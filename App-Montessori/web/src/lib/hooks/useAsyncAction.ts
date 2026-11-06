'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { newOpId, toApiError, type ApiError } from '../api';

export interface AsyncActionState<A extends unknown[], R> {
  /** Chạy thao tác. Bỏ qua nếu đang busy (chống gửi trùng). Trả `undefined` nếu lỗi (xem `error`). */
  run: (...args: A) => Promise<R | undefined>;
  busy: boolean;
  error: ApiError | null;
  reset: () => void;
}

/**
 * Bọc một thao tác ghi: busy + chống gửi trùng + `opId` ỔN ĐỊNH cho một lần submit.
 * opId chỉ đổi sau khi thao tác thành công; nếu lỗi và người dùng bấm lại, vẫn dùng cùng opId
 * (máy chủ xóa bản ghi ops khi lỗi nên gửi lại an toàn, và nếu lần trước thực ra đã thành công thì nhận lại đúng kết quả cũ).
 * Không bao giờ coi là thành công trước khi promise của máy chủ resolve.
 */
export function useAsyncAction<A extends unknown[], R>(fn: (opId: string, ...args: A) => Promise<R>): AsyncActionState<A, R> {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const busyRef = useRef(false);
  const opRef = useRef<string | null>(null);
  const fnRef = useRef(fn);
  const alive = useRef(true);
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(async (...args: A) => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    opRef.current ??= newOpId();
    try {
      const result = await fnRef.current(opRef.current, ...args);
      opRef.current = null;
      return result;
    } catch (e) {
      if (alive.current) setError(toApiError(e));
      return undefined;
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);

  const reset = useCallback(() => {
    setError(null);
  }, []);

  return { run, busy, error, reset };
}
