'use client';
import { useState } from 'react';
import { doc } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import { callApi } from '@/lib/api';
import { useDoc } from '@/lib/hooks/useFirestore';
import { useForm } from '@/lib/hooks/useForm';
import { dayKey, formatDate } from '@/lib/format';
import { ErrorState, PageHeader, SkeletonText } from '@/components/ui/Misc';
import { Button, LinkButton } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Checkbox, DateInput, FormField, Input, Select, Textarea } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import type { ScreenProps } from '../registry';
import { EnrollProblems, hasDuplicates } from './parts/enroll';
import { GuardiansTab } from './parts/ChildGuardians';
import { AttendanceTab, EnrollmentsTab, FeesTab, HealthTab, HistoryTab } from './parts/ChildTabs';
import {
  ageText, CHILD_STATUS, FormDialog, GENDER_LABEL, GENDER_OPTIONS, IN_SCHOOL, Kv, mapChild, MetaTag, metaOptions, NotInCampus, useCampusCtx, useClassesQ, type ChildRow,
} from './parts/kit';

const splitList = (s: string): string[] => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

function EditDialog({ child, onClose }: { child: ChildRow; onClose: () => void }) {
  const { orgId, cid, tz } = useCampusCtx();
  const toast = useToast();
  const today = dayKey(new Date(), tz);
  const form = useForm({
    initial: { fullName: child.fullName, nickname: child.nickname, dob: child.dob, gender: child.gender, address: child.address, photoConsent: child.photoConsent, notes: child.notes, missingDocuments: child.missingDocuments.join(', '), confirmDuplicate: false },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (v.fullName.trim().length < 2) e.fullName = 'Nhập họ tên trẻ (tối thiểu 2 ký tự).';
      if (!v.dob) e.dob = 'Nhập ngày sinh.';
      else if (v.dob > today) e.dob = 'Ngày sinh không được ở tương lai.';
      return e;
    },
  });
  const submit = form.onSubmit(async (v, opId) => {
    await callApi('child.save', { orgId, campusId: cid ?? undefined, opId, payload: {
      id: child.id, expectedVersion: child.version, fullName: v.fullName.trim(), nickname: v.nickname.trim(), dob: v.dob, gender: v.gender || undefined,
      address: v.address.trim(), photoConsent: v.photoConsent, notes: v.notes.trim(), missingDocuments: splitList(v.missingDocuments), confirmDuplicate: v.confirmDuplicate,
    } });
    toast.success('Đã lưu hồ sơ trẻ.');
    form.reset(v);
    onClose();
  });
  const v = form.values;
  return (
    <FormDialog title={`Sửa hồ sơ ${child.fullName}`} form={form} dirty={form.dirty} onSubmit={submit} onClose={onClose} submitLabel="Lưu hồ sơ" size="lg">
      <Banner tone="info">Mã trẻ ({child.code}) và cơ sở không đổi tại đây. Đổi cơ sở dùng chức năng chuyển cơ sở.</Banner>
      <div className="grid-2">
        <FormField name="fullName" label="Họ tên trẻ" required {...form.field('fullName')}><Input {...form.bind('fullName')} autoComplete="off" /></FormField>
        <FormField name="nickname" label="Tên thường gọi" {...form.field('nickname')}><Input {...form.bind('nickname')} /></FormField>
        <FormField name="dob" label="Ngày sinh" required {...form.field('dob')}><DateInput {...form.bind('dob')} /></FormField>
        <FormField name="gender" label="Giới tính" {...form.field('gender')}><Select {...form.bind('gender')} placeholder="Chưa chọn" options={GENDER_OPTIONS} /></FormField>
      </div>
      <FormField name="address" label="Địa chỉ" {...form.field('address')}><Input {...form.bind('address')} /></FormField>
      <FormField name="missingDocuments" label="Giấy tờ còn thiếu" helper="Ngăn cách bằng dấu phẩy." {...form.field('missingDocuments')}><Input {...form.bind('missingDocuments')} /></FormField>
      <Checkbox checked={v.photoConsent} onChange={(on) => form.setValue('photoConsent', on)}>Phụ huynh đồng ý sử dụng hình ảnh của bé</Checkbox>
      <FormField name="notes" label="Ghi chú" {...form.field('notes')}><Textarea {...form.bind('notes')} /></FormField>
      <EnrollProblems error={form.apiError} />
      {hasDuplicates(form.apiError) || v.confirmDuplicate ? <Checkbox checked={v.confirmDuplicate} onChange={(on) => form.setValue('confirmDuplicate', on)}>Vẫn lưu (đây là trẻ khác)</Checkbox> : null}
    </FormDialog>
  );
}

