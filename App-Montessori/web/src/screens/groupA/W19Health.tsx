'use client';
import { useMemo, useState } from 'react';
import { callApi } from '@/lib/api';
import { useAsyncAction } from '@/lib/hooks/useAsyncAction';
import { useForm } from '@/lib/hooks/useForm';
import { dayKey, formatDate, formatDateTime } from '@/lib/format';
import { PageHeader, Stat } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Tabs';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/Modal';
import { DateInput, FormField, Input, Select, Textarea } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import {
  dateOf, FormDialog, Kv, MED_RESULT, MED_STATUS, MetaTag, metaOptions, num, ServerError, str, strs, statusOf, useCampusCol, useCampusCtx, useChildrenQ, useStaffWith, isoVn,
} from './parts/kit';

interface Req {
  id: string; childId: string; classId: string; medicineName: string; dose: string; times: string[]; fromDay: string; toDay: string; instructions: string; reason: string; storage: string;
  status: string; requestedBy: string; assignee: string; decisionReason: string; version?: number;
}
interface Admin { id: string; requestId: string; childId: string; medicineName: string; dose: string; requestedDose: string; doseDiffers: boolean; at: Date | null; result: string; note: string; by: string }
interface Growth { id: string; childId: string; measuredOn: string; heightCm: number; weightKg: number; bmi?: number; note: string }

const mapReq = (id: string, d: Record<string, unknown>): Req => ({
  id, childId: str(d.childId), classId: str(d.classId), medicineName: str(d.medicineName), dose: str(d.dose), times: strs(d.times), fromDay: str(d.fromDay), toDay: str(d.toDay),
  instructions: str(d.instructions), reason: str(d.reason), storage: str(d.storage), status: str(d.status), requestedBy: str(d.requestedByName), assignee: str(d.assigneeName), decisionReason: str(d.decisionReason), version: num(d.version),
});
const missingInfo = (r: Req): string[] => [!r.medicineName && 'tên thuốc', !r.dose && 'liều', !r.instructions && 'hướng dẫn', r.times.length === 0 && 'giờ uống'].filter((x): x is string => !!x);

type Decision = 'received' | 'rejected' | 'paused';

function DecideDialog({ req, decision, childName, onClose }: { req: Req; decision: Decision; childName: string; onClose: () => void }) {
  const { orgId, cid } = useCampusCtx();
  const toast = useToast();
  const staff = useStaffWith('medication.write');
  const [reason, setReason] = useState('');
  const [assignee, setAssignee] = useState('');
  const [err, setErr] = useState('');
  const resume = decision === 'received' && req.status === 'paused';
  const act = useAsyncAction(async (opId: string) => {
    await callApi('medication.decide', { orgId, campusId: cid ?? undefined, opId, payload: { id: req.id, decision, reason: reason.trim() || undefined, assigneeUid: assignee || undefined, expectedVersion: req.version } });
    return true as const;
  });
  const need = decision !== 'received';
  const label = resume ? 'Tiếp tục cho dùng thuốc' : decision === 'received' ? 'Nhận thuốc' : decision === 'rejected' ? 'Từ chối thuốc' : 'Tạm dừng thuốc';
  const impact = decision === 'received'
    ? [`Ghi nhận nhà trường đã nhận thuốc «${req.medicineName}» của ${childName}.`, 'Người được giao thực hiện sẽ ghi giờ, liều thực tế và kết quả mỗi lần dùng.', 'Phụ huynh nhận thông báo kết quả.']
    : [`Thuốc «${req.medicineName}» của ${childName} ${decision === 'rejected' ? 'bị từ chối; không được cho trẻ dùng' : 'tạm dừng; không được ghi nhận thêm lần dùng cho đến khi tiếp tục'}.`, 'Phụ huynh nhận thông báo kèm lý do.'];
  return (
    <ConfirmDialog open title={label} subject={`${childName} · ${req.medicineName}`} impact={impact} confirmLabel={`${label} cho ${childName}`} tone={decision === 'rejected' ? 'destructive' : 'primary'}
      busy={act.busy} error={act.error?.code === 'VERSION_CONFLICT' ? null : act.error?.message} onCancel={onClose}
      onConfirm={async () => { if (need && !reason.trim()) return setErr('Nhập lý do.'); if (await act.run()) { toast.success('Đã cập nhật yêu cầu thuốc.'); onClose(); } }}>
      <div className="stack" style={{ marginTop: 'var(--space-3)' }}>
        {decision === 'received' && !resume && staff.available ? (
          <FormField name="assignee" label="Người thực hiện cho dùng thuốc"><Select name="assignee" value={assignee} onValueChange={setAssignee} placeholder="Chưa phân công" options={staff.options.map((s) => ({ value: s.uid, label: s.name }))} /></FormField>
        ) : null}
        <FormField name="med-reason" label="Lý do / ghi chú" required={need} error={err || undefined}><Textarea name="med-reason" value={reason} onValueChange={(t) => { setReason(t); setErr(''); }} /></FormField>
        {act.error?.code === 'VERSION_CONFLICT' ? <ServerError error={act.error} onReload={onClose} /> : null}
      </div>
    </ConfirmDialog>
  );
}

