'use client';
import { useMemo } from 'react';
import { callApi } from '@/lib/api';
import { useForm } from '@/lib/hooks/useForm';
import { dayKey, formatTime } from '@/lib/format';
import { Banner } from '@/components/ui/Banner';
import { DateInput, FormField, Input, Select, Textarea } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import {
  dateOf, EMAIL_RE, FormDialog, isoVn, LEAD_STATUS, num, objs, PHONE_RE, phoneKey, str, strs, useCampusCtx, type ClassRow, type Doc,
} from './kit';

export interface LeadRow {
  id: string;
  campusId: string;
  childName: string;
  childDob: string;
  parentName: string;
  phone: string;
  email: string;
  source: string;
  interestedClassId: string;
  status: string;
  tourAt: Date | null;
  createdAt: Date | null;
  documents: string[];
  note: string;
  lostReason: string;
  enrolledChildId: string;
  consultNotes: { at: Date | null; byName: string; text: string }[];
  statusHistory: { status: string; at: Date | null; note: string }[];
  version?: number;
}

export const mapLead = (id: string, d: Doc): LeadRow => ({
  id,
  campusId: str(d.campusId),
  childName: str(d.childName, id),
  childDob: str(d.childDob),
  parentName: str(d.parentName),
  phone: str(d.phone),
  email: str(d.email),
  source: str(d.source),
  interestedClassId: str(d.interestedClassId),
  status: str(d.status, 'new'),
  tourAt: dateOf(d.tourAt),
  createdAt: dateOf(d.createdAt),
  documents: strs(d.documents),
  note: str(d.note),
  lostReason: str(d.lostReason),
  enrolledChildId: str(d.enrolledChildId),
  consultNotes: objs(d.consultNotes).map((n) => ({ at: dateOf(n.at), byName: str(n.byName), text: str(n.text) })),
  statusHistory: objs(d.statusHistory).map((h) => ({ status: str(h.status), at: dateOf(h.at), note: str(h.note) })),
  version: num(d.version),
});

export const LEAD_SOURCES = ['Facebook', 'Zalo', 'Website', 'Giới thiệu', 'Đến trực tiếp', 'Hội thảo/sự kiện', 'Khác'];
export const REQUIRED_DOCS = ['Giấy khai sinh', 'Sổ tiêm chủng', 'Căn cước/CCCD của phụ huynh', 'Ảnh của bé', 'Giấy khám sức khỏe'];

interface Props {
  /** null = thêm mới. */
  lead: LeadRow | null;
  leads: LeadRow[];
  classes: ClassRow[];
  onSaved: (id: string, created: boolean) => void;
  onClose: () => void;
}

