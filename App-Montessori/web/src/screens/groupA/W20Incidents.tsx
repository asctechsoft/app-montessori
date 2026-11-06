'use client';
import { useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { callApi } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import { useAsyncAction } from '@/lib/hooks/useAsyncAction';
import { useForm } from '@/lib/hooks/useForm';
import { dayKey, formatDateTime, formatTime } from '@/lib/format';
import { PageHeader, Stat } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Checkbox, DateInput, FormField, Input, Select, Textarea } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import {
  dateOf, FormDialog, INCIDENT_STATUS, isoVn, Kv, metaOptions, MetaTag, num, objs, SEVERITY, str, statusOf, useCampusCol, useCampusCtx, useChildrenQ, useStaffWith, type Doc,
} from './parts/kit';

interface Inc {
  id: string; occurredAt: Date | null; type: string; severity: string; childId: string; location: string; description: string; firstAid: string; status: string; ownerUid: string;
  contacts: { name: string; method: string; at: string }[]; outcome: string; shareWithParent: boolean; restricted: boolean; reportedBy: string; closedBy: string; version?: number;
}
const mapInc = (id: string, d: Doc): Inc => ({
  id, occurredAt: dateOf(d.occurredAt), type: str(d.type), severity: str(d.severity), childId: str(d.childId), location: str(d.location), description: str(d.description), firstAid: str(d.firstAid),
  status: str(d.status, 'open'), ownerUid: str(d.ownerUid), contacts: objs(d.contactedPersons).map((c) => ({ name: str(c.name), method: str(c.method), at: str(c.at) })),
  outcome: str(d.outcome), shareWithParent: d.shareWithParent === true, restricted: d.restricted !== false, reportedBy: str(d.reportedByName), closedBy: str(d.closedByName), version: num(d.version),
});

const TYPES = ['Té ngã', 'Va chạm', 'Côn trùng cắn', 'Dị ứng', 'Sốt hoặc không khỏe', 'Cắn hoặc cào', 'Khác'];
const METHODS = [{ value: 'call', label: 'Gọi điện' }, { value: 'message', label: 'Nhắn tin' }, { value: 'inperson', label: 'Trực tiếp' }];

