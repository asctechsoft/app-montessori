'use client';
import { useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { callApi } from '@/lib/api';
import { useForm } from '@/lib/hooks/useForm';
import { dayKey, formatDate } from '@/lib/format';
import { Banner } from '@/components/ui/Banner';
import { Button, LinkButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Checkbox, DateInput, FormField, Input, Select, Textarea } from '@/components/ui/Fields';
import { ClassSelect, EnrollProblems, hasDuplicates, seatsText } from './enroll';
import { GuardianEditor, guardianBody, newGuardian, validateGuardians, type GuardianDraft } from './GuardianEditor';
import {
  addDaysKey, FormDialog, GENDER_OPTIONS, objs, str, strs, useCampusCol, useCampusCtx, useChildrenQ, useClassesQ, useOccupancy, type ClassRow,
} from './kit';
import type { LeadRow } from './lead';

interface EnrollResult {
  status: 'enrolled' | 'pending_approval';
  childId?: string;
  code?: string;
  approvalId?: string;
  guardians: { status: string; inviteCode: string; warning: string }[];
  warnings: string[];
}

interface Policy {
  id: string;
  name: string;
  classIds: string[];
}

/** Tháng tuổi của trẻ vào ngày nhập học. */
function monthsOn(dob: string, day: string): number {
  return (Date.parse(day) - Date.parse(dob)) / (30.4375 * 86400_000);
}

/**
 * W09 — Duyệt nhập học: chọn lớp, ngày nhập học, biểu phí; kiểm tra sĩ số (lớp đầy: gợi ý lớp khác hoặc xin duyệt ngoại lệ);
 * tạo hồ sơ trẻ + người giám hộ qua lead.enroll (opId chống gửi trùng).
 */
export function EnrollDialog({ lead, onClose }: { lead: LeadRow; onClose: () => void }) {
  const { orgId, cid, tz, can } = useCampusCtx();
  const today = dayKey(new Date(), tz);
  const classes = useClassesQ();
  const children = useChildrenQ(can('children.read'));
  const occupancy = useOccupancy(children.data, children.status === 'ready' || children.status === 'empty');
  const policies = useCampusCol<Policy>('feePolicies', (id, d) => ({ id, name: str(d.name, id), classIds: strs(d.classIds) }), {
    enabled: can('fees.read'),
    where: [where('status', '==', 'published')],
    keyExtra: 'published',
  });
  const [result, setResult] = useState<EnrollResult | null>(null);

  const form = useForm({
    initial: {
      classId: lead.interestedClassId,
      startDate: today,
      feePlanId: '',
      fullName: lead.childName,
      dob: lead.childDob,
      gender: '',
      code: '',
      address: '',
      photoConsent: false,
      guardians: [{ ...newGuardian('mother'), name: lead.parentName, phone: lead.phone, email: lead.email, pickup: true }] as GuardianDraft[],
      requestException: false,
      exceptionReason: '',
      confirmDuplicate: false,
    },
    validate: (v) => {
      const e: Record<string, string> = {};
      const cls = classes.byId.get(v.classId);
      if (!v.classId) e.classId = 'Chọn lớp nhập học.';
      else if (cls && occupancy(cls) >= cls.capacity && !v.requestException) e.classId = 'Lớp đã đủ sĩ số. Chọn lớp khác hoặc xin duyệt ngoại lệ bên dưới.';
      if (!v.startDate) e.startDate = 'Chọn ngày nhập học.';
      else if (v.startDate < addDaysKey(today, -31)) e.startDate = 'Ngày nhập học quá xa trong quá khứ (tối đa 31 ngày).';
      if (v.fullName.trim().length < 2) e.fullName = 'Nhập họ tên trẻ (tối thiểu 2 ký tự).';
      if (!v.dob) e.dob = 'Nhập ngày sinh của trẻ.';
      else if (v.dob > today) e.dob = 'Ngày sinh không được ở tương lai.';
      else if (v.dob < addDaysKey(today, -365 * 15)) e.dob = 'Ngày sinh không hợp lý đối với trẻ mầm non.';
      const code = v.code.trim();
      if (code && !/^[A-Za-z0-9_-]{2,20}$/.test(code)) e.code = 'Mã 2–20 ký tự gồm chữ, số, gạch nối hoặc gạch dưới.';
      else if (code && children.data.some((c) => c.code.toUpperCase() === code.toUpperCase())) e.code = `Mã trẻ ${code.toUpperCase()} đã tồn tại.`;
      if (v.requestException && !v.exceptionReason.trim()) e.exceptionReason = 'Nhập lý do xin nhận vượt sĩ số.';
      return { ...e, ...validateGuardians(v.guardians) };
    },
  });
  const v = form.values;
  const cls: ClassRow | undefined = classes.byId.get(v.classId);
  const enrolled = cls ? occupancy(cls) : 0;
  const full = !!cls && enrolled >= cls.capacity;
  const ageWarn = useMemo(() => {
    if (!cls || !v.dob || !v.startDate) return '';
    const m = monthsOn(v.dob, v.startDate);
    if ((cls.minAgeMonths !== undefined && m < cls.minAgeMonths) || (cls.maxAgeMonths !== undefined && m > cls.maxAgeMonths)) {
      return 'Độ tuổi của trẻ nằm ngoài khối tuổi của lớp. Vẫn có thể nhập học nếu nhà trường đồng ý.';
    }
    return '';
  }, [cls, v.dob, v.startDate]);

  const submit = form.onSubmit(async (val, opId) => {
    const payload: Record<string, unknown> = {
      leadId: lead.id,
      classId: val.classId,
      startDate: val.startDate,
      child: {
        fullName: val.fullName.trim(), dob: val.dob, photoConsent: val.photoConsent,
        ...(val.gender ? { gender: val.gender } : {}), ...(val.code.trim() ? { code: val.code.trim().toUpperCase() } : {}), ...(val.address.trim() ? { address: val.address.trim() } : {}),
      },
      guardians: val.guardians.map(guardianBody),
      confirmDuplicate: val.confirmDuplicate,
    };
    if (val.feePlanId) payload.feePlanId = val.feePlanId;
    if (val.requestException && full) {
      payload.requestException = true;
      payload.exceptionReason = val.exceptionReason.trim();
    }
    const res = await callApi<Record<string, unknown>>('lead.enroll', { orgId, campusId: cid ?? undefined, opId, payload });
    form.reset(val);
    setResult({
      status: res.status === 'pending_approval' ? 'pending_approval' : 'enrolled',
      childId: str(res.childId) || undefined,
      code: str(res.code) || undefined,
      approvalId: str(res.approvalId) || undefined,
      guardians: objs(res.guardians).map((g) => ({ status: str(g.status), inviteCode: str(g.inviteCode), warning: str(g.warning) })),
      warnings: strs(res.warnings),
    });
  });

  if (result) {
    return (
      <Modal open title={result.status === 'enrolled' ? 'Đã nhập học' : 'Đã gửi xin duyệt ngoại lệ'} onClose={onClose} footer={
        <>
          {result.status === 'enrolled' && result.childId ? <LinkButton href={`/tre/${result.childId}`}>Mở hồ sơ trẻ</LinkButton> : null}
          {result.status === 'pending_approval' ? <LinkButton href="/phe-duyet">Mở trung tâm phê duyệt</LinkButton> : null}
          <Button variant="secondary" onClick={onClose}>Đóng</Button>
        </>
      }>
        <div className="stack">
          {result.status === 'enrolled' ? (
            <Banner tone="success" title={`Đã nhập học: ${v.fullName.trim()}${result.code ? ` (mã ${result.code})` : ''}`}>
              Trẻ được xếp vào lớp {cls?.name} từ {formatDate(v.startDate)}. Tư vấn đã chuyển sang «Đã nhập học».
            </Banner>
          ) : (
            <Banner tone="info" title="Lớp đã đủ sĩ số nên yêu cầu nhận vượt sĩ số đã được gửi">
              Trẻ sẽ được nhập học sau khi người có thẩm quyền duyệt. Tư vấn giữ nguyên trạng thái hiện tại cho tới lúc đó.
            </Banner>
          )}
          {result.guardians.map((g, i) => (
            <p key={i} className="text-small">
              Người giám hộ {i + 1}: {g.status === 'linked' ? 'đã liên kết với tài khoản phụ huynh có sẵn.' : <>đã tạo lời mời kích hoạt{g.inviteCode ? <>, mã mời <strong>{g.inviteCode}</strong></> : null}.</>}
              {g.warning ? ` ${g.warning}` : ''}
            </p>
          ))}
          {result.warnings.map((w) => <Banner key={w} tone="warning">{w}</Banner>)}
        </div>
      </Modal>
    );
  }

  const impact = [
    cls ? `Trẻ vào lớp ${cls.name} từ ${v.startDate ? formatDate(v.startDate) : '—'}; sĩ số ${seatsText(cls, enrolled)} → ${enrolled + 1}/${cls.capacity}${full ? ' (vượt sĩ số, cần duyệt ngoại lệ)' : ''}.` : 'Chọn lớp để xem sĩ số sau khi nhận trẻ.',
    `Tạo hồ sơ trẻ mới và liên kết ${v.guardians.length} người giám hộ; mỗi người nhận lời mời kích hoạt nếu chưa có tài khoản.`,
    'Tư vấn chuyển sang «Đã nhập học» và không đổi lại được.',
  ];

  return (
    <FormDialog title={`Duyệt nhập học cho bé ${lead.childName}`} form={form} dirty={form.dirty} onSubmit={submit} onClose={onClose} submitLabel={v.requestException && full ? 'Gửi xin duyệt ngoại lệ' : `Nhập học bé ${v.fullName.trim() || lead.childName}`} size="lg"
      footerNote={<div className="impact"><div className="impact-subject">Tác động khi xác nhận</div><ul>{impact.map((t) => <li key={t}>{t}</li>)}</ul></div>}>
      <div className="grid-2">
        <FormField name="classId" label="Lớp nhập học" required {...form.field('classId')}>
          <ClassSelect {...form.bind('classId')} classes={classes.data} occupancy={occupancy} />
        </FormField>
        <FormField name="startDate" label="Ngày nhập học" required {...form.field('startDate')}>
          <DateInput {...form.bind('startDate')} />
        </FormField>
        {can('fees.read') ? (
          <FormField name="feePlanId" label="Biểu phí áp dụng" helper="Biểu phí đã phát hành của cơ sở." {...form.field('feePlanId')}>
            <Select
              {...form.bind('feePlanId')}
              placeholder="Chưa chọn (áp dụng sau)"
              options={policies.data.filter((p) => p.classIds.length === 0 || !v.classId || p.classIds.includes(v.classId)).map((p) => ({ value: p.id, label: p.name }))}
            />
          </FormField>
        ) : null}
      </div>
      {full ? (
        <Banner tone="warning" title={`Lớp ${cls?.name} đã đủ sĩ số (${seatsText(cls!, enrolled)})`}>
          <div className="stack-sm">
            <span>Chọn lớp khác còn chỗ, hoặc gửi xin duyệt ngoại lệ theo chính sách.</span>
            <Checkbox checked={v.requestException} onChange={(on) => form.setValue('requestException', on)}>Xin duyệt nhận vượt sĩ số</Checkbox>
            {v.requestException ? (
              <FormField name="exceptionReason" label="Lý do xin vượt sĩ số" required {...form.field('exceptionReason')}>
                <Textarea {...form.bind('exceptionReason')} />
              </FormField>
            ) : null}
          </div>
        </Banner>
      ) : null}
      {ageWarn ? <Banner tone="warning">{ageWarn}</Banner> : null}

      <div className="field-label">Hồ sơ trẻ</div>
      <div className="grid-2">
        <FormField name="fullName" label="Họ tên trẻ" required {...form.field('fullName')}>
          <Input {...form.bind('fullName')} autoComplete="off" />
        </FormField>
        <FormField name="dob" label="Ngày sinh" required {...form.field('dob')}>
          <DateInput {...form.bind('dob')} />
        </FormField>
        <FormField name="gender" label="Giới tính" {...form.field('gender')}>
          <Select {...form.bind('gender')} placeholder="Chưa chọn" options={GENDER_OPTIONS} />
        </FormField>
        <FormField name="code" label="Mã trẻ" helper="Để trống để hệ thống tự sinh (MN001...)." {...form.field('code')}>
          <Input {...form.bind('code')} autoComplete="off" />
        </FormField>
      </div>
      <FormField name="address" label="Địa chỉ" {...form.field('address')}>
        <Input {...form.bind('address')} autoComplete="off" />
      </FormField>
      <Checkbox checked={v.photoConsent} onChange={(on) => form.setValue('photoConsent', on)}>Phụ huynh đồng ý sử dụng hình ảnh của bé</Checkbox>

      <div className="field-label">Người giám hộ</div>
      <GuardianEditor drafts={v.guardians} onChange={(g) => form.setValue('guardians', g)} errors={form.errors} min={1} />

      <EnrollProblems error={form.apiError} onPickClass={(id) => form.setValue('classId', id)} />
      {hasDuplicates(form.apiError) || v.confirmDuplicate ? (
        <Checkbox checked={v.confirmDuplicate} onChange={(on) => form.setValue('confirmDuplicate', on)}>Vẫn tạo hồ sơ mới (đây là trẻ khác)</Checkbox>
      ) : null}
    </FormDialog>
  );
}
