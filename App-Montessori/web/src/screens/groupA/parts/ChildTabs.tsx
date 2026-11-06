'use client';
import { useMemo, useState } from 'react';
import { doc, where } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import { callApi } from '@/lib/api';
import { useDoc } from '@/lib/hooks/useFirestore';
import { useForm } from '@/lib/hooks/useForm';
import { dayKey, formatDate, formatDateTime, formatTime, formatVnd } from '@/lib/format';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { DateInput, FormField, Input, Textarea } from '@/components/ui/Fields';
import { ErrorState, SkeletonText, Stat } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import {
  CHILD_STATUS, dateOf, FormDialog, Kv, MED_STATUS, MetaTag, num, obj, str, strs, statusOf, TRANSFER_STATUS, useCampusCol, useCampusCtx, useClassesQ,
  type ChildRow, type Doc,
} from './kit';

const sortDesc = <T,>(rows: T[], key: (r: T) => string): T[] => [...rows].sort((a, b) => key(b).localeCompare(key(a)));

/* ------------------------------------------------------------------ đợt phân lớp */

interface EnrRow { id: string; classId: string; startDate: string; endDate: string; status: string; source: string; endReason: string }
interface TrRow { id: string; fromClassId: string; toClassId: string; fromCampusId: string; toCampusId: string; effectiveDate: string; status: string; crossCampus: boolean }