function IncidentDialog({ inc, onClose }: { inc: Inc | null; onClose: () => void }) {
  const { orgId, cid, tz, can } = useCampusCtx();
  const toast = useToast();
  const children = useChildrenQ();
  const staff = useStaffWith('incident.write');
  const cats = useCampusCol('categories', (id, d) => ({ id, type: str(d.type), name: str(d.name), active: d.active !== false }), { keyExtra: 'incident_type', where: [where('type', '==', 'incident_type')] });
  const today = dayKey(new Date(), tz);
  const typeOptions = [...new Set([...cats.data.filter((c) => c.active).map((c) => c.name), ...TYPES])];
  const form = useForm({
    initial: {
      day: inc?.occurredAt ? dayKey(inc.occurredAt, tz) : today, time: inc?.occurredAt ? formatTime(inc.occurredAt, tz) : new Date().toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }),
      type: inc?.type ?? '', severity: inc?.severity ?? '', childId: inc?.childId ?? '', location: inc?.location ?? '', description: inc?.description ?? '', firstAid: inc?.firstAid ?? '',
      contacts: (inc?.contacts.length ? inc.contacts : [{ name: '', method: 'call', at: '' }]) as { name: string; method: string; at: string }[],
      ownerUid: inc?.ownerUid ?? '', restricted: inc?.restricted ?? true, shareWithParent: inc?.shareWithParent ?? false, outcome: inc?.outcome ?? '',
    },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.day) e.day = 'Chọn ngày xảy ra.';
      if (!v.time) e.time = 'Nhập giờ xảy ra.';
      if (v.day && v.time && new Date(isoVn(v.day, v.time)).getTime() - Date.now() > 5 * 60_000) e.day = 'Thời điểm xảy ra không được ở tương lai.';
      if (!v.type.trim()) e.type = 'Nhập loại sự cố.';
      if (!v.severity) e.severity = 'Chọn mức độ.';
      if (v.description.trim().length < 5) e.description = 'Mô tả diễn biến (tối thiểu 5 ký tự).';
      return e;
    },
  });
  const v = form.values;
  const submit = form.onSubmit(async (val, opId) => {
    const payload: Record<string, unknown> = {
      id: inc?.id, campusId: cid, occurredAt: isoVn(val.day, val.time), type: val.type.trim(), severity: val.severity, location: val.location.trim(), description: val.description.trim(), firstAid: val.firstAid.trim(),
      contactedPersons: val.contacts.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), method: c.method, at: c.at.trim() })), restricted: val.restricted, expectedVersion: inc?.version,
    };
    if (!inc) payload.childId = val.childId || undefined;
    if (val.ownerUid) payload.ownerUid = val.ownerUid;
    if (val.outcome.trim()) payload.outcome = val.outcome.trim();
    if (can('children.write')) payload.shareWithParent = val.shareWithParent;
    await callApi('incident.save', { orgId, campusId: cid ?? undefined, opId, payload });
    toast.success(inc ? 'Đã lưu sự cố.' : 'Đã ghi nhận sự cố.');
    form.reset(val);
    onClose();
  });
  return (
    <FormDialog title={inc ? 'Sửa sự cố' : 'Ghi nhận sự cố'} form={form} dirty={form.dirty} onSubmit={submit} onClose={onClose} submitLabel="Lưu sự cố" size="lg">
      <Banner tone="warning" title="Tình huống khẩn cấp">Liên hệ trực tiếp phụ huynh và cơ quan y tế theo quy trình của trường trước; hồ sơ này ghi lại sau để theo dõi. Hồ sơ sự cố giới hạn người xem và không đưa vào album lớp.</Banner>
      <div className="grid-2">
        <FormField name="day" label="Ngày xảy ra" required {...form.field('day')}><DateInput {...form.bind('day')} /></FormField>
        <FormField name="time" label="Giờ xảy ra" required {...form.field('time')}><Input {...form.bind('time')} type="time" /></FormField>
        <FormField name="type" label="Loại sự cố" required {...form.field('type')}>
          <Select {...form.bind('type')} placeholder="Chọn loại" options={[...typeOptions, ...(v.type && !typeOptions.includes(v.type) ? [v.type] : [])].map((t) => ({ value: t, label: t }))} />
        </FormField>
        <FormField name="severity" label="Mức độ" required {...form.field('severity')}><Select {...form.bind('severity')} placeholder="Chọn mức độ" options={metaOptions(SEVERITY)} /></FormField>
        <FormField name="childId" label="Trẻ liên quan" helper={inc ? 'Không đổi trẻ sau khi đã ghi nhận.' : 'Để trống nếu sự cố không gắn với một trẻ.'} {...form.field('childId')}>
          <Select {...form.bind('childId')} placeholder="Không gắn với trẻ" disabled={!!inc} options={children.data.filter((c) => c.classId).map((c) => ({ value: c.id, label: `${c.fullName} (${c.code})` }))} />
        </FormField>
        <FormField name="location" label="Địa điểm" {...form.field('location')}><Input {...form.bind('location')} /></FormField>
      </div>
      <FormField name="description" label="Diễn biến" required {...form.field('description')}><Textarea {...form.bind('description')} /></FormField>
      <FormField name="firstAid" label="Xử lý ban đầu" {...form.field('firstAid')}><Textarea {...form.bind('firstAid')} /></FormField>
      <div className="stack-sm">
        <div className="field-label">Người đã liên hệ</div>
        {v.contacts.map((c, i) => (
          <div key={i} className="grid-3">
            <Input value={c.name} onValueChange={(t) => form.setValue('contacts', v.contacts.map((x, j) => (j === i ? { ...x, name: t } : x)))} placeholder="Họ tên / quan hệ" aria-label={`Người liên hệ ${i + 1}`} />
            <Select value={c.method} onValueChange={(t) => form.setValue('contacts', v.contacts.map((x, j) => (j === i ? { ...x, method: t } : x)))} options={METHODS} aria-label="Cách liên hệ" />
            <Input value={c.at} onValueChange={(t) => form.setValue('contacts', v.contacts.map((x, j) => (j === i ? { ...x, at: t } : x)))} placeholder="Giờ liên hệ (HH:mm)" aria-label="Giờ liên hệ" />
          </div>
        ))}
        <div><Button size="sm" variant="secondary" icon="plus" onClick={() => form.setValue('contacts', [...v.contacts, { name: '', method: 'call', at: '' }])}>Thêm người liên hệ</Button></div>
      </div>
      <div className="grid-2">
        <FormField name="ownerUid" label="Người phụ trách" {...form.field('ownerUid')}>
          {staff.available ? <Select {...form.bind('ownerUid')} placeholder="Chưa giao" options={staff.options.map((s) => ({ value: s.uid, label: s.name }))} /> : <Input {...form.bind('ownerUid')} placeholder="Mã tài khoản người phụ trách" />}
        </FormField>
        <FormField name="outcome" label="Kết quả xử lý" {...form.field('outcome')}><Input {...form.bind('outcome')} /></FormField>
      </div>
      <Checkbox checked={v.restricted} onChange={(on) => form.setValue('restricted', on)}>Giới hạn người xem (chỉ người liên quan và quản lý)</Checkbox>
      {can('children.write') ? <Checkbox checked={v.shareWithParent} onChange={(on) => form.setValue('shareWithParent', on)}>Chia sẻ hồ sơ này cho phụ huynh của trẻ</Checkbox> : null}
    </FormDialog>
  );
}

