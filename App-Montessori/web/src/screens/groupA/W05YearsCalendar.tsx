'use client';
import { useMemo, useState } from 'react';
import { doc } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import { callApi } from '@/lib/api';
import { useDoc } from '@/lib/hooks/useFirestore';
import { useAsyncAction } from '@/lib/hooks/useAsyncAction';
import { useForm } from '@/lib/hooks/useForm';
import { formatDate } from '@/lib/format';
import { PageHeader, SkeletonText, ErrorState } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Tabs';
import { ConfirmDialog } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Checkbox, DateInput, FormField, Input, Select, Textarea } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import {
  FormDialog, mapYear, num, ServerError, str, strs, statusOf, TIME_RE, useCampusCol, useCampusCtx, useClassesQ, WEEKDAYS, type Doc, type YearRow,
} from './parts/kit';

const YEAR_STATUS: Record<string, string> = { draft: 'Nháp', active: 'Đang diễn ra', closed: 'Đã kết thúc' };
const EX_TYPES: Record<string, string> = { holiday: 'Ngày nghỉ lễ', closure: 'Đóng cửa', makeup_day: 'Ngày học bù', special_hours: 'Giờ đặc biệt' };

interface ExRow {
  id: string; name: string; type: string; fromDay: string; toDay: string; openTime: string; closeTime: string; classIds: string[]; note: string; archived: boolean; version?: number;
}
const mapEx = (id: string, d: Doc): ExRow => ({
  id, name: str(d.name, id), type: str(d.type), fromDay: str(d.fromDay), toDay: str(d.toDay), openTime: str(d.openTime), closeTime: str(d.closeTime),
  classIds: strs(d.classIds), note: str(d.note), archived: d.archived === true, version: num(d.version),
});

/* ------------------------------------------------------------------ năm học */

function YearDialog({ year, years, onClose }: { year: YearRow | null; years: YearRow[]; onClose: () => void }) {
  const { orgId, cid } = useCampusCtx();
  const toast = useToast();
  const form = useForm({
    initial: {
      code: year?.code ?? '', name: year?.name ?? '', startDate: year?.startDate ?? '', endDate: year?.endDate ?? '',
      teachingDays: year?.teachingDays ?? [1, 2, 3, 4, 5], current: year?.current ?? false, status: year?.status ?? 'draft', note: year?.note ?? '',
    },
    validate: (v) => {
      const e: Record<string, string> = {};
      const code = v.code.trim();
      if (code.length < 2) e.code = 'Nhập mã năm học (tối thiểu 2 ký tự).';
      else if (years.some((y) => y.id !== year?.id && y.code.toLowerCase() === code.toLowerCase())) e.code = 'Mã năm học đã tồn tại.';
      if (v.name.trim().length < 2) e.name = 'Nhập tên năm học.';
      if (!v.startDate) e.startDate = 'Chọn ngày bắt đầu.';
      if (!v.endDate) e.endDate = 'Chọn ngày kết thúc.';
      if (v.startDate && v.endDate) {
        if (v.startDate >= v.endDate) e.endDate = 'Ngày kết thúc phải sau ngày bắt đầu.';
        else {
          const o = years.find((y) => y.id !== year?.id && v.startDate <= y.endDate && v.endDate >= y.startDate);
          if (o) e.startDate = `Trùng khoảng thời gian với năm học «${o.name}».`;
        }
      }
      if (v.teachingDays.length === 0) e.teachingDays = 'Chọn ít nhất một ngày học trong tuần.';
      return e;
    },
  });
  const v = form.values;
  const submit = form.onSubmit(async (val, opId) => {
    await callApi('entity.save', {
      orgId, campusId: cid ?? undefined, opId,
      payload: {
        collection: 'academicYears', id: year?.id, expectedVersion: year?.version,
        data: { campusId: cid, code: val.code.trim(), name: val.name.trim(), startDate: val.startDate, endDate: val.endDate, teachingDays: [...val.teachingDays].sort(), current: val.current, status: val.status, note: val.note.trim() },
      },
    });
    toast.success(`Đã lưu năm học ${val.name.trim()}.`);
    form.reset(val);
    onClose();
  });
  return (
    <FormDialog title={year ? `Sửa năm học ${year.name}` : 'Tạo năm học'} form={form} dirty={form.dirty} onSubmit={submit} onClose={onClose} submitLabel="Lưu năm học" size="lg">
      <div className="grid-2">
        <FormField name="code" label="Mã năm học" required {...form.field('code')}><Input {...form.bind('code')} autoComplete="off" /></FormField>
        <FormField name="name" label="Tên năm học" required {...form.field('name')}><Input {...form.bind('name')} autoComplete="off" /></FormField>
        <FormField name="startDate" label="Ngày bắt đầu" required {...form.field('startDate')}><DateInput {...form.bind('startDate')} /></FormField>
        <FormField name="endDate" label="Ngày kết thúc" required {...form.field('endDate')}><DateInput {...form.bind('endDate')} /></FormField>
        <FormField name="status" label="Trạng thái" {...form.field('status')}>
          <Select {...form.bind('status')} options={Object.entries(YEAR_STATUS).map(([value, label]) => ({ value, label }))} />
        </FormField>
      </div>
      <FormField name="teachingDays" label="Ngày học trong tuần" required {...form.field('teachingDays')}>
        <div id="field-teachingDays" tabIndex={-1} className="row">
          {WEEKDAYS.map((d) => (
            <Checkbox key={d.value} checked={v.teachingDays.includes(d.value)} onChange={(on) => form.setValue('teachingDays', on ? [...v.teachingDays, d.value] : v.teachingDays.filter((x) => x !== d.value))}>{d.label}</Checkbox>
          ))}
        </div>
      </FormField>
      <Checkbox checked={v.current} onChange={(on) => form.setValue('current', on)}>Đặt làm năm học hiện hành (năm học hiện hành khác sẽ được bỏ đánh dấu)</Checkbox>
      <FormField name="note" label="Ghi chú" {...form.field('note')}><Textarea {...form.bind('note')} /></FormField>
    </FormDialog>
  );
}

