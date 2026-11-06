'use client';
import { useMemo } from 'react';
import { ApiError, callApi } from '@/lib/api';
import { useForm } from '@/lib/hooks/useForm';
import { dayKey, formatDate, formatTime } from '@/lib/format';
import { Banner } from '@/components/ui/Banner';
import { DateInput, FormField, Input, Select, Textarea } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import { dateOf, FormDialog, isoVn, num, obj, objs, ROLE_LABEL, str, useCampusCtx, useStaffWith, type Doc } from './kit';

export interface AssignRow {
  id: string;
  classId: string;
  uid: string;
  teacherName: string;
  role: string;
  validFrom: Date | null;
  validTo: Date | null;
  status: string;
  note: string;
  version?: number;
}

export const mapAssign = (id: string, d: Doc): AssignRow => ({
  id, classId: str(d.classId), uid: str(d.uid), teacherName: str(d.teacherName, str(d.uid)), role: str(d.role), validFrom: dateOf(d.validFrom), validTo: dateOf(d.validTo),
  status: str(d.status, 'active'), note: str(d.note), version: num(d.version),
});

/** Phân công còn hiệu lực tại thời điểm `at`. */
export const activeAt = (a: AssignRow, at: Date): boolean =>
  a.status !== 'cancelled' && (!a.validFrom || a.validFrom <= at) && (!a.validTo || a.validTo >= at);

const overlap = (a: { from: number; to: number }, b: { from: number; to: number }) => a.from < b.to && b.from < a.to;

interface Props {
  classId: string;
  className: string;
  assign: AssignRow | null;
  /** Mọi phân công của cơ sở (để kiểm tra chồng lấn trước khi gửi). */
  all: AssignRow[];
  onClose: () => void;
}

