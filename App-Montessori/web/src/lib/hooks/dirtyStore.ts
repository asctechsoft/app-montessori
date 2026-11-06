'use client';
import { createContext, useContext, useEffect, useId } from 'react';

export interface DirtyApi {
  register: (id: string, dirty: boolean) => void;
  isDirty: () => boolean;
  /** Nếu có biểu mẫu chưa lưu: hỏi "Bỏ thay đổi / Ở lại". Trả true nếu được phép đi tiếp. */
  confirmDiscard: (what?: string) => Promise<boolean>;
}

export const DirtyContext = createContext<DirtyApi | null>(null);

export function useDirtyGuard(): DirtyApi {
  const c = useContext(DirtyContext);
  if (!c) throw new Error('useDirtyGuard cần DirtyProvider');
  return c;
}

/** Đăng ký trạng thái chưa lưu của một biểu mẫu (chặn rời trang / đổi cơ sở khi chưa lưu). */
export function useDirtyRegistration(dirty: boolean) {
  const { register } = useDirtyGuard();
  const id = useId();
  useEffect(() => {
    register(id, dirty);
    return () => register(id, false);
  }, [register, id, dirty]);
}
