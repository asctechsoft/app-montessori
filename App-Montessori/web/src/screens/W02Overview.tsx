'use client';
import { useMemo } from 'react';
import { useScope } from '@/providers/ScopeProvider';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { formatVnd } from '@/lib/format';
import { PageHeader, Stat, ErrorState, Skeleton, EmptyState } from '@/components/ui/Misc';
import { Banner } from '@/components/ui/Banner';
import { Button, LinkButton } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';

interface Metric {
  key?: string;
  label: string;
  value: number | string;
  unit?: string;
  hint?: string;
}

interface ChainData {
  metrics?: Metric[] | Record<string, number | string>;
  rows?: Record<string, unknown>[];
  campuses?: Record<string, unknown>[];
}

function fmt(m: Metric): string {
  if (typeof m.value === 'number') return m.unit === 'VND' ? formatVnd(m.value) : m.value.toLocaleString('vi-VN');
  return String(m.value);
}

function toMetrics(raw: ChainData['metrics']): Metric[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Object.entries(raw).map(([key, value]) => ({ key, label: key, value }));
}

/** W02 — Tổng quan toàn chuỗi (dashboard.chain). Backend chưa sẵn => trạng thái lỗi + Thử lại, không dữ liệu giả. */
export function W02Overview() {
  const { org, scopeKey } = useScope();
  const q = useApiQuery<ChainData>(org ? `chain|${scopeKey}` : null, 'dashboard.chain', () => ({ orgId: org!.orgId }));

  const metrics = useMemo(() => toMetrics(q.data?.metrics), [q.data]);
  const rows = useMemo(() => q.data?.campuses ?? q.data?.rows ?? [], [q.data]);
  const columns = useMemo<Column<Record<string, unknown>>[]>(() => {
    const keys = rows.length ? Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== 'object') : [];
    return keys.map((k) => ({ key: k, header: k, value: (r) => (r[k] as string | number | null | undefined) ?? '', sortable: true }));
  }, [rows]);

  return (
    <div>
      <PageHeader
        title="Tổng quan toàn chuỗi"
        code="W02"
        description={org ? `Tổ chức ${org.name}` : undefined}
        actions={<LinkButton href="/co-so" variant="secondary" icon="building">Xem danh sách cơ sở</LinkButton>}
      />
      {q.status === 'loading' ? (
        <div className="grid-4" role="status" aria-label="Đang tải tổng quan">
          {[0, 1, 2, 3].map((i) => (
            <div className="card stack-sm" key={i}>
              <Skeleton height={14} width="50%" />
              <Skeleton height={36} width="70%" />
            </div>
          ))}
        </div>
      ) : q.status === 'error' ? (
        <div className="card">
          <ErrorState
            title="Không tải được tổng quan toàn chuỗi"
            message={q.error?.code === 'NOT_FOUND' ? 'Máy chủ chưa hỗ trợ báo cáo tổng quan (dashboard.chain). Hãy thử lại sau.' : q.error?.message}
            onRetry={q.retry}
          />
        </div>
      ) : metrics.length === 0 && rows.length === 0 ? (
        <div className="card">
          <EmptyState title="Chưa có số liệu" description="Tổ chức chưa phát sinh dữ liệu để tổng hợp. Tạo cơ sở và nhập học trẻ để bắt đầu." action={<LinkButton href="/co-so/moi">Tạo cơ sở mới</LinkButton>} />
        </div>
      ) : (
        <div className="stack">
          {metrics.length > 0 ? (
            <div className="grid-4">
              {metrics.map((m) => (
                <Stat key={m.key ?? m.label} label={m.label} value={fmt(m)} hint={m.hint} />
              ))}
            </div>
          ) : null}
          {rows.length > 0 ? (
            <DataTable
              caption="Số liệu theo cơ sở"
              columns={columns}
              rows={rows}
              rowKey={(r) => String(r.id ?? r.campusId ?? JSON.stringify(r))}
              status="ready"
              searchText={(r) => Object.values(r).join(' ')}
              searchPlaceholder="Tìm cơ sở"
            />
          ) : (
            <Banner tone="info">Máy chủ chưa trả số liệu theo từng cơ sở.</Banner>
          )}
          <div>
            <Button variant="tertiary" icon="refresh" onClick={q.retry}>Tải lại số liệu</Button>
          </div>
        </div>
      )}
    </div>
  );
}
