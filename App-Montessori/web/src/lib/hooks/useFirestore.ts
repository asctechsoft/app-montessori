'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { onSnapshot, type DocumentData, type DocumentReference, type DocumentSnapshot, type Query, type QuerySnapshot } from 'firebase/firestore';

export type DataStatus = 'loading' | 'ready' | 'empty' | 'error';

export interface QueryState<T> {
  status: DataStatus;
  data: T[];
  error: Error | null;
  /** Đang kết nối lại / dữ liệu từ cache chưa được máy chủ xác nhận. */
  fromCache: boolean;
  retry: () => void;
}

export interface DocState<T> {
  status: DataStatus; // empty = tài liệu không tồn tại
  data: T | null;
  error: Error | null;
  retry: () => void;
}

export function friendlyFirestoreError(e: unknown): Error {
  const code = (e as { code?: string })?.code ?? '';
  if (code === 'permission-denied') return new Error('Bạn không có quyền xem dữ liệu này.');
  if (code === 'unavailable') return new Error('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.');
  if (code === 'failed-precondition') return new Error('Truy vấn cần chỉ mục (index) chưa được tạo. Báo quản trị kỹ thuật.');
  return new Error('Không tải được dữ liệu. Vui lòng thử lại.');
}

/** Huỷ listener an toàn: sau khi onSnapshot gọi error callback listener đã bị SDK huỷ, gọi unsubscribe lần nữa có thể ném INTERNAL ASSERTION FAILED. */
function safeUnsub(unsub: () => void, state: { errored: boolean }): () => void {
  return () => {
    if (state.errored) return;
    state.errored = true;
    try {
      unsub();
    } catch {
      /* listener đã bị huỷ */
    }
  };
}

/** onSnapshot với huỷ an toàn (không unsubscribe lần 2 sau lỗi, bọc try/catch). Dùng cho listener ngoài hook. */
export function safeOnSnapshot(target: Query<DocumentData>, onNext: (snap: QuerySnapshot<DocumentData>) => void, onError?: (e: unknown) => void): () => void;
export function safeOnSnapshot(target: DocumentReference<DocumentData>, onNext: (snap: DocumentSnapshot<DocumentData>) => void, onError?: (e: unknown) => void): () => void;
export function safeOnSnapshot(target: Query<DocumentData> | DocumentReference<DocumentData>, onNext: (snap: never) => void, onError?: (e: unknown) => void): () => void {
  const st = { errored: false };
  const unsub = (onSnapshot as (t: unknown, n: unknown, e: unknown) => () => void)(target, onNext, (e: unknown) => {
    st.errored = true;
    onError?.(e);
  });
  return safeUnsub(unsub, st);
}

/**
 * Đọc realtime một truy vấn Firestore (rules chặn theo membership).
 * `key`: chuỗi định danh truy vấn; đổi key (vd. đổi cơ sở) thì tải lại. `null` = chưa chạy (vẫn loading).
 * `build`: trả Query (hoặc null nếu thiếu điều kiện). Phân trạng thái: loading / ready / empty / error + retry.
 * Lọc "không có kết quả" (no-results) do UI/DataTable xử lý vì còn bộ lọc phía client.
 */
export function useFirestoreQuery<T = DocumentData>(
  key: string | null,
  build: () => Query<DocumentData> | null,
  map?: (id: string, data: DocumentData) => T,
): QueryState<T> {
  const [state, setState] = useState<Omit<QueryState<T>, 'retry'>>({ status: 'loading', data: [], error: null, fromCache: false });
  const [attempt, setAttempt] = useState(0);
  const buildRef = useRef(build);
  const mapRef = useRef(map);
  useEffect(() => {
    buildRef.current = build;
    mapRef.current = map;
  });

  useEffect(() => {
    if (key === null) {
      setState({ status: 'loading', data: [], error: null, fromCache: false });
      return;
    }
    const q = buildRef.current();
    if (!q) {
      setState({ status: 'loading', data: [], error: null, fromCache: false });
      return;
    }
    setState((s) => ({ ...s, status: 'loading', error: null }));
    const st = { errored: false };
    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => (mapRef.current ? mapRef.current(d.id, d.data()) : ({ id: d.id, ...d.data() } as unknown as T)));
        setState({ status: data.length === 0 ? 'empty' : 'ready', data, error: null, fromCache: snap.metadata.fromCache });
      },
      (e) => {
        st.errored = true;
        setState({ status: 'error', data: [], error: friendlyFirestoreError(e), fromCache: false });
      },
    );
    return safeUnsub(unsub, st);
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}

/** Đọc realtime một tài liệu. */
export function useDoc<T = DocumentData>(
  key: string | null,
  build: () => DocumentReference<DocumentData> | null,
  map?: (id: string, data: DocumentData) => T,
): DocState<T> {
  const [state, setState] = useState<Omit<DocState<T>, 'retry'>>({ status: 'loading', data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const buildRef = useRef(build);
  const mapRef = useRef(map);
  useEffect(() => {
    buildRef.current = build;
    mapRef.current = map;
  });

  useEffect(() => {
    if (key === null) {
      setState({ status: 'loading', data: null, error: null });
      return;
    }
    const ref = buildRef.current();
    if (!ref) {
      setState({ status: 'loading', data: null, error: null });
      return;
    }
    setState((s) => ({ ...s, status: 'loading', error: null }));
    const st = { errored: false };
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) setState({ status: 'empty', data: null, error: null });
        else setState({ status: 'ready', data: mapRef.current ? mapRef.current(snap.id, snap.data()) : ({ id: snap.id, ...snap.data() } as unknown as T), error: null });
      },
      (e) => {
        st.errored = true;
        setState({ status: 'error', data: null, error: friendlyFirestoreError(e) });
      },
    );
    return safeUnsub(unsub, st);
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
