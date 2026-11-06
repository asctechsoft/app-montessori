'use client';
import { useMemo, useState } from 'react';
import { collection } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import { useFirestoreQuery } from '@/lib/hooks/useFirestore';
import { formatVnd } from '@/lib/format';
import { PageHeader, Stat, Stepper } from '@/components/ui/Misc';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Checkbox, FormField, Select, Textarea, Input } from '@/components/ui/Fields';
import { EmptyState } from '@/components/ui/Misc';
import { ActionDialog, formatNumber, num, text, useCall, useCampusCtx, useCampusDocs } from './parts/kit';
import { currentPeriod, periodLabel, periodOptions } from './parts/dates';
import { Tag } from './parts/statuses';
import { GuardedLink } from '@/components/layout/nav';

interface RunRow {
  id: string;
  periodKey: string;
  status: string;
  paymentStatus: string;
  headcount: number;
  gross: number;
  deductions: number;
  net: number;
  paid: number;
  errors: { employeeId: string; name: string; message: string }[];
  standardDays: number;
  timesheetLockVersion: number;
  submittedBy: string;
  rejectReason: string;
  approvalNote: string;
  version?: number;
}

interface ItemRow {
  id: string;
  code: string;
  name: string;
  paidDays: number;
  standardDays: number;
  basePay: number;
  overtimePay: number;
  allowances: number;
  deductions: number;
  net: number;
  paidAmount: number;
  paymentStatus: string;
}

const toRun = (id: string, d: Record<string, unknown>): RunRow => {
  const t = (d.totals ?? {}) as Record<string, unknown>;
  return {
    id,
    periodKey: text(d.periodKey),
    status: text(d.status, 'draft'),
    paymentStatus: text(d.paymentStatus, 'unpaid'),
    headcount: num(d.headcount),
    gross: num(t.gross),
    deductions: num(t.deductions),
    net: num(t.net),
    paid: num(t.paid),
    errors: Array.isArray(d.errors) ? (d.errors as RunRow['errors']) : [],
    standardDays: num(d.standardDays),
    timesheetLockVersion: num(d.timesheetLockVersion),
    submittedBy: text(d.submittedBy),
    rejectReason: text(d.rejectReason),
    approvalNote: text(d.approvalNote),
    version: typeof d.version === 'number' ? d.version : undefined,
  };
};

const toItem = (id: string, d: Record<string, unknown>): ItemRow => ({
  id,
  code: text(d.code),
  name: text(d.name, id),
  paidDays: num(d.paidDays),
  standardDays: num(d.standardDays),
  basePay: num(d.basePay),
  overtimePay: num(d.overtimePay),
  allowances: num(d.allowances),
  deductions: num(d.deductions),
  net: num(d.net),
  paidAmount: num(d.paidAmount),
  paymentStatus: text(d.paymentStatus, 'unpaid'),
});

const STEPS = ['Nháp', 'Chờ duyệt', 'Đã duyệt', 'Đã phát hành phiếu', 'Đã chi trả đủ'];
const STEP_INDEX: Record<string, number> = { draft: 0, submitted: 1, approved: 2, published: 3, paid: 4 };

type Dlg = 'build' | 'submit' | 'approve' | 'publish' | null;

