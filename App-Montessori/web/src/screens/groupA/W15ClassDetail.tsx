'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { doc } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import { callApi } from '@/lib/api';
import { useDoc } from '@/lib/hooks/useFirestore';
import { useAsyncAction } from '@/lib/hooks/useAsyncAction';
import { formatDateTime } from '@/lib/format';
import { ErrorState, PageHeader, SkeletonText, Stat } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { FormField, Textarea } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import type { ScreenProps } from '../registry';
import { ClassDialog } from './parts/ClassDialog';
import { activeAt, AssignDialog, mapAssign, type AssignRow } from './parts/assign';
import {
  ageText, CHILD_STATUS, IN_SCHOOL, Kv, mapClass, mapYear, MetaTag, NotInCampus, ROLE_LABEL, statusOf, useCampusCol, useCampusCtx, useChildrenQ, useOccupancy, type ChildRow, type ClassRow,
} from './parts/kit';

function CancelAssign({ a, className, onClose }: { a: AssignRow; className: string; onClose: () => void }) {
  const { orgId, cid } = useCampusCtx();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const act = useAsyncAction(async (opId: string) => {
    await callApi('assignment.save', { orgId, campusId: cid ?? undefined, opId, payload: { id: a.id, cancel: true, reason: reason.trim() } });
    return true as const;
  });
  return (
    <ConfirmDialog open title={`Hủy phân công của ${a.teacherName}`} subject={`${a.teacherName} · lớp ${className}`} tone="destructive" confirmLabel={`Hủy phân công của ${a.teacherName}`} busy={act.busy} error={act.error?.message} onCancel={onClose}
      impact={[`${a.teacherName} không còn là ${ROLE_LABEL[a.role]?.toLowerCase() ?? 'giáo viên'} của lớp ${className}.`, 'Giáo viên mất quyền nhập dữ liệu cho lớp này.', 'Phân công cũ được giữ trong lịch sử.']}
      onConfirm={async () => { if (!reason.trim()) return setErr('Nhập lý do hủy phân công.'); if (await act.run()) { toast.success('Đã hủy phân công.'); onClose(); } }}>
      <FormField name="cancel-reason" label="Lý do" required error={err || undefined}>
        <Textarea name="cancel-reason" value={reason} onValueChange={(t) => { setReason(t); setErr(''); }} />
      </FormField>
    </ConfirmDialog>
  );
}