/** Thêm/sửa nhu cầu tuyển sinh (lead.save). Cảnh báo trùng số điện thoại, giữ dữ liệu khi lỗi, xung đột phiên bản báo tải lại. */
export function LeadDialog({ lead, leads, classes, onSaved, onClose }: Props) {
  const { orgId, cid, tz } = useCampusCtx();
  const toast = useToast();
  const today = dayKey(new Date(), tz);

  const form = useForm({
    initial: {
      childName: lead?.childName ?? '', childDob: lead?.childDob ?? '', parentName: lead?.parentName ?? '', phone: lead?.phone ?? '', email: lead?.email ?? '',
      source: lead?.source ?? '', interestedClassId: lead?.interestedClassId ?? '',
      tourDay: lead?.tourAt ? dayKey(lead.tourAt, tz) : '', tourTime: lead?.tourAt ? formatTime(lead.tourAt, tz) : '',
      consultNote: '',
    },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (v.childName.trim().length < 2) e.childName = 'Nhập họ tên bé (tối thiểu 2 ký tự).';
      if (v.childDob && v.childDob > today) e.childDob = 'Ngày sinh không được ở tương lai.';
      if (v.parentName.trim().length < 2) e.parentName = 'Nhập họ tên phụ huynh.';
      if (!v.phone.trim()) e.phone = 'Nhập số điện thoại liên hệ.';
      else if (!PHONE_RE.test(v.phone.trim())) e.phone = 'Số điện thoại chưa đúng định dạng.';
      if (v.email.trim() && !EMAIL_RE.test(v.email.trim())) e.email = 'Email chưa đúng định dạng.';
      if (v.tourTime && !v.tourDay) e.tourDay = 'Chọn ngày tham quan khi đã nhập giờ.';
      return e;
    },
  });

  const dup = useMemo(() => {
    const k = phoneKey(form.values.phone);
    if (k.length < 8) return [];
    return leads.filter((l) => l.id !== lead?.id && phoneKey(l.phone) === k && !['lost', 'enrolled'].includes(l.status));
  }, [form.values.phone, leads, lead?.id]);

  const submit = form.onSubmit(async (v, opId) => {
    const payload: Record<string, unknown> = {
      id: lead?.id, campusId: cid, childName: v.childName.trim(), parentName: v.parentName.trim(), phone: v.phone.trim(),
      expectedVersion: lead?.version,
    };
    if (v.childDob) payload.childDob = v.childDob;
    if (v.email.trim()) payload.email = v.email.trim();
    if (v.source) payload.source = v.source;
    if (v.interestedClassId) payload.interestedClassId = v.interestedClassId;
    if (v.tourDay) payload.tourAt = v.tourTime ? isoVn(v.tourDay, v.tourTime) : v.tourDay;
    if (v.consultNote.trim()) payload.consultNote = v.consultNote.trim();
    const res = await callApi<{ id: string; duplicates?: unknown[] }>('lead.save', { orgId, campusId: cid ?? undefined, opId, payload });
    toast.success(lead ? 'Đã lưu thông tin tư vấn.' : `Đã ghi nhận nhu cầu của bé ${v.childName.trim()}.`);
    if (res.duplicates && res.duplicates.length > 0) toast.warning('Số điện thoại này đã có nhu cầu đang xử lý khác. Hãy kiểm tra để tránh trùng.');
    form.reset(v);
    onSaved(res.id, !lead);
  });

  return (
    <FormDialog title={lead ? `Sửa nhu cầu của bé ${lead.childName}` : 'Thêm nhu cầu tuyển sinh'} form={form} dirty={form.dirty} onSubmit={submit} onClose={onClose} submitLabel="Lưu nhu cầu" size="lg">
      {dup.length > 0 ? (
        <Banner tone="warning" title="Số điện thoại này đã có nhu cầu đang xử lý">
          {dup.map((l) => `${l.childName} (${LEAD_STATUS[l.status]?.label ?? l.status})`).join('; ')}. Bạn vẫn có thể lưu nếu đây là bé khác.
        </Banner>
      ) : null}
      <div className="grid-2">
        <FormField name="childName" label="Họ tên bé" required {...form.field('childName')}>
          <Input {...form.bind('childName')} autoComplete="off" />
        </FormField>
        <FormField name="childDob" label="Ngày sinh của bé" {...form.field('childDob')}>
          <DateInput {...form.bind('childDob')} />
        </FormField>
        <FormField name="parentName" label="Họ tên phụ huynh" required {...form.field('parentName')}>
          <Input {...form.bind('parentName')} autoComplete="off" />
        </FormField>
        <FormField name="phone" label="Số điện thoại" required {...form.field('phone')}>
          <Input {...form.bind('phone')} inputMode="tel" autoComplete="off" />
        </FormField>
        <FormField name="email" label="Email" {...form.field('email')}>
          <Input {...form.bind('email')} type="email" autoComplete="off" />
        </FormField>
        <FormField name="source" label="Nguồn tiếp nhận" {...form.field('source')}>
          <Select {...form.bind('source')} placeholder="Chưa rõ" options={LEAD_SOURCES.map((s) => ({ value: s, label: s }))} />
        </FormField>
        <FormField name="interestedClassId" label="Lớp quan tâm" {...form.field('interestedClassId')}>
          <Select {...form.bind('interestedClassId')} placeholder="Chưa chọn" options={classes.map((c) => ({ value: c.id, label: c.name }))} />
        </FormField>
        <div />
        <FormField name="tourDay" label="Ngày hẹn tham quan" {...form.field('tourDay')}>
          <DateInput {...form.bind('tourDay')} />
        </FormField>
        <FormField name="tourTime" label="Giờ hẹn" {...form.field('tourTime')}>
          <Input {...form.bind('tourTime')} type="time" />
        </FormField>
      </div>
      <FormField name="consultNote" label={lead ? 'Thêm ghi chú tư vấn' : 'Ghi chú tư vấn ban đầu'} {...form.field('consultNote')}>
        <Textarea {...form.bind('consultNote')} />
      </FormField>
    </FormDialog>
  );
}
