'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from '@/lib/hooks/useForm';
import { useDirtyGuard } from '@/lib/hooks/dirtyStore';
import { useScope } from '@/providers/ScopeProvider';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { FormField, Input, DateInput } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import type { ScreenProps } from '../registry';
import { ErrorDetails, useCall, useCampusCtx, useCampusDocs, useEmployees, type EmployeeRow } from './parts/kit';
import { B_STATUS, Tag } from './parts/statuses';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUS_OPTIONS = Object.entries(B_STATUS.employee).map(([value, s]) => ({ value, label: s.label }));

function CreateDrawer({ onClose }: { onClose: () => void }) {
  const call = useCall();
  const toast = useToast();
  const router = useRouter();
  const { confirmDiscard } = useDirtyGuard();
  const form = useForm({
    initial: { code: '', fullName: '', phone: '', email: '', title: '', startDate: '', annualLeaveDays: '12' },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.code.trim()) e.code = 'Nhập mã nhân viên.';
      if (v.fullName.trim().length < 2) e.fullName = 'Nhập họ tên (tối thiểu 2 ký tự).';
      if (v.phone.trim() && !/^[0-9+\s().-]{8,20}$/.test(v.phone.trim())) e.phone = 'Số điện thoại chưa đúng định dạng.';
      if (v.email.trim() && !EMAIL_RE.test(v.email.trim())) e.email = 'Email chưa đúng định dạng.';
      if (v.annualLeaveDays.trim() && !/^\d{1,2}$/.test(v.annualLeaveDays.trim())) e.annualLeaveDays = 'Nhập số ngày phép nguyên (0–60).';
      return e;
    },
  });
  const submit = form.onSubmit(async (v, opId) => {
    const res = await call<{ id: string }>('employee.save', {
      code: v.code.trim(), fullName: v.fullName.trim(), phone: v.phone.trim() || undefined, email: v.email.trim() || undefined, title: v.title.trim() || undefined,
      startDate: v.startDate || undefined, annualLeaveDays: v.annualLeaveDays.trim() ? Number(v.annualLeaveDays) : undefined,
    }, opId);
    toast.success(`Đã tạo hồ sơ ${v.fullName.trim()}.`);
    form.reset();
    onClose();
    router.push(`/nhan-su/${res.id}`);
  });
  const close = async () => {
    if (form.dirty && !(await confirmDiscard('đóng biểu mẫu nhân viên'))) return;
    onClose();
  };
  return (
    <Drawer
      open
      title="Thêm nhân viên"
      onClose={() => void close()}
      locked={form.submitting}
      footer={
        <>
          <Button variant="secondary" onClick={() => void close()} disabled={form.submitting}>Hủy</Button>
          <Button onClick={() => void submit()} loading={form.submitting}>Tạo hồ sơ</Button>
        </>
      }
    >
      <form className="stack" noValidate onSubmit={submit}>
        {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
        <p className="text-secondary text-small">Cơ sở chính của nhân viên là cơ sở đang chọn. Hợp đồng, phân công thêm cơ sở và lương được thiết lập trong hồ sơ.</p>
        <div className="grid-2">
          <FormField name="code" label="Mã nhân viên" required {...form.field('code')}><Input {...form.bind('code')} autoComplete="off" /></FormField>
          <FormField name="fullName" label="Họ và tên" required {...form.field('fullName')}><Input {...form.bind('fullName')} autoComplete="off" /></FormField>
          <FormField name="title" label="Chức danh" {...form.field('title')}><Input {...form.bind('title')} /></FormField>
          <FormField name="startDate" label="Ngày vào làm" {...form.field('startDate')}><DateInput {...form.bind('startDate')} /></FormField>
          <FormField name="phone" label="Số điện thoại" {...form.field('phone')}><Input {...form.bind('phone')} inputMode="tel" /></FormField>
          <FormField name="email" label="Email" {...form.field('email')}><Input {...form.bind('email')} type="email" /></FormField>
          <FormField name="annualLeaveDays" label="Số ngày phép năm" {...form.field('annualLeaveDays')}><Input {...form.bind('annualLeaveDays')} inputMode="numeric" /></FormField>
        </div>
        <ErrorDetails error={form.apiError} />
      </form>
    </Drawer>
  );
}

