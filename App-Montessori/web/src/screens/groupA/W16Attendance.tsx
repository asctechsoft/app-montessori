'use client';
import { useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { callApi } from '@/lib/api';
import { useForm } from '@/lib/hooks/useForm';
import { dayKey, formatDate, formatTime } from '@/lib/format';
import { PageHeader, Stat } from '@/components/ui/Misc';
import { Button, LinkButton } from '@/components/ui/Button';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { DateInput, FormField, Select, Textarea } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import { STATUS_MAPS } from '@/lib/status';
import { dateOf, FormDialog, IN_SCHOOL, SESSION_LABEL, str, statusOf, useCampusCol, useCampusCtx, useChildrenQ, useClassesQ } from './parts/kit';

interface AttDoc { id: string; childId: string; classId: string; status: string; session: string; arrivedAt: Date | null; droppedBy: string; markedByName: string; closed: boolean; note: string }
interface HoDoc { childId: string; receivedAt: Date | null; receivedByName: string }
interface Row {
  key: string; childId: string; childName: string; code: string; classId: string; className: string; status: string; session: string; arrivedAt: Date | null; droppedBy: string; by: string; closed: boolean; attId: string; note: string;
}

const ATT_OPTIONS = Object.entries(STATUS_MAPS.attendance).filter(([k]) => k !== 'unconfirmed').map(([value, s]) => ({ value, label: s.label }));

function CorrectionDialog({ row, dayK, onClose }: { row: Row; dayK: string; onClose: () => void }) {
  const { orgId, cid } = useCampusCtx();
  const toast = useToast();
  const form = useForm({
    initial: { status: '', reason: '' },
    validate: (v) => ({ ...(!v.status ? { status: 'Chọn trạng thái đúng.' } : v.status === row.status ? { status: 'Trạng thái mới phải khác trạng thái hiện tại.' } : {}), ...(!v.reason.trim() ? { reason: 'Nhập lý do sửa.' } : {}) }),
  });
  const submit = form.onSubmit(async (v, opId) => {
    await callApi('attendance.requestCorrection', { orgId, campusId: cid ?? undefined, opId, payload: { attendanceId: row.attId, newValue: { status: v.status }, reason: v.reason.trim() } });
    toast.success('Đã gửi yêu cầu sửa điểm danh để phê duyệt.');
    form.reset(v);
    onClose();
  });
  return (
    <FormDialog title={`Yêu cầu sửa điểm danh: ${row.childName}`} form={form} dirty={form.dirty} onSubmit={submit} onClose={onClose} submitLabel="Gửi yêu cầu sửa"
      footerNote={<div className="impact"><div className="impact-subject">Tác động khi gửi</div><ul>
        <li>Bản ghi ngày {formatDate(dayK)} đã chốt nên không sửa trực tiếp; yêu cầu đi qua trung tâm phê duyệt.</li>
        <li>Giá trị trước ({STATUS_MAPS.attendance[row.status as keyof typeof STATUS_MAPS.attendance]?.label ?? row.status}) và giá trị sau được lưu cùng lý do và người duyệt.</li></ul></div>}>
      <FormField name="status" label="Trạng thái đúng" required {...form.field('status')}><Select {...form.bind('status')} placeholder="Chọn trạng thái" options={ATT_OPTIONS} /></FormField>
      <FormField name="reason" label="Lý do sửa" required {...form.field('reason')}><Textarea {...form.bind('reason')} /></FormField>
    </FormDialog>
  );
}

/** W16 — Điểm danh toàn cơ sở theo ngày: trạng thái, giờ nhận, người thực hiện, chốt theo lớp; sửa sau chốt qua phê duyệt. */
export function W16Attendance() {
  const { tz, can } = useCampusCtx();
  const today = dayKey(new Date(), tz);
  const [day, setDay] = useState(today);
  const [fix, setFix] = useState<Row | null>(null);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day);
  const dk = valid ? day : today;
  const classes = useClassesQ();
  const children = useChildrenQ();
  const att = useCampusCol<AttDoc>('attendance', (id, d) => ({ id, childId: str(d.childId), classId: str(d.classId), status: str(d.status), session: str(d.session, 'all'), arrivedAt: dateOf(d.arrivedAt), droppedBy: str(d.droppedBy), markedByName: str(d.markedByName), closed: d.closed === true, note: str(d.note) }), { where: [where('dayKey', '==', dk)], keyExtra: dk, enabled: valid });
  const ho = useCampusCol<HoDoc>('handovers', (_id, d) => ({ childId: str(d.childId), receivedAt: dateOf(d.receivedAt), receivedByName: str(d.receivedByName) }), { where: [where('dayKey', '==', dk)], keyExtra: dk, enabled: valid });
  const closures = useCampusCol<{ id: string; classId: string; unconfirmed: number }>('attendanceClosures', (id, d) => ({ id, classId: str(d.classId), unconfirmed: Number(d.unconfirmed ?? 0) }), { where: [where('dayKey', '==', dk)], keyExtra: dk, enabled: valid });
  const cal = useCampusCol<{ id: string; name: string; type: string; fromDay: string; toDay: string }>('calendarExceptions', (id, d) => ({ id, name: str(d.name), type: str(d.type), fromDay: str(d.fromDay), toDay: str(d.toDay) }));

  const hoBy = useMemo(() => new Map(ho.data.map((h) => [h.childId, h])), [ho.data]);
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const seen = new Set<string>();
    for (const a of att.data) {
      const c = children.byId.get(a.childId);
      seen.add(a.childId);
      out.push({ key: a.id, childId: a.childId, childName: c?.fullName ?? a.childId, code: c?.code ?? '', classId: a.classId, className: classes.byId.get(a.classId)?.name ?? '', status: a.status, session: a.session, arrivedAt: hoBy.get(a.childId)?.receivedAt ?? a.arrivedAt, droppedBy: a.droppedBy, by: hoBy.get(a.childId)?.receivedByName || a.markedByName, closed: a.closed, attId: a.id, note: a.note });
    }
    // Trẻ trong lớp mà chưa có bản ghi: chỉ suy ra cho hôm nay (quá khứ lấy theo bản ghi đã chốt).
    if (dk === today) for (const c of children.data) {
      if (!c.classId || !IN_SCHOOL.includes(c.status) || seen.has(c.id)) continue;
      out.push({ key: `u_${c.id}`, childId: c.id, childName: c.fullName, code: c.code, classId: c.classId, className: classes.byId.get(c.classId)?.name ?? '', status: 'unconfirmed', session: 'all', arrivedAt: hoBy.get(c.id)?.receivedAt ?? null, droppedBy: '', by: hoBy.get(c.id)?.receivedByName ?? '', closed: false, attId: '', note: '' });
    }
    return out;
  }, [att.data, children.byId, children.data, classes.byId, dk, today, hoBy]);

  const cnt = (s: string) => rows.filter((r) => r.status === s).length;
  const closedClasses = new Set(closures.data.map((c) => c.classId));
  const holiday = cal.data.find((e) => ['holiday', 'closure'].includes(e.type) && e.fromDay <= dk && dk <= e.toDay);
  const loading = att.status === 'loading' || children.status === 'loading';
  const status = att.status === 'error' ? 'error' : children.status === 'error' ? 'error' : loading ? 'loading' : statusOf('ready', rows);

  const columns: Column<Row>[] = [
    { key: 'child', header: 'Trẻ', value: (r) => r.childName, sortable: true, render: (r) => <div><LinkButton href={`/tre/${r.childId}`} variant="tertiary" size="sm">{r.childName}</LinkButton><div className="text-caption">{r.code}</div></div> },
    { key: 'class', header: 'Lớp', value: (r) => r.className, sortable: true },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, sortable: true, render: (r) => <StatusBadge domain="attendance" value={r.status} /> },
    { key: 'session', header: 'Buổi', render: (r) => SESSION_LABEL[r.session] ?? r.session },
    { key: 'in', header: 'Giờ nhận', value: (r) => r.arrivedAt?.getTime() ?? 0, sortable: true, render: (r) => (r.arrivedAt ? formatTime(r.arrivedAt, tz) : '—') },
    { key: 'by', header: 'Người thực hiện', render: (r) => r.by || '—' },
    { key: 'closed', header: 'Chốt', render: (r) => (r.attId ? <Badge tone={r.closed ? 'success' : 'warning'}>{r.closed ? 'Đã chốt' : 'Chưa chốt'}</Badge> : <span className="text-secondary">—</span>) },
    ...(can('attendance.write') ? [{ key: 'act', header: 'Thao tác', render: (r: Row) => (r.attId && r.closed ? <Button size="sm" variant="tertiary" onClick={() => setFix(r)}>Yêu cầu sửa</Button> : null) }] : []),
  ];
  const filters: TableFilter<Row>[] = [
    { key: 'class', label: 'Lớp', options: classes.data.map((c) => ({ value: c.id, label: c.name })), predicate: (r, v) => r.classId === v },
    { key: 'status', label: 'Trạng thái', options: Object.entries(STATUS_MAPS.attendance).map(([value, s]) => ({ value, label: s.label })), predicate: (r, v) => r.status === v },
  ];

  return (
    <div className="stack">
      <PageHeader title="Điểm danh trẻ toàn cơ sở" code="W16" description="Tổng hợp trạng thái theo ngày và lớp. Đơn xin nghỉ không tự thay cho việc đối chiếu thực tế." />
      <div className="row">
        <FormField name="att-day" label="Ngày" error={valid ? undefined : 'Nhập ngày hợp lệ.'}><DateInput name="att-day" value={day} onValueChange={setDay} /></FormField>
        {day !== today ? <Button variant="secondary" onClick={() => setDay(today)}>Về hôm nay</Button> : null}
      </div>
      {holiday ? <Banner tone="info" title={`Ngày ${formatDate(dk)} là ${holiday.name}`}>Cơ sở không học ngày này theo lịch ngoại lệ; điểm danh có thể trống.</Banner> : null}
      <div className="grid-4">
        <Stat label="Có mặt" value={cnt('present')} tone="success" />
        <Stat label="Nghỉ có phép" value={cnt('absent_excused')} />
        <Stat label="Nghỉ không phép" value={cnt('absent_unexcused')} tone="error" />
        <Stat label="Chưa xác nhận" value={cnt('unconfirmed')} tone="warning" hint={dk === today ? 'Trẻ chưa được điểm danh hôm nay' : undefined} />
      </div>
      {classes.data.length > 0 ? (
        <Card title="Chốt điểm danh theo lớp">
          <div className="row">{classes.data.map((c) => <Badge key={c.id} tone={closedClasses.has(c.id) ? 'success' : 'warning'}>{c.name}: {closedClasses.has(c.id) ? 'Đã chốt' : 'Chưa chốt'}</Badge>)}</div>
        </Card>
      ) : null}
      <DataTable
        caption={`Điểm danh ngày ${formatDate(dk)}`}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.key}
        status={status}
        error={att.error?.message ?? children.error?.message}
        onRetry={() => { att.retry(); children.retry(); }}
        searchText={(r) => `${r.childName} ${r.code} ${r.className}`}
        searchPlaceholder="Tìm theo tên trẻ, mã, lớp"
        filters={filters}
        emptyTitle={`Chưa có điểm danh ngày ${formatDate(dk)}`}
        emptyDescription={dk > today ? 'Không thể điểm danh cho ngày ở tương lai.' : 'Điểm danh xuất hiện sau khi giáo viên nhận trẻ hoặc ghi nhận trên app.'}
      />
      {fix ? <CorrectionDialog row={fix} dayK={dk} onClose={() => setFix(null)} /> : null}
    </div>
  );
}
