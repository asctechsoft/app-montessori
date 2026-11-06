'use client';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/Toast';
import { DirtyProvider } from '@/lib/hooks/dirty';
import { AuthProvider } from './AuthProvider';

/** Thứ tự: Toast > Dirty (chặn rời trang) > Auth. ScopeProvider nằm trong nhóm route (app) vì cần đã đăng nhập. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <DirtyProvider>
        <AuthProvider>{children}</AuthProvider>
      </DirtyProvider>
    </ToastProvider>
  );
}
