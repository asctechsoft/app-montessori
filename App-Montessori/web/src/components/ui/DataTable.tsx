'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Button } from './Button';
import { Pagination } from './Pagination';
import { EmptyState, ErrorState, Skeleton } from './Misc';
import type { DataStatus } from '@/lib/hooks/useFirestore';

export interface Column<T> {
  key: string;
  header: string;
  /** Hiển thị ô. Mặc định: String(value(row)). */
  render?: (row: T) => ReactNode;
  /** Giá trị thô để sắp xếp / tìm kiếm / cộng tổng. */
  value?: (row: T) => string | number | null | undefined;
  sortable?: boolean;
  align?: 'left' | 'right';
  /** Tổng theo phạm vi đang lọc: 'sum' (cộng value) hoặc hàm tự dựng. */
  total?: 'sum' | ((rows: T[]) => ReactNode);
  /** Định dạng ô tổng khi dùng 'sum' (vd. formatVnd). */
  formatTotal?: (n: number) => ReactNode;
  width?: number | string;
}

export interface TableFilter<T> {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  predicate: (row: T, value: string) => boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** loading → skeleton; error → Thử lại; empty/ready được suy ra từ rows. */
  status: DataStatus;
  error?: string | null;
  onRetry?: () => void;
  caption: string;

  searchPlaceholder?: string;
  /** Có hàm này thì bật ô tìm kiếm. Mặc định tìm trong value() của mọi cột. */
  searchText?: (row: T) => string;
  filters?: TableFilter<T>[];
  pageSize?: number;
  onRowClick?: (row: T) => void;

  selectable?: boolean;
  /** Thanh thao tác khi có dòng được chọn. */
  bulkActions?: (selectedKeys: string[], clear: () => void) => ReactNode;

  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  toolbarExtra?: ReactNode;
  totalLabel?: string;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();

/**
 * Bảng dữ liệu đủ 5 trạng thái: Đang tải (skeleton) / Có dữ liệu / Chưa có dữ liệu (empty) /
 * Không có kết quả lọc (kèm "Xóa bộ lọc") / Lỗi (kèm Thử lại). Sắp xếp, tìm kiếm không dấu, lọc, phân trang,
 * chọn nhiều, hàng click, tổng theo phạm vi lọc.
 */
export function DataTable<T>({
  columns, rows, rowKey, status, error, onRetry, caption, searchPlaceholder = 'Tìm kiếm', searchText, filters, pageSize: initialSize = 10,
  onRowClick, selectable, bulkActions, emptyTitle = 'Chưa có dữ liệu', emptyDescription, emptyAction, toolbarExtra, totalLabel = 'Tổng theo bộ lọc hiện tại',
}: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialSize);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const activeFilters = Object.values(filterValues).some(Boolean) || query.trim() !== '';
  const clearFilters = () => {
    setQuery('');
    setFilterValues({});
    setPage(1);
  };

