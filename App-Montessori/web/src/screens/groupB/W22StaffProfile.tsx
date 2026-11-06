'use client';
import { useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import { useFirestoreQuery } from '@/lib/hooks/useFirestore';
import { useForm } from '@/lib/hooks/useForm';
import { useDirtyGuard } from '@/lib/hooks/dirtyStore';
import { useScope } from '@/providers/ScopeProvider';
import { dayKey, formatDate, formatVnd } from '@/lib/format';
import { PageHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Tabs';
import { Banner } from '@/components/ui/Banner';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { FormField, Input, Select, DateInput, MoneyInput, Checkbox } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import type { ScreenProps } from '../registry';
import { ActionDialog, ErrorDetails, KV, formatNumber, num, text, toEmployee, useCall, useCampusCtx, useCampusDocs, useOrgDoc, type EmployeeRow } from './parts/kit';
import { B_STATUS, Tag } from './parts/statuses';

interface ContractRow { id: string; type: string; startDate: string; endDate: string; position: string; standardDays: number | null; status: string }
interface AssignRow { id: string; campusId: string; title: string; classId: string; role: string; fromDay: string; toDay: string; status: string; primary: boolean }

const CONTRACT_TYPES: Record<string, string> = {
  probation: 'Thử việc', fixed_term: 'Có thời hạn', indefinite: 'Không thời hạn', part_time: 'Bán thời gian', service: 'Dịch vụ / thời vụ',
};
const toContract = (id: string, d: Record<string, unknown>): ContractRow => ({
  id, type: text(d.type), startDate: text(d.startDate), endDate: text(d.endDate), position: text(d.position),
  standardDays: typeof d.standardDays === 'number' ? d.standardDays : null, status: text(d.status, 'active'),
});
const contractPayload = (c: ContractRow) => ({
  id: c.id || undefined, type: c.type, startDate: c.startDate, endDate: c.endDate || undefined, position: c.position || undefined,
  standardDays: c.standardDays ?? undefined, status: c.status,
});
const overlap = (a: ContractRow, b: ContractRow) => (!a.endDate || a.endDate >= b.startDate) && (!b.endDate || b.endDate >= a.startDate);

/* ------------------------------------------------------------------ sửa hồ sơ */

function EditDrawer({ emp, onClose, onReload }: { emp: EmployeeRow; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  const toast = useToast();
  const { confirmDiscard } = useDirtyGuard();
  const form = useForm({
    initial: { fullName: emp.fullName, phone: emp.phone, email: emp.email, title: emp.title, status: emp.status, endDate: emp.endDate, annualLeaveDays: emp.annualLeaveDays === null ? '' : String(emp.annualLeaveDays) },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (v.fullName.trim().length < 2) e.fullName = 'Nhập họ tên (tối thiểu 2 ký tự).';
      if (v.endDate && emp.startDate && v.endDate < emp.startDate) e.endDate = 'Ngày nghỉ việc phải sau ngày vào làm.';
      if (v.status === 'resigned' && !v.endDate) e.endDate = 'Nhập ngày nghỉ việc khi chuyển sang «Đã nghỉ việc».';
      if (v.annualLeaveDays.trim() && !/^\d{1,2}$/.test(v.annualLeaveDays.trim())) e.annualLeaveDays = 'Nhập số ngày phép nguyên (0–60).';
      return e;
    },
  });
  const submit = form.onSubmit(async (v, opId) => {
    await call('employee.save', {
      id: emp.id, campusId: emp.campusId, expectedVersion: emp.version, fullName: v.fullName.trim(), phone: v.phone.trim(), email: v.email.trim(), title: v.title.trim(),
      status: v.status, ...(v.endDate ? { endDate: v.endDate } : {}), ...(v.annualLeaveDays.trim() ? { annualLeaveDays: Number(v.annualLeaveDays) } : {}),
    }, opId);
    toast.success('Đã lưu hồ sơ.');
    form.reset();
    onClose();
  });
  const close = async () => {
    if (form.dirty && !(await confirmDiscard('đóng biểu mẫu hồ sơ'))) return;
    onClose();
  };
  return (
    <Drawer
      open
      title={`Sửa hồ sơ ${emp.fullName}`}
      onClose={() => void close()}
      locked={form.submitting}
      footer={
        <>
          <Button variant="secondary" onClick={() => void close()} disabled={form.submitting}>Hủy</Button>
          <Button onClick={() => void submit()} loading={form.submitting}>Lưu hồ sơ</Button>
        </>
      }
    >
      <form className="stack" noValidate onSubmit={submit}>
        {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
        <ErrorDetails error={form.apiError} onReload={onReload} />
        <div className="grid-2">
          <FormField name="fullName" label="Họ và tên" required {...form.field('fullName')}><Input {...form.bind('fullName')} /></FormField>
          <FormField name="title" label="Chức danh" {...form.field('title')}><Input {...form.bind('title')} /></FormField>
          <FormField name="phone" label="Điện thoại" {...form.field('phone')}><Input {...form.bind('phone')} /></FormField>
          <FormField name="email" label="Email" {...form.field('email')}><Input {...form.bind('email')} type="email" /></FormField>
          <FormField name="status" label="Trạng thái" {...form.field('status')}>
            <Select {...form.bind('status')} options={Object.entries(B_STATUS.employee).map(([value, s]) => ({ value, label: s.label }))} />
          </FormField>
          <FormField name="endDate" label="Ngày nghỉ việc" {...form.field('endDate')}><DateInput {...form.bind('endDate')} /></FormField>
          <FormField name="annualLeaveDays" label="Số ngày phép năm" {...form.field('annualLeaveDays')}><Input {...form.bind('annualLeaveDays')} inputMode="numeric" /></FormField>
        </div>
      </form>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ hợp đồng */

function ContractDrawer({ emp, contracts, onClose, onReload }: { emp: EmployeeRow; contracts: ContractRow[]; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  const toast = useToast();
  const { confirmDiscard } = useDirtyGuard();
  const form = useForm({
    initial: { type: 'fixed_term', startDate: '', endDate: '', position: emp.title, standardDays: '' },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.startDate) e.startDate = 'Chọn ngày bắt đầu.';
      if (v.endDate && v.startDate && v.endDate < v.startDate) e.endDate = 'Ngày kết thúc phải từ ngày bắt đầu trở đi.';
      if (v.type === 'fixed_term' && !v.endDate) e.endDate = 'Hợp đồng có thời hạn cần ngày kết thúc.';
      if (v.standardDays.trim() && !(Number(v.standardDays) >= 1 && Number(v.standardDays) <= 31)) e.standardDays = 'Công chuẩn trong khoảng 1–31.';
      if (v.startDate) {
        const nw: ContractRow = { id: '', type: v.type, startDate: v.startDate, endDate: v.endDate, position: '', standardDays: null, status: 'active' };
        const clash = contracts.find((c) => c.status === 'active' && overlap(c, nw));
        if (clash) e.startDate = `Trùng thời gian với hợp đồng đang hiệu lực (${formatDate(clash.startDate)}${clash.endDate ? ` – ${formatDate(clash.endDate)}` : ' – không thời hạn'}).`;
      }
      return e;
    },
  });
  const submit = form.onSubmit(async (v, opId) => {
    const added = { type: v.type, startDate: v.startDate, endDate: v.endDate || undefined, position: v.position.trim() || undefined, standardDays: v.standardDays.trim() ? Number(v.standardDays) : undefined, status: 'active' };
    await call('employee.save', { id: emp.id, campusId: emp.campusId, expectedVersion: emp.version, contracts: [...contracts.map(contractPayload), added] }, opId);
    toast.success('Đã thêm hợp đồng.');
    form.reset();
    onClose();
  });
  const close = async () => {
    if (form.dirty && !(await confirmDiscard('đóng biểu mẫu hợp đồng'))) return;
    onClose();
  };
  return (
    <Drawer
      open
      title="Thêm hợp đồng"
      onClose={() => void close()}
      locked={form.submitting}
      footer={
        <>
          <Button variant="secondary" onClick={() => void close()} disabled={form.submitting}>Hủy</Button>
          <Button onClick={() => void submit()} loading={form.submitting}>Lưu hợp đồng</Button>
        </>
      }
    >
      <form className="stack" noValidate onSubmit={submit}>
        {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
        <ErrorDetails error={form.apiError} onReload={onReload} />
        <FormField name="type" label="Loại hợp đồng" required {...form.field('type')}>
          <Select {...form.bind('type')} options={Object.entries(CONTRACT_TYPES).map(([value, label]) => ({ value, label }))} />
        </FormField>
        <div className="grid-2">
          <FormField name="startDate" label="Ngày bắt đầu" required {...form.field('startDate')}><DateInput {...form.bind('startDate')} /></FormField>
          <FormField name="endDate" label="Ngày kết thúc" {...form.field('endDate')}><DateInput {...form.bind('endDate')} /></FormField>
          <FormField name="position" label="Vị trí" {...form.field('position')}><Input {...form.bind('position')} /></FormField>
          <FormField name="standardDays" label="Công chuẩn / tháng" helper="Để trống để dùng công chuẩn của cơ sở." {...form.field('standardDays')}><Input {...form.bind('standardDays')} inputMode="decimal" /></FormField>
        </div>
      </form>
    </Drawer>
  );
}

function EndContractDialog({ emp, contract, contracts, onClose, onReload }: { emp: EmployeeRow; contract: ContractRow; contracts: ContractRow[]; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  const c = useCampusCtx();
  const today = dayKey(new Date(), c.tz);
  const [status, setStatus] = useState<'ended' | 'cancelled'>('ended');
  return (
    <ActionDialog
      title="Kết thúc hợp đồng"
      subject={`${emp.fullName} · ${CONTRACT_TYPES[contract.type] ?? contract.type} từ ${formatDate(contract.startDate)}`}
      impact={[
        status === 'ended' ? `Hợp đồng kết thúc từ ngày ${formatDate(today)}; lương các kỳ sau không dựng từ hợp đồng này.` : 'Hợp đồng bị hủy (nhập sai); không dùng để dựng lương.',
        'Bảng lương đã dựng/duyệt của kỳ trước không bị thay đổi.',
      ]}
      confirmLabel={status === 'ended' ? 'Kết thúc hợp đồng' : 'Hủy hợp đồng'}
      tone="destructive"
      success="Đã cập nhật hợp đồng."
      onClose={onClose}
      onReload={onReload}
      run={(opId) =>
        call('employee.save', {
          id: emp.id, campusId: emp.campusId, expectedVersion: emp.version,
          contracts: contracts.map((x) => (x.id === contract.id ? { ...contractPayload(x), status, endDate: status === 'ended' ? (x.endDate && x.endDate < today ? x.endDate : today) : x.endDate || undefined } : contractPayload(x))),
        }, opId)
      }
    >
      <FormField name="end-status" label="Cách xử lý">
        <Select name="end-status" value={status} onValueChange={(v) => setStatus(v === 'cancelled' ? 'cancelled' : 'ended')} options={[{ value: 'ended', label: 'Kết thúc hợp đồng (đã thực hiện)' }, { value: 'cancelled', label: 'Hủy (nhập sai)' }]} />
      </FormField>
    </ActionDialog>
  );
}

function ContractsTab({ emp, onReload }: { emp: EmployeeRow; onReload: () => void }) {
  const c = useCampusCtx();
  const q = useCampusDocs<ContractRow>('contracts', toContract, { where: [['employeeId', '==', emp.id]] });
  const [adding, setAdding] = useState(false);
  const [ending, setEnding] = useState<ContractRow | null>(null);
  const rows = useMemo(() => [...q.data].sort((a, b) => b.startDate.localeCompare(a.startDate)), [q.data]);
  const canWrite = c.can('staff.write');
  const columns: Column<ContractRow>[] = [
    { key: 'type', header: 'Loại', value: (r) => r.type, render: (r) => CONTRACT_TYPES[r.type] ?? r.type },
    { key: 'from', header: 'Từ ngày', value: (r) => r.startDate, sortable: true, render: (r) => formatDate(r.startDate) },
    { key: 'to', header: 'Đến ngày', value: (r) => r.endDate, render: (r) => (r.endDate ? formatDate(r.endDate) : 'Không thời hạn') },
    { key: 'pos', header: 'Vị trí', value: (r) => r.position },
    { key: 'std', header: 'Công chuẩn', value: (r) => r.standardDays, render: (r) => (r.standardDays === null ? 'Theo cơ sở' : formatNumber(r.standardDays)) },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, render: (r) => <Tag domain="contract" value={r.status} /> },
    {
      key: 'act', header: 'Thao tác',
      render: (r) => (canWrite && r.status === 'active' ? <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setEnding(r); }}>Kết thúc</Button> : null),
    },
  ];
  return (
    <div className="stack">
      <DataTable
        caption="Hợp đồng lao động"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={q.status}
        error={q.error?.message}
        onRetry={q.retry}
        toolbarExtra={canWrite ? <Button icon="plus" onClick={() => setAdding(true)}>Thêm hợp đồng</Button> : undefined}
        emptyTitle="Chưa có hợp đồng"
        emptyDescription="Cần có hợp đồng hiệu lực trong kỳ thì mới dựng được bảng lương."
      />
      {adding ? <ContractDrawer emp={emp} contracts={q.data} onClose={() => setAdding(false)} onReload={onReload} /> : null}
      {ending ? <EndContractDialog emp={emp} contract={ending} contracts={q.data} onClose={() => setEnding(null)} onReload={onReload} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ phân công nhiều cơ sở */

function AssignDrawer({ emp, onClose }: { emp: EmployeeRow; onClose: () => void }) {
  const call = useCall();
  const c = useCampusCtx();
  const toast = useToast();
  const { confirmDiscard } = useDirtyGuard();
  const classes = useCampusDocs<{ id: string; name: string }>('classes', (id, d) => ({ id, name: String(d.name ?? id) }), { enabled: c.can('classes.read') });
  const form = useForm({
    initial: { title: emp.title, fromDay: '', toDay: '', classId: '', role: '', primary: false },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.title.trim()) e.title = 'Nhập chức danh trong đợt phân công.';
      if (!v.fromDay) e.fromDay = 'Chọn ngày bắt đầu.';
      if (v.toDay && v.fromDay && v.toDay < v.fromDay) e.toDay = 'Ngày kết thúc phải từ ngày bắt đầu trở đi.';
      return e;
    },
  });
  const submit = form.onSubmit(async (v, opId) => {
    await call('employee.assign', {
      employeeId: emp.id, title: v.title.trim(), fromDay: v.fromDay, ...(v.toDay ? { toDay: v.toDay } : {}), ...(v.classId ? { classId: v.classId } : {}),
      ...(v.role.trim() ? { role: v.role.trim() } : {}), primary: v.primary,
    }, opId);
    toast.success(`Đã phân công ${emp.fullName} làm việc tại ${c.campusName}.`);
    form.reset();
    onClose();
  });
  const close = async () => {
    if (form.dirty && !(await confirmDiscard('đóng biểu mẫu phân công'))) return;
    onClose();
  };
  return (
    <Drawer
      open
      title={`Phân công tại ${c.campusName}`}
      onClose={() => void close()}
      locked={form.submitting}
      footer={
        <>
          <Button variant="secondary" onClick={() => void close()} disabled={form.submitting}>Hủy</Button>
          <Button onClick={() => void submit()} loading={form.submitting}>Lưu phân công</Button>
        </>
      }
    >
      <form className="stack" noValidate onSubmit={submit}>
        {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
        <Banner tone="info">Đợt phân công có thời hạn tại cơ sở đang chọn. Một người có thể làm ở nhiều cơ sở; lịch ca không được trùng khi công bố lịch.</Banner>
        <ErrorDetails error={form.apiError} />
        <div className="grid-2">
          <FormField name="title" label="Chức danh" required {...form.field('title')}><Input {...form.bind('title')} /></FormField>
          <FormField name="role" label="Vai trò (tùy chọn)" {...form.field('role')}><Input {...form.bind('role')} /></FormField>
          <FormField name="fromDay" label="Từ ngày" required {...form.field('fromDay')}><DateInput {...form.bind('fromDay')} /></FormField>
          <FormField name="toDay" label="Đến ngày" helper="Để trống nếu chưa xác định." {...form.field('toDay')}><DateInput {...form.bind('toDay')} /></FormField>
        </div>
        <FormField name="classId" label="Lớp phụ trách (tùy chọn)" {...form.field('classId')}>
          <Select {...form.bind('classId')} placeholder="Không gắn lớp" options={classes.data.map((x) => ({ value: x.id, label: x.name }))} />
        </FormField>
        <Checkbox checked={form.values.primary} onChange={(v) => form.setValue('primary', v)}>Cơ sở chính trong đợt này</Checkbox>
      </form>
    </Drawer>
  );
}

function AssignmentsTab({ emp }: { emp: EmployeeRow }) {
  const c = useCampusCtx();
  const { campuses, canOrg, org } = useScope();
  const orgWide = canOrg('staff.read');
  // Quyền cấp tổ chức: xem mọi đợt phân công của nhân viên; còn lại: chỉ đợt tại cơ sở đang chọn (rules theo cơ sở).
  const q = useFirestoreQuery<AssignRow>(
    org ? `assign|${org.orgId}|${emp.id}|${orgWide ? 'org' : c.campusId}` : null,
    () => {
      const base = collection(firebase().db, 'orgs', org!.orgId, 'staffAssignments');
      return orgWide ? query(base, where('employeeId', '==', emp.id)) : query(base, where('campusId', '==', c.campusId), where('employeeId', '==', emp.id));
    },
    (id, d) => ({ id, campusId: text(d.campusId), title: text(d.title), classId: text(d.classId), role: text(d.role), fromDay: text(d.fromDay), toDay: text(d.toDay), status: text(d.status, 'active'), primary: d.primary === true }),
  );
  const classes = useCampusDocs<{ id: string; name: string }>('classes', (id, d) => ({ id, name: String(d.name ?? id) }), { enabled: c.can('classes.read') });
  const [adding, setAdding] = useState(false);
  const campusName = (id: string) => campuses.find((x) => x.id === id)?.name ?? id;
  const rows = useMemo(() => [...q.data].sort((a, b) => b.fromDay.localeCompare(a.fromDay)), [q.data]);
  const columns: Column<AssignRow>[] = [
    { key: 'campus', header: 'Cơ sở', value: (r) => campusName(r.campusId), sortable: true },
    { key: 'title', header: 'Chức danh', value: (r) => r.title, render: (r) => `${r.title}${r.primary ? ' (chính)' : ''}` },
    { key: 'class', header: 'Lớp', value: (r) => r.classId, render: (r) => classes.data.find((x) => x.id === r.classId)?.name ?? (r.classId || '—') },
    { key: 'from', header: 'Từ ngày', value: (r) => r.fromDay, sortable: true, render: (r) => formatDate(r.fromDay) },
    { key: 'to', header: 'Đến ngày', value: (r) => r.toDay, render: (r) => (r.toDay ? formatDate(r.toDay) : 'Chưa xác định') },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, render: (r) => <Tag domain="assignment" value={r.status} /> },
  ];
  return (
    <div className="stack">
      <p className="text-secondary text-small">Cơ sở làm việc hiện tại: {(emp.campusIds.length ? emp.campusIds : [emp.campusId]).map(campusName).join(', ')}. {orgWide ? '' : 'Danh sách chỉ gồm các đợt tại cơ sở đang chọn.'}</p>
      <DataTable
        caption="Đợt phân công"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={q.status}
        error={q.error?.message}
        onRetry={q.retry}
        toolbarExtra={c.can('staff.write') ? <Button icon="plus" onClick={() => setAdding(true)}>Phân công tại {c.campusName}</Button> : undefined}
        emptyTitle="Chưa có đợt phân công"
        emptyDescription="Khi chưa có đợt phân công, nhân viên được coi là làm tại cơ sở chính."
      />
      {adding ? <AssignDrawer emp={emp} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ lương và ngân hàng (chỉ người có quyền) */

interface SalaryDoc { id: string; baseSalary: number; overtimeRate: number | null; effectiveFrom: string; components: Record<string, unknown>[]; version?: number }
interface BankDoc { id: string; bankName: string; accountNo: string; accountName: string }

function SalaryDrawer({ emp, salary, onClose }: { emp: EmployeeRow; salary: SalaryDoc | null; onClose: () => void }) {
  const call = useCall();
  const toast = useToast();
  const { confirmDiscard } = useDirtyGuard();
  const form = useForm({
    initial: { baseSalary: (salary?.baseSalary ?? null) as number | null, overtimeRate: salary?.overtimeRate === null || salary?.overtimeRate === undefined ? '1.5' : String(salary.overtimeRate), effectiveFrom: salary?.effectiveFrom ?? '' },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (v.baseSalary === null) e.baseSalary = 'Nhập lương cơ bản.';
      if (v.overtimeRate.trim() && !(Number(v.overtimeRate) >= 1 && Number(v.overtimeRate) <= 5)) e.overtimeRate = 'Hệ số tăng ca trong khoảng 1–5.';
      return e;
    },
  });
  const submit = form.onSubmit(async (v, opId) => {
    await call('salary.save', {
      employeeId: emp.id, baseSalary: v.baseSalary, ...(v.overtimeRate.trim() ? { overtimeRate: Number(v.overtimeRate) } : {}), ...(v.effectiveFrom ? { effectiveFrom: v.effectiveFrom } : {}),
      components: salary?.components ?? [], expectedVersion: salary?.version,
    }, opId);
    toast.success('Đã lưu lương. Lịch sử thay đổi được ghi lại.');
    onClose();
  });
  const close = async () => {
    if (form.dirty && !(await confirmDiscard('đóng biểu mẫu lương'))) return;
    onClose();
  };
  return (
    <Drawer
      open
      title={`Lương cơ bản — ${emp.fullName}`}
      onClose={() => void close()}
      locked={form.submitting}
      footer={
        <>
          <Button variant="secondary" onClick={() => void close()} disabled={form.submitting}>Hủy</Button>
          <Button onClick={() => void submit()} loading={form.submitting}>Lưu lương</Button>
        </>
      }
    >
      <form className="stack" noValidate onSubmit={submit}>
        {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
        <ErrorDetails error={form.apiError} />
        <FormField name="baseSalary" label="Lương cơ bản / tháng" required {...form.field('baseSalary')}><MoneyInput {...form.bind('baseSalary')} /></FormField>
        <div className="grid-2">
          <FormField name="overtimeRate" label="Hệ số tăng ca" {...form.field('overtimeRate')}><Input {...form.bind('overtimeRate')} inputMode="decimal" /></FormField>
          <FormField name="effectiveFrom" label="Hiệu lực từ" {...form.field('effectiveFrom')}><DateInput {...form.bind('effectiveFrom')} /></FormField>
        </div>
        <p className="text-secondary text-small">Phụ cấp, thưởng, khấu trừ hiện có ({salary?.components.length ?? 0} khoản) được giữ nguyên.</p>
      </form>
    </Drawer>
  );
}

function BankDrawer({ emp, bank, onClose }: { emp: EmployeeRow; bank: BankDoc | null; onClose: () => void }) {
  const call = useCall();
  const toast = useToast();
  const { confirmDiscard } = useDirtyGuard();
  const form = useForm({
    initial: { bankName: bank?.bankName ?? '', accountNo: bank?.accountNo ?? '', accountName: bank?.accountName ?? '' },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.bankName.trim()) e.bankName = 'Nhập tên ngân hàng.';
      if (!/^\d{6,20}$/.test(v.accountNo.trim())) e.accountNo = 'Số tài khoản gồm 6–20 chữ số.';
      if (!v.accountName.trim()) e.accountName = 'Nhập tên chủ tài khoản.';
      return e;
    },
  });
  const submit = form.onSubmit(async (v, opId) => {
    await call('employee.save', { id: emp.id, campusId: emp.campusId, expectedVersion: emp.version, bank: { bankName: v.bankName.trim(), accountNo: v.accountNo.trim(), accountName: v.accountName.trim() } }, opId);
    toast.success('Đã lưu tài khoản ngân hàng.');
    onClose();
  });
  const close = async () => {
    if (form.dirty && !(await confirmDiscard('đóng biểu mẫu ngân hàng'))) return;
    onClose();
  };
  return (
    <Drawer
      open
      title="Tài khoản nhận lương"
      onClose={() => void close()}
      locked={form.submitting}
      footer={
        <>
          <Button variant="secondary" onClick={() => void close()} disabled={form.submitting}>Hủy</Button>
          <Button onClick={() => void submit()} loading={form.submitting}>Lưu tài khoản</Button>
        </>
      }
    >
      <form className="stack" noValidate onSubmit={submit}>
        {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
        <ErrorDetails error={form.apiError} />
        <FormField name="bankName" label="Ngân hàng" required {...form.field('bankName')}><Input {...form.bind('bankName')} /></FormField>
        <FormField name="accountNo" label="Số tài khoản" required {...form.field('accountNo')}><Input {...form.bind('accountNo')} inputMode="numeric" autoComplete="off" /></FormField>
        <FormField name="accountName" label="Chủ tài khoản" required {...form.field('accountName')}><Input {...form.bind('accountName')} autoComplete="off" /></FormField>
      </form>
    </Drawer>
  );
}

/** Chỉ được render khi người dùng có payroll.read (nơi gọi đã kiểm tra); không đọc dữ liệu lương nếu thiếu quyền. */
function PaySection({ emp }: { emp: EmployeeRow }) {
  const c = useCampusCtx();
  const sal = useOrgDoc<SalaryDoc>(['salaries', emp.id], (id, d) => ({
    id, baseSalary: num(d.baseSalary), overtimeRate: typeof d.overtimeRate === 'number' ? d.overtimeRate : null, effectiveFrom: text(d.effectiveFrom),
    components: Array.isArray(d.components) ? (d.components as Record<string, unknown>[]) : [], version: typeof d.version === 'number' ? d.version : undefined,
  }));
  const bank = useOrgDoc<BankDoc>(['employees', emp.id, 'private', 'bank'], (id, d) => ({ id, bankName: text(d.bankName), accountNo: text(d.accountNo), accountName: text(d.accountName) }));
  const [reveal, setReveal] = useState(false);
  const [editSalary, setEditSalary] = useState(false);
  const [editBank, setEditBank] = useState(false);
  const canWrite = c.can('payroll.write');
  const masked = (n: string) => (reveal || n.length <= 4 ? n : `${'•'.repeat(n.length - 4)}${n.slice(-4)}`);
  return (
    <div className="stack">
      <Banner tone="info">Thông tin lương và ngân hàng chỉ hiển thị cho người có quyền lương. Mọi thay đổi được ghi nhật ký.</Banner>
      <Card title="Lương cơ bản" actions={canWrite && (sal.status === 'ready' || sal.status === 'empty') ? <Button size="sm" variant="secondary" onClick={() => setEditSalary(true)}>{sal.data ? 'Sửa lương' : 'Thiết lập lương'}</Button> : undefined}>
        {sal.status === 'loading' ? <Skeleton height={48} /> : sal.status === 'error' ? <ErrorState message={sal.error?.message} onRetry={sal.retry} /> : !sal.data ? (
          <EmptyState title="Chưa thiết lập lương" description="Cần thiết lập lương cơ bản trước khi dựng bảng lương." />
        ) : (
          <KV cols={3} items={[
            ['Lương cơ bản', formatVnd(sal.data.baseSalary)], ['Hệ số tăng ca', sal.data.overtimeRate === null ? 'Mặc định 1,5' : formatNumber(sal.data.overtimeRate)],
            ['Hiệu lực từ', sal.data.effectiveFrom ? formatDate(sal.data.effectiveFrom) : ''],
            ['Phụ cấp, thưởng, khấu trừ', `${sal.data.components.length} khoản`],
          ]} />
        )}
      </Card>
      <Card title="Tài khoản ngân hàng" actions={canWrite && (bank.status === 'ready' || bank.status === 'empty') ? <Button size="sm" variant="secondary" onClick={() => setEditBank(true)}>{bank.data ? 'Sửa' : 'Thêm tài khoản'}</Button> : undefined}>
        {bank.status === 'loading' ? <Skeleton height={48} /> : bank.status === 'error' ? <ErrorState message={bank.error?.message} onRetry={bank.retry} /> : !bank.data ? (
          <EmptyState title="Chưa có tài khoản nhận lương" />
        ) : (
          <div className="stack-sm">
            <KV cols={3} items={[['Ngân hàng', bank.data.bankName], ['Số tài khoản', masked(bank.data.accountNo)], ['Chủ tài khoản', bank.data.accountName]]} />
            <div><Button size="sm" variant="tertiary" icon="eye" onClick={() => setReveal((v) => !v)}>{reveal ? 'Ẩn số tài khoản' : 'Hiện số tài khoản'}</Button></div>
          </div>
        )}
      </Card>
      {editSalary ? <SalaryDrawer emp={emp} salary={sal.data} onClose={() => setEditSalary(false)} /> : null}
      {editBank ? <BankDrawer emp={emp} bank={bank.data} onClose={() => setEditBank(false)} /> : null}
    </div>
  );
}

/** W22 — Hồ sơ nhân viên, hợp đồng, phân công nhiều cơ sở, lương/ngân hàng (có quyền). */
export function W22StaffProfile({ screen, params }: ScreenProps) {
  const c = useCampusCtx();
  const id = params.id;
  const doc = useOrgDoc<EmployeeRow>(['employees', id], toEmployee);
  const [tab, setTab] = useState('info');
  const [edit, setEdit] = useState(false);
  const showPay = c.can('payroll.read');
  const emp = doc.data;
  const tabs = [{ id: 'info', label: 'Thông tin' }, { id: 'contracts', label: 'Hợp đồng' }, { id: 'assign', label: 'Phân công nhiều cơ sở' }, ...(showPay ? [{ id: 'pay', label: 'Lương và ngân hàng' }] : [])];
  return (
    <div>
      <PageHeader
        title={emp ? emp.fullName : screen.title}
        code={screen.code}
        breadcrumbs={[{ label: 'Nhân sự', href: '/nhan-su' }, { label: emp?.fullName ?? 'Hồ sơ' }]}
        actions={emp && c.can('staff.write') ? <Button variant="secondary" onClick={() => setEdit(true)}>Sửa hồ sơ</Button> : undefined}
      />
      {doc.status === 'loading' ? <Skeleton height={120} /> : doc.status === 'error' ? <ErrorState message={doc.error?.message} onRetry={doc.retry} /> : !emp ? (
        <EmptyState title="Không tìm thấy nhân viên" description="Hồ sơ không tồn tại hoặc bạn không có quyền xem." />
      ) : (
        <div className="stack">
          <Tabs items={tabs} active={tab} onChange={setTab} />
          {tab === 'info' ? (
            <Card title="Thông tin cơ bản">
              <KV cols={3} items={[
                ['Mã nhân viên', emp.code], ['Chức danh', emp.title], ['Trạng thái', <Tag key="s" domain="employee" value={emp.status} />],
                ['Điện thoại', emp.phone], ['Email', emp.email], ['Tài khoản đăng nhập', emp.uid ? 'Đã liên kết' : 'Chưa liên kết'],
                ['Ngày vào làm', emp.startDate ? formatDate(emp.startDate) : ''], ['Ngày nghỉ việc', emp.endDate ? formatDate(emp.endDate) : ''], ['Phép năm', emp.annualLeaveDays === null ? '' : `${emp.annualLeaveDays} ngày`],
              ]} />
            </Card>
          ) : null}
          {tab === 'contracts' ? <ContractsTab emp={emp} onReload={doc.retry} /> : null}
          {tab === 'assign' ? <AssignmentsTab emp={emp} /> : null}
          {tab === 'pay' && showPay ? <PaySection emp={emp} /> : null}
          {edit ? <EditDrawer emp={emp} onClose={() => setEdit(false)} onReload={doc.retry} /> : null}
        </div>
      )}
    </div>
  );
}
