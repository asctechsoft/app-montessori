import type { ReactNode, HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  actions?: ReactNode;
  /** Bỏ padding (dùng cho bảng sát mép). */
  flush?: boolean;
}

export function Card({ title, actions, flush, children, className, ...rest }: CardProps) {
  return (
    <section className={`card ${flush ? 'card-flush' : ''} ${className ?? ''}`} {...rest}>
      {title || actions ? (
        <div className="card-head" style={flush ? { padding: 'var(--space-4) var(--space-4) 0' } : undefined}>
          {title ? <h3 className="card-title">{title}</h3> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