function AdministerDialog({ req, childName, onClose }: { req: Req; childName: string; onClose: () => void }) {
  const { orgId, cid, tz } = useCampusCtx();
  const toast = useToast();
  const now = new Date();
  const form = useForm({
    initial: { day: dayKey(now, tz), time: now.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }), dose: '', result: 'given', note: '' },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.dose.trim()) e.dose = 'Nhập liều thực tế đã cho dùng (không suy đoán).';
      else if (v.dose.replace(/\s+/g, '').toLowerCase() !== req.dose.replace(/\s+/g, '').toLowerCase() && !v.note.trim()) e.note = 'Liều khác với yêu cầu của phụ huynh, ghi chú lý do.';
      if (!v.day) e.day = 'Chọn ngày.';
      else if (v.day < req.fromDay || v.day > req.toDay) e.day = `Ngoài thời gian phụ huynh yêu cầu (${formatDate(req.fromDay)} – ${formatDate(req.toDay)}).`;
      if (!v.time) e.time = 'Nhập giờ dùng thuốc.';
      return e;
    },
  });
  const submit = form.onSubmit(async (v, opId) => {
    await callApi('medication.administer', { orgId, campusId: cid ?? undefined, opId, payload: { requestId: req.id, dose: v.dose.trim(), at: isoVn(v.day, v.time), result: v.result, note: v.note.trim() } });
    toast.success(`Đã ghi nhận lần dùng thuốc cho ${childName}.`);
    form.reset(v);
    onClose();
  });
  return (
    <FormDialog title={`Ghi nhận cho dùng thuốc: ${childName}`} form={form} dirty={form.dirty} onSubmit={submit} onClose={onClose} submitLabel="Ghi nhận lần dùng">
      <Banner tone="info">{req.medicineName} · yêu cầu {req.dose}{req.times.length ? ` · giờ ${req.times.join(', ')}` : ''}. {req.instructions}</Banner>
      <div className="grid-2">
        <FormField name="day" label="Ngày dùng" required {...form.field('day')}><DateInput {...form.bind('day')} /></FormField>
        <FormField name="time" label="Giờ thực tế" required {...form.field('time')}><Input {...form.bind('time')} type="time" /></FormField>
        <FormField name="dose" label="Liều thực tế" required {...form.field('dose')}><Input {...form.bind('dose')} autoComplete="off" /></FormField>
        <FormField name="result" label="Kết quả" required {...form.field('result')}><Select {...form.bind('result')} options={Object.entries(MED_RESULT).map(([value, label]) => ({ value, label }))} /></FormField>
      </div>
      <FormField name="note" label="Ghi chú" {...form.field('note')}><Textarea {...form.bind('note')} /></FormField>
    </FormDialog>
  );
}

