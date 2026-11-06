import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import type { Tone } from '@/lib/status';

const ICON: Record<Exclude<Tone, 'neutral'>, IconName> = {
  success: 'check-circle',
  warning: 'alert',
  error: 'alert-circle',
  info: 'info',
};

interface BannerProps {
  tone?: Exclude<Tone, 'neutral'>;
  title?: string;
  children?: ReactNode;
  /** Hành động riêng (vd. nút "Thử lại"). */
  action?: ReactNode;
}

/** Banner trạng thái; lỗi dùng role=alert, còn lại role=status. */
export function Banner({ tone = 'info', title, children, action }: BannerProps) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={ICON[tone]} size={20} />
      <div className="banner-body">
        {title ? <div className="banner-title">{title}</div> : null}
        {children ? <div>{children}</div> : null}
        {action ? <div className="banner-action">{action}</div> : null}
      </div>
    </div>
  );
}