export function EnrollmentsTab({ child }: { child: ChildRow }) {
  const classes = useClassesQ();
  const eq = useCampusCol<EnrRow>('enrollments', (id, d) => ({ id, classId: str(d.classId), startDate: str(d.startDate), endDate: str(d.endDate), status: str(d.status), source: str(d.source), endReason: str(d.endReason) }), { where: [where('childId', '==', child.id)], keyExtra: child.id });
  const tq = useCampusCol<TrRow>('transfers', (id, d) => ({ id, fromClassId: str(d.fromClassId), toClassId: str(d.toClassId), fromCampusId: str(d.fromCampusId), toCampusId: str(d.toCampusId), effectiveDate: str(d.effectiveDate), status: str(d.status), crossCampus: d.crossCampus === true }), { where: [where('childId', '==', child.id)], keyExtra: child.id });
  const enr = useMemo(() => sortDesc(eq.data, (r) => r.startDate), [eq.data]);
  const trs = useMemo(() => sortDesc(tq.data, (r) => r.effectiveDate), [tq.data]);
  const cn = (id: string) => classes.byId.get(id)?.name ?? id;
  const SRC: Record<string, string> = { enroll: 'Nhập học', transfer: 'Chuyển lớp/cơ sở' };
  const cols: Column<EnrRow>[] = [
    { key: 'class', header: 'Lớp', render: (r) => <strong>{cn(r.classId)}</strong> },
    { key: 'from', header: 'Từ ngày', value: (r) => r.startDate, sortable: true, render: (r) => formatDate(r.startDate) },
    { key: 'to', header: 'Đến ngày', render: (r) => (r.endDate ? formatDate(r.endDate) : 'Hiện tại') },
    { key: 'status', header: 'Trạng thái', render: (r) => <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status === 'active' ? 'Đang học' : 'Đã kết thúc'}</Badge> },
    { key: 'src', header: 'Nguồn', render: (r) => SRC[r.source] ?? r.source },
  ];
  const tcols: Column<TrRow>[] = [
    { key: 'date', header: 'Ngày hiệu lực', render: (r) => formatDate(r.effectiveDate) },
    { key: 'move', header: 'Chuyển', render: (r) => `${cn(r.fromClassId)} → ${cn(r.toClassId)}${r.crossCampus ? ' (khác cơ sở)' : ''}` },
    { key: 'status', header: 'Trạng thái', render: (r) => <MetaTag meta={TRANSFER_STATUS} value={r.status} /> },
  ];
  return (
    <div className="stack">
      <Card title="Các đợt phân lớp" flush>
        <DataTable caption="Các đợt phân lớp của trẻ" columns={cols} rows={enr} rowKey={(r) => r.id} status={statusOf(eq.status, enr)} error={eq.error?.message} onRetry={eq.retry}
          emptyTitle="Chưa có đợt phân lớp" emptyDescription="Trẻ chưa được xếp lớp nào tại cơ sở này." />
      </Card>
      <Card title="Yêu cầu chuyển lớp hoặc cơ sở" flush>
        <DataTable caption="Yêu cầu chuyển của trẻ" columns={tcols} rows={trs} rowKey={(r) => r.id} status={statusOf(tq.status, trs)} error={tq.error?.message} onRetry={tq.retry}
          emptyTitle="Chưa có yêu cầu chuyển" />
      </Card>
      <p className="text-caption">Đợt phân lớp tại cơ sở khác (trước khi chuyển) nằm ở lịch sử của cơ sở đó; hồ sơ giữ nguyên danh tính trong tổ chức.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ điểm danh */

interface AttRow { id: string; dayKey: string; session: string; status: string; arrivedAt: Date | null; droppedBy: string }
interface HoRow { id: string; dayKey: string; state: string; receivedAt: Date | null; pickedAt: Date | null; pickupPersonName: string }

export function AttendanceTab({ child }: { child: ChildRow }) {
  const { tz } = useCampusCtx();
  const aq = useCampusCol<AttRow>('attendance', (id, d) => ({ id, dayKey: str(d.dayKey), session: str(d.session), status: str(d.status), arrivedAt: dateOf(d.arrivedAt), droppedBy: str(d.droppedBy) }), { where: [where('childId', '==', child.id)], keyExtra: child.id });
  const hq = useCampusCol<HoRow>('handovers', (id, d) => ({ id, dayKey: str(d.dayKey), state: str(d.state), receivedAt: dateOf(d.receivedAt), pickedAt: dateOf(d.pickedAt), pickupPersonName: str(d.pickupPersonName) }), { where: [where('childId', '==', child.id)], keyExtra: child.id });
  const att = useMemo(() => sortDesc(aq.data, (r) => r.dayKey).slice(0, 60), [aq.data]);
  const ho = useMemo(() => new Map(hq.data.map((h) => [h.dayKey, h])), [hq.data]);
  const cnt = (s: string) => aq.data.filter((a) => a.status === s).length;
  const cols: Column<AttRow>[] = [
    { key: 'day', header: 'Ngày', value: (r) => r.dayKey, sortable: true, render: (r) => formatDate(r.dayKey) },
    { key: 'status', header: 'Điểm danh', render: (r) => <StatusBadge domain="attendance" value={r.status} /> },
    { key: 'in', header: 'Giờ nhận', render: (r) => { const h = ho.get(r.dayKey); return formatTime(h?.receivedAt ?? r.arrivedAt, tz); } },
    { key: 'out', header: 'Giờ trả', render: (r) => { const h = ho.get(r.dayKey); return h?.pickedAt ? formatTime(h.pickedAt, tz) : '—'; } },
    { key: 'ho', header: 'Bàn giao', render: (r) => { const h = ho.get(r.dayKey); return h ? <div><StatusBadge domain="handover" value={h.state} />{h.pickupPersonName ? <div className="text-caption">Người đón: {h.pickupPersonName}</div> : null}</div> : '—'; } },
    { key: 'by', header: 'Người đưa', render: (r) => r.droppedBy || '—' },
  ];
  return (
    <div className="stack">
      <div className="grid-4">
        <Stat label="Có mặt" value={cnt('present')} tone="success" />
        <Stat label="Nghỉ có phép" value={cnt('absent_excused')} />
        <Stat label="Nghỉ không phép" value={cnt('absent_unexcused')} tone="error" />
        <Stat label="Chưa xác nhận" value={cnt('unconfirmed')} tone="warning" />
      </div>
      <DataTable caption="Lịch sử điểm danh của trẻ (60 ngày gần nhất)" columns={cols} rows={att} rowKey={(r) => r.id} status={statusOf(aq.status, att)} error={aq.error?.message} onRetry={aq.retry}
        emptyTitle="Chưa có dữ liệu điểm danh" emptyDescription="Điểm danh xuất hiện sau khi giáo viên ghi nhận trên app." />
    </div>
  );
}

/* ------------------------------------------------------------------ học phí tóm tắt */

interface RcvRow { id: string; periodKey: string; type: string; amount: number; balance: number; status: string; dueDate: string }

export function FeesTab({ child }: { child: ChildRow }) {
  const rq = useCampusCol<RcvRow>('receivables', (id, d) => ({ id, periodKey: str(d.periodKey), type: str(d.type), amount: num(d.amount) ?? 0, balance: num(d.balance) ?? 0, status: str(d.status), dueDate: str(d.dueDate) }), { where: [where('childId', '==', child.id)], keyExtra: child.id });
  const dq = useCampusCol<{ id: string; amount: number; status: string }>('deposits', (id, d) => ({ id, amount: num(d.amount) ?? 0, status: str(d.status) }), { where: [where('childId', '==', child.id)], keyExtra: child.id });
  const rows = useMemo(() => sortDesc(rq.data.filter((r) => r.status !== 'draft'), (r) => r.periodKey), [rq.data]);
  const open = rows.filter((r) => !['paid', 'cancelled'].includes(r.status));
  const debt = open.reduce((s, r) => s + r.balance, 0);
  const overdue = rows.filter((r) => r.status === 'overdue').reduce((s, r) => s + r.balance, 0);
  const held = dq.data.filter((d) => d.status === 'held').reduce((s, d) => s + d.amount, 0);
  const cols: Column<RcvRow>[] = [
    { key: 'period', header: 'Kỳ', value: (r) => r.periodKey, sortable: true },
    { key: 'amount', header: 'Phải thu', align: 'right', value: (r) => r.amount, render: (r) => formatVnd(r.amount) },
    { key: 'balance', header: 'Còn nợ', align: 'right', value: (r) => r.balance, render: (r) => formatVnd(r.balance) },
    { key: 'due', header: 'Hạn', render: (r) => (r.dueDate ? formatDate(r.dueDate) : '—') },
    { key: 'status', header: 'Trạng thái', render: (r) => <StatusBadge domain="payment" value={r.status} /> },
  ];
  return (
    <div className="stack">
      <div className="grid-3">
        <Stat label="Tổng còn nợ" value={formatVnd(debt)} tone={debt > 0 ? 'warning' : undefined} />
        <Stat label="Quá hạn" value={formatVnd(overdue)} tone={overdue > 0 ? 'error' : undefined} />
        <Stat label="Tiền đặt cọc đang giữ" value={formatVnd(held)} />
      </div>
      <DataTable caption="Khoản phải thu của trẻ" columns={cols} rows={rows} rowKey={(r) => r.id} status={statusOf(rq.status, rows)} error={rq.error?.message} onRetry={rq.retry}
        emptyTitle="Chưa có khoản phải thu" emptyDescription="Khoản phải thu xuất hiện sau khi kỳ thu được phát hành." />
      <div><LinkButton href={`/thu-tien/cong-no/${child.id}`} variant="secondary">Xem chi tiết khoản thu</LinkButton></div>
    </div>
  );
}

/* ------------------------------------------------------------------ sức khỏe */

interface HealthRec { id: string; measuredOn: string; heightCm: number; weightKg: number; bmi: number | undefined; note: string }
const lines = (s: string): string[] => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

function HealthDialog({ child, health, onClose }: { child: ChildRow; health: Doc; onClose: () => void }) {
  const { orgId, cid } = useCampusCtx();
  const toast = useToast();
  const ec = obj(health.emergencyContact);
  const form = useForm({
    initial: { allergies: strs(health.allergies).join(', '), conditions: strs(health.conditions).join(', '), dietNote: str(health.dietNote), bloodType: str(health.bloodType), doctor: str(health.doctor), hospital: str(health.hospital), ecName: str(ec.name), ecPhone: str(ec.phone), notes: str(health.notes) },
    validate: (v) => (v.ecPhone.trim() && !/^[0-9+\s().-]{8,20}$/.test(v.ecPhone.trim()) ? { ecPhone: 'Số điện thoại chưa đúng định dạng.' } : v.bloodType.length > 5 ? { bloodType: 'Tối đa 5 ký tự.' } : {}),
  });
  const submit = form.onSubmit(async (v, opId) => {
    await callApi('child.save', { orgId, campusId: cid ?? undefined, opId, payload: { id: child.id, expectedVersion: child.version, health: {
      allergies: lines(v.allergies), conditions: lines(v.conditions), dietNote: v.dietNote.trim(), bloodType: v.bloodType.trim(), doctor: v.doctor.trim(), hospital: v.hospital.trim(),
      emergencyContact: { name: v.ecName.trim(), phone: v.ecPhone.trim() }, notes: v.notes.trim(),
    } } });
    toast.success('Đã lưu thông tin sức khỏe.');
    form.reset(v);
    onClose();
  });
  return (
    <FormDialog title={`Sức khỏe của ${child.fullName}`} form={form} dirty={form.dirty} onSubmit={submit} onClose={onClose} submitLabel="Lưu thông tin sức khỏe" size="lg">
      <Banner tone="info">Thông tin sức khỏe chỉ hiển thị cho người có quyền và mọi thay đổi được ghi vào nhật ký thao tác.</Banner>
      <div className="grid-2">
        <FormField name="allergies" label="Dị ứng" helper="Ngăn cách bằng dấu phẩy." {...form.field('allergies')}><Input {...form.bind('allergies')} /></FormField>
        <FormField name="conditions" label="Bệnh nền / lưu ý y tế" {...form.field('conditions')}><Input {...form.bind('conditions')} /></FormField>
        <FormField name="bloodType" label="Nhóm máu" {...form.field('bloodType')}><Input {...form.bind('bloodType')} /></FormField>
        <FormField name="dietNote" label="Lưu ý ăn uống" {...form.field('dietNote')}><Input {...form.bind('dietNote')} /></FormField>
        <FormField name="doctor" label="Bác sĩ theo dõi" {...form.field('doctor')}><Input {...form.bind('doctor')} /></FormField>
        <FormField name="hospital" label="Bệnh viện thường khám" {...form.field('hospital')}><Input {...form.bind('hospital')} /></FormField>
        <FormField name="ecName" label="Liên hệ khẩn cấp" {...form.field('ecName')}><Input {...form.bind('ecName')} /></FormField>
        <FormField name="ecPhone" label="Điện thoại khẩn cấp" {...form.field('ecPhone')}><Input {...form.bind('ecPhone')} inputMode="tel" /></FormField>
      </div>
      <FormField name="notes" label="Ghi chú" {...form.field('notes')}><Textarea {...form.bind('notes')} /></FormField>
    </FormDialog>
  );
}

function MeasureDialog({ child, onClose }: { child: ChildRow; onClose: () => void }) {
  const { orgId, cid, tz } = useCampusCtx();
  const toast = useToast();
  const today = dayKey(new Date(), tz);
  const form = useForm({
    initial: { measuredOn: today, heightCm: '', weightKg: '', note: '' },
    validate: (v) => {
      const e: Record<string, string> = {};
      const h = Number(v.heightCm.replace(',', '.'));
      const w = Number(v.weightKg.replace(',', '.'));
      if (!v.measuredOn) e.measuredOn = 'Chọn ngày đo.';
      else if (v.measuredOn > today) e.measuredOn = 'Ngày đo không được ở tương lai.';
      if (!v.heightCm.trim() || !Number.isFinite(h) || h < 30 || h > 200) e.heightCm = 'Chiều cao 30–200 cm.';
      if (!v.weightKg.trim() || !Number.isFinite(w) || w < 2 || w > 80) e.weightKg = 'Cân nặng 2–80 kg.';
      return e;
    },
  });
  const submit = form.onSubmit(async (v, opId) => {
    await callApi('health.record', { orgId, campusId: cid ?? undefined, opId, payload: { childId: child.id, measuredOn: v.measuredOn, heightCm: Number(v.heightCm.replace(',', '.')), weightKg: Number(v.weightKg.replace(',', '.')), note: v.note.trim() } });
    toast.success('Đã ghi nhận số đo.');
    form.reset(v);
    onClose();
  });
  return (
    <FormDialog title={`Ghi số đo cho ${child.fullName}`} form={form} dirty={form.dirty} onSubmit={submit} onClose={onClose} submitLabel="Ghi số đo">
      <div className="grid-2">
        <FormField name="measuredOn" label="Ngày đo" required {...form.field('measuredOn')}><DateInput {...form.bind('measuredOn')} /></FormField>
        <div />
        <FormField name="heightCm" label="Chiều cao (cm)" required {...form.field('heightCm')}><Input {...form.bind('heightCm')} inputMode="decimal" /></FormField>
        <FormField name="weightKg" label="Cân nặng (kg)" required {...form.field('weightKg')}><Input {...form.bind('weightKg')} inputMode="decimal" /></FormField>
      </div>
      <FormField name="note" label="Ghi chú" {...form.field('note')}><Textarea {...form.bind('note')} /></FormField>
    </FormDialog>
  );
}

export function HealthTab({ child }: { child: ChildRow }) {
  const { orgId, scopeKey, can } = useCampusCtx();
  const [dlg, setDlg] = useState<'edit' | 'measure' | null>(null);
  const hq = useDoc<Doc>(orgId ? `health|${scopeKey}|${child.id}` : null, () => doc(firebase().db, 'orgs', orgId, 'children', child.id, 'private', 'health'), (_i, d) => d);
  const rq = useCampusCol<HealthRec>('healthRecords', (id, d) => ({ id, measuredOn: str(d.measuredOn), heightCm: num(d.heightCm) ?? 0, weightKg: num(d.weightKg) ?? 0, bmi: num(d.bmi), note: str(d.note) }), { where: [where('childId', '==', child.id)], keyExtra: child.id });
  const mq = useCampusCol<{ id: string; medicineName: string; dose: string; fromDay: string; toDay: string; status: string }>('medicationRequests', (id, d) => ({ id, medicineName: str(d.medicineName), dose: str(d.dose), fromDay: str(d.fromDay), toDay: str(d.toDay), status: str(d.status) }), { where: [where('childId', '==', child.id)], keyExtra: child.id });
  const recs = useMemo(() => sortDesc(rq.data, (r) => r.measuredOn), [rq.data]);
  const meds = useMemo(() => sortDesc(mq.data, (r) => r.fromDay), [mq.data]);
  const h = hq.data ?? {};
  const ec = obj(h.emergencyContact);
  const rcols: Column<HealthRec>[] = [
    { key: 'd', header: 'Ngày đo', value: (r) => r.measuredOn, sortable: true, render: (r) => formatDate(r.measuredOn) },
    { key: 'h', header: 'Chiều cao', align: 'right', value: (r) => r.heightCm, render: (r) => `${r.heightCm} cm` },
    { key: 'w', header: 'Cân nặng', align: 'right', value: (r) => r.weightKg, render: (r) => `${r.weightKg} kg` },
    { key: 'b', header: 'BMI', align: 'right', render: (r) => r.bmi ?? '—' },
    { key: 'n', header: 'Ghi chú', render: (r) => r.note || '—' },
  ];
  const mcols = [
    { key: 'n', header: 'Thuốc', render: (r: (typeof meds)[number]) => <strong>{r.medicineName}</strong> },
    { key: 'd', header: 'Liều', render: (r: (typeof meds)[number]) => r.dose },
    { key: 'p', header: 'Thời gian', render: (r: (typeof meds)[number]) => `${formatDate(r.fromDay)} – ${formatDate(r.toDay)}` },
    { key: 's', header: 'Trạng thái', render: (r: (typeof meds)[number]) => <MetaTag meta={MED_STATUS} value={r.status} /> },
  ];
  return (
    <div className="stack">
      <Banner tone="info">Thông tin sức khỏe chỉ dành cho người có quyền; mỗi lần xem hoặc sửa được ghi vào nhật ký truy cập.</Banner>
      <Card title="Hồ sơ sức khỏe" actions={can('children.write') && can('children.health.read') ? <Button size="sm" variant="secondary" onClick={() => setDlg('edit')}>Cập nhật</Button> : undefined}>
        {hq.status === 'loading' ? <SkeletonText lines={4} /> : hq.status === 'error' ? <ErrorState message={hq.error?.message} onRetry={hq.retry} /> : hq.status === 'empty' ? <p className="text-secondary">Chưa có thông tin sức khỏe.</p> : (
          <Kv items={[
            ['Dị ứng', strs(h.allergies).join(', ')], ['Bệnh nền / lưu ý', strs(h.conditions).join(', ')], ['Lưu ý ăn uống', str(h.dietNote)], ['Nhóm máu', str(h.bloodType)],
            ['Bác sĩ theo dõi', str(h.doctor)], ['Bệnh viện', str(h.hospital)], ['Liên hệ khẩn cấp', ec.name || ec.phone ? `${str(ec.name)} ${str(ec.phone)}` : ''], ['Ghi chú', str(h.notes)],
          ]} />
        )}
      </Card>
      <Card title="Số đo tăng trưởng" actions={can('care.write') || can('medication.write') ? <Button size="sm" icon="plus" onClick={() => setDlg('measure')}>Ghi số đo</Button> : undefined} flush>
        <DataTable caption="Số đo tăng trưởng" columns={rcols} rows={recs} rowKey={(r) => r.id} status={statusOf(rq.status, recs)} error={rq.error?.message} onRetry={rq.retry} emptyTitle="Chưa có số đo" />
      </Card>
      <Card title="Yêu cầu thuốc" flush>
        <DataTable caption="Yêu cầu thuốc của trẻ" columns={mcols} rows={meds} rowKey={(r) => r.id} status={statusOf(mq.status, meds)} error={mq.error?.message} onRetry={mq.retry} emptyTitle="Chưa có yêu cầu thuốc" />
      </Card>
      {dlg === 'edit' ? <HealthDialog child={child} health={h} onClose={() => setDlg(null)} /> : null}
      {dlg === 'measure' ? <MeasureDialog child={child} onClose={() => setDlg(null)} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ lịch sử thay đổi */

interface StHist { id: string; from: string; to: string; effectiveDate: string; reason: string; byName: string; at: Date | null }
interface Audit { id: string; at: Date | null; actorName: string; action: string; reason: string; before: unknown; after: unknown }

const summarize = (v: unknown): string => {
  const o = obj(v);
  const keys = Object.keys(o);
  if (keys.length === 0) return typeof v === 'string' ? v : '—';
  return keys.slice(0, 6).map((k) => `${k}: ${typeof o[k] === 'object' ? JSON.stringify(o[k]) : String(o[k])}`).join('; ');
};

export function HistoryTab({ child }: { child: ChildRow }) {
  const { can } = useCampusCtx();
  const sq = useCampusCol<StHist>('childStatusHistory', (id, d) => ({ id, from: str(d.from), to: str(d.to), effectiveDate: str(d.effectiveDate), reason: str(d.reason), byName: str(d.byName), at: dateOf(d.at) }), { where: [where('childId', '==', child.id)], keyExtra: child.id });
  const aq = useCampusCol<Audit>('auditLogs', (id, d) => ({ id, at: dateOf(d.at), actorName: str(d.actorName), action: str(d.action), reason: str(d.reason), before: d.before, after: d.after }), { where: [where('docId', '==', child.id)], keyExtra: child.id, enabled: can('audit.read') });
  const st = useMemo(() => [...sq.data].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0)), [sq.data]);
  const au = useMemo(() => [...aq.data].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0)), [aq.data]);
  const scols: Column<StHist>[] = [
    { key: 'at', header: 'Thời điểm', render: (r) => formatDateTime(r.at) },
    { key: 'chg', header: 'Thay đổi', render: (r) => `${CHILD_STATUS[r.from]?.label ?? r.from} → ${CHILD_STATUS[r.to]?.label ?? r.to}` },
    { key: 'eff', header: 'Hiệu lực', render: (r) => formatDate(r.effectiveDate) },
    { key: 'by', header: 'Người thực hiện', render: (r) => r.byName || '—' },
    { key: 'why', header: 'Lý do', render: (r) => r.reason || '—' },
  ];
  const acols: Column<Audit>[] = [
    { key: 'at', header: 'Thời điểm', render: (r) => formatDateTime(r.at) },
    { key: 'who', header: 'Người thực hiện', render: (r) => r.actorName },
    { key: 'act', header: 'Thao tác', render: (r) => r.action },
    { key: 'before', header: 'Trước', render: (r) => <span className="text-small">{summarize(r.before)}</span> },
    { key: 'after', header: 'Sau', render: (r) => <span className="text-small">{summarize(r.after)}</span> },
    { key: 'why', header: 'Lý do', render: (r) => r.reason || '—' },
  ];
  return (
    <div className="stack">
      <Card title="Lịch sử trạng thái" flush>
        <DataTable caption="Lịch sử trạng thái của trẻ" columns={scols} rows={st} rowKey={(r) => r.id} status={statusOf(sq.status, st)} error={sq.error?.message} onRetry={sq.retry} emptyTitle="Chưa có thay đổi trạng thái" />
      </Card>
      {can('audit.read') ? (
        <Card title="Nhật ký thay đổi hồ sơ" flush>
          <DataTable caption="Nhật ký thay đổi hồ sơ trẻ" columns={acols} rows={au} rowKey={(r) => r.id} status={statusOf(aq.status, au)} error={aq.error?.message} onRetry={aq.retry} emptyTitle="Chưa có nhật ký" />
        </Card>
      ) : <p className="text-caption">Nhật ký thay đổi chi tiết chỉ hiển thị cho người có quyền xem nhật ký thao tác.</p>}
    </div>
  );
}