/** Thêm/sửa phân công giáo viên (assignment.save). Kiểm tra chồng lấn phía web trước, máy chủ kiểm tra lại. */
export function AssignDialog({ classId, className, assign, all, onClose }: Props) {
  const { orgId, cid, tz } = useCampusCtx();
  const toast = useToast();
  const staff = useStaffWith('attendance.write');
  const today = dayKey(new Date(), tz);
  const form = useForm({
    initial: {
      uid: assign?.uid ?? '', role: assign?.role ?? 'main',
      fromDay: assign?.validFrom ? dayKey(assign.validFrom, tz) : today, fromTime: assign?.validFrom ? formatTime(assign.validFrom, tz) : '00:00',
      toDay: assign?.validTo ? dayKey(assign.validTo, tz) : '', toTime: assign?.validTo ? formatTime(assign.validTo, tz) : '23:59', note: assign?.note ?? '',
    },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.uid.trim()) e.uid = 'Chọn giáo viên.';
      if (!v.fromDay) e.fromDay = 'Chọn ngày bắt đầu.';
      if (v.fromDay && v.toDay && isoVn(v.toDay, v.toTime) <= isoVn(v.fromDay, v.fromTime)) e.toDay = 'Thời điểm kết thúc phải sau thời điểm bắt đầu.';
      return e;
    },
  });
  const v = form.values;

  const conflicts = useMemo(() => {
    if (!v.uid || !v.fromDay) return [];
    const from = new Date(isoVn(v.fromDay, v.fromTime)).getTime();
    const to = v.toDay ? new Date(isoVn(v.toDay, v.toTime)).getTime() : Infinity;
    return all.filter((a) => {
      if (a.id === assign?.id || a.status === 'cancelled') return false;
      const r = { from: a.validFrom?.getTime() ?? 0, to: a.validTo?.getTime() ?? Infinity };
      if (!overlap({ from, to }, r)) return false;
      if (a.uid === v.uid) return true;
      return a.classId === classId && a.role === 'main' && v.role === 'main';
    });
  }, [all, assign?.id, classId, v.fromDay, v.fromTime, v.toDay, v.toTime, v.uid, v.role]);

  const serverConflicts = objs(form.apiError?.details?.conflicts);
  const submit = form.onSubmit(async (val, opId) => {
    if (conflicts.length > 0) throw new ApiError('CONFLICT', 'Phân công bị chồng lấn thời gian. Xem chi tiết ở trên.');
    const payload: Record<string, unknown> = { id: assign?.id, classId, uid: val.uid, role: val.role, validFrom: isoVn(val.fromDay, val.fromTime), note: val.note.trim(), expectedVersion: assign?.version };
    payload.validTo = val.toDay ? isoVn(val.toDay, val.toTime) : null;
    await callApi('assignment.save', { orgId, campusId: cid ?? undefined, opId, payload });
    toast.success('Đã lưu phân công giáo viên.');
    form.reset(val);
    onClose();
  });
  const nameOf = (a: AssignRow) => `${a.teacherName} (${ROLE_LABEL[a.role] ?? a.role}${a.validFrom ? `, từ ${formatDate(a.validFrom)}` : ''}${a.validTo ? ` đến ${formatDate(a.validTo)}` : ''})`;

  return (
    <FormDialog title={assign ? `Sửa phân công lớp ${className}` : `Phân công giáo viên lớp ${className}`} form={form} dirty={form.dirty} onSubmit={submit} onClose={onClose} submitLabel="Lưu phân công" size="lg" submitDisabled={conflicts.length > 0}>
      <div className="grid-2">
        <FormField name="uid" label="Giáo viên" required {...form.field('uid')}>
          {staff.available ? (
            <Select {...form.bind('uid')} placeholder="Chọn giáo viên" options={staff.options.map((s) => ({ value: s.uid, label: s.name }))} disabled={!!assign} />
          ) : (
            <Input {...form.bind('uid')} placeholder="Mã tài khoản (uid) của giáo viên" disabled={!!assign} />
          )}
        </FormField>
        <FormField name="role" label="Vai trò trong lớp" required {...form.field('role')}>
          <Select {...form.bind('role')} options={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))} />
        </FormField>
        <FormField name="fromDay" label="Hiệu lực từ ngày" required {...form.field('fromDay')}><DateInput {...form.bind('fromDay')} /></FormField>
        <FormField name="fromTime" label="Từ giờ" {...form.field('fromTime')}><Input {...form.bind('fromTime')} type="time" /></FormField>
        <FormField name="toDay" label="Đến ngày" helper="Để trống nếu chưa có ngày kết thúc." {...form.field('toDay')}><DateInput {...form.bind('toDay')} /></FormField>
        <FormField name="toTime" label="Đến giờ" {...form.field('toTime')}><Input {...form.bind('toTime')} type="time" /></FormField>
      </div>
      {!staff.available ? <Banner tone="info">Bạn chưa có quyền xem danh sách tài khoản nên cần nhập mã tài khoản giáo viên. Giáo viên phải có vai trò giáo viên tại cơ sở này.</Banner> : null}
      <FormField name="note" label="Ghi chú" {...form.field('note')}><Textarea {...form.bind('note')} /></FormField>
      {conflicts.length > 0 ? (
        <Banner tone="error" title="Phân công bị chồng lấn thời gian">
          <ul style={{ margin: 0, paddingLeft: 20 }}>{conflicts.map((a) => <li key={a.id}>{nameOf(a)}</li>)}</ul>
          Một giáo viên không thể có hai phân công trùng thời gian, và mỗi lớp chỉ có một giáo viên chính tại một thời điểm. Hãy đổi thời gian hoặc kết thúc phân công cũ trước.
        </Banner>
      ) : null}
      {serverConflicts.length > 0 ? <Banner tone="error" title="Máy chủ phát hiện chồng lấn">{serverConflicts.map((c) => `${str(obj(c).role)} ${str(obj(c).uid)}`).join('; ')}</Banner> : null}
    </FormDialog>
  );
}
