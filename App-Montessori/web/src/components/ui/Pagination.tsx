'use client';
import { Icon } from './Icon';

interface PaginationProps {
  page: number; // bắt đầu từ 1
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
  onPageSizeChange?: (s: number) => void;
  sizes?: number[];
}

function pageList(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(pages - 1, page + 1);
  if (from > 2) out.push('…');
  for (let i = from; i <= to; i++) out.push(i);
  if (to < pages - 1) out.push('…');
  out.push(pages);
  return out;
}

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, sizes = [10, 20, 50] }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="pager" aria-label="Phân trang">
      <div className="row" style={{ gap: 'var(--space-3)' }}>
        <span>Hiển thị {from}–{to} / {total}</span>
        {onPageSizeChange ? (
          <label className="row" style={{ gap: 'var(--space-2)' }}>
            <span>Số dòng</span>
            <select className="control" style={{ minHeight: 'var(--size-touch-min)', width: 'auto' }} value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
              {sizes.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="pager-nav">
        <button type="button" className="pager-btn" aria-label="Trang trước" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <Icon name="chevron-left" />
        </button>
        {pageList(page, pages).map((p, i) =>
          p === '…' ? (
            <span key={`e${i}`} aria-hidden="true">…</span>
          ) : (
            <button key={p} type="button" className="pager-btn" aria-current={p === page ? 'page' : undefined} aria-label={`Trang ${p}`} onClick={() => onPageChange(p)}>
              {p}
            </button>
          ),
        )}
        <button type="button" className="pager-btn" aria-label="Trang sau" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          <Icon name="chevron-right" />
        </button>
      </div>
    </nav>
  );
}
