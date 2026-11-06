'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { callApi } from '@/lib/api';
import { useAsyncAction } from '@/lib/hooks/useAsyncAction';
import { PageHeader } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/Modal';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { FormField, Textarea } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import { ClassDialog } from './parts/ClassDialog';
import { activeAt, mapAssign } from './parts/assign';
import { mapYear, statusOf, useCampusCol, useCampusCtx, useChildrenQ, useClassesQ, useOccupancy, type ClassRow } from './parts/kit';

interface Row extends ClassRow {
  enrolled: number;
  yearName: string;
  teacher: string;
}

function ArchiveClass({ cls, enrolled, onClose }: { cls: ClassRow; enrolled: number; onClose: () => void }) {
  const { orgId, cid } = useCampusCtx();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const act = useAsyncAction(async (opId: string) => {
    await callApi('entity.archive', { orgId, campusId: cid ?? undefined, opId, payload: { collection: 'classes', id: cls.id, reason: reason.trim(), expectedVersion: cls.version } });
    return true as const;
  });
  return (
    <ConfirmDialog open title={`Lưu trữ lớp ${cls.name}`} subject={`${cls.code} · ${cls.name}`} tone="destructive" confirmLabel={`Lưu trữ lớp ${cls.name}`} busy={act.busy} error={act.error?.message} onCancel={onClose}
      impact={[enrolled > 0 ? `Lớp còn ${enrolled} trẻ đang học nên máy chủ sẽ từ chối. Hãy chuyển lớp cho các trẻ trước.` : 'Lớp không còn xuất hiện trong danh sách chọn lớp.', 'Phân công giáo viên và lịch sử điểm danh được giữ nguyên.', 'Không xóa cứng dữ liệu.']}
      onConfirm={async () => { if (!reason.trim()) return setErr('Nhập lý do lưu trữ.'); if (await act.run()) { toast.success(`Đã lưu trữ lớp ${cls.name}.`); onClose(); } }}>
      <FormField name="archive-reason" label="Lý do lưu trữ" required error={err || undefined}>
        <Textarea name="archive-reason" value={reason} onValueChange={(t) => { setReason(t); setErr(''); }} />
      </FormField>
    </ConfirmDialog>
  );
}

/** W14 — Danh sách lớp học: sĩ số, giáo viên chính, năm học; tạo/sửa/lưu trữ lớp. */
export function W14Classes() {
  const { can } = useCampusCtx();
  const router = useRouter();
  const classes = useClassesQ();
  const children = useChildrenQ(can('children.read'));
  const years = useCampusCol('academicYears', mapYear);
  const assigns = useCampusCol('assignments', mapAssign);
  const occupancy = useOccupancy(children.data, children.status === 'ready' || children.status === 'empty');
  const [dlg, setDlg] = useState<{ kind: 'edit' | 'archive'; cls: ClassRow | null } | null>(null);

  const yearList = useMemo(() => years.data.filter((y) => !y.archived), [years.data]);
  const rows = useMemo<Row[]>(() => {
    const now = new Date();
    return classes.data.map((c) => {
      const main = assigns.data.find((a) => a.classId === c.id && a.role === 'main' && activeAt(a, now));
      return { ...c, enrolled: occupancy(c), yearName: yearList.find((y) => y.id === c.academicYearId)?.name ?? '', teacher: main?.teacherName ?? '' };
    });
  }, [classes.data, assigns.data, occupancy, yearList]);

  const columns: Column<Row>[] = [
    { key: 'code', header: 'Mã', value: (r) => r.code, sortable: true, width: 90 },
    { key: 'name', header: 'Lớp', value: (r) => r.name, sortable: true, render: (r) => <div><strong>{r.name}</strong><div className="text-caption">{r.ageGroup}{r.room ? ` · Phòng ${r.room}` : ''}</div></div> },
    { key: 'year', header: 'Năm học', value: (r) => r.yearName, render: (r) => r.yearName || '—' },
    { key: 'teacher', header: 'Giáo viên chính', value: (r) => r.teacher, render: (r) => r.teacher || <Badge tone="warning">Chưa phân công</Badge> },
    {
      key: 'seats', header: 'Sĩ số', align: 'right', value: (r) => r.enrolled,
      sortable: true, render: (r) => <span>{r.enrolled}/{r.capacity} {r.enrolled >= r.capacity ? <Badge tone="error">Đã đủ</Badge> : <Badge tone="success">Còn {r.capacity - r.enrolled}</Badge>}</span>,
    },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, render: (r) => <Badge tone={r.status === 'closed' ? 'neutral' : 'success'}>{r.status === 'closed' ? 'Đã đóng' : 'Đang hoạt động'}</Badge> },
    ...(can('classes.write') ? [{ key: 'act', header: 'Thao tác', render: (r: Row) => (
      <div className="row" style={{ flexWrap: 'nowrap', gap: 'var(--space-1)' }}>
        <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setDlg({ kind: 'edit', cls: r }); }}>Sửa</Button>
        <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setDlg({ kind: 'archive', cls: r }); }}>Lưu trữ</Button>
      </div>) }] : []),
  ];

  const filters: TableFilter<Row>[] = [
    { key: 'year', label: 'Năm học', options: yearList.map((y) => ({ value: y.id, label: y.name })), predicate: (r, v) => r.academicYearId === v },
    { key: 'status', label: 'Trạng thái', options: [{ value: 'active', label: 'Đang hoạt động' }, { value: 'closed', label: 'Đã đóng' }], predicate: (r, v) => r.status === v },
    { key: 'seats', label: 'Chỗ trống', options: [{ value: 'free', label: 'Còn chỗ' }, { value: 'full', label: 'Đã đủ sĩ số' }], predicate: (r, v) => (v === 'free' ? r.enrolled < r.capacity : r.enrolled >= r.capacity) },
  ];
  const add = can('classes.write') ? <Button icon="plus" onClick={() => setDlg({ kind: 'edit', cls: null })}>Tạo lớp</Button> : undefined;

  return (
    <div className="stack">
      <PageHeader title="Danh sách lớp học" code="W14" description="Lớp, phòng, khối tuổi, sức chứa và sĩ số hiện tại của cơ sở." actions={add} />
      <DataTable
        caption="Danh sách lớp học"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={statusOf(classes.status, rows)}
        error={classes.error?.message}
        onRetry={classes.retry}
        searchText={(r) => `${r.code} ${r.name} ${r.room} ${r.teacher}`}
        searchPlaceholder="Tìm theo mã, tên lớp, phòng, giáo viên"
        filters={filters}
        onRowClick={(r) => router.push(`/lop/${r.id}`)}
        emptyTitle="Chưa có lớp học"
        emptyDescription="Tạo lớp đầu tiên để nhận trẻ và phân công giáo viên."
        emptyAction={add}
      />
      {dlg?.kind === 'edit' ? <ClassDialog cls={dlg.cls} years={yearList} classes={classes.data} enrolled={dlg.cls ? occupancy(dlg.cls) : 0} onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === 'archive' && dlg.cls ? <ArchiveClass cls={dlg.cls} enrolled={occupancy(dlg.cls)} onClose={() => setDlg(null)} /> : null}
    </div>
  );
}
