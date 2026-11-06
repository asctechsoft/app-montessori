import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { statusInfo, type StatusDomain, type Tone } from '@/lib/status';

const TONE_ICON: Record<Tone, IconName> = {
  success: 'check-circle',
  warning: 'alert',
  error: 'x-circle',
  info: 'info',
  neutral: 'minus',
};

/** Badge: luôn chữ + biểu tượng, không chỉ dựa vào màu. */
export function Badge({ tone = 'neutral', children, icon }: { tone?: Tone; children: ReactNode; icon?: IconName }) {
  return (
    <span className={`badge badge-${tone}`}>
      <Icon name={icon ?? TONE_ICON[tone]} size={14} />
      {children}
    </span>
  );
}

/** Trạng thái theo nhãn VN trong CONTRACT §9: <StatusBadge domain="campus" value="active" />. */
export function StatusBadge({ domain, value }: { domain: StatusDomain; value: string | null | undefined }) {
  const s = statusInfo(domain, value);
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
