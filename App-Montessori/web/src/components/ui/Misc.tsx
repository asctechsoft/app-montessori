import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Button } from './Button';

/* ---------- Skeleton ---------- */
export function Skeleton({ width = '100%', height = 16, style }: { width?: number | string; height?: number | string; style?: CSSProperties }) {
  return <span className="skeleton" style={{ width, height, ...style }} aria-hidden="true" />;
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="stack-sm" role="status" aria-label="Đang tải">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </div>
  );
}

/* ---------- EmptyState ---------- */
interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: IconName;
  tone?: 'neutral' | 'error';
  action?: ReactNode;
}

export function EmptyState({ title, description, icon = 'inbox', tone = 'neutral', action }: EmptyStateProps) {
  return (
    <div className="empty" role={tone === 'error' ? 'alert' : undefined}>
      <span className={`empty-icon ${tone === 'error' ? 'empty-icon-error' : ''}`}>
        <Icon name={icon} size={28} />
      </span>
      <div className="empty-title">{title}</div>
      {description ? <div className="empty-desc">{description}</div> : null}
      {action}
    </div>
  );
}

/** Trạng thái lỗi tải + nút Thử lại. */
export function ErrorState({ message, onRetry, title = 'Không tải được dữ liệu' }: { message?: string; onRetry?: () => void; title?: string }) {
  return (
    <EmptyState
      tone="error"
      icon="alert-circle"
      title={title}
      description={message}
      action={onRetry ? <Button variant="secondary" icon="refresh" onClick={onRetry}>Thử lại</Button> : undefined}
    />
  );
}

/* ---------- Stat / MetricCard ---------- */
export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'error' | 'success' | 'warning' }) {
  const color = tone ? `var(--color-${tone})` : undefined;
  return (
    <div className="card stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={{ color }}>{value}</span>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  );
}
export const MetricCard = Stat;

/* ---------- Breadcrumbs ---------- */
export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="crumbs" aria-label="Đường dẫn">
      {items.map((it, i) => (
        <span key={i} className="row" style={{ gap: 'var(--space-1)' }}>
          {i > 0 ? <Icon name="chevron-right" size={16} /> : null}
          {it.href && i < items.length - 1 ? <Link href={it.href}>{it.label}</Link> : <span aria-current={i === items.length - 1 ? 'page' : undefined}>{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

/* ---------- PageHeader ---------- */
interface PageHeaderProps {
  title: string;
  /** Mã màn hình W## (hiện nhỏ phía trên để đối chiếu thiết kế). */
  code?: string;
  description?: string;
  breadcrumbs?: { label: string; href?: string }[];
  actions?: ReactNode;
}

export function PageHeader({ title, code, description, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <header className="page-head">
      <div style={{ minWidth: 0 }}>
        {breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : null}
        {code ? <div className="page-head-code">{code}</div> : null}
        <h1>{title}</h1>
        {description ? <p className="text-secondary" style={{ marginTop: 'var(--space-1)' }}>{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

/* ---------- Stepper ---------- */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="stepper" aria-label="Các bước">
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li key={s} className={`step step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="step-dot">{state === 'done' ? <Icon name="check" size={16} /> : i + 1}</span>
            <span>{s}</span>
            {i < steps.length - 1 ? <span className="step-sep" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
