'use client';
import { useState } from 'react';
import { where } from 'firebase/firestore';
import { callApi } from '@/lib/api';
import { useAsyncAction } from '@/lib/hooks/useAsyncAction';
import { useForm } from '@/lib/hooks/useForm';
import { dayKey, formatDate } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Checkbox, DateInput, FormField, Input, Select, Textarea } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import { GuardianEditor, guardianBody, newGuardian, validateGuardians, type GuardianDraft } from './GuardianEditor';
import {
  FormDialog, GUARDIAN_STATUS, mapGuardian, mapPickup, MetaTag, PHONE_RE, relationLabel, RELATION_OPTIONS, statusOf, useCampusCol, useCampusCtx,
  type ChildRow, type GuardianRow, type PickupRow,
} from './kit';

/** Trạng thái hiệu lực của ủy quyền đón vào ngày `today`. */
export function pickupEffective(p: PickupRow, today: string): { label: string; tone: 'success' | 'warning' | 'error' | 'neutral' } {
  if (p.status === 'revoked') return { label: 'Đã thu hồi', tone: 'neutral' };
  if (p.status === 'rejected') return { label: 'Từ chối', tone: 'error' };
  if (p.status === 'pending') return { label: 'Chờ xác nhận', tone: 'warning' };
  if (p.validTo && p.validTo < today) return { label: 'Đã hết hạn', tone: 'error' };
  if (p.validFrom && p.validFrom > today) return { label: 'Chưa có hiệu lực', tone: 'warning' };
  return { label: 'Đang có hiệu lực', tone: 'success' };
}

function GuardianFormDialog({ child, onClose }: { child: ChildRow; onClose: () => void }) {
  const { orgId, cid } = useCampusCtx();
  const toast = useToast();
  const form = useForm({ initial: { guardians: [newGuardian('mother')] as GuardianDraft[] }, validate: (v) => validateGuardians(v.guardians) });
  const submit = form.onSubmit(async (v) => {
    const g = v.guardians[0];
    const { perms, ...body } = guardianBody(g);
    const r = await callApi<{ status: string; inviteCode: string | null; warning: string | null }>('child.linkGuardian', { orgId, campusId: cid ?? undefined, payload: { childId: child.id, guardian: body, perms } });
    toast.success(r.status === 'linked' ? 'Đã liên kết với tài khoản phụ huynh có sẵn.' : `Đã tạo lời mời kích hoạt${r.inviteCode ? ` (mã ${r.inviteCode})` : ''}.`);
    if (r.warning) toast.warning(r.warning);
    form.reset(v);
    onClose();
  });
  return (
    <FormDialog title={`Thêm người giám hộ cho ${child.fullName}`} form={form} dirty={form.dirty} onSubmit={submit} onClose={onClose} submitLabel="Liên kết người giám hộ" size="lg">
      <GuardianEditor drafts={form.values.guardians} onChange={(g) => form.setValue('guardians', g)} errors={form.errors} min={1} />
    </FormDialog>
  );
}

