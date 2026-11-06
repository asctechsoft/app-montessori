'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate, formatDateTime } from '@/lib/format';
import { PageHeader, Stat } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { ageText, LEAD_STATUS, MetaTag, metaOptions, statusOf, useCampusCol, useCampusCtx, useClassesQ } from './parts/kit';
import { LeadDialog, mapLead, type LeadRow } from './parts/lead';

/** W08 — Danh sách tuyển sinh (leads của cơ sở). Một khách quan tâm chưa được tính vào sĩ số đang học. */
export function W08Leads() {
  const { can, cid } = useCampusCtx();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const q = useCampusCol('leads', mapLead);
  const classes = useClassesQ();
  const rows = q.data;

  const counts = useMemo(() => {
    const c = { fresh: 0, consulting: 0, ready: 0, enrolled: 0, lost: 0 };
    for (const l of rows) {
      if (l.status === 'new') c.fresh++;
      else if (['contacted', 'tour_scheduled', 'trial', 'documents'].includes(l.status)) c.consulting++;
      else if (l.status === 'approved') c.ready++;
      else if (l.status === 'enrolled') c.enrolled++;
      else if (l.status === 'lost') c.lost++;
    }
    return c;
  }, [rows]);

  const sources = useMemo(() => [...new Set(rows.map((r) => r.source).filter(Boolean))].sort(), [rows]);

  const columns: Column<LeadRow>[] = [
    {
      key: 'child', header: 'Bé', value: (r) => r.childName, sortable: true,
      render: (r) => (
        <div>
          <strong>{r.childName}</strong>
          <div className="text-caption">{r.childDob ? `${formatDate(r.childDob)} · ${ageText(r.childDob)}` : 'Chưa có ngày sinh'}</div>
        </div>
      ),
    },
    {
      key: 'parent', header: 'Phụ huynh', value: (r) => r.parentName, sortable: true,
      render: (r) => (<div>{r.parentName}<div className="text-caption">{r.phone}</div></div>),
    },
    { key: 'source', header: 'Nguồn', value: (r) => r.source },
    { key: 'class', header: 'Lớp quan tâm', value: (r) => classes.byId.get(r.interestedClassId)?.name ?? '', render: (r) => classes.byId.get(r.interestedClassId)?.name ?? '—' },
    { key: 'tour', header: 'Lịch tham quan', value: (r) => r.tourAt?.getTime() ?? 0, sortable: true, render: (r) => (r.tourAt ? formatDateTime(r.tourAt) : '—') },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, sortable: true, render: (r) => <MetaTag meta={LEAD_STATUS} value={r.status} /> },
    { key: 'created', header: 'Tiếp nhận', value: (r) => r.createdAt?.getTime() ?? 0, sortable: true, render: (r) => formatDate(r.createdAt) },
  ];

  const filters: TableFilter<LeadRow>[] = [
    { key: 'status', label: 'Trạng thái', options: metaOptions(LEAD_STATUS), predicate: (r, v) => r.status === v },
    { key: 'source', label: 'Nguồn', options: sources.map((s) => ({ value: s, label: s })), predicate: (r, v) => r.source === v },
  ];

  const addBtn = can('leads.write') ? <Button icon="plus" onClick={() => setCreating(true)}>Thêm nhu cầu</Button> : undefined;

  return (
    <div className="stack">
      <PageHeader title="Danh sách tuyển sinh" code="W08" description="Theo dõi khách quan tâm từ lúc tiếp nhận đến khi nhập học. Khách quan tâm chưa được tính vào sĩ số." actions={addBtn} />
      {q.status === 'ready' ? (
        <div className="grid-4">
          <Stat label="Mới tiếp nhận" value={counts.fresh} />
          <Stat label="Đang tư vấn" value={counts.consulting} />
          <Stat label="Đủ điều kiện nhập học" value={counts.ready} tone="success" />
          <Stat label="Đã nhập học" value={counts.enrolled} hint={`${counts.lost} khách không tiếp tục`} />
        </div>
      ) : null}
      <DataTable
        caption="Danh sách khách quan tâm tuyển sinh"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={statusOf(q.status, rows)}
        error={q.error?.message}
        onRetry={q.retry}
        searchText={(r) => `${r.childName} ${r.parentName} ${r.phone} ${r.email}`}
        searchPlaceholder="Tìm theo tên bé, phụ huynh, số điện thoại"
        filters={filters}
        onRowClick={(r) => router.push(`/tuyen-sinh/${r.id}`)}
        emptyTitle="Chưa có khách quan tâm nào"
        emptyDescription="Ghi nhận nhu cầu đầu tiên để bắt đầu theo dõi tư vấn và nhập học."
        emptyAction={addBtn}
      />
      {creating && cid ? (
        <LeadDialog
          lead={null}
          leads={rows}
          classes={classes.data}
          onClose={() => setCreating(false)}
          onSaved={(id) => { setCreating(false); router.push(`/tuyen-sinh/${id}`); }}
        />
      ) : null}
    </div>
  );
}
