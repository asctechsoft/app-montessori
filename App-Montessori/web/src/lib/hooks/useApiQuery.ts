'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { callApi, toApiError, type ApiError } from '../api';

export interface ApiQueryState<T> {
  status: 'loading' | 'ready' | 'error';
  data: T | null;
  error: ApiError | null;
  retry: () => void;
}

/**
 * Đọc dữ liệu qua action `api` (vd. dashboard.chain, report.get). `key` đổi => tải lại; `null` => chưa chạy.
 * Không bịa dữ liệu: lỗi => status 'error' để UI hiện Thử lại.
 */
export function useApiQuery<T = unknown>(key: string | null, action: string, input: () => { orgId?: string; campusId?: string; payload?: unknown }): ApiQueryState<T> {
  const [state, setState] = useState<Omit<ApiQueryState<T>, 'retry'>>({ status: 'loading', data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  });

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading', error: null }));
    callApi<T>(action, inputRef.current())
      .then((data) => !cancelled && setState({ status: 'ready', data, error: null }))
      .catch((e) => !cancelled && setState({ status: 'error', data: null, error: toApiError(e) }));
    return () => {
      cancelled = true;
    };
  }, [key, action, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
