'use client';
import { useMemo, useState } from 'react';
import { doc } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import { callApi } from '@/lib/api';
import { useDoc } from '@/lib/hooks/useFirestore';
import { useAsyncAction } from '@/lib/hooks/useAsyncAction';
import { useForm } from '@/lib/hooks/useForm';
import { dayKey, formatDate, formatDateTime, formatTime } from '@/lib/format';
import { PageHeader, SkeletonText, Stepper } from '@/components/ui/Misc';
import { Button, LinkButton } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Checkbox, DateInput, FormField, Input, Select, Textarea } from '@/components/ui/Fields';
import { ErrorState } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import type { ScreenProps } from '../registry';
import { ageText, isoVn, Kv, LEAD_FLOW, LEAD_STATUS, MetaTag, metaOptions, NotInCampus, ServerError, useCampusCtx, useClassesQ } from './parts/kit';
import { LeadDialog, mapLead, REQUIRED_DOCS, type LeadRow } from './parts/lead';
import { EnrollDialog } from './parts/EnrollDialog';

function StatusDialog({ lead, onClose }: { lead: LeadRow; onClose: () => void }) {
  const { orgId, cid, tz } = useCampusCtx();
  const toast = useToast();
  const form = useForm({
    initial: { status: '', note: '', lostReason: '', tourDay: lead.tourAt ? dayKey(lead.tourAt, tz) : '', tourTime: lead.tourAt ? formatTime(lead.tourAt, tz) : '' },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.status) e.status = 'Chọn trạng thái mới.';
      if (v.status === 'lost' && !v.lostReason.trim()) e.lostReason = 'Nhập lý do không tiếp tục.';
      if (v.status === 'tour_scheduled' && !v.tourDay) e.tourDay = 'Chọn ngày hẹn tham quan.';
      return e;
    },
  });
  const v = form.values;
  const label = LEAD_STATUS[v.status]?.label ?? '';
  const submit = form.onSubmit(async (val, opId) => {
    const payload: Record<string, unknown> = { id: lead.id, status: val.status, note: val.note.trim() || undefined, expectedVersion: lead.version };
    if (val.status === 'lost') payload.lostReason = val.lostReason.trim();
    if (val.status === 'tour_scheduled' && val.tourDay) payload.tourAt = val.tourTime ? isoVn(val.tourDay, val.tourTime) : val.tourDay;
    await callApi('lead.setStatus', { orgId, campusId: cid ?? undefined, opId, payload });
    toast.success(`Đã chuyển tư vấn sang «${LEAD_STATUS[val.status]?.label}».`);
    form.reset(val);
    onClose();
  });
  const impact = [
    `Trạng thái tư vấn của bé ${lead.childName} đổi từ «${LEAD_STATUS[lead.status]?.label}» sang «${label || '—'}».`,
    'Mỗi lần đổi được lưu vào lịch sử kèm người thực hiện và ghi chú.',
    v.status === 'lost' ? 'Khách không còn được theo dõi tuyển sinh; có thể mở lại bằng cách đổi sang trạng thái khác.' : 'Khách quan tâm chưa được tính vào sĩ số đang học.',
  ];
  return (
    <ConfirmDialog
      open
      title="Đổi trạng thái tư vấn"
      subject={`${lead.childName} · ${lead.parentName}`}
      impact={impact}
      confirmLabel={label ? `Chuyển sang ${label}` : 'Đổi trạng thái'}
      busy={form.submitting}
      error={form.formError}
      onCancel={onClose}
      onConfirm={() => void submit()}
    >
      <div className="stack" style={{ marginTop: 'var(--space-3)' }}>
        <FormField name="status" label="Trạng thái mới" required {...form.field('status')}>
          <Select {...form.bind('status')} placeholder="Chọn trạng thái" options={metaOptions(LEAD_STATUS).filter((o) => o.value !== lead.status && o.value !== 'enrolled')} />
        </FormField>
        {v.status === 'tour_scheduled' ? (
          <div className="grid-2">
            <FormField name="tourDay" label="Ngày hẹn tham quan" required {...form.field('tourDay')}>
              <DateInput {...form.bind('tourDay')} />
            </FormField>
            <FormField name="tourTime" label="Giờ hẹn" {...form.field('tourTime')}>
              <Input {...form.bind('tourTime')} type="time" />
            </FormField>
          </div>
        ) : null}
        {v.status === 'lost' ? (
          <FormField name="lostReason" label="Lý do không tiếp tục" required {...form.field('lostReason')}>
            <Textarea {...form.bind('lostReason')} />
          </FormField>
        ) : null}
        <FormField name="note" label="Ghi chú" {...form.field('note')}>
          <Textarea {...form.bind('note')} />
        </FormField>
      </div>
    </ConfirmDialog>
  );
}

