'use client';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/Misc';
import { LinkButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { ageText, CHILD_STATUS, mapGuardian, MetaTag, metaOptions, statusOf, useCampusCol, useCampusCtx, useChildrenQ, useClassesQ, type ChildRow, type GuardianRow } from './parts/kit';

interface Row extends ChildRow {
  className: string;
  guardians: GuardianRow[];
}

/** W10 — Danh sách trẻ và phụ huynh (trẻ của cơ sở + người giám hộ đang liên kết). */
export function W10Children() {
  const { can } = useCampusCtx();
  const router = useRouter();
  const children = useChildrenQ();
  const classes = useClassesQ();
  const links = useCampusCol('guardianLinks', mapGuardian);

  const rows = useMemo<Row[]>(() => {
    const by = new Map<string, GuardianRow[]>();
    for (const g of links.data) if (g.status !== 'unlinked') by.set(g.childId, [...(by.get(g.childId) ?? []), g]);
    return children.data.map((c) => ({ ...c, className: classes.byId.get(c.classId ?? '')?.name ?? '', guardians: by.get(c.id) ?? [] }));
  }, [children.data, classes.byId, links.data]);

  const columns: Column<Row>[] = [
    { key: 'code', header: 'Mã', value: (r) => r.code, sortable: true, width: 100 },
    {
      key: 'name', header: 'Họ tên', value: (r) => r.fullName, sortable: true,
      render: (r) => (<div><strong>{r.fullName}</strong>{r.nickname ? <span className="text-caption"> ({r.nickname})</span> : null}<div className="text-caption">{formatDate(r.dob)} · {ageText(r.dob)}</div></div>),
    },
    { key: 'class', header: 'Lớp', value: (r) => r.className, sortable: true, render: (r) => r.className || <span className="text-secondary">Chưa xếp lớp</span> },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, sortable: true, render: (r) => <MetaTag meta={CHILD_STATUS} value={r.status} /> },
    {
      key: 'guardians', header: 'Phụ huynh', value: (r) => r.guardians.map((g) => g.name).join(', '),
      render: (r) => (r.guardians.length === 0 ? <Badge tone="warning">Chưa có người giám hộ</Badge> : (
        <div>
          {r.guardians.map((g) => (
            <div key={g.id} className="text-small">{g.name}{g.phone ? ` · ${g.phone}` : ''}{g.status === 'invited' ? <> <Badge tone="warning">Chưa kích hoạt</Badge></> : null}</div>
          ))}
        </div>
      )),
    },
    { key: 'docs', header: 'Hồ sơ', render: (r) => (r.missingDocuments.length ? <Badge tone="warning">Thiếu {r.missingDocuments.length} giấy tờ</Badge> : <span className="text-secondary">Đủ</span>) },
  ];

  const filters: TableFilter<Row>[] = [
    { key: 'class', label: 'Lớp', options: classes.data.map((c) => ({ value: c.id, label: c.name })), predicate: (r, v) => r.classId === v },
    { key: 'status', label: 'Trạng thái', options: metaOptions(CHILD_STATUS), predicate: (r, v) => r.status === v },
    { key: 'guardian', label: 'Phụ huynh', options: [{ value: 'none', label: 'Chưa có người giám hộ' }, { value: 'invited', label: 'Có người chưa kích hoạt' }], predicate: (r, v) => (v === 'none' ? r.guardians.length === 0 : r.guardians.some((g) => g.status === 'invited')) },
  ];

  const add = can('children.write') ? <LinkButton href="/tre/moi" icon="plus">Thêm trẻ</LinkButton> : undefined;
  return (
    <div className="stack">
      <PageHeader title="Danh sách trẻ và phụ huynh" code="W10" description="Hồ sơ trẻ của cơ sở và người giám hộ đã liên kết." actions={add} />
      <DataTable
        caption="Danh sách trẻ"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={statusOf(children.status, rows)}
        error={children.error?.message}
        onRetry={children.retry}
        searchText={(r) => `${r.code} ${r.fullName} ${r.nickname} ${r.guardians.map((g) => `${g.name} ${g.phone}`).join(' ')}`}
        searchPlaceholder="Tìm theo mã, tên trẻ, phụ huynh, số điện thoại"
        filters={filters}
        onRowClick={(r) => router.push(`/tre/${r.id}`)}
        emptyTitle="Chưa có hồ sơ trẻ"
        emptyDescription="Thêm trẻ hoặc nhập học từ danh sách tuyển sinh để tạo hồ sơ đầu tiên."
        emptyAction={add}
      />
    </div>
  );
}