interface AssignRow { id: string; employeeId: string; title: string; fromDay: string; toDay: string; status: string }

/** W21 — Danh sách nhân sự của cơ sở (employees, staffAssignments). */
export function W21Staff({ screen }: ScreenProps) {
  const c = useCampusCtx();
  const router = useRouter();
  const { campuses } = useScope();
  const emp = useEmployees();
  const assigns = useCampusDocs<AssignRow>('staffAssignments', (id, d) => ({
    id, employeeId: String(d.employeeId ?? ''), title: String(d.title ?? ''), fromDay: String(d.fromDay ?? ''), toDay: String(d.toDay ?? ''), status: String(d.status ?? 'active'),
  }));
  const [creating, setCreating] = useState(false);
  const campusName = (id: string) => campuses.find((x) => x.id === id)?.name ?? id;
  const activeAssign = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assigns.data) if (a.status !== 'cancelled') m.set(a.employeeId, (m.get(a.employeeId) ?? 0) + 1);
    return m;
  }, [assigns.data]);

  const columns: Column<EmployeeRow>[] = [
    { key: 'code', header: 'Mã', value: (r) => r.code, sortable: true, width: 110 },
    { key: 'name', header: 'Họ và tên', value: (r) => r.fullName, sortable: true, render: (r) => <strong>{r.fullName}</strong> },
    { key: 'title', header: 'Chức danh', value: (r) => r.title },
    { key: 'phone', header: 'Điện thoại', value: (r) => r.phone },
    {
      key: 'campuses', header: 'Cơ sở làm việc', value: (r) => r.campusIds.length,
      render: (r) => (r.campusIds.length ? r.campusIds.map(campusName).join(', ') : campusName(r.campusId)),
    },
    { key: 'assign', header: 'Đợt phân công tại cơ sở này', value: (r) => activeAssign.get(r.id) ?? 0, render: (r) => `${activeAssign.get(r.id) ?? 0} đợt` },
    { key: 'start', header: 'Vào làm', value: (r) => r.startDate, sortable: true, render: (r) => (r.startDate ? formatDate(r.startDate) : '—') },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, sortable: true, render: (r) => <Tag domain="employee" value={r.status} /> },
  ];
  const filters: TableFilter<EmployeeRow>[] = [{ key: 'status', label: 'Trạng thái', options: STATUS_OPTIONS, predicate: (r, v) => r.status === v }];

  return (
    <div>
      <PageHeader
        title={screen.title}
        code={screen.code}
        description={`Nhân sự có cơ sở chính là ${c.campusName}. Mở hồ sơ để xem hợp đồng và phân công nhiều cơ sở có thời hạn.`}
        actions={c.can('staff.write') ? <Button icon="plus" onClick={() => setCreating(true)}>Thêm nhân viên</Button> : undefined}
      />
      <DataTable
        caption="Danh sách nhân sự"
        columns={columns}
        rows={emp.data}
        rowKey={(r) => r.id}
        status={emp.status}
        error={emp.error?.message}
        onRetry={emp.retry}
        onRowClick={(r) => router.push(`/nhan-su/${r.id}`)}
        searchText={(r) => `${r.code} ${r.fullName} ${r.phone} ${r.email} ${r.title}`}
        searchPlaceholder="Tìm theo mã, tên, điện thoại"
        filters={filters}
        emptyTitle="Chưa có nhân viên nào"
        emptyDescription="Thêm hồ sơ nhân viên đầu tiên cho cơ sở này."
        emptyAction={c.can('staff.write') ? <Button icon="plus" onClick={() => setCreating(true)}>Thêm nhân viên</Button> : undefined}
      />
      {creating ? <CreateDrawer onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
