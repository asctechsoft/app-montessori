'use client';
import { callApi } from '@/lib/api';
import { useForm } from '@/lib/hooks/useForm';
import { useToast } from '@/components/ui/Toast';
import { FormField, Input, Select, Textarea } from '@/components/ui/Fields';
import { FormDialog, useCampusCtx, type ClassRow, type YearRow } from './kit';

interface Props {
  /** null = tạo lớp mới. */
  cls: ClassRow | null;
  years: YearRow[];
  classes: ClassRow[];
  /** Sĩ số hiện tại của lớp đang sửa. */
  enrolled: number;
  onClose: () => void;
}

const toInt = (s: string): number | undefined => (s.trim() === '' ? undefined : Number(s));

/** Tạo/sửa lớp học qua entity.save (collection classes). Kiểm tra trùng mã, tuổi, sức chứa không nhỏ hơn sĩ số. */
export function ClassDialog({ cls, years, classes, enrolled, onClose }: Props) {
  const { orgId, cid } = useCampusCtx();
  const toast = useToast();
  const current = years.find((y) => y.current && !y.archived)?.id ?? '';

  const form = useForm({
    initial: {
      code: cls?.code ?? '',
      name: cls?.name ?? '',
      ageGroup: cls?.ageGroup ?? '',
      minAge: cls?.minAgeMonths !== undefined ? String(cls.minAgeMonths) : '',
      maxAge: cls?.maxAgeMonths !== undefined ? String(cls.maxAgeMonths) : '',
      room: cls?.room ?? '',
      capacity: cls ? String(cls.capacity) : '',
      academicYearId: cls?.academicYearId ?? current,
      status: cls?.status ?? 'active',
      note: cls?.note ?? '',
    },
    validate: (v) => {
      const e: Record<string, string> = {};
      const code = v.code.trim();
      if (!code) e.code = 'Nhập mã lớp.';
      else if (classes.some((c) => c.id !== cls?.id && c.code.toLowerCase() === code.toLowerCase())) e.code = 'Mã lớp đã tồn tại tại cơ sở này.';
      if (v.name.trim().length < 2) e.name = 'Nhập tên lớp (tối thiểu 2 ký tự).';
      const cap = toInt(v.capacity);
      if (cap === undefined || !Number.isInteger(cap) || cap < 1 || cap > 200) e.capacity = 'Sức chứa là số nguyên từ 1 đến 200.';
      else if (cls && cap < enrolled) e.capacity = `Sức chứa không được nhỏ hơn sĩ số hiện tại (${enrolled}).`;
      const mn = toInt(v.minAge);
      const mx = toInt(v.maxAge);
      if (mn !== undefined && (!Number.isInteger(mn) || mn < 0 || mn > 120)) e.minAge = 'Tuổi tối thiểu 0–120 tháng.';
      if (mx !== undefined && (!Number.isInteger(mx) || mx < 0 || mx > 120)) e.maxAge = 'Tuổi tối đa 0–120 tháng.';
      if (mn !== undefined && mx !== undefined && !e.minAge && !e.maxAge && mn > mx) e.maxAge = 'Tuổi tối đa không nhỏ hơn tuổi tối thiểu.';
      return e;
    },
  });

  const submit = form.onSubmit(async (v, opId) => {
    const data: Record<string, unknown> = {
      code: v.code.trim(), name: v.name.trim(), ageGroup: v.ageGroup.trim(), room: v.room.trim(), capacity: toInt(v.capacity),
      academicYearId: v.academicYearId, status: v.status, note: v.note.trim(), campusId: cid,
    };
    const mn = toInt(v.minAge);
    const mx = toInt(v.maxAge);
    if (mn !== undefined) data.minAgeMonths = mn;
    if (mx !== undefined) data.maxAgeMonths = mx;
    await callApi('entity.save', {
      orgId, campusId: cid ?? undefined, opId,
      payload: { collection: 'classes', id: cls?.id, data, expectedVersion: cls?.version },
    });
    toast.success(cls ? `Đã lưu lớp ${v.name.trim()}.` : `Đã tạo lớp ${v.name.trim()}.`);
    form.reset(v);
    onClose();
  });

  return (
    <FormDialog title={cls ? `Sửa lớp ${cls.name}` : 'Tạo lớp học'} form={form} dirty={form.dirty} onSubmit={submit} onClose={onClose} submitLabel={cls ? 'Lưu lớp' : 'Tạo lớp'} size="lg">
      <div className="grid-2">
        <FormField name="code" label="Mã lớp" required {...form.field('code')}>
          <Input {...form.bind('code')} autoComplete="off" />
        </FormField>
        <FormField name="name" label="Tên lớp" required {...form.field('name')}>
          <Input {...form.bind('name')} autoComplete="off" />
        </FormField>
        <FormField name="ageGroup" label="Khối tuổi" helper="Ví dụ: Mầm (3–4 tuổi)." {...form.field('ageGroup')}>
          <Input {...form.bind('ageGroup')} />
        </FormField>
        <FormField name="room" label="Phòng" {...form.field('room')}>
          <Input {...form.bind('room')} />
        </FormField>
        <FormField name="minAge" label="Tuổi tối thiểu (tháng)" {...form.field('minAge')}>
          <Input {...form.bind('minAge')} inputMode="numeric" />
        </FormField>
        <FormField name="maxAge" label="Tuổi tối đa (tháng)" {...form.field('maxAge')}>
          <Input {...form.bind('maxAge')} inputMode="numeric" />
        </FormField>
        <FormField name="capacity" label="Sức chứa" required helper={cls ? `Sĩ số hiện tại: ${enrolled}.` : undefined} {...form.field('capacity')}>
          <Input {...form.bind('capacity')} inputMode="numeric" />
        </FormField>
        <FormField name="academicYearId" label="Năm học" {...form.field('academicYearId')}>
          <Select {...form.bind('academicYearId')} placeholder="Chưa gán năm học" options={years.filter((y) => !y.archived).map((y) => ({ value: y.id, label: y.name }))} />
        </FormField>
        <FormField name="status" label="Trạng thái" {...form.field('status')}>
          <Select {...form.bind('status')} options={[{ value: 'active', label: 'Đang hoạt động' }, { value: 'closed', label: 'Đã đóng' }]} />
        </FormField>
      </div>
      <FormField name="note" label="Ghi chú" {...form.field('note')}>
        <Textarea {...form.bind('note')} />
      </FormField>
    </FormDialog>
  );
}