function MeasureDialog({ onClose }: { onClose: () => void }) {
  const { orgId, cid, tz } = useCampusCtx();
  const toast = useToast();
  const children = useChildrenQ();
  const today = dayKey(new Date(), tz);
  const form = useForm({
    initial: { childId: '', measuredOn: today, heightCm: '', weightKg: '', note: '' },
    validate: (v) => {
      const e: Record<string, string> = {};
      const h = Number(v.heightCm.replace(',', '.'));
      const w = Number(v.weightKg.replace(',', '.'));
      if (!v.childId) e.childId = 'Chọn trẻ.';
      if (!v.measuredOn) e.measuredOn = 'Chọn ngày đo.';
      else if (v.measuredOn > today) e.measuredOn = 'Ngày đo không được ở tương lai.';
      if (!v.heightCm.trim() || !Number.isFinite(h) || h < 30 || h > 200) e.heightCm = 'Chiều cao 30–200 cm.';
      if (!v.weightKg.trim() || !Number.isFinite(w) || w < 2 || w > 80) e.weightKg = 'Cân nặng 2–80 kg.';
      return e;
    },
  });
  const submit = form.onSubmit(async (v, opId) => {
    await callApi('health.record', { orgId, campusId: cid ?? undefined, opId, payload: { childId: v.childId, measuredOn: v.measuredOn, heightCm: Number(v.heightCm.replace(',', '.')), weightKg: Number(v.weightKg.replace(',', '.')), note: v.note.trim() } });
    toast.success('Đã ghi nhận số đo.');
    form.reset(v);
    onClose();
  });
  return (
    <FormDialog title="Ghi số đo tăng trưởng" form={form} dirty={form.dirty} onSubmit={submit} onClose={onClose} submitLabel="Ghi số đo">
      <FormField name="childId" label="Trẻ" required {...form.field('childId')}><Select {...form.bind('childId')} placeholder="Chọn trẻ" options={children.data.filter((c) => c.classId).map((c) => ({ value: c.id, label: `${c.fullName} (${c.code})` }))} /></FormField>
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

/** W19 — Sức khỏe và quản lý thuốc: yêu cầu thuốc từ phụ huynh, ghi nhận từng lần dùng, số đo tăng trưởng. */
export function W19Health() {
  const { tz, can } = useCampusCtx();
  const canMed = can('medication.read');
  const [tab, setTab] = useState(canMed ? 'req' : 'growth');
  const [dlg, setDlg] = useState<{ kind: 'decide' | 'admin'; req: Req; decision?: Decision } | null>(null);
  const [detail, setDetail] = useState<Req | null>(null);
  const [measure, setMeasure] = useState(false);
  const today = dayKey(new Date(), tz);

  const children = useChildrenQ();
  const reqs = useCampusCol('medicationRequests', mapReq, { enabled: canMed });
  const admins = useCampusCol<Admin>('medicationAdmins', (id, d) => ({ id, requestId: str(d.requestId), childId: str(d.childId), medicineName: str(d.medicineName), dose: str(d.dose), requestedDose: str(d.requestedDose), doseDiffers: d.doseDiffers === true, at: dateOf(d.at), result: str(d.result), note: str(d.note), by: str(d.administeredByName) }), { enabled: canMed });
  const growth = useCampusCol<Growth>('healthRecords', (id, d) => ({ id, childId: str(d.childId), measuredOn: str(d.measuredOn), heightCm: num(d.heightCm) ?? 0, weightKg: num(d.weightKg) ?? 0, bmi: num(d.bmi), note: str(d.note) }), { enabled: can('medication.read') || can('children.health.read') });
  const nameOf = (id: string) => children.byId.get(id)?.fullName ?? id;

  const reqRows = useMemo(() => [...reqs.data].sort((a, b) => b.fromDay.localeCompare(a.fromDay)), [reqs.data]);
  const adminRows = useMemo(() => [...admins.data].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0)), [admins.data]);
  const growthRows = useMemo(() => [...growth.data].sort((a, b) => b.measuredOn.localeCompare(a.measuredOn)), [growth.data]);
  const pending = reqRows.filter((r) => r.status === 'pending').length;
  const activeToday = reqRows.filter((r) => r.status === 'received' && r.fromDay <= today && today <= r.toDay).length;

  const canWrite = can('medication.write');
  const reqCols: Column<Req>[] = [
    { key: 'child', header: 'Trẻ', value: (r) => nameOf(r.childId), sortable: true, render: (r) => <strong>{nameOf(r.childId)}</strong> },
    { key: 'med', header: 'Thuốc', value: (r) => r.medicineName, render: (r) => <div>{r.medicineName || '—'}<div className="text-caption">{r.dose}{r.times.length ? ` · ${r.times.join(', ')}` : ''}</div>{missingInfo(r).length ? <Badge tone="warning">Thiếu {missingInfo(r).join(', ')}</Badge> : null}</div> },
    { key: 'period', header: 'Thời gian', value: (r) => r.fromDay, sortable: true, render: (r) => `${formatDate(r.fromDay)} – ${formatDate(r.toDay)}` },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, render: (r) => <MetaTag meta={MED_STATUS} value={r.status} /> },
    { key: 'by', header: 'Phụ huynh / người thực hiện', render: (r) => <div className="text-small">{r.requestedBy || '—'}{r.assignee ? <div className="text-caption">Thực hiện: {r.assignee}</div> : null}</div> },
    { key: 'act', header: 'Thao tác', render: (r) => (
      <div className="row" style={{ flexWrap: 'nowrap', gap: 'var(--space-1)' }} onClick={(e) => e.stopPropagation()}>
        {canWrite && r.status === 'pending' ? <><Button size="sm" variant="tertiary" onClick={() => setDlg({ kind: 'decide', req: r, decision: 'received' })}>Nhận thuốc</Button><Button size="sm" variant="tertiary" onClick={() => setDlg({ kind: 'decide', req: r, decision: 'rejected' })}>Từ chối</Button></> : null}
        {canWrite && r.status === 'received' ? <><Button size="sm" variant="tertiary" onClick={() => setDlg({ kind: 'admin', req: r })}>Ghi nhận dùng</Button><Button size="sm" variant="tertiary" onClick={() => setDlg({ kind: 'decide', req: r, decision: 'paused' })}>Tạm dừng</Button></> : null}
        {canWrite && r.status === 'paused' ? <Button size="sm" variant="tertiary" onClick={() => setDlg({ kind: 'decide', req: r, decision: 'received' })}>Tiếp tục</Button> : null}
      </div>) },
  ];
  const adminCols: Column<Admin>[] = [
    { key: 'at', header: 'Giờ thực tế', value: (r) => r.at?.getTime() ?? 0, sortable: true, render: (r) => formatDateTime(r.at, tz) },
    { key: 'child', header: 'Trẻ', render: (r) => nameOf(r.childId) },
    { key: 'med', header: 'Thuốc', render: (r) => r.medicineName },
    { key: 'dose', header: 'Liều thực tế', render: (r) => <span>{r.dose}{r.doseDiffers ? <> <Badge tone="warning">Khác yêu cầu ({r.requestedDose})</Badge></> : null}</span> },
    { key: 'res', header: 'Kết quả', render: (r) => MED_RESULT[r.result] ?? r.result },
    { key: 'by', header: 'Người ghi', render: (r) => r.by },
  ];
  const growthCols: Column<Growth>[] = [
    { key: 'd', header: 'Ngày đo', value: (r) => r.measuredOn, sortable: true, render: (r) => formatDate(r.measuredOn) },
    { key: 'c', header: 'Trẻ', value: (r) => nameOf(r.childId), sortable: true, render: (r) => nameOf(r.childId) },
    { key: 'h', header: 'Chiều cao', align: 'right', value: (r) => r.heightCm, render: (r) => `${r.heightCm} cm` },
    { key: 'w', header: 'Cân nặng', align: 'right', value: (r) => r.weightKg, render: (r) => `${r.weightKg} kg` },
    { key: 'b', header: 'BMI', align: 'right', render: (r) => r.bmi ?? '—' },
    { key: 'n', header: 'Ghi chú', render: (r) => r.note || '—' },
  ];
  const reqFilters: TableFilter<Req>[] = [{ key: 'status', label: 'Trạng thái', options: metaOptions(MED_STATUS), predicate: (r, v) => r.status === v }];
  const tabs = [...(canMed ? [{ id: 'req', label: 'Yêu cầu thuốc', badge: pending ? <Badge tone="warning">{pending}</Badge> : undefined }, { id: 'admin', label: 'Nhật ký cho dùng thuốc' }] : []), { id: 'growth', label: 'Tăng trưởng' }];
  const detailAdmins = detail ? adminRows.filter((a) => a.requestId === detail.id) : [];

  return (
    <div className="stack">
      <PageHeader title="Sức khỏe và quản lý thuốc" code="W19" description="Tiếp nhận yêu cầu thuốc từ phụ huynh, ghi nhận từng lần dùng thuốc và số đo tăng trưởng. Không suy đoán tên thuốc hoặc liều khi thiếu thông tin." />
      {canMed ? <div className="grid-3"><Stat label="Chờ nhận thuốc" value={pending} tone={pending ? 'warning' : undefined} /><Stat label="Đang cho dùng hôm nay" value={activeToday} /><Stat label="Lần dùng đã ghi" value={adminRows.length} /></div> : null}
      <Tabs items={tabs} active={tab} onChange={setTab} label="Mục sức khỏe" />
      {tab === 'req' && canMed ? (
        <DataTable caption="Yêu cầu thuốc" columns={reqCols} rows={reqRows} rowKey={(r) => r.id} status={statusOf(reqs.status, reqRows)} error={reqs.error?.message} onRetry={reqs.retry}
          searchText={(r) => `${nameOf(r.childId)} ${r.medicineName}`} searchPlaceholder="Tìm theo tên trẻ, thuốc" filters={reqFilters} onRowClick={(r) => setDetail(r)}
          emptyTitle="Chưa có yêu cầu thuốc" emptyDescription="Yêu cầu do phụ huynh gửi từ app sẽ hiện ở đây." />
      ) : null}
      {tab === 'admin' && canMed ? (
        <DataTable caption="Nhật ký cho dùng thuốc" columns={adminCols} rows={adminRows} rowKey={(r) => r.id} status={statusOf(admins.status, adminRows)} error={admins.error?.message} onRetry={admins.retry}
          searchText={(r) => `${nameOf(r.childId)} ${r.medicineName}`} emptyTitle="Chưa có lần dùng thuốc nào" emptyDescription="Mỗi lần cho dùng thuốc ghi giờ thực tế, người ghi và kết quả." />
      ) : null}
      {tab === 'growth' ? (
        <Card flush actions={can('care.write') || can('medication.write') ? <Button size="sm" icon="plus" onClick={() => setMeasure(true)}>Ghi số đo</Button> : undefined} title="Số đo tăng trưởng">
          <DataTable caption="Số đo tăng trưởng" columns={growthCols} rows={growthRows} rowKey={(r) => r.id} status={statusOf(growth.status, growthRows)} error={growth.error?.message} onRetry={growth.retry}
            searchText={(r) => nameOf(r.childId)} emptyTitle="Chưa có số đo" emptyDescription="Ghi chiều cao, cân nặng định kỳ để theo dõi tăng trưởng." />
        </Card>
      ) : null}
      {dlg?.kind === 'decide' && dlg.decision ? <DecideDialog req={dlg.req} decision={dlg.decision} childName={nameOf(dlg.req.childId)} onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === 'admin' ? <AdministerDialog req={dlg.req} childName={nameOf(dlg.req.childId)} onClose={() => setDlg(null)} /> : null}
      {measure ? <MeasureDialog onClose={() => setMeasure(false)} /> : null}
      <Drawer open={!!detail} title={detail ? `Thuốc của ${nameOf(detail.childId)}` : ''} onClose={() => setDetail(null)}>
        {detail ? (
          <div className="stack">
            <Kv items={[['Thuốc', detail.medicineName], ['Liều', detail.dose], ['Giờ uống', detail.times.join(', ')], ['Thời gian', `${formatDate(detail.fromDay)} – ${formatDate(detail.toDay)}`], ['Hướng dẫn', detail.instructions], ['Lý do dùng', detail.reason], ['Bảo quản', detail.storage],
              ['Trạng thái', <MetaTag key="s" meta={MED_STATUS} value={detail.status} />], ['Lý do xử lý', detail.decisionReason], ['Người thực hiện', detail.assignee]]} />
            {missingInfo(detail).length ? <Banner tone="warning" title="Yêu cầu thiếu thông tin">Thiếu {missingInfo(detail).join(', ')}. Liên hệ phụ huynh để bổ sung, không tự suy đoán.</Banner> : null}
            <h3>Các lần đã dùng</h3>
            {detailAdmins.length === 0 ? <p className="text-secondary">Chưa có lần dùng nào.</p> : detailAdmins.map((a) => <div key={a.id} className="text-small">{formatDateTime(a.at, tz)} · {a.dose} · {MED_RESULT[a.result] ?? a.result} · {a.by}{a.note ? ` · ${a.note}` : ''}</div>)}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