function StatusDialog({ child, className, onClose }: { child: ChildRow; className: string; onClose: () => void }) {
  const { orgId, cid, tz } = useCampusCtx();
  const toast = useToast();
  const form = useForm({
    initial: { status: '', effectiveDate: dayKey(new Date(), tz), reason: '' },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.status) e.status = 'Chọn trạng thái mới.';
      else if (IN_SCHOOL.includes(v.status) && !child.classId) e.status = 'Trẻ chưa được xếp lớp nên chưa thể đặt trạng thái này.';
      if (!v.effectiveDate) e.effectiveDate = 'Chọn ngày hiệu lực.';
      if (!v.reason.trim()) e.reason = 'Nhập lý do đổi trạng thái.';
      return e;
    },
  });
  const v = form.values;
  const leaving = v.status === 'withdrawn' || v.status === 'archived';
  const submit = form.onSubmit(async (val, opId) => {
    const r = await callApi<{ outstandingReceivables?: number }>('child.setStatus', { orgId, campusId: cid ?? undefined, opId, payload: { childId: child.id, status: val.status, effectiveDate: val.effectiveDate, reason: val.reason.trim(), expectedVersion: child.version } });
    toast.success(`Đã chuyển ${child.fullName} sang «${CHILD_STATUS[val.status]?.label}».`);
    if (r?.outstandingReceivables) toast.warning(`Trẻ còn ${r.outstandingReceivables} khoản công nợ chưa thanh toán cần xử lý.`);
    form.reset(val);
    onClose();
  });
  const impact = [
    `Trạng thái của ${child.fullName} đổi từ «${CHILD_STATUS[child.status]?.label ?? child.status}» sang «${CHILD_STATUS[v.status]?.label ?? '—'}» từ ${v.effectiveDate ? formatDate(v.effectiveDate) : '—'}.`,
    ...(leaving ? [`Đợt phân lớp hiện tại${className ? ` (lớp ${className})` : ''} kết thúc; sĩ số lớp giảm và giáo viên không còn thấy trẻ.`, 'Công nợ và đặt cọc còn lại không tự xóa; cần xử lý riêng.'] : []),
    ...(v.status === 'pending' ? ['Trẻ rời lớp hiện tại và chuyển về «Chờ xếp lớp».'] : []),
    'Thay đổi được ghi vào lịch sử trẻ kèm lý do và người thực hiện.',
  ];
  return (
    <ConfirmDialog open title="Đổi trạng thái hồ sơ trẻ" subject={`${child.code} · ${child.fullName}`} impact={impact}
      confirmLabel={v.status ? `Chuyển sang ${CHILD_STATUS[v.status]?.label}` : 'Đổi trạng thái'} tone={leaving ? 'destructive' : 'primary'}
      busy={form.submitting} error={form.formError} onCancel={onClose} onConfirm={() => void submit()}>
      <div className="stack" style={{ marginTop: 'var(--space-3)' }}>
        <FormField name="status" label="Trạng thái mới" required {...form.field('status')}>
          <Select {...form.bind('status')} placeholder="Chọn trạng thái" options={metaOptions(CHILD_STATUS).filter((o) => o.value !== child.status)} />
        </FormField>
        <FormField name="effectiveDate" label="Ngày hiệu lực" required {...form.field('effectiveDate')}><DateInput {...form.bind('effectiveDate')} /></FormField>
        <FormField name="reason" label="Lý do" required {...form.field('reason')}><Textarea {...form.bind('reason')} /></FormField>
      </div>
    </ConfirmDialog>
  );
}

