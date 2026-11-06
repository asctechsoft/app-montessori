'use client';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { GuardedLink } from '@/components/layout/nav';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'destructiveOutline';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface BaseProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Đang gửi: chặn bấm lần hai, hiện vòng xoay, vẫn giữ nhãn. */
  loading?: boolean;
  icon?: IconName;
  block?: boolean;
  children: ReactNode;
}

export type ButtonProps = BaseProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>;

/** Nhãn dạng động từ + đối tượng: "Tạo cơ sở", "Lưu vai trò". Nút đỏ chỉ cho thao tác nguy hiểm, không dùng cho "Quay lại". */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, block, children, disabled, className, type = 'button', onClick, ...rest },
  ref,
) {
  const cls = ['btn', `btn-${size}`, `btn-${variant}`, block ? 'btn-block' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button
      ref={ref}
      type={type}
      className={cls}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={(e) => {
        if (loading) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      {...rest}
    >
      {loading ? <Icon name="refresh" size={20} className="icon spin" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
});

export function LinkButton({
  href, variant = 'primary', size = 'md', icon, children, block,
}: { href: string; variant?: ButtonVariant; size?: ButtonSize; icon?: IconName; children: ReactNode; block?: boolean }) {
  const cls = ['btn', `btn-${size}`, `btn-${variant}`, block ? 'btn-block' : ''].filter(Boolean).join(' ');
  return (
    <GuardedLink href={href} className={cls}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </GuardedLink>
  );
}

export function IconButton({
  icon, label, onClick, disabled, ...rest
}: { icon: IconName; label: string; onClick?: () => void; disabled?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'>) {
  return (
    <button type="button" className="btn btn-icon btn-md" aria-label={label} title={label} onClick={onClick} disabled={disabled} {...rest}>
      <Icon name={icon} size={24} />
    </button>
  );
}
