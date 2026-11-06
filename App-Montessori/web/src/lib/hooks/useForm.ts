'use client';
import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react';
import type { ApiError } from '../api';
import { useAsyncAction } from './useAsyncAction';
import { useDirtyRegistration } from './dirtyStore';

export type FieldErrors = Record<string, string | undefined>;

export interface UseFormOptions<T extends Record<string, unknown>> {
  initial: T;
  /** Trả về lỗi theo field (rỗng = hợp lệ). Chạy khi rời field (sau khi chạm) và khi gửi. */
  validate?: (values: T) => FieldErrors;
  /** Đăng ký chặn rời trang khi dirty (mặc định true). */
  guard?: boolean;
}

/**
 * Biểu mẫu: lỗi theo field, giữ dữ liệu khi lỗi, dirty tracking, chặn rời trang, chống gửi trùng + opId ổn định.
 *
 *   const form = useForm({ initial: { name: '' }, validate: v => (v.name ? {} : { name: 'Nhập tên.' }) });
 *   <FormField label="Tên" required {...form.field('name')}><Input {...form.bind('name')} /></FormField>
 *   <form onSubmit={form.onSubmit(async (values, opId) => { await callApi('x', { opId, payload: values }); })}>
 *     {form.formError && <Banner tone="error">{form.formError}</Banner>}
 *     <Button type="submit" loading={form.submitting}>Lưu cơ sở</Button>
 */
export function useForm<T extends Record<string, unknown>>({ initial, validate, guard = true }: UseFormOptions<T>) {
  const baseline = useRef<T>(initial);
  const [values, setValuesState] = useState<T>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(baseline.current), [values]);
  useDirtyRegistration(guard && dirty);

  const runValidate = useCallback((v: T): FieldErrors => (validate ? validate(v) : {}), [validate]);

  const action = useAsyncAction(async (opId: string, handler: (values: T, opId: string) => Promise<unknown>, snapshot: T) => handler(snapshot, opId));
  const apiError: ApiError | null = action.error;
  const serverFieldErrors = apiError?.fieldErrors;
  const mergedErrors = useMemo<FieldErrors>(() => ({ ...(serverFieldErrors ?? {}), ...errors }), [serverFieldErrors, errors]);

  const setValue = useCallback(
    <K extends keyof T>(name: K, value: T[K]) => {
      const key = name as string;
      setValuesState((prev) => {
        const next = { ...prev, [name]: value };
        if (submitted || touched[key]) {
          const all = runValidate(next);
          setErrors((old) => {
            const copy = { ...old };
            if (all[key]) copy[key] = all[key];
            else delete copy[key];
            return copy;
          });
        } else {
          setErrors((old) => {
            if (!old[key]) return old;
            const copy = { ...old };
            delete copy[key];
            return copy;
          });
        }
        return next;
      });
    },
    [runValidate, submitted, touched],
  );

  const setValues = useCallback((patch: Partial<T>) => setValuesState((p) => ({ ...p, ...patch })), []);

  const touch = useCallback(
    (name: string) => {
      setTouched((t) => (t[name] ? t : { ...t, [name]: true }));
      const all = runValidate(values);
      setErrors((old) => {
        const copy = { ...old };
        if (all[name]) copy[name] = all[name];
        else delete copy[name];
        return copy;
      });
    },
    [runValidate, values],
  );

  /** Thuộc tính truyền cho FormField (cùng với name, label): { error }. */
  const field = useCallback((name: keyof T & string) => ({ error: mergedErrors[name] }), [mergedErrors]);

  /** Thuộc tính truyền cho Input/Select/Textarea/DateInput/MoneyInput: { name, value, onValueChange, onBlur, invalid }. */
  const bind = useCallback(
    <K extends keyof T & string>(name: K) => ({
      name,
      value: values[name],
      invalid: !!mergedErrors[name],
      onValueChange: (v: T[K]) => setValue(name, v),
      onBlur: () => touch(name),
    }),
    [values, mergedErrors, setValue, touch],
  );

  const reset = useCallback((next?: T) => {
    const base = next ?? baseline.current;
    baseline.current = base;
    setValuesState(base);
    setErrors({});
    setTouched({});
    setSubmitted(false);
    setFormError(null);
    action.reset();
  }, [action]);

  const focusFirstError = (errs: FieldErrors) => {
    const first = Object.keys(errs)[0];
    if (!first || typeof document === 'undefined') return;
    const el = document.getElementById(`field-${first}`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.focus?.();
    }
  };

  const onSubmit = useCallback(
    (handler: (values: T, opId: string) => Promise<unknown>) =>
      async (e?: FormEvent) => {
        e?.preventDefault();
        if (action.busy) return undefined;
        setSubmitted(true);
        setFormError(null);
        const errs = runValidate(values);
        setErrors(errs);
        if (Object.keys(errs).length > 0) {
          setFormError('Vui lòng kiểm tra lại các trường được đánh dấu.');
          focusFirstError(errs);
          return undefined;
        }
        const res = await action.run(handler, values);
        return res;
      },
    [action, runValidate, values],
  );

  return {
    values,
    errors: mergedErrors,
    touched,
    dirty,
    submitting: action.busy,
    /** Thông điệp lỗi chung (đặt trên nút gửi): lỗi kiểm tra hoặc lỗi máy chủ. */
    formError: formError ?? (apiError ? apiError.message : null),
    apiError,
    setValue,
    setValues,
    setErrors,
    setFormError,
    touch,
    field,
    bind,
    reset,
    onSubmit,
  };
}

export type FormApi<T extends Record<string, unknown>> = ReturnType<typeof useForm<T>>;