/** W15 — Chi tiết lớp và phân công giáo viên (kiểm tra chồng lấn trước khi lưu). */
export function W15ClassDetail({ params }: ScreenProps) {
  const id = params.id;
  const { orgId, cid, scopeKey, can } = useCampusCtx();
  const router = useRouter();
  const [dlg, setDlg] = useState<{ kind: 'class' | 'assign' | 'cancel'; a?: AssignRow } | null>(null);
  const q = useDoc<ClassRow & { campusId: string }>(orgId && cid ? `class|${scopeKey}|${id}` : null, () => doc(firebase().db, 'orgs', orgId, 'classes', id), (i, d) => ({ ...mapClass(i, d), campusId: String(d.campusId ?? '') }));
  const cls = q.data;
  const children = useChildrenQ(can('children.read'));
  const occupancy = useOccupancy(children.data, children.status === 'ready' || children.status === 'empty');
  const years = useCampusCol('academicYears', mapYear);
  const aq = useCampusCol('assignments', mapAssign);
  const members = useMemo(() => children.data.filter((c) => c.classId === id && IN_SCHOOL.includes(c.status)), [children.data, id]);
  const mine = useMemo(() => aq.data.filter((a) => a.classId === id).sort((a, b) => (b.validFrom?.getTime() ?? 0) - (a.validFrom?.getTime() ?? 0)), [aq.data, id]);

  if (q.status === 'loading') return <><PageHeader title="Chi tiết lớp" code="W15" /><SkeletonText lines={6} /></>;
  if (q.status === 'error') return <><PageHeader title="Chi tiết lớp" code="W15" /><ErrorState message={q.error?.message} onRetry={q.retry} /></>;
  if (q.status === 'empty' || !cls || cls.campusId !== cid) return <><PageHeader title="Chi tiết lớp" code="W15" /><NotInCampus what="lớp học" backHref="/lop" backLabel="Về danh sách lớp" /></>;

  const now = new Date();
  const enrolled = occupancy(cls);
  const canWrite = can('classes.write');
  const yearName = years.data.find((y) => y.id === cls.academicYearId)?.name ?? '';
  const mainNow = mine.find((a) => a.role === 'main' && activeAt(a, now));

  const aCols: Column<AssignRow>[] = [
    { key: 't', header: 'Giáo viên', value: (r) => r.teacherName, sortable: true, render: (r) => <strong>{r.teacherName}</strong> },
    { key: 'r', header: 'Vai trò', render: (r) => ROLE_LABEL[r.role] ?? r.role },
    { key: 'v', header: 'Hiệu lực', value: (r) => r.validFrom?.getTime() ?? 0, sortable: true, render: (r) => `${formatDateTime(r.validFrom)} → ${r.validTo ? formatDateTime(r.validTo) : 'chưa kết thúc'}` },
    { key: 's', header: 'Trạng thái', render: (r) => (r.status === 'cancelled' ? <Badge tone="neutral">Đã hủy</Badge> : activeAt(r, now) ? <Badge tone="success">Đang hiệu lực</Badge> : r.validFrom && r.validFrom > now ? <Badge tone="info">Sắp hiệu lực</Badge> : <Badge tone="neutral">Đã kết thúc</Badge>) },
    ...(canWrite ? [{ key: 'act', header: 'Thao tác', render: (r: AssignRow) => (r.status === 'cancelled' ? null : (
      <div className="row" style={{ flexWrap: 'nowrap', gap: 'var(--space-1)' }}>
        <Button size="sm" variant="tertiary" onClick={() => setDlg({ kind: 'assign', a: r })}>Sửa</Button>
        <Button size="sm" variant="tertiary" onClick={() => setDlg({ kind: 'cancel', a: r })}>Hủy phân công</Button>
      </div>)) }] : []),
  ];
  const cCols: Column<ChildRow>[] = [
    { key: 'code', header: 'Mã', value: (r) => r.code, sortable: true, width: 100 },
    { key: 'name', header: 'Họ tên', value: (r) => r.fullName, sortable: true, render: (r) => <strong>{r.fullName}</strong> },
    { key: 'age', header: 'Tuổi', render: (r) => ageText(r.dob) },
    { key: 'st', header: 'Trạng thái', render: (r) => <MetaTag meta={CHILD_STATUS} value={r.status} /> },
  ];

  return (
    <div className="stack">
      <PageHeader title={`Lớp ${cls.name}`} code="W15" breadcrumbs={[{ label: 'Lớp học', href: '/lop' }, { label: cls.name }]} description={`${cls.code}${cls.ageGroup ? ` · ${cls.ageGroup}` : ''}${cls.room ? ` · Phòng ${cls.room}` : ''}`}
        actions={canWrite ? <Button variant="secondary" onClick={() => setDlg({ kind: 'class' })}>Sửa thông tin lớp</Button> : undefined} />
      <div className="grid-3">
        <Stat label="Sĩ số" value={`${enrolled}/${cls.capacity}`} tone={enrolled >= cls.capacity ? 'error' : undefined} hint={enrolled >= cls.capacity ? 'Đã đủ sĩ số' : `Còn ${cls.capacity - enrolled} chỗ`} />
        <Stat label="Giáo viên chính" value={<span style={{ fontSize: 'var(--fs-title)' }}>{mainNow?.teacherName ?? 'Chưa phân công'}</span>} tone={mainNow ? undefined : 'warning'} />
        <Stat label="Năm học" value={<span style={{ fontSize: 'var(--fs-title)' }}>{yearName || '—'}</span>} />
      </div>
      <Card title="Thông tin lớp">
        <Kv items={[['Khối tuổi', cls.ageGroup], ['Độ tuổi (tháng)', cls.minAgeMonths !== undefined || cls.maxAgeMonths !== undefined ? `${cls.minAgeMonths ?? 0} – ${cls.maxAgeMonths ?? '…'}` : ''], ['Phòng', cls.room], ['Sức chứa', String(cls.capacity)], ['Trạng thái', cls.status === 'closed' ? 'Đã đóng' : 'Đang hoạt động'], ['Ghi chú', cls.note]]} />
      </Card>
      <Card title="Phân công giáo viên" actions={canWrite && cls.status !== 'closed' ? <Button size="sm" icon="plus" onClick={() => setDlg({ kind: 'assign' })}>Thêm phân công</Button> : undefined} flush>
        <DataTable caption="Phân công giáo viên của lớp" columns={aCols} rows={mine} rowKey={(r) => r.id} status={statusOf(aq.status, mine)} error={aq.error?.message} onRetry={aq.retry}
          emptyTitle="Chưa có phân công" emptyDescription="Phân công giáo viên chính, phụ hoặc thay thế kèm ngày giờ hiệu lực." />
      </Card>
      <Card title={`Trẻ trong lớp (${members.length})`} flush>
        <DataTable caption="Trẻ trong lớp" columns={cCols} rows={members} rowKey={(r) => r.id} status={statusOf(children.status, members)} error={children.error?.message} onRetry={children.retry}
          onRowClick={(r) => router.push(`/tre/${r.id}`)} searchText={(r) => `${r.code} ${r.fullName}`} emptyTitle="Lớp chưa có trẻ" emptyDescription="Trẻ xuất hiện sau khi nhập học hoặc chuyển vào lớp." />
      </Card>
      {dlg?.kind === 'class' ? <ClassDialog cls={cls} years={years.data.filter((y) => !y.archived)} classes={[]} enrolled={enrolled} onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === 'assign' ? <AssignDialog classId={cls.id} className={cls.name} assign={dlg.a ?? null} all={aq.data} onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === 'cancel' && dlg.a ? <CancelAssign a={dlg.a} className={cls.name} onClose={() => setDlg(null)} /> : null}
    </div>
  );
}
