'use client';
import { useCallback, type AnchorHTMLAttributes, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDirtyGuard } from '@/lib/hooks/dirtyStore';

/** Điều hướng có hỏi bỏ thay đổi khi biểu mẫu chưa lưu. */
export function useGuardedNavigate() {
  const router = useRouter();
  const { confirmDiscard } = useDirtyGuard();
  return useCallback(
    async (href: string, replace = false) => {
      if (!(await confirmDiscard('rời trang này'))) return false;
      if (replace) router.replace(href);
      else router.push(href);
      return true;
    },
    [router, confirmDiscard],
  );
}

interface Props extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  children: ReactNode;
  onNavigate?: () => void;
}

/** Link nội bộ có chặn rời trang khi biểu mẫu dirty. */
export function GuardedLink({ href, children, onNavigate, onClick, ...rest }: Props) {
  const go = useGuardedNavigate();
  const { isDirty } = useDirtyGuard();
  return (
    <Link
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
        if (isDirty()) {
          e.preventDefault();
          void go(href).then((ok) => ok && onNavigate?.());
        } else {
          onNavigate?.();
        }
      }}
      {...rest}
    >
      {children}
    </Link>
  );
}