  const filtered = useMemo(() => {
    let out = rows;
    const q = norm(query.trim());
    if (q) {
      out = out.filter((r) => {
        const text = searchText ? searchText(r) : columns.map((c) => String(c.value?.(r) ?? '')).join(' ');
        return norm(text).includes(q);
      });
    }
    for (const f of filters ?? []) {
      const v = filterValues[f.key];
      if (v) out = out.filter((r) => f.predicate(r, v));
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.value) {
        const get = col.value;
        const dir = sort.dir === 'asc' ? 1 : -1;
        out = [...out].sort((a, b) => {
          const x = get(a), y = get(b);
          if (x === y) return 0;
          if (x === null || x === undefined) return 1;
          if (y === null || y === undefined) return -1;
          if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
          return String(x).localeCompare(String(y), 'vi') * dir;
        });
      }
    }
    return out;
  }, [rows, query, filters, filterValues, sort, columns, searchText]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  const hasTotals = columns.some((c) => c.total);
  const colSpan = columns.length + (selectable ? 1 : 0);
  const showToolbar = !!searchText || !!filters?.length || !!toolbarExtra;
  const clearSel = () => setSelected(new Set());

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' }));
  };

  const allOnPage = pageRows.length > 0 && pageRows.every((r) => selected.has(rowKey(r)));

  let body: ReactNode;
  if (status === 'error') {
    body = <ErrorState message={error ?? undefined} onRetry={onRetry} />;
  } else if (status === 'loading') {
    body = (
      <div className="dt-scroll" role="status" aria-label="Đang tải dữ liệu">
        <table className="dt" aria-hidden="true">
          <tbody>
            {Array.from({ length: 5 }, (_, i) => (
              <tr key={i}>
                {Array.from({ length: Math.max(colSpan, 3) }, (_, j) => (
                  <td key={j}><Skeleton height={18} width={j === 0 ? '70%' : '90%'} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else if (rows.length === 0) {
    body = <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  } else if (filtered.length === 0) {
    body = (
      <EmptyState
        icon="search"
        title="Không có kết quả phù hợp"
        description="Không có dòng nào khớp từ khóa hoặc bộ lọc hiện tại."
        action={<Button variant="secondary" onClick={clearFilters}>Xóa bộ lọc</Button>}
      />
    );
  } else {
    body = (
      <div className="dt-scroll">
        <table className="dt">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {selectable ? (
                <th className="dt-check" scope="col">
                  <input
                    type="checkbox"
                    aria-label="Chọn tất cả dòng trong trang"
                    checked={allOnPage}
                    onChange={(e) => {
                      const next = new Set(selected);
                      pageRows.forEach((r) => (e.target.checked ? next.add(rowKey(r)) : next.delete(rowKey(r))));
                      setSelected(next);
                    }}
                  />
                </th>
              ) : null}
              {columns.map((c) => (
                <th key={c.key} scope="col" className={c.align === 'right' ? 'num' : ''} style={{ width: c.width }} aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.sortable && c.value ? (
                    <button type="button" className="dt-sort" onClick={() => toggleSort(c.key)}>
                      {c.header}
                      <Icon name={sort?.key === c.key ? (sort.dir === 'asc' ? 'chevron-up' : 'chevron-down') : 'arrow-up-down'} size={16} />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const k = rowKey(r);
              return (
                <tr
                  key={k}
                  className={`${onRowClick ? 'clickable' : ''} ${selected.has(k) ? 'selected' : ''}`}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(r); } : undefined}
                >
                  {selectable ? (
                    <td className="dt-check" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label="Chọn dòng"
                        checked={selected.has(k)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(k);
                          else next.delete(k);
                          setSelected(next);
                        }}
                      />
                    </td>
                  ) : null}
                  {columns.map((c) => (
                    <td key={c.key} className={c.align === 'right' ? 'num' : ''}>
                      {c.render ? c.render(r) : String(c.value?.(r) ?? '')}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          {hasTotals ? (
            <tfoot>
              <tr>
                {selectable ? <td /> : null}
                {columns.map((c, i) => {
                  let cell: ReactNode = null;
                  if (typeof c.total === 'function') cell = c.total(filtered);
                  else if (c.total === 'sum' && c.value) {
                    const sum = filtered.reduce((acc, r) => acc + (Number(c.value!(r)) || 0), 0);
                    cell = c.formatTotal ? c.formatTotal(sum) : sum;
                  } else if (i === 0) cell = `${totalLabel} (${filtered.length} dòng)`;
                  return <td key={c.key} className={c.align === 'right' ? 'num' : ''}>{cell}</td>;
                })}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    );
  }

  const interactive = status !== 'loading' && status !== 'error' && rows.length > 0;

  return (
    <div className="card card-flush">
      {showToolbar && status !== 'error' ? (
        <div className="dt-toolbar">
          {searchText ? (
            <div className="dt-search">
              <Icon name="search" size={20} />
              <input
                className="control"
                type="search"
                aria-label={searchPlaceholder}
                placeholder={searchPlaceholder}
                value={query}
                disabled={!interactive && !activeFilters}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          ) : null}
          {filters?.map((f) => (
            <label key={f.key} className="dt-filter">
              <span className="sr-only">{f.label}</span>
              <select
                className="control"
                value={filterValues[f.key] ?? ''}
                disabled={!interactive && !activeFilters}
                onChange={(e) => {
                  setFilterValues((v) => ({ ...v, [f.key]: e.target.value }));
                  setPage(1);
                }}
              >
                <option value="">{f.label}: Tất cả</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          ))}
          {activeFilters ? <Button variant="tertiary" size="sm" onClick={clearFilters}>Xóa bộ lọc</Button> : null}
          {toolbarExtra ? <div style={{ marginLeft: 'auto' }}>{toolbarExtra}</div> : null}
        </div>
      ) : null}
      {selectable && selected.size > 0 && bulkActions ? (
        <div className="dt-selectbar" role="status">
          <span>Đã chọn {selected.size} dòng</span>
          {bulkActions(Array.from(selected), clearSel)}
          <Button variant="tertiary" size="sm" onClick={clearSel}>Bỏ chọn</Button>
        </div>
      ) : null}
      {body}
      {interactive && filtered.length > 0 ? (
        <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />
      ) : null}
    </div>
  );
}