/** W11 — Chi tiết hồ sơ trẻ: thông tin, giám hộ, đợt phân lớp, điểm danh, học phí, sức khỏe, lịch sử. */
export function W11ChildDetail({ params }: ScreenProps) {
  const id = params.id;
  const { orgId, cid, scopeKey, can } = useCampusCtx();
  const classes = useClassesQ();
  const [tab, setTab] = useState('info');
  const [dlg, setDlg] = useState<'edit' | 'status' | null>(null);
  const q = useDoc<ChildRow>(orgId && cid ? `child|${scopeKey}|${id}` : null, () => doc(firebase().db, 'orgs', orgId, 'children', id), (i, d) => mapChild(i, d));
  const child = q.data;

  if (q.status === 'loading') return <><PageHeader title="Hồ sơ trẻ" code="W11" /><SkeletonText lines={6} /></>;
  if (q.status === 'error') return <><PageHeader title="Hồ sơ trẻ" code="W11" /><ErrorState message={q.error?.message} onRetry={q.retry} /></>;
  if (q.status === 'empty' || !child || child.campusId !== cid) return <><PageHeader title="Hồ sơ trẻ" code="W11" /><NotInCampus what="hồ sơ trẻ" backHref="/tre" backLabel="Về danh sách trẻ" /></>;

  const className = classes.byId.get(child.classId ?? '')?.name ?? '';
  const canWrite = can('children.write');
  const canHealth = can('children.health.read') || can('medication.read');
  const tabs: TabItem[] = [
    { id: 'info', label: 'Thông tin' },
    { id: 'guardians', label: 'Giám hộ và quyền' },
    { id: 'enrollments', label: 'Đợt phân lớp' },
    ...(can('attendance.read') ? [{ id: 'attendance', label: 'Điểm danh' }] : []),
    ...(can('payments.read') ? [{ id: 'fees', label: 'Học phí' }] : []),
    ...(canHealth ? [{ id: 'health', label: 'Sức khỏe' }] : []),
    { id: 'history', label: 'Lịch sử thay đổi' },
  ];
  const active = tabs.some((t) => t.id === tab) ? tab : 'info';
  const inSchool = IN_SCHOOL.includes(child.status) && !!child.classId;

  return (
    <div className="stack">
      <PageHeader
        title={child.fullName}
        code="W11"
        breadcrumbs={[{ label: 'Trẻ và phụ huynh', href: '/tre' }, { label: child.fullName }]}
        description={`Mã ${child.code} · ${ageText(child.dob)}${className ? ` · Lớp ${className}` : ''}`}
        actions={
          <>
            <MetaTag meta={CHILD_STATUS} value={child.status} />
            {canWrite && child.status !== 'archived' ? <Button variant="secondary" onClick={() => setDlg('edit')}>Sửa hồ sơ</Button> : null}
            {canWrite && child.status !== 'archived' ? <Button variant="secondary" onClick={() => setDlg('status')}>Đổi trạng thái</Button> : null}
            {can('children.transfer') && inSchool ? <LinkButton href={`/tre/${child.id}/chuyen`}>Chuyển lớp hoặc cơ sở</LinkButton> : null}
          </>
        }
      />
      <Tabs items={tabs} active={active} onChange={setTab} label="Mục hồ sơ trẻ" />
      {active === 'info' ? (
        <div className="stack">
          {child.missingDocuments.length ? <Banner tone="warning" title="Hồ sơ còn thiếu giấy tờ">{child.missingDocuments.join(', ')}</Banner> : null}
          <Card title="Thông tin cơ bản">
            <Kv items={[
              ['Họ tên', child.fullName], ['Tên thường gọi', child.nickname], ['Mã trẻ', child.code], ['Ngày sinh', `${formatDate(child.dob)} (${ageText(child.dob)})`],
              ['Giới tính', GENDER_LABEL[child.gender] ?? ''], ['Địa chỉ', child.address], ['Lớp hiện tại', className || 'Chưa xếp lớp'],
              ['Ngày nhập học', child.enrolledAt ? formatDate(child.enrolledAt) : ''], ['Đồng ý dùng hình ảnh', child.photoConsent ? 'Có' : 'Chưa'],
              ['Lý do trạng thái gần nhất', child.statusReason], ['Ghi chú', child.notes],
            ]} />
          </Card>
        </div>
      ) : null}
      {active === 'guardians' ? <GuardiansTab child={child} /> : null}
      {active === 'enrollments' ? <EnrollmentsTab child={child} /> : null}
      {active === 'attendance' ? <AttendanceTab child={child} /> : null}
      {active === 'fees' ? <FeesTab child={child} /> : null}
      {active === 'health' ? <HealthTab child={child} /> : null}
      {active === 'history' ? <HistoryTab child={child} /> : null}
      {dlg === 'edit' ? <EditDialog child={child} onClose={() => setDlg(null)} /> : null}
      {dlg === 'status' ? <StatusDialog child={child} className={className} onClose={() => setDlg(null)} /> : null}
    </div>
  );
}