function CloseDialog({ inc, onClose }: { inc: Inc; onClose: () => void }) {
  const { orgId, cid } = useCampusCtx();
  const toast = useToast();
  const [outcome, setOutcome] = useState(inc.outcome);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const act = useAsyncAction(async (opId: string) => {
    await callApi('incident.close', { orgId, campusId: cid ?? undefined, opId, payload: { id: inc.id, outcome: outcome.trim(), note: note.trim() || undefined, expectedVersion: inc.version } });
    return true as const;
  });
  return (
    <ConfirmDialog open title="Đóng sự cố" subject={`${inc.type} · ${formatDateTime(inc.occurredAt)}`} confirmLabel="Đóng sự cố" busy={act.busy} error={act.error?.message} onCancel={onClose}
      impact={['Sự cố chuyển sang «Đã đóng» và không thể sửa nữa.', 'Kết quả xử lý được lưu cùng người đóng và thời điểm đóng.', 'Muốn ghi thêm sau khi đóng phải tạo ghi chú ở hồ sơ mới.']}
      onConfirm={async () => { if (!outcome.trim()) return setErr('Ghi kết quả xử lý trước khi đóng.'); if (await act.run()) { toast.success('Đã đóng sự cố.'); onClose(); } }}>
      <div className="stack" style={{ marginTop: 'var(--space-3)' }}>
        <FormField name="outcome" label="Kết quả xử lý" required error={err || undefined}><Textarea name="outcome" value={outcome} onValueChange={(t) => { setOutcome(t); setErr(''); }} /></FormField>
        <FormField name="close-note" label="Ghi chú đóng"><Textarea name="close-note" value={note} onValueChange={setNote} /></FormField>
      </div>
    </ConfirmDialog>
  );
}