/** W27 — Bảng lương cơ sở: dựng từ công đã khóa → gửi duyệt → duyệt → phát hành phiếu. Chi trả ở W28. */
export function W27Payroll() {
  const c = useCampusCtx();
  const call = useCall();
  const canRead = c.can('payroll.read');
  const [period, setPeriod] = useState(() => currentPeriod(c.tz));
  const [dlg, setDlg] = useState<Dlg>(null);
  const [stdDays, setStdDays] = useState('');
  const [ack, setAck] = useState(false);
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [note, setNote] = useState('');

  const runs = useCampusDocs<RunRow>('payrollRuns', toRun, { enabled: canRead });
  const runId = `pr_${c.campusId}_${period}`;
  const run = runs.data.find((r) => r.id === runId) ?? null;

  const items = useFirestoreQuery<ItemRow>(
    canRead && run ? `payrollItems|${c.orgId}|${runId}` : null,
    () => collection(firebase().db, 'orgs', c.orgId, 'payrollRuns', runId, 'items'),
    (id, d) => toItem(id, d),
  );

  const periods = useMemo(() => periodOptions(c.tz, 18, 1), [c.tz]);
  const close = () => {
    setDlg(null);
    setAck(false);
    setNote('');
    setStdDays('');
  };

  if (!canRead) {
    return (
      <div>
        <PageHeader title="Bảng lương cơ sở" code="W27" />
        <EmptyState icon="lock" title="Bạn không có quyền xem bảng lương" description="Dữ liệu lương chỉ hiển thị cho người được cấp quyền xem lương." />
      </div>
    );
  }

  const columns: Column<ItemRow>[] = [
    { key: 'code', header: 'Mã', value: (r) => r.code, sortable: true, width: 90 },
    { key: 'name', header: 'Nhân viên', value: (r) => r.name, sortable: true, render: (r) => <strong>{r.name}</strong> },
    { key: 'days', header: 'Công thực tế / chuẩn', value: (r) => r.paidDays, align: 'right', render: (r) => `${formatNumber(r.paidDays)} / ${formatNumber(r.standardDays)}` },
    { key: 'base', header: 'Lương theo công', value: (r) => r.basePay, align: 'right', render: (r) => formatVnd(r.basePay), total: 'sum', formatTotal: formatVnd },
    { key: 'ot', header: 'Tăng ca', value: (r) => r.overtimePay, align: 'right', render: (r) => formatVnd(r.overtimePay), total: 'sum', formatTotal: formatVnd },
    { key: 'allow', header: 'Phụ cấp', value: (r) => r.allowances, align: 'right', render: (r) => formatVnd(r.allowances), total: 'sum', formatTotal: formatVnd },
    { key: 'ded', header: 'Khấu trừ', value: (r) => r.deductions, align: 'right', render: (r) => formatVnd(r.deductions), total: 'sum', formatTotal: formatVnd },
    { key: 'net', header: 'Thực lĩnh', value: (r) => r.net, sortable: true, align: 'right', render: (r) => <strong>{formatVnd(r.net)}</strong>, total: 'sum', formatTotal: formatVnd },
    { key: 'pay', header: 'Chi trả', value: (r) => r.paymentStatus, render: (r) => <Tag domain="pay" value={r.paymentStatus} /> },
  ];

  const runColumns: Column<RunRow>[] = [
    { key: 'period', header: 'Kỳ', value: (r) => r.periodKey, sortable: true, render: (r) => periodLabel(r.periodKey) },
    { key: 'status', header: 'Duyệt / phát hành', value: (r) => r.status, render: (r) => <Tag domain="payrollRun" value={r.status} /> },
    { key: 'headcount', header: 'Số nhân viên', value: (r) => r.headcount, align: 'right' },
    { key: 'net', header: 'Thực lĩnh', value: (r) => r.net, align: 'right', render: (r) => formatVnd(r.net) },
    { key: 'paid', header: 'Đã trả', value: (r) => r.paid, align: 'right', render: (r) => formatVnd(r.paid) },
  ];

  const nameOf = (id: string) => items.data.find((i) => i.id === id)?.name ?? id;

  return (
    <div>
      <PageHeader
        title="Bảng lương cơ sở"
        code="W27"
        description="Bảng lương được dựng từ bảng công đã khóa. Đã duyệt, đã phát hành phiếu và đã trả tiền là ba bước tách biệt."
        actions={
          <div className="row">
            <div style={{ minWidth: 200 }}>
              <Select name="period" value={period} onValueChange={setPeriod} options={periods} aria-label="Kỳ lương" />
            </div>
            {c.can('payroll.write') && (!run || run.status === 'draft') ? <Button icon="refresh" onClick={() => setDlg('build')}>{run ? 'Dựng lại bảng lương' : 'Dựng bảng lương'}</Button> : null}
          </div>
        }
      />

      <div className="stack">
        {run ? (
          <Card title={`Kỳ ${periodLabel(period)}`} actions={<LinkButton href={`/cong-luong/bang-luong/${run.id}`} variant="secondary">Phiếu lương và chi trả</LinkButton>}>
            <div className="stack">
              <Stepper steps={STEPS} current={STEP_INDEX[run.status] ?? 0} />
              <div className="row">
                <Badge tone={['approved', 'published', 'paid'].includes(run.status) ? 'success' : 'neutral'}>{['approved', 'published', 'paid'].includes(run.status) ? 'Đã duyệt' : 'Chưa duyệt'}</Badge>
                <Badge tone={['published', 'paid'].includes(run.status) ? 'success' : 'neutral'}>{['published', 'paid'].includes(run.status) ? 'Đã phát hành phiếu' : 'Chưa phát hành phiếu'}</Badge>
                <Badge tone={run.paymentStatus === 'paid' ? 'success' : run.paymentStatus === 'partially_paid' ? 'info' : 'neutral'}>
                  {run.paymentStatus === 'paid' ? 'Đã trả đủ' : run.paymentStatus === 'partially_paid' ? 'Đã trả một phần' : 'Chưa trả'}
                </Badge>
                <span className="text-small text-secondary">Dựng từ bảng công khóa lần {run.timesheetLockVersion || 1}, công chuẩn {run.standardDays} ngày.</span>
              </div>
              <div className="grid-4">
                <Stat label="Số nhân viên" value={run.headcount} />
                <Stat label="Tổng thu nhập" value={formatVnd(run.gross)} />
                <Stat label="Tổng khấu trừ" value={formatVnd(run.deductions)} />
                <Stat label="Tổng thực lĩnh" value={formatVnd(run.net)} hint={`Đã trả ${formatVnd(run.paid)}`} />
              </div>
              {run.rejectReason ? <Banner tone="warning" title="Bảng lương bị từ chối duyệt">{run.rejectReason}</Banner> : null}
              {run.errors.length > 0 ? (
                <Banner tone="warning" title={`${run.errors.length} nhân viên chưa được tính lương`}>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {run.errors.map((e) => (
                      <li key={e.employeeId}>{e.name || e.employeeId}: {e.message}</li>
                    ))}
                  </ul>
                </Banner>
              ) : null}
              <div className="row">
                {run.status === 'draft' && c.can('payroll.write') ? <Button onClick={() => setDlg('submit')}>Gửi duyệt</Button> : null}
                {run.status === 'submitted' && c.can('payroll.approve') ? <Button onClick={() => { setDecision('approved'); setDlg('approve'); }}>Duyệt hoặc từ chối</Button> : null}
                {run.status === 'submitted' && !c.can('payroll.approve') ? <span className="text-secondary text-small">Đang chờ người có quyền duyệt lương.</span> : null}
                {run.status === 'approved' && c.can('payroll.write') ? <Button onClick={() => setDlg('publish')}>Phát hành phiếu lương</Button> : null}
              </div>
            </div>
          </Card>
        ) : runs.status === 'ready' || runs.status === 'empty' ? (
          <Banner tone="info" title={`Chưa có bảng lương ${periodLabel(period)}`}>
            Bảng lương chỉ được dựng từ bảng công đã khóa. Nếu kỳ công chưa khóa, hãy xử lý tại <GuardedLink href="/cong-luong/duyet-cong">Duyệt và khóa công</GuardedLink>.
          </Banner>
        ) : null}

        {run ? (
          <DataTable
            caption={`Bảng lương ${periodLabel(period)}`}
            columns={columns}
            rows={items.data}
            rowKey={(r) => r.id}
            status={items.status}
            error={items.error?.message}
            onRetry={items.retry}
            searchText={(r) => `${r.code} ${r.name}`}
            searchPlaceholder="Tìm theo mã hoặc tên"
            emptyTitle="Bảng lương chưa có nhân viên nào"
            emptyDescription="Kiểm tra bảng công đã khóa và thành phần lương của nhân viên."
          />
        ) : null}

        <Card title="Các kỳ lương của cơ sở" flush>
          <DataTable
            caption="Danh sách bảng lương theo kỳ"
            columns={runColumns}
            rows={[...runs.data].sort((a, b) => b.periodKey.localeCompare(a.periodKey))}
            rowKey={(r) => r.id}
            status={runs.status}
            error={runs.error?.message}
            onRetry={runs.retry}
            onRowClick={(r) => setPeriod(r.periodKey)}
            emptyTitle="Chưa có bảng lương nào"
            emptyDescription="Khóa bảng công của một kỳ rồi dựng bảng lương."
          />
        </Card>
      </div>

      {dlg === 'build' ? (
        <ActionDialog
          title="Dựng bảng lương từ công đã khóa"
          subject={`${c.campusName} · ${periodLabel(period)}`}
          impact={[
            'Lấy số công từ bảng công ĐÃ KHÓA của kỳ này; kỳ chưa khóa sẽ bị máy chủ từ chối.',
            'Lương theo công = lương cơ bản × công thực tế ÷ công chuẩn, làm tròn đến đồng; cộng tăng ca, phụ cấp và trừ khấu trừ.',
            'Nhân viên thiếu thành phần lương hoặc hợp đồng hiệu lực được liệt kê lỗi, không được tính.',
            'Chỉ dựng lại được khi bảng lương còn ở trạng thái nháp; chưa gửi duyệt và chưa trả tiền.',
          ]}
          confirmLabel="Dựng bảng lương"
          success={`Đã dựng bảng lương ${periodLabel(period)}.`}
          validate={() => (stdDays && !(Number(stdDays) >= 1 && Number(stdDays) <= 31) ? 'Công chuẩn phải trong khoảng 1 đến 31.' : null)}
          run={(opId) => call('payroll.build', { periodKey: period, ...(stdDays ? { standardDays: Number(stdDays) } : {}) }, opId)}
          onClose={close}
          onReload={runs.retry}
        >
          <FormField name="stdDays" label="Công chuẩn (ngày)" helper="Để trống để dùng công chuẩn của cơ sở hoặc hợp đồng.">
            <Input name="stdDays" value={stdDays} onValueChange={setStdDays} inputMode="decimal" />
          </FormField>
          {runs.error ? null : <TimesheetHint />}
        </ActionDialog>
      ) : null}

      {dlg === 'submit' && run ? (
        <ActionDialog
          title="Gửi duyệt bảng lương"
          subject={`${periodLabel(run.periodKey)} · ${run.headcount} nhân viên · thực lĩnh ${formatVnd(run.net)}`}
          impact={[
            'Bảng lương chuyển sang «Chờ duyệt» và tạo phê duyệt cho người có quyền duyệt lương.',
            'Người gửi không được tự duyệt bảng lương của mình.',
            ...(run.errors.length ? [`Có ${run.errors.length} nhân viên lỗi sẽ không có trong bảng lương nếu bạn xác nhận bỏ qua.`] : []),
          ]}
          confirmLabel="Gửi duyệt"
          success="Đã gửi duyệt bảng lương."
          validate={() => (run.errors.length > 0 && !ack ? 'Xác nhận bỏ qua nhân viên lỗi hoặc quay lại xử lý trước.' : null)}
          run={(opId) => call('payroll.submit', { runId: run.id, ...(ack ? { acknowledgeErrors: true } : {}) }, opId)}
          onClose={close}
          onReload={runs.retry}
          nameOf={nameOf}
        >
          {run.errors.length ? <Checkbox checked={ack} onChange={setAck}>Tôi đã xem danh sách lỗi và đồng ý bỏ qua các nhân viên này</Checkbox> : null}
        </ActionDialog>
      ) : null}

      {dlg === 'approve' && run ? (
        <ActionDialog
          title="Duyệt bảng lương"
          subject={`${periodLabel(run.periodKey)} · ${run.headcount} nhân viên · thực lĩnh ${formatVnd(run.net)}`}
          impact={
            decision === 'approved'
              ? ['Bảng lương chuyển sang «Đã duyệt». Chưa tạo phiếu lương và chưa trả tiền.', 'Người gửi duyệt không được là người duyệt (máy chủ kiểm tra).']
              : ['Bảng lương quay về «Nháp» kèm lý do từ chối để người lập chỉnh sửa.']
          }
          confirmLabel={decision === 'approved' ? 'Duyệt bảng lương' : 'Từ chối bảng lương'}
          tone={decision === 'rejected' ? 'destructive' : 'primary'}
          success={decision === 'approved' ? 'Đã duyệt bảng lương.' : 'Đã từ chối bảng lương.'}
          validate={() => (decision === 'rejected' && !note.trim() ? 'Nhập lý do từ chối.' : null)}
          run={(opId) => call('payroll.approve', { runId: run.id, decision, note: note.trim() }, opId)}
          onClose={close}
          onReload={runs.retry}
        >
          <FormField name="decision" label="Quyết định" required>
            <Select name="decision" value={decision} onValueChange={(v) => setDecision(v as 'approved' | 'rejected')} options={[{ value: 'approved', label: 'Duyệt' }, { value: 'rejected', label: 'Từ chối' }]} />
          </FormField>
          <FormField name="note" label="Ghi chú" required={decision === 'rejected'}>
            <Textarea name="note" value={note} onValueChange={setNote} />
          </FormField>
        </ActionDialog>
      ) : null}

      {dlg === 'publish' && run ? (
        <ActionDialog
          title="Phát hành phiếu lương"
          subject={`${periodLabel(run.periodKey)} · ${run.headcount} phiếu`}
          impact={[
            `Tạo ${run.headcount} phiếu lương và gửi thông báo cho nhân viên; mỗi nhân viên chỉ xem phiếu của mình.`,
            'Phát hành KHÔNG có nghĩa đã trả tiền. Việc trả tiền được ghi nhận riêng, nhiều đợt, ở màn chi trả.',
            'Sau khi phát hành, bảng lương không thể dựng lại.',
          ]}
          confirmLabel="Phát hành phiếu lương"
          success="Đã phát hành phiếu lương."
          run={(opId) => call('payroll.publish', { runId: run.id }, opId)}
          onClose={close}
          onReload={runs.retry}
        />
      ) : null}
    </div>
  );
}

function TimesheetHint() {
  return (
    <Banner tone="info">
      Nếu máy chủ báo kỳ công chưa khóa, vào <GuardedLink href="/cong-luong/duyet-cong">Duyệt và khóa công</GuardedLink> để khóa kỳ trước.
    </Banner>
  );
}