function PermsDialog({ child, g, onClose }: { child: ChildRow; g: GuardianRow; onClose: () => void }) {
  const { orgId, cid } = useCampusCtx();
  const toast = useToast();
  const [p, setP] = useState(g.perms);
  const act = useAsyncAction(async () => {
    await callApi('child.linkGuardian', { orgId, campusId: cid ?? undefined, payload: { childId: child.id, guardian: { name: g.name, phone: g.phone, email: g.email, relation: g.relation }, perms: p } });
    return true as const;
  });
  const lines: string[] = [];
  if (p.notify !== g.perms.notify) lines.push(p.notify ? `${g.name} sẽ nhận thông báo về ${child.fullName}.` : `${g.name} sẽ không còn nhận thông báo về ${child.fullName}.`);
  if (p.viewFees !== g.perms.viewFees) lines.push(p.viewFees ? `${g.name} sẽ xem được học phí của trẻ.` : `${g.name} sẽ không còn xem được học phí của trẻ.`);
  if (p.pickup !== g.perms.pickup) lines.push(p.pickup ? `${g.name} được thêm vào danh sách người đón hợp lệ.` : `Ủy quyền đón của ${g.name} bị thu hồi.`);
  return (
    <ConfirmDialog open title={`Quyền của ${g.name}`} subject={`${g.name} · ${relationLabel(g.relation)} của ${child.fullName}`} impact={lines.length ? lines : ['Chưa có thay đổi nào.']}
      confirmLabel="Lưu quyền" busy={act.busy} error={act.error?.message} onCancel={onClose}
      onConfirm={async () => { if (!lines.length) return onClose(); if (await act.run()) { toast.success('Đã cập nhật quyền người giám hộ.'); onClose(); } }}>
      <div className="stack-sm" style={{ marginTop: 'var(--space-3)' }}>
        <Checkbox checked={p.notify} onChange={(v) => setP({ ...p, notify: v })}>Nhận thông báo</Checkbox>
        <Checkbox checked={p.viewFees} onChange={(v) => setP({ ...p, viewFees: v })}>Xem học phí</Checkbox>
        <Checkbox checked={p.pickup} onChange={(v) => setP({ ...p, pickup: v })}>Được đón trẻ</Checkbox>
      </div>
    </ConfirmDialog>
  );
}

function ReasonDialog({ title, subject, impact, confirmLabel, field, onSubmit, onClose, tone = 'destructive' }: {
  title: string; subject: string; impact: string[]; confirmLabel: string; field: string; tone?: 'primary' | 'destructive';
  onSubmit: (reason: string) => Promise<unknown>; onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const act = useAsyncAction(async () => { await onSubmit(reason.trim()); return true as const; });
  return (
    <ConfirmDialog open title={title} subject={subject} impact={impact} confirmLabel={confirmLabel} tone={tone} busy={act.busy} error={act.error?.message} onCancel={onClose}
      onConfirm={async () => { if (!reason.trim()) return setErr(`Nhập ${field.toLowerCase()}.`); if (await act.run()) onClose(); }}>
      <FormField name="reason-field" label={field} required error={err || undefined}>
        <Textarea name="reason-field" value={reason} onValueChange={(t) => { setReason(t); setErr(''); }} />
      </FormField>
    </ConfirmDialog>
  );
}

function DelegateDialog({ child, onClose }: { child: ChildRow; onClose: () => void }) {
  const { orgId, cid, tz } = useCampusCtx();
  const toast = useToast();
  const today = dayKey(new Date(), tz);
  const form = useForm({
    initial: { personName: '', relation: 'relative', phone: '', idNumberLast4: '', validFrom: today, validTo: '', validFromTime: '', validToTime: '', note: '' },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (v.personName.trim().length < 2) e.personName = 'Nhập họ tên người đón.';
      if (v.phone.trim() && !PHONE_RE.test(v.phone.trim())) e.phone = 'Số điện thoại chưa đúng định dạng.';
      if (v.idNumberLast4.trim() && !/^\w{3,6}$/.test(v.idNumberLast4.trim())) e.idNumberLast4 = 'Chỉ nhập 4 ký tự cuối giấy tờ.';
      if (!v.validFrom) e.validFrom = 'Chọn ngày bắt đầu.';
      if (!v.validTo) e.validTo = 'Ủy quyền cần có ngày hết hạn.';
      else if (v.validTo < today) e.validTo = 'Ngày hết hạn đã qua.';
      else if (v.validFrom && v.validTo < v.validFrom) e.validTo = 'Ngày hết hạn phải từ ngày bắt đầu trở đi.';
      return e;
    },
  });
  const submit = form.onSubmit(async (v, opId) => {
    await callApi('pickupAuth.save', { orgId, campusId: cid ?? undefined, opId, payload: {
      childId: child.id, personName: v.personName.trim(), relation: v.relation, phone: v.phone.trim(), idNumberLast4: v.idNumberLast4.trim(),
      validFrom: v.validFrom, validTo: v.validTo, ...(v.validFromTime ? { validFromTime: v.validFromTime } : {}), ...(v.validToTime ? { validToTime: v.validToTime } : {}), note: v.note.trim(),
    } });
    toast.success(`Đã thêm người đón ${v.personName.trim()}.`);
    form.reset(v);
    onClose();
  });
  return (
    <FormDialog title={`Thêm người đón được ủy quyền cho ${child.fullName}`} form={form} dirty={form.dirty} onSubmit={submit} onClose={onClose} submitLabel="Thêm người đón" size="lg">
      <Banner tone="info">Ủy quyền do nhà trường tạo có hiệu lực ngay. Người đón phải xuất trình giấy tờ khi nhận trẻ; mã QR chỉ hỗ trợ, không thay thế xác minh.</Banner>
      <div className="grid-2">
        <FormField name="personName" label="Họ tên người đón" required {...form.field('personName')}><Input {...form.bind('personName')} autoComplete="off" /></FormField>
        <FormField name="relation" label="Quan hệ với trẻ" required {...form.field('relation')}><Select {...form.bind('relation')} options={RELATION_OPTIONS} /></FormField>
        <FormField name="phone" label="Số điện thoại" {...form.field('phone')}><Input {...form.bind('phone')} inputMode="tel" /></FormField>
        <FormField name="idNumberLast4" label="4 ký tự cuối giấy tờ tùy thân" {...form.field('idNumberLast4')}><Input {...form.bind('idNumberLast4')} autoComplete="off" /></FormField>
        <FormField name="validFrom" label="Có hiệu lực từ ngày" required {...form.field('validFrom')}><DateInput {...form.bind('validFrom')} /></FormField>
        <FormField name="validTo" label="Hết hạn ngày" required {...form.field('validTo')}><DateInput {...form.bind('validTo')} /></FormField>
        <FormField name="validFromTime" label="Từ giờ (tùy chọn)" {...form.field('validFromTime')}><Input {...form.bind('validFromTime')} type="time" /></FormField>
        <FormField name="validToTime" label="Đến giờ (tùy chọn)" {...form.field('validToTime')}><Input {...form.bind('validToTime')} type="time" /></FormField>
      </div>
      <FormField name="note" label="Ghi chú" {...form.field('note')}><Textarea {...form.bind('note')} /></FormField>
    </FormDialog>
  );
}