function ArchiveDialog({ collection, id, name, impact, onClose }: { collection: string; id: string; name: string; impact: string[]; onClose: () => void }) {
  const { orgId, cid } = useCampusCtx();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const act = useAsyncAction(async (opId: string) => {
    await callApi('entity.archive', { orgId, campusId: cid ?? undefined, opId, payload: { collection, id, reason: reason.trim() } });
    return true as const;
  });
  return (
    <ConfirmDialog open title={`Lưu trữ «${name}»`} subject={name} impact={impact} confirmLabel={`Lưu trữ ${name}`} tone="destructive" busy={act.busy} error={act.error?.message} onCancel={onClose}
      onConfirm={async () => {
        if (!reason.trim()) return setErr('Nhập lý do lưu trữ.');
        if (await act.run()) { toast.success(`Đã lưu trữ ${name}.`); onClose(); }
      }}>
      <FormField name="archive-reason" label="Lý do lưu trữ" required error={err || undefined}>
        <Textarea name="archive-reason" value={reason} onValueChange={(t) => { setReason(t); setErr(''); }} />
      </FormField>
    </ConfirmDialog>
  );
}

function YearsTab({ canEdit }: { canEdit: boolean }) {
  const q = useCampusCol('academicYears', mapYear);
  const rows = useMemo(() => q.data.filter((y) => !y.archived).sort((a, b) => b.startDate.localeCompare(a.startDate)), [q.data]);
  const [edit, setEdit] = useState<YearRow | 'new' | null>(null);
  const [arch, setArch] = useState<YearRow | null>(null);
  const cols: Column<YearRow>[] = [
    { key: 'name', header: 'Năm học', value: (r) => r.name, sortable: true, render: (r) => <span><strong>{r.name}</strong> <span className="text-caption">({r.code})</span></span> },
    { key: 'range', header: 'Thời gian', value: (r) => r.startDate, sortable: true, render: (r) => `${formatDate(r.startDate)} – ${formatDate(r.endDate)}` },
    { key: 'days', header: 'Ngày học', render: (r) => WEEKDAYS.filter((d) => r.teachingDays.includes(d.value)).map((d) => (d.value === 7 ? 'CN' : `T${d.value + 1}`)).join(', ') || '—' },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, render: (r) => <span className="row" style={{ gap: 'var(--space-2)' }}><Badge tone={r.status === 'active' ? 'success' : r.status === 'closed' ? 'neutral' : 'info'}>{YEAR_STATUS[r.status] ?? r.status}</Badge>{r.current ? <Badge tone="success">Hiện hành</Badge> : null}</span> },
    ...(canEdit ? [{ key: 'actions', header: 'Thao tác', render: (r: YearRow) => (
      <div className="row" style={{ flexWrap: 'nowrap', gap: 'var(--space-1)' }}>
        <Button size="sm" variant="tertiary" onClick={() => setEdit(r)}>Sửa</Button>
        <Button size="sm" variant="tertiary" onClick={() => setArch(r)}>Lưu trữ</Button>
      </div>
    ) }] : []),
  ];
  const add = canEdit ? <Button icon="plus" onClick={() => setEdit('new')}>Tạo năm học</Button> : undefined;
  return (
    <div className="stack">
      {add ? <div>{add}</div> : null}
      <DataTable caption="Danh sách năm học" columns={cols} rows={rows} rowKey={(r) => r.id} status={statusOf(q.status, rows)} error={q.error?.message} onRetry={q.retry}
        searchText={(r) => `${r.name} ${r.code}`} emptyTitle="Chưa có năm học" emptyDescription="Tạo năm học đầu tiên để gán lớp và lập lịch." emptyAction={add} />
      {edit ? <YearDialog year={edit === 'new' ? null : edit} years={rows} onClose={() => setEdit(null)} /> : null}
      {arch ? <ArchiveDialog collection="academicYears" id={arch.id} name={arch.name} onClose={() => setArch(null)}
        impact={['Năm học không còn xuất hiện trong danh sách chọn.', 'Máy chủ chỉ cho lưu trữ khi không còn lớp đang dùng năm học này.', 'Dữ liệu lịch sử được giữ nguyên.']} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ giờ vận hành */

function HoursTab({ canEdit }: { canEdit: boolean }) {
  const { orgId, cid, scopeKey } = useCampusCtx();
  const toast = useToast();
  const q = useDoc<Doc & { id: string }>(orgId && cid ? `campusDoc|${scopeKey}` : null, () => doc(firebase().db, 'orgs', orgId, 'campuses', cid!), (id, d) => ({ id, ...d }));
  if (q.status === 'loading') return <SkeletonText lines={5} />;
  if (q.status === 'error') return <ErrorState message={q.error?.message} onRetry={q.retry} />;
  const d = q.data ?? ({} as Doc);
  return <HoursForm key={String(d.version ?? 0)} d={d} canEdit={canEdit} orgId={orgId} cid={cid} onSaved={() => toast.success('Đã lưu giờ vận hành.')} />;
}

function HoursForm({ d, canEdit, orgId, cid, onSaved }: { d: Doc; canEdit: boolean; orgId: string; cid: string | null; onSaved: () => void }) {
  const form = useForm({
    initial: {
      openTime: str(d.openTime), closeTime: str(d.closeTime), mealCutoff: str(d.mealCutoff),
      workingDays: Array.isArray(d.workingDays) ? (d.workingDays as unknown[]).filter((x): x is number => typeof x === 'number') : [1, 2, 3, 4, 5],
      dropoffFrom: str(d.dropoffFrom), dropoffTo: str(d.dropoffTo), pickupFrom: str(d.pickupFrom), pickupTo: str(d.pickupTo),
    },
    validate: (v) => {
      const e: Record<string, string> = {};
      for (const k of ['openTime', 'closeTime', 'mealCutoff', 'dropoffFrom', 'dropoffTo', 'pickupFrom', 'pickupTo'] as const) if (v[k] && !TIME_RE.test(v[k])) e[k] = 'Giờ phải dạng HH:mm.';
      if (!v.openTime) e.openTime = 'Nhập giờ mở cửa.';
      if (!v.closeTime) e.closeTime = 'Nhập giờ đóng cửa.';
      if (!e.openTime && !e.closeTime && v.openTime >= v.closeTime) e.closeTime = 'Giờ đóng cửa phải sau giờ mở cửa.';
      if (v.dropoffFrom && v.dropoffTo && v.dropoffFrom >= v.dropoffTo) e.dropoffTo = 'Khung đón trẻ: giờ kết thúc phải sau giờ bắt đầu.';
      if (v.pickupFrom && v.pickupTo && v.pickupFrom >= v.pickupTo) e.pickupTo = 'Khung trả trẻ: giờ kết thúc phải sau giờ bắt đầu.';
      if (v.openTime && v.dropoffFrom && v.dropoffFrom < v.openTime) e.dropoffFrom = 'Khung đón không được sớm hơn giờ mở cửa.';
      if (v.closeTime && v.pickupTo && v.pickupTo > v.closeTime) e.pickupTo = 'Khung trả không được muộn hơn giờ đóng cửa.';
      if (v.workingDays.length === 0) e.workingDays = 'Chọn ít nhất một ngày hoạt động.';
      return e;
    },
  });
  const v = form.values;
  const submit = form.onSubmit(async (val, opId) => {
    const payload: Record<string, unknown> = { openTime: val.openTime, closeTime: val.closeTime, workingDays: [...val.workingDays].sort(), expectedVersion: typeof d.version === 'number' ? d.version : undefined };
    for (const k of ['mealCutoff', 'dropoffFrom', 'dropoffTo', 'pickupFrom', 'pickupTo'] as const) if (val[k]) payload[k] = val[k];
    await callApi('campus.update', { orgId, campusId: cid ?? undefined, opId, payload });
    form.reset(val);
    onSaved();
  });
  const T = (name: 'openTime' | 'closeTime' | 'mealCutoff' | 'dropoffFrom' | 'dropoffTo' | 'pickupFrom' | 'pickupTo', label: string, req = false) => (
    <FormField name={name} label={label} required={req} {...form.field(name)}><Input {...form.bind(name)} type="time" disabled={!canEdit} /></FormField>
  );
  return (
    <form className="stack" noValidate onSubmit={(e) => void submit(e)} style={{ maxWidth: 880 }}>
      {!canEdit ? <Banner tone="info">Bạn chỉ có quyền xem cấu hình này.</Banner> : null}
      <Card title="Giờ mở cửa">
        <div className="grid-3">{T('openTime', 'Giờ mở cửa', true)}{T('closeTime', 'Giờ đóng cửa', true)}{T('mealCutoff', 'Giờ chốt suất ăn')}</div>
      </Card>
      <Card title="Khung giờ đón và trả trẻ">
        <div className="grid-2">{T('dropoffFrom', 'Đón trẻ từ')}{T('dropoffTo', 'Đón trẻ đến')}{T('pickupFrom', 'Trả trẻ từ')}{T('pickupTo', 'Trả trẻ đến')}</div>
      </Card>
      <Card title="Ngày hoạt động trong tuần">
        <FormField name="workingDays" label="Ngày cơ sở mở cửa" required {...form.field('workingDays')}>
          <div id="field-workingDays" tabIndex={-1} className="row">
            {WEEKDAYS.map((w) => (
              <Checkbox key={w.value} disabled={!canEdit} checked={v.workingDays.includes(w.value)} onChange={(on) => form.setValue('workingDays', on ? [...v.workingDays, w.value] : v.workingDays.filter((x) => x !== w.value))}>{w.label}</Checkbox>
            ))}
          </div>
        </FormField>
      </Card>
      <ServerError error={form.apiError} message={form.formError} onReload={() => form.reset()} />
      {canEdit ? <div><Button type="submit" size="lg" loading={form.submitting} disabled={!form.dirty}>Lưu giờ vận hành</Button></div> : null}
    </form>
  );
}

/* ------------------------------------------------------------------ ngoại lệ theo ngày */

function ExDialog({ ex, onClose }: { ex: ExRow | null; onClose: () => void }) {
  const { orgId, cid } = useCampusCtx();
  const toast = useToast();
  const classes = useClassesQ();
  const form = useForm({
    initial: { name: ex?.name ?? '', type: ex?.type ?? 'holiday', fromDay: ex?.fromDay ?? '', toDay: ex?.toDay ?? '', openTime: ex?.openTime ?? '', closeTime: ex?.closeTime ?? '', classIds: ex?.classIds ?? [], note: ex?.note ?? '' },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (v.name.trim().length < 2) e.name = 'Nhập tên ngoại lệ (tối thiểu 2 ký tự).';
      if (!v.fromDay) e.fromDay = 'Chọn ngày bắt đầu.';
      if (!v.toDay) e.toDay = 'Chọn ngày kết thúc.';
      if (v.fromDay && v.toDay && v.fromDay > v.toDay) e.toDay = 'Ngày kết thúc phải từ ngày bắt đầu trở đi.';
      if (v.type === 'special_hours') {
        if (!v.openTime) e.openTime = 'Nhập giờ mở cửa.';
        if (!v.closeTime) e.closeTime = 'Nhập giờ đóng cửa.';
        if (v.openTime && v.closeTime && v.openTime >= v.closeTime) e.closeTime = 'Giờ đóng cửa phải sau giờ mở cửa.';
      }
      return e;
    },
  });
  const v = form.values;
  const submit = form.onSubmit(async (val, opId) => {
    const data: Record<string, unknown> = { campusId: cid, name: val.name.trim(), type: val.type, fromDay: val.fromDay, toDay: val.toDay, classIds: val.classIds, note: val.note.trim() };
    if (val.type === 'special_hours') { data.openTime = val.openTime; data.closeTime = val.closeTime; }
    await callApi('entity.save', { orgId, campusId: cid ?? undefined, opId, payload: { collection: 'calendarExceptions', id: ex?.id, expectedVersion: ex?.version, data } });
    toast.success('Đã lưu ngoại lệ lịch.');
    form.reset(val);
    onClose();
  });
  return (
    <FormDialog title={ex ? 'Sửa ngoại lệ theo ngày' : 'Thêm ngoại lệ theo ngày'} form={form} dirty={form.dirty} onSubmit={submit} onClose={onClose} submitLabel="Lưu ngoại lệ" size="lg">
      <Banner tone="info">Ngoại lệ được lưu riêng, không làm đổi cấu hình năm học hoặc giờ vận hành chung.</Banner>
      <div className="grid-2">
        <FormField name="name" label="Tên ngoại lệ" required {...form.field('name')}><Input {...form.bind('name')} autoComplete="off" /></FormField>
        <FormField name="type" label="Loại" required {...form.field('type')}><Select {...form.bind('type')} options={Object.entries(EX_TYPES).map(([value, label]) => ({ value, label }))} /></FormField>
        <FormField name="fromDay" label="Từ ngày" required {...form.field('fromDay')}><DateInput {...form.bind('fromDay')} /></FormField>
        <FormField name="toDay" label="Đến ngày" required {...form.field('toDay')}><DateInput {...form.bind('toDay')} /></FormField>
        {v.type === 'special_hours' ? (
          <>
            <FormField name="openTime" label="Giờ mở cửa" required {...form.field('openTime')}><Input {...form.bind('openTime')} type="time" /></FormField>
            <FormField name="closeTime" label="Giờ đóng cửa" required {...form.field('closeTime')}><Input {...form.bind('closeTime')} type="time" /></FormField>
          </>
        ) : null}
      </div>
      {classes.data.length > 0 ? (
        <FormField name="classIds" label="Áp dụng cho lớp" helper="Không chọn lớp nào = áp dụng toàn cơ sở.">
          <div className="row">{classes.data.map((c) => <Checkbox key={c.id} checked={v.classIds.includes(c.id)} onChange={(on) => form.setValue('classIds', on ? [...v.classIds, c.id] : v.classIds.filter((x) => x !== c.id))}>{c.name}</Checkbox>)}</div>
        </FormField>
      ) : null}
      <FormField name="note" label="Ghi chú" {...form.field('note')}><Textarea {...form.bind('note')} /></FormField>
    </FormDialog>
  );
}

function ExceptionsTab({ canEdit }: { canEdit: boolean }) {
  const q = useCampusCol('calendarExceptions', mapEx);
  const rows = useMemo(() => q.data.filter((r) => !r.archived).sort((a, b) => b.fromDay.localeCompare(a.fromDay)), [q.data]);
  const [edit, setEdit] = useState<ExRow | 'new' | null>(null);
  const [arch, setArch] = useState<ExRow | null>(null);
  const cols: Column<ExRow>[] = [
    { key: 'name', header: 'Tên', value: (r) => r.name, sortable: true, render: (r) => <strong>{r.name}</strong> },
    { key: 'type', header: 'Loại', value: (r) => r.type, render: (r) => <Badge tone={r.type === 'makeup_day' ? 'info' : r.type === 'special_hours' ? 'warning' : 'neutral'}>{EX_TYPES[r.type] ?? r.type}</Badge> },
    { key: 'range', header: 'Thời gian', value: (r) => r.fromDay, sortable: true, render: (r) => (r.fromDay === r.toDay ? formatDate(r.fromDay) : `${formatDate(r.fromDay)} – ${formatDate(r.toDay)}`) },
    { key: 'hours', header: 'Giờ', render: (r) => (r.openTime ? `${r.openTime}–${r.closeTime}` : '—') },
    { key: 'scope', header: 'Phạm vi', render: (r) => (r.classIds.length ? `${r.classIds.length} lớp` : 'Toàn cơ sở') },
    ...(canEdit ? [{ key: 'actions', header: 'Thao tác', render: (r: ExRow) => (
      <div className="row" style={{ flexWrap: 'nowrap', gap: 'var(--space-1)' }}>
        <Button size="sm" variant="tertiary" onClick={() => setEdit(r)}>Sửa</Button>
        <Button size="sm" variant="tertiary" onClick={() => setArch(r)}>Lưu trữ</Button>
      </div>
    ) }] : []),
  ];
  const add = canEdit ? <Button icon="plus" onClick={() => setEdit('new')}>Thêm ngoại lệ</Button> : undefined;
  return (
    <div className="stack">
      {add ? <div>{add}</div> : null}
      <DataTable caption="Ngoại lệ lịch theo ngày" columns={cols} rows={rows} rowKey={(r) => r.id} status={statusOf(q.status, rows)} error={q.error?.message} onRetry={q.retry}
        searchText={(r) => r.name} filters={[{ key: 'type', label: 'Loại', options: Object.entries(EX_TYPES).map(([value, label]) => ({ value, label })), predicate: (r, x) => r.type === x }]}
        emptyTitle="Chưa có ngoại lệ nào" emptyDescription="Thêm ngày nghỉ lễ, ngày đóng cửa, học bù hoặc giờ mở cửa đặc biệt." emptyAction={add} />
      {edit ? <ExDialog ex={edit === 'new' ? null : edit} onClose={() => setEdit(null)} /> : null}
      {arch ? <ArchiveDialog collection="calendarExceptions" id={arch.id} name={arch.name} onClose={() => setArch(null)} impact={['Ngoại lệ không còn được áp dụng vào lịch vận hành.', 'Bản ghi được lưu trữ, không xóa cứng.']} /> : null}
    </div>
  );
}

/** W05 — Cấu hình năm học và lịch vận hành: năm học, ngày học/nghỉ, giờ mở cửa, khung đón trả; ngoại lệ lưu riêng. */
export function W05YearsCalendar() {
  const { can } = useCampusCtx();
  const [tab, setTab] = useState('years');
  const canManage = can('campus.manage');
  return (
    <div className="stack">
      <PageHeader title="Cấu hình năm học và lịch vận hành" code="W05" description="Thiết lập năm học, ngày học, giờ mở cửa, khung đón trả và các ngày ngoại lệ của cơ sở." />
      <Tabs items={[{ id: 'years', label: 'Năm học' }, { id: 'hours', label: 'Giờ vận hành' }, { id: 'exceptions', label: 'Ngoại lệ theo ngày' }]} active={tab} onChange={setTab} />
      {tab === 'years' ? <YearsTab canEdit={canManage && can('classes.write')} /> : null}
      {tab === 'hours' ? <HoursTab canEdit={canManage} /> : null}
      {tab === 'exceptions' ? <ExceptionsTab canEdit={canManage} /> : null}
    </div>
  );
}

