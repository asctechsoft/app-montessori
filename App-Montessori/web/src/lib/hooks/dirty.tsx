'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/ui/Modal';

import { DirtyContext as Ctx } from './dirtyStore';
export { useDirtyGuard, useDirtyRegistration } from './dirtyStore';

export function DirtyProvider({ children }: { children: ReactNode }) {
  const dirtyIds = useRef(new Set<string>());
  const [ask, setAsk] = useState<{ what: string; resolve: (v: boolean) => void } | null>(null);

  const register = useCallback((id: string, dirty: boolean) => {
    if (dirty) dirtyIds.current.add(id);
    else dirtyIds.current.delete(id);
  }, []);
  const isDirty = useCallback(() => dirtyIds.current.size > 0, []);
  const confirmDiscard = useCallback(
    (what = 'chuyển trang') =>
      new Promise<boolean>((resolve) => {
        if (dirtyIds.current.size === 0) return resolve(true);
        setAsk({ what, resolve });
      }),
    [],
  );

  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (dirtyIds.current.size > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, []);

  const api = useMemo(() => ({ register, isDirty, confirmDiscard }), [register, isDirty, confirmDiscard]);

  const close = (v: boolean) => {
    ask?.resolve(v);
    if (v) dirtyIds.current.clear();
    setAsk(null);
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      <ConfirmDialog
        open={!!ask}
        title="Bỏ thay đổi chưa lưu?"
        subject="Biểu mẫu đang mở"
        impact={[`Các thay đổi chưa lưu sẽ mất nếu bạn ${ask?.what ?? 'chuyển trang'}.`, 'Dữ liệu đã lưu trước đó không bị ảnh hưởng.']}
        confirmLabel="Bỏ thay đổi"
        cancelLabel="Ở lại chỉnh sửa"
        tone="primary"
        onConfirm={() => close(true)}
        onCancel={() => close(false)}
      />
    </Ctx.Provider>
  );
}

