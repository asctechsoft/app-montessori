'use client';
import {
  createContext, forwardRef, useContext, useEffect, useState,
  type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { Icon } from './Icon';
import { formatDate, parseDisplayDate } from '@/lib/format';

interface FieldCtx {
  id?: string;
  describedBy?: string;
  invalid?: boolean;
  required?: boolean;
}
const FieldContext = createContext<FieldCtx>({});

interface FormFieldProps {
  /** Tên field: id của control = `field-${name}` (useForm dùng để cuộn/focus tới lỗi đầu tiên). */
  name: string;
  label: string;
  required?: boolean;
  helper?: string;
  error?: string;
  children: ReactNode;
}

/** Label luôn ngoài input; helper và lỗi (icon + chữ) nằm ngay dưới field. */
export function FormField({ name, label, required, helper, error, children }: FormFieldProps) {
  const id = `field-${name}`;
  const msgId = `${id}-msg`;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        {required ? (
          <>
            <span className="field-req" aria-hidden="true">*</span>
            <span className="sr-only"> (bắt buộc)</span>
          </>
        ) : null}
      </label>
      <FieldContext.Provider value={{ id, describedBy: error || helper ? msgId : undefined, invalid: !!error, required }}>{children}</FieldContext.Provider>
      {error ? (
        <div className="field-error" id={msgId} role="alert">
          <Icon name="alert-circle" size={16} style={{ marginTop: 3 }} />
          <span>{error}</span>
        </div>
      ) : helper ? (
        <div className="field-help" id={msgId}>{helper}</div>
      ) : null}
    </div>
  );
}

function useCtl(name: string | undefined, invalid?: boolean) {
  const c = useContext(FieldContext);
  return {
    id: c.id ?? (name ? `field-${name}` : undefined),
    'aria-describedby': c.describedBy,
    'aria-invalid': (invalid ?? c.invalid) || undefined,
    'aria-required': c.required || undefined,
  };
}

type InputBase = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>;

interface InputProps extends InputBase {
  value: string | undefined | null;
  onValueChange?: (v: string) => void;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ value, onValueChange, invalid, name, className, ...rest }, ref) {
  const a = useCtl(name, invalid);
  return <input ref={ref} className={`control ${className ?? ''}`} name={name} value={value ?? ''} onChange={(e) => onValueChange?.(e.target.value)} {...a} {...rest} />;
});

interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string | undefined | null;
  onValueChange?: (v: string) => void;
  invalid?: boolean;
}

export function Textarea({ value, onValueChange, invalid, name, className, ...rest }: TextareaProps) {
  const a = useCtl(name, invalid);
  return <textarea className={`control ${className ?? ''}`} name={name} value={value ?? ''} onChange={(e) => onValueChange?.(e.target.value)} {...a} {...rest} />;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> {
  value: string | undefined | null;
  onValueChange?: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  invalid?: boolean;
}

export function Select({ value, onValueChange, options, placeholder, invalid, name, className, ...rest }: SelectProps) {
  const a = useCtl(name, invalid);
  return (
    <select className={`control ${className ?? ''}`} name={name} value={value ?? ''} onChange={(e) => onValueChange?.(e.target.value)} {...a} {...rest}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
      ))}
    </select>
  );
}

interface DateInputProps {
  /** Giá trị lưu: `YYYY-MM-DD` hoặc rỗng. Hiển thị dd/MM/yyyy. */
  value: string | undefined | null;
  onValueChange?: (iso: string) => void;
  onBlur?: () => void;
  name?: string;
  invalid?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
}

/** Ô nhập ngày dd/MM/yyyy có kiểm tra (không nhận ngày không tồn tại). Không dùng `type=date` để hiển thị đúng định dạng VN ở mọi trình duyệt. */
export function DateInput({ value, onValueChange, onBlur, name, invalid, disabled, readOnly }: DateInputProps) {
  const a = useCtl(name, invalid);
  const [text, setText] = useState(value ? formatDate(value) : '');
  const [bad, setBad] = useState(false);
  useEffect(() => {
    // Đồng bộ khi giá trị bên ngoài thay đổi (vd. reset form), nhưng không ghi đè lúc đang gõ dở.
    if (value && parseDisplayDate(text) !== value) setText(formatDate(value));
    if (!value && parseDisplayDate(text)) setText('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const onChange = (raw: string) => {
    const digits = raw.replace(/[^\d]/g, '').slice(0, 8);
    let out = digits;
    if (digits.length > 4) out = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    else if (digits.length > 2) out = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    setText(out);
    const iso = parseDisplayDate(out);
    setBad(out.length === 10 && !iso);
    onValueChange?.(iso ?? '');
  };

  return (
    <div className="control-affix">
      <input
        className="control"
        name={name}
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/MM/yyyy"
        maxLength={10}
        value={text}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (text && !parseDisplayDate(text)) setBad(true);
          onBlur?.();
        }}
        {...a}
        aria-invalid={a['aria-invalid'] || bad || undefined}
      />
      {bad ? <span className="sr-only" role="alert">Ngày không hợp lệ</span> : null}
    </div>
  );
}

interface MoneyInputProps {
  /** Số nguyên VND, hoặc null khi trống. */
  value: number | null | undefined;
  onValueChange?: (v: number | null) => void;
  onBlur?: () => void;
  name?: string;
  invalid?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
}

const group = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Nhập tiền VND nguyên: tự nhóm hàng nghìn (4.100.000), đuôi "đ". Chỉ nhận chữ số. */
export function MoneyInput({ value, onValueChange, onBlur, name, invalid, disabled, readOnly, placeholder = '0' }: MoneyInputProps) {
  const a = useCtl(name, invalid);
  return (
    <div className="control-affix">
      <input
        className="control"
        name={name}
        inputMode="numeric"
        autoComplete="off"
        style={{ textAlign: 'right' }}
        placeholder={placeholder}
        value={value === null || value === undefined ? '' : group(value)}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^\d]/g, '').slice(0, 13);
          onValueChange?.(digits ? parseInt(digits, 10) : null);
        }}
        onBlur={onBlur}
        {...a}
      />
      <span className="affix" aria-hidden="true">đ</span>
    </div>
  );
}

export function Checkbox({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}