/** Tab giám hộ: liên kết người giám hộ + quyền tách riêng (thông báo / học phí / đón trẻ) và ủy quyền đón có thời hạn. */
export function GuardiansTab({ child }: { child: ChildRow }) {
  const { orgId, cid, tz, can } = useCampusCtx();
  const toast = useToast();
  const today = dayKey(new Date(), tz);
  const gq = useCampusCol('guardianLinks', mapGuardian, { where: [where('childId', '==', child.id)], keyExtra: child.id });
  const pq = useCampusCol('pickupAuthorizations', mapPickup, { where: [where('childId', '==', child.id)], keyExtra: child.id });
  const canWrite = can('children.write');
  const [dlg, setDlg] = useState<{ kind: 'add' | 'perms' | 'unlink' | 'delegate' | 'revoke' | 'decide'; g?: GuardianRow; p?: PickupRow } | null>(null);
  const guardians = gq.data.filter((g) => g.status !== 'unlinked');
  const delegates = pq.data.filter((p) => p.type !== 'guardian');

  const gCols: Column<GuardianRow>[] = [
    { key: 'name', header: 'Người giám hộ', value: (r) => r.name, sortable: true, render: (r) => <div><strong>{r.name}</strong><div className="text-caption">{relationLabel(r.relation)}</div></div> },
    { key: 'contact', header: 'Liên hệ', render: (r) => <div>{r.phone || '—'}<div className="text-caption">{r.email}</div></div> },
    { key: 'status', header: 'Tài khoản', value: (r) => r.status, render: (r) => <MetaTag meta={GUARDIAN_STATUS} value={r.status} /> },
    { key: 'perms', header: 'Quyền', render: (r) => (
      <div className="row" style={{ gap: 'var(--space-1)' }}>
        <Badge tone={r.perms.notify ? 'success' : 'neutral'}>{r.perms.notify ? 'Nhận thông báo' : 'Không nhận thông báo'}</Badge>
        <Badge tone={r.perms.viewFees ? 'success' : 'neutral'}>{r.perms.viewFees ? 'Xem học phí' : 'Không xem học phí'}</Badge>
        <Badge tone={r.perms.pickup ? 'success' : 'neutral'}>{r.perms.pickup ? 'Được đón trẻ' : 'Không được đón'}</Badge>
      </div>) },
    ...(canWrite ? [{ key: 'act', header: 'Thao tác', render: (r: GuardianRow) => (
      <div className="row" style={{ flexWrap: 'nowrap', gap: 'var(--space-1)' }}>
        <Button size="sm" variant="tertiary" onClick={() => setDlg({ kind: 'perms', g: r })}>Sửa quyền</Button>
        <Button size="sm" variant="tertiary" onClick={() => setDlg({ kind: 'unlink', g: r })}>Gỡ liên kết</Button>
      </div>) }] : []),
  ];
  const pCols: Column<PickupRow>[] = [
    { key: 'name', header: 'Người đón', value: (r) => r.personName, sortable: true, render: (r) => <div><strong>{r.personName}</strong><div className="text-caption">{relationLabel(r.relation)}{r.phone ? ` · ${r.phone}` : ''}</div></div> },
    { key: 'valid', header: 'Thời hạn', value: (r) => r.validTo, sortable: true, render: (r) => `${formatDate(r.validFrom)} – ${formatDate(r.validTo)}${r.validFromTime || r.validToTime ? ` (${r.validFromTime || '00:00'}–${r.validToTime || '23:59'})` : ''}` },
    { key: 'status', header: 'Hiệu lực', render: (r) => { const e = pickupEffective(r, today); return <Badge tone={e.tone}>{e.label}</Badge>; } },
    ...(canWrite ? [{ key: 'act', header: 'Thao tác', render: (r: PickupRow) => (
      <div className="row" style={{ flexWrap: 'nowrap', gap: 'var(--space-1)' }}>
        {r.status === 'pending' ? <Button size="sm" variant="tertiary" onClick={() => setDlg({ kind: 'decide', p: r })}>Xử lý yêu cầu</Button> : null}
        {r.status === 'approved' || r.status === 'pending' ? <Button size="sm" variant="tertiary" onClick={() => setDlg({ kind: 'revoke', p: r })}>Thu hồi</Button> : null}
      </div>) }] : []),
  ];

  return (
    <div className="stack">
      <Card title="Người giám hộ và quyền" actions={canWrite ? <Button size="sm" icon="plus" onClick={() => setDlg({ kind: 'add' })}>Thêm người giám hộ</Button> : undefined}>
        <DataTable caption="Người giám hộ của trẻ" columns={gCols} rows={guardians} rowKey={(r) => r.id} status={statusOf(gq.status, guardians)} error={gq.error?.message} onRetry={gq.retry}
          emptyTitle="Chưa có người giám hộ" emptyDescription="Thêm người giám hộ để họ nhận thông báo và theo dõi bé trên app." />
      </Card>
      <Card title="Người đón được ủy quyền" actions={canWrite ? <Button size="sm" icon="plus" onClick={() => setDlg({ kind: 'delegate' })}>Thêm người đón</Button> : undefined}>
        <p className="text-small text-secondary" style={{ marginBottom: 'var(--space-3)' }}>Người giám hộ có quyền đón tự động nằm trong danh sách người đón. Dưới đây là người được ủy quyền có thời hạn.</p>
        <DataTable caption="Người đón được ủy quyền" columns={pCols} rows={delegates} rowKey={(r) => r.id} status={statusOf(pq.status, delegates)} error={pq.error?.message} onRetry={pq.retry}
          emptyTitle="Chưa có ủy quyền đón" emptyDescription="Ủy quyền cho người thân khác đón trẻ khi cần, có thời hạn rõ ràng." />
      </Card>
      {dlg?.kind === 'add' ? <GuardianFormDialog child={child} onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === 'perms' && dlg.g ? <PermsDialog child={child} g={dlg.g} onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === 'delegate' ? <DelegateDialog child={child} onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === 'unlink' && dlg.g ? (
        <ReasonDialog title={`Gỡ liên kết ${dlg.g.name}`} subject={`${dlg.g.name} · ${child.fullName}`} confirmLabel={`Gỡ liên kết ${dlg.g.name}`} field="Lý do gỡ liên kết"
          impact={[`${dlg.g.name} không còn xem hồ sơ và nhận thông báo về ${child.fullName}.`, 'Quyền đón trẻ của người này bị thu hồi ngay.', 'Lịch sử liên kết được giữ trong nhật ký thao tác.']}
          onSubmit={async (reason) => { await callApi('child.unlinkGuardian', { orgId, campusId: cid ?? undefined, payload: { childId: child.id, linkId: dlg.g!.id, reason } }); toast.success(`Đã gỡ liên kết ${dlg.g!.name}.`); }} onClose={() => setDlg(null)} />
      ) : null}
      {dlg?.kind === 'revoke' && dlg.p ? (
        <ReasonDialog title={`Thu hồi ủy quyền của ${dlg.p.personName}`} subject={`${dlg.p.personName} · ${child.fullName}`} confirmLabel={`Thu hồi ủy quyền của ${dlg.p.personName}`} field="Lý do thu hồi"
          impact={[`${dlg.p.personName} không còn được nhận ${child.fullName} từ thời điểm này.`, 'Giáo viên sẽ bị chặn khi người này đến đón.', 'Việc thu hồi được ghi vào nhật ký thao tác.']}
          onSubmit={async (reason) => { await callApi('pickupAuth.revoke', { orgId, campusId: cid ?? undefined, payload: { id: dlg.p!.id, reason } }); toast.success('Đã thu hồi ủy quyền đón.'); }} onClose={() => setDlg(null)} />
      ) : null}
      {dlg?.kind === 'decide' && dlg.p ? <DecideDialog p={dlg.p} child={child} onClose={() => setDlg(null)} /> : null}
    </div>
  );
}

