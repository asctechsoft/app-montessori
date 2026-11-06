'use client';
import type { KeyboardEvent, ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
  badge?: ReactNode;
}

export function Tabs({ items, active, onChange, label = 'Chuyển mục' }: { items: TabItem[]; active: string; onChange: (id: string) => void; label?: string }) {
  const onKey = (e: KeyboardEvent) => {
    const i = items.findIndex((t) => t.id === active);
    if (e.key === 'ArrowRight') onChange(items[(i + 1) % items.length].id);
    if (e.key === 'ArrowLeft') onChange(items[(i - 1 + items.length) % items.length].id);
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {items.map((t) => (
        <button key={t.id} type="button" role="tab" className="tab" aria-selected={t.id === active} tabIndex={t.id === active ? 0 : -1} onClick={() => onChange(t.id)}>
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}