/** W20 — Sự cố và xử lý. Hồ sơ giới hạn người xem: người có quyền quản lý thấy hết, người khác chỉ thấy hồ sơ mình được xem. */
export function W20Incidents() {
  const { user } = useAuth();
  const { can } = useCampusCtx();
  const manager = can('children.write');
  const uid = user?.uid ?? '';
  const children = useChildrenQ();
  const [dlg, setDlg] = useState<{ kind: 'edit' | 'close'; inc: Inc | null } | null>(null);
  const [view, setView] = useState<Inc | null>(null);

  // Rules: người không có quyền quản lý chỉ đọc được hồ sơ không giới hạn hoặc có tên trong viewerUids -> hai truy vấn riêng.
  const all = useCampusCol('incidents', mapInc, { enabled: manager, keyExtra: 'all' });
  const open = useCampusCol('incidents', mapInc, { enabled: !manager, where: [where('restricted', '==', false)], keyExtra: 'open' });
  const mine = useCampusCol('incidents', mapInc, { enabled: !manager && !!uid, where: [where('viewerUids', 'array-contains', uid)], keyExtra: `mine|${uid}` });
  const rows = useMemo(() => {
    const m = new Map<string, Inc>();
    for (const r of [...all.data, ...open.data, ...mine.data]) m.set(r.id, r);
    return [...m.values()].sort((a, b) => (b.occurredAt?.getTime() ?? 0) - (a.occurredAt?.getTime() ?? 0));
  }, [all.data, open.data, mine.data]);
  const q = manager ? all : open;
  const loading = manager ? all.status === 'loading' : open.status === 'loading' || mine.status === 'loading';
  const error = manager ? all.status === 'error' : open.status === 'error' && mine.status === 'error';
  const status = error ? 'error' : loading ? 'loading' : statusOf('ready', rows);
  const nameOf = (id: string) => (id ? children.byId.get(id)?.fullName ?? id : '');

  const columns: Column<Inc>[] = [
    { key: 'at', header: 'Thời điểm', value: (r) => r.occurredAt?.getTime() ?? 0, sortable: true, render: (r) => formatDateTime(r.occurredAt) },
    { key: 'type', header: 'Loại', value: (r) => r.type, sortable: true, render: (r) => <div><strong>{r.type}</strong><div className="text-caption">{r.location}</div></div> },
    { key: 'child', header: 'Trẻ', value: (r) => nameOf(r.childId), render: (r) => nameOf(r.childId) || '—' },
    { key: 'sev', header: 'Mức độ', value: (r) => r.severity, sortable: true, render: (r) => <MetaTag meta={SEVERITY} value={r.severity} /> },
    { key: 'st', header: 'Trạng thái', value: (r) => r.status, render: (r) => <MetaTag meta={INCIDENT_STATUS} value={r.status} /> },
    ...(can('incident.write') ? [{ key: 'act', header: 'Thao tác', render: (r: Inc) => (r.status === 'open' ? (
      <div className="row" style={{ flexWrap: 'nowrap', gap: 'var(--space-1)' }} onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="tertiary" onClick={() => setDlg({ kind: 'edit', inc: r })}>Sửa</Button>
        <Button size="sm" variant="tertiary" onClick={() => setDlg({ kind: 'close', inc: r })}>Đóng sự cố</Button>
      </div>) : null) }] : []),
  ];
  const filters: TableFilter<Inc>[] = [
    { key: 'sev', label: 'Mức độ', options: metaOptions(SEVERITY), predicate: (r, v) => r.severity === v },
    { key: 'st', label: 'Trạng thái', options: metaOptions(INCIDENT_STATUS), predicate: (r, v) => r.status === v },
    { key: 'type', label: 'Loại', options: [...new Set(rows.map((r) => r.type))].filter(Boolean).map((t) => ({ value: t, label: t })), predicate: (r, v) => r.type === v },
  ];
  const add = can('incident.write') ? <Button icon="plus" onClick={() => setDlg({ kind: 'edit', inc: null })}>Ghi nhận sự cố</Button> : undefined;
  const openCount = rows.filter((r) => r.status === 'open').length;

  return (
    <div className="stack">
      <PageHeader title="Sự cố và xử lý" code="W20" description="Ghi thời gian, diễn biến, xử lý ban đầu, người đã liên hệ, người phụ trách và kết quả. Hồ sơ giới hạn người xem." actions={add} />
      <div className="grid-3"><Stat label="Đang xử lý" value={openCount} tone={openCount ? 'warning' : undefined} /><Stat label="Nghiêm trọng đang mở" value={rows.filter((r) => r.status === 'open' && r.severity === 'serious').length} tone="error" /><Stat label="Tổng hồ sơ xem được" value={rows.length} /></div>
      <DataTable
        caption="Danh sách sự cố"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={status}
        error={q.error?.message ?? mine.error?.message}
        onRetry={() => { all.retry(); open.retry(); mine.retry(); }}
        searchText={(r) => `${r.type} ${r.location} ${nameOf(r.childId)} ${r.description}`}
        searchPlaceholder="Tìm theo loại, địa điểm, trẻ, nội dung"
        filters={filters}
        onRowClick={(r) => setView(r)}
        emptyTitle="Chưa có sự cố nào"
        emptyDescription="Khi có sự cố, ghi nhận tại đây để theo dõi xử lý đến khi đóng."
        emptyAction={add}
      />
      {dlg?.kind === 'edit' ? <IncidentDialog inc={dlg.inc} onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === 'close' && dlg.inc ? <CloseDialog inc={dlg.inc} onClose={() => setDlg(null)} /> : null}
      <Drawer open={!!view} title={view ? `Sự cố: ${view.type}` : ''} onClose={() => setView(null)}>
        {view ? (
          <div className="stack">
            <Kv items={[
              ['Thời điểm', formatDateTime(view.occurredAt)], ['Mức độ', <MetaTag key="s" meta={SEVERITY} value={view.severity} />], ['Trạng thái', <MetaTag key="t" meta={INCIDENT_STATUS} value={view.status} />], ['Trẻ liên quan', nameOf(view.childId)],
              ['Địa điểm', view.location], ['Diễn biến', view.description], ['Xử lý ban đầu', view.firstAid],
              ['Người đã liên hệ', view.contacts.map((c) => `${c.name} (${METHODS.find((m) => m.value === c.method)?.label ?? c.method}${c.at ? `, ${c.at}` : ''})`).join('; ')],
              ['Kết quả', view.outcome], ['Người ghi nhận', view.reportedBy], ['Người đóng', view.closedBy],
              ['Giới hạn người xem', view.restricted ? 'Có' : 'Không'], ['Chia sẻ phụ huynh', view.shareWithParent ? 'Có' : 'Không'],
            ]} />
            <p className="text-caption">Hồ sơ sự cố không đưa vào album lớp và chỉ người được cấp quyền mới xem.</p>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