function NotesCard({ lead, canWrite }: { lead: LeadRow; canWrite: boolean }) {
  const { orgId, cid } = useCampusCtx();
  const toast = useToast();
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const add = useAsyncAction(async (opId: string) => {
    await callApi('lead.save', { orgId, campusId: cid ?? undefined, opId, payload: { id: lead.id, consultNote: text.trim(), expectedVersion: lead.version } });
    return true as const;
  });
  const notes = [...lead.consultNotes].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
  return (
    <Card title="Nội dung tư vấn">
      <div className="stack">
        {canWrite && lead.status !== 'enrolled' ? (
          <div className="stack-sm">
            <FormField name="consult-note" label="Thêm ghi chú tư vấn, tham quan, học thử" error={err || undefined}>
              <Textarea name="consult-note" value={text} onValueChange={(t) => { setText(t); setErr(''); }} />
            </FormField>
            <div>
              <Button
                loading={add.busy}
                onClick={async () => {
                  if (!text.trim()) return setErr('Nhập nội dung ghi chú.');
                  if (await add.run()) { setText(''); toast.success('Đã thêm ghi chú tư vấn.'); }
                }}
              >
                Thêm ghi chú
              </Button>
            </div>
            <ServerError error={add.error} />
          </div>
        ) : null}
        {notes.length === 0 ? <p className="text-secondary">Chưa có ghi chú tư vấn.</p> : (
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }} className="stack-sm">
            {notes.map((n, i) => (
              <li key={i} style={{ borderLeft: '3px solid var(--color-borderSubtle)', paddingLeft: 'var(--space-3)' }}>
                <div className="text-caption">{formatDateTime(n.at)} · {n.byName || 'Nhân viên'}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{n.text}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function DocsCard({ lead, canWrite }: { lead: LeadRow; canWrite: boolean }) {
  const { orgId, cid } = useCampusCtx();
  const toast = useToast();
  const [picked, setPicked] = useState<string[] | null>(null);
  const current = picked ?? lead.documents;
  const dirty = picked !== null && JSON.stringify([...picked].sort()) !== JSON.stringify([...lead.documents].sort());
  const save = useAsyncAction(async (opId: string) => {
    await callApi('lead.save', { orgId, campusId: cid ?? undefined, opId, payload: { id: lead.id, documents: current, expectedVersion: lead.version } });
    return true as const;
  });
  const all = [...new Set([...REQUIRED_DOCS, ...lead.documents])];
  return (
    <Card title="Giấy tờ đã nhận" actions={<span className="text-small text-secondary">{current.length}/{all.length} mục</span>}>
      <div className="stack-sm">
        {all.map((d) => (
          <Checkbox key={d} checked={current.includes(d)} disabled={!canWrite || lead.status === 'enrolled'} onChange={(on) => setPicked(on ? [...current, d] : current.filter((x) => x !== d))}>{d}</Checkbox>
        ))}
        {canWrite && lead.status !== 'enrolled' ? (
          <div>
            <Button
              variant="secondary"
              loading={save.busy}
              disabled={!dirty}
              onClick={async () => { if (await save.run()) { setPicked(null); toast.success('Đã cập nhật danh sách giấy tờ.'); } }}
            >
              Lưu giấy tờ
            </Button>
          </div>
        ) : null}
        <ServerError error={save.error} onReload={() => { setPicked(null); save.reset(); }} />
      </div>
    </Card>
  );
}

/** W09 — Chi tiết tư vấn và duyệt nhập học. */
export function W09LeadDetail({ params }: ScreenProps) {
  const id = params.id;
  const { orgId, cid, scopeKey, can } = useCampusCtx();
  const classes = useClassesQ();
  const [dialog, setDialog] = useState<'edit' | 'status' | 'enroll' | null>(null);
  const q = useDoc<LeadRow>(orgId && cid ? `lead|${scopeKey}|${id}` : null, () => doc(firebase().db, 'orgs', orgId, 'leads', id), (i, d) => mapLead(i, d));
  const lead = q.data;
  const canWrite = can('leads.write');
  const stepIdx = useMemo(() => (lead ? Math.max(0, LEAD_FLOW.indexOf(lead.status)) : 0), [lead]);

  if (q.status === 'loading') return <><PageHeader title="Chi tiết tư vấn" code="W09" /><SkeletonText lines={6} /></>;
  if (q.status === 'error') return <><PageHeader title="Chi tiết tư vấn" code="W09" /><ErrorState message={q.error?.message} onRetry={q.retry} /></>;
  if (q.status === 'empty' || !lead || lead.campusId !== cid) return <><PageHeader title="Chi tiết tư vấn" code="W09" /><NotInCampus what="khách quan tâm" backHref="/tuyen-sinh" backLabel="Về danh sách tuyển sinh" /></>;

  const open = lead.status !== 'enrolled';
  const canEnroll = can('children.write') && open && lead.status !== 'lost';
  const eligible = ['trial', 'documents', 'approved'].includes(lead.status);

  return (
    <div className="stack">
      <PageHeader
        title={`Tư vấn: bé ${lead.childName}`}
        code="W09"
        breadcrumbs={[{ label: 'Tuyển sinh', href: '/tuyen-sinh' }, { label: lead.childName }]}
        description={`Phụ huynh ${lead.parentName} · ${lead.phone}`}
        actions={
          <>
            {canWrite && open ? <Button variant="secondary" onClick={() => setDialog('edit')}>Sửa thông tin</Button> : null}
            {canWrite && open ? <Button variant="secondary" onClick={() => setDialog('status')}>Đổi trạng thái</Button> : null}
            {canEnroll ? <Button onClick={() => setDialog('enroll')}>Duyệt nhập học</Button> : null}
            {lead.enrolledChildId ? <LinkButton href={`/tre/${lead.enrolledChildId}`}>Mở hồ sơ trẻ</LinkButton> : null}
          </>
        }
      />
      <Card>
        <div className="stack">
          <div className="row"><MetaTag meta={LEAD_STATUS} value={lead.status} />{lead.status === 'lost' && lead.lostReason ? <span className="text-secondary">Lý do: {lead.lostReason}</span> : null}</div>
          {lead.status !== 'lost' ? <Stepper steps={LEAD_FLOW.map((s) => LEAD_STATUS[s].label)} current={stepIdx} /> : <Banner tone="info">Khách đã dừng quan tâm. Đổi sang trạng thái khác để mở lại tư vấn.</Banner>}
          {canEnroll && !eligible ? <p className="text-small text-secondary">Nên hoàn tất học thử và giấy tờ trước khi duyệt nhập học; vẫn có thể duyệt sớm nếu nhà trường đồng ý.</p> : null}
        </div>
      </Card>
      <div className="grid-2">
        <Card title="Thông tin">
          <Kv items={[
            ['Bé', `${lead.childName}${lead.childDob ? ` · ${formatDate(lead.childDob)} (${ageText(lead.childDob)})` : ''}`],
            ['Phụ huynh', lead.parentName],
            ['Điện thoại', lead.phone],
            ['Email', lead.email],
            ['Nguồn tiếp nhận', lead.source],
            ['Lớp quan tâm', classes.byId.get(lead.interestedClassId)?.name ?? ''],
            ['Lịch tham quan', lead.tourAt ? formatDateTime(lead.tourAt) : ''],
            ['Tiếp nhận lúc', formatDateTime(lead.createdAt)],
          ]} />
        </Card>
        <DocsCard lead={lead} canWrite={canWrite} />
      </div>
      <NotesCard lead={lead} canWrite={canWrite} />
      <Card title="Lịch sử trạng thái">
        {lead.statusHistory.length === 0 ? <p className="text-secondary">Chưa có lịch sử.</p> : (
          <ol style={{ margin: 0, paddingLeft: 'var(--space-4)' }} className="stack-sm">
            {[...lead.statusHistory].reverse().map((h, i) => (
              <li key={i}><MetaTag meta={LEAD_STATUS} value={h.status} /> <span className="text-caption">{formatDateTime(h.at)}{h.note ? ` · ${h.note}` : ''}</span></li>
            ))}
          </ol>
        )}
      </Card>
      {dialog === 'edit' ? <LeadDialog lead={lead} leads={[]} classes={classes.data} onClose={() => setDialog(null)} onSaved={() => setDialog(null)} /> : null}
      {dialog === 'status' ? <StatusDialog lead={lead} onClose={() => setDialog(null)} /> : null}
      {dialog === 'enroll' ? <EnrollDialog lead={lead} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