function DecideDialog({ p, child, onClose }: { p: PickupRow; child: ChildRow; onClose: () => void }) {
  const { orgId, cid } = useCampusCtx();
  const toast = useToast();
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const act = useAsyncAction(async () => {
    await callApi('pickupAuth.decide', { orgId, campusId: cid ?? undefined, payload: { id: p.id, decision, note: note.trim() || undefined, expectedVersion: p.version } });
    return true as const;
  });
  return (
    <ConfirmDialog open title="Xử lý yêu cầu ủy quyền đón" subject={`${p.personName} · ${child.fullName}`} tone={decision === 'rejected' ? 'destructive' : 'primary'}
      impact={decision === 'approved' ? [`${p.personName} được nhận ${child.fullName} từ ${formatDate(p.validFrom)} đến ${formatDate(p.validTo)}.`, 'Phụ huynh gửi yêu cầu được thông báo kết quả.'] : ['Yêu cầu bị từ chối; người này không được nhận trẻ.', 'Phụ huynh gửi yêu cầu được thông báo kèm lý do.']}
      confirmLabel={decision === 'approved' ? `Xác nhận cho ${p.personName} đón` : 'Từ chối yêu cầu'} busy={act.busy} error={act.error?.message} onCancel={onClose}
      onConfirm={async () => { if (decision === 'rejected' && !note.trim()) return setErr('Nhập lý do từ chối.'); if (await act.run()) { toast.success('Đã xử lý yêu cầu ủy quyền.'); onClose(); } }}>
      <div className="stack" style={{ marginTop: 'var(--space-3)' }}>
        <FormField name="decision" label="Quyết định"><Select name="decision" value={decision} onValueChange={(v) => setDecision(v as 'approved' | 'rejected')} options={[{ value: 'approved', label: 'Xác nhận' }, { value: 'rejected', label: 'Từ chối' }]} /></FormField>
        <FormField name="decision-note" label="Ghi chú" required={decision === 'rejected'} error={err || undefined}><Textarea name="decision-note" value={note} onValueChange={(t) => { setNote(t); setErr(''); }} /></FormField>
      </div>
    </ConfirmDialog>
  );
}

