'use client';
import { useMemo, useState } from 'react';
import { collection } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import { useFirestoreQuery } from '@/lib/hooks/useFirestore';
import { formatDateTime, formatVnd } from '@/lib/format';
import { PageHeader, Stat, EmptyState, ErrorState, Skeleton } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { Drawer } from '@/components/ui/Drawer';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { FormField, Input, MoneyInput, Select } from '@/components/ui/Fields';
import type { ScreenProps } from '../registry';
import { ActionDialog, formatNumber, KV, num, text, toDate, useCall, useCampusCtx, useCampusDocs, useOrgDoc } from './parts/kit';
import { periodLabel } from './parts/dates';
import { Tag } from './parts/statuses';

interface Line {
  code: string;
  name: string;
  type: string;
  amount: number;
}

interface Item {
  id: string;
  code: string;
  name: string;
  paidDays: number;
  standardDays: number;
  baseSalary: number;
  basePay: number;
  overtimePay: number;
  allowances: number;
  deductions: number;
  gross: number;
  net: number;
  paidAmount: number;
  remaining: number;
  paymentStatus: string;
  lines: Line[];
}

interface Payment {
  id: string;
  employeeId: string;
  amount: number;
  method: string;
  reference: string;
  paidAt: Date | null;
  opId: string;
}

const LINE_TYPE: Record<string, string> = { allowance: 'Phụ cấp', bonus: 'Thưởng', deduction: 'Khấu trừ', advance: 'Tạm ứng', base: 'Lương', overtime: 'Tăng ca' };
const METHOD: Record<string, string> = { bank_transfer: 'Chuyển khoản', cash: 'Tiền mặt' };

const toItem = (id: string, d: Record<string, unknown>): Item => {
  const net = num(d.net);
  const paid = num(d.paidAmount);
  return {
    id,
    code: text(d.code),
    name: text(d.name, id),
    paidDays: num(d.paidDays),
    standardDays: num(d.standardDays),
    baseSalary: num(d.baseSalary),
    basePay: num(d.basePay),
    overtimePay: num(d.overtimePay),
    allowances: num(d.allowances),
    deductions: num(d.deductions),
    gross: num(d.gross),
    net,
    paidAmount: paid,
    remaining: Math.max(0, net - paid),
    paymentStatus: text(d.paymentStatus, 'unpaid'),
    lines: Array.isArray(d.lines) ? (d.lines as Line[]) : [],
  };
};

const toPayment = (id: string, d: Record<string, unknown>): Payment => ({
  id,
  employeeId: text(d.employeeId),
  amount: num(d.amount),
  method: text(d.method),
  reference: text(d.reference),
  paidAt: toDate(d.paidAt as never),
  opId: text(d.opId),
});

const maskAccount = (s: string) => (s.length <= 4 ? s : `${'•'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`);

/** Thông tin ngân hàng: chỉ tải khi có quyền, che bớt số tài khoản. */
function BankInfo({ employeeId }: { employeeId: string }) {
  const bank = useOrgDoc<{ bankName: string; accountNo: string; accountName: string }>(['employees', employeeId, 'private', 'bank'], (_id, d) => ({
    bankName: text(d.bankName),
    accountNo: text(d.accountNo),
    accountName: text(d.accountName),
  }));
  const [show, setShow] = useState(false);
  if (bank.status === 'loading') return <Skeleton height={40} />;
  if (bank.status === 'error') return <p className="text-small text-secondary">Không xem được thông tin ngân hàng với quyền hiện tại.</p>;
  if (bank.status === 'empty' || !bank.data) return <p className="text-small text-secondary">Chưa có thông tin ngân hàng. Bổ sung ở hồ sơ nhân viên.</p>;
  return (
    <div className="stack-sm">
      <KV items={[['Ngân hàng', bank.data.bankName], ['Chủ tài khoản', bank.data.accountName], ['Số tài khoản', show ? bank.data.accountNo : maskAccount(bank.data.accountNo)]]} cols={3} />
      <div>
        <Button size="sm" variant="tertiary" icon="eye" onClick={() => setShow((v) => !v)}>{show ? 'Ẩn số tài khoản' : 'Hiện số tài khoản'}</Button>
      </div>
    </div>
  );
}

/** W28 — Chi tiết phiếu lương và chi trả (nhiều đợt). */
export function W28Payslips({ params }: ScreenProps) {
  const c = useCampusCtx();
  const call = useCall();
  const runId = params.id;
  const canRead = c.can('payroll.read');
  const canPay = c.can('payroll.write');

  const run = useOrgDoc(canRead ? ['payrollRuns', runId] : null);
  const base = canRead && run.status === 'ready' ? `${c.orgId}|${runId}` : null;
  const items = useFirestoreQuery<Item>(base ? `pItems|${base}` : null, () => collection(firebase().db, 'orgs', c.orgId, 'payrollRuns', runId, 'items'), (id, d) => toItem(id, d));
  const payments = useFirestoreQuery<Payment>(base ? `pPays|${base}` : null, () => collection(firebase().db, 'orgs', c.orgId, 'payrollRuns', runId, 'payments'), (id, d) => toPayment(id, d));
  const slips = useCampusDocs<{ id: string }>('payslips', (id) => ({ id }), { enabled: canRead && !!runId, where: [['runId', '==', runId]], tag: runId });

  const [view, setView] = useState<Item | null>(null);
  const [payFor, setPayFor] = useState<string[] | null>(null);
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [amounts, setAmounts] = useState<Record<string, number | null>>({});
  const [fieldErr, setFieldErr] = useState('');

  const rd = run.data as Record<string, unknown> | null;
  const status = text(rd?.status);
  const totals = (rd?.totals ?? {}) as Record<string, unknown>;
  const net = num(totals.net);
  const paid = num(totals.paid);
  const periodKey = text(rd?.periodKey);
  const slipSet = useMemo(() => new Set(slips.data.map((s) => s.id)), [slips.data]);
  const itemById = useMemo(() => new Map(items.data.map((i) => [i.id, i])), [items.data]);
  const canRecord = canPay && ['published', 'paid'].includes(status);

  if (!canRead) {
    return (
      <div>
        <PageHeader title="Chi tiết phiếu lương và chi trả" code="W28" />
        <EmptyState icon="lock" title="Bạn không có quyền xem phiếu lương" description="Dữ liệu lương chỉ hiển thị cho người được cấp quyền xem lương." />
      </div>
    );
  }
  if (run.status === 'loading') return <div><PageHeader title="Chi tiết phiếu lương và chi trả" code="W28" /><Skeleton height={120} /></div>;
  if (run.status === 'error') return <div><PageHeader title="Chi tiết phiếu lương và chi trả" code="W28" /><ErrorState message={run.error?.message} onRetry={run.retry} /></div>;
  if (run.status === 'empty' || (rd && text(rd.campusId) && text(rd.campusId) !== c.campusId)) {
    return (
      <div>
        <PageHeader title="Chi tiết phiếu lương và chi trả" code="W28" breadcrumbs={[{ label: 'Bảng lương', href: '/cong-luong/bang-luong' }, { label: 'Không tìm thấy' }]} />
        <EmptyState title="Không tìm thấy bảng lương" description="Bảng lương không tồn tại hoặc thuộc cơ sở khác. Chọn đúng cơ sở rồi mở lại từ danh sách bảng lương." />
      </div>
    );
  }

  const openPay = (keys: string[]) => {
    const next: Record<string, number | null> = {};
    for (const k of keys) next[k] = itemById.get(k)?.remaining ?? 0;
    setAmounts(next);
    setFieldErr('');
    setPayFor(keys);
  };
  const closePay = () => {
    setPayFor(null);
    setReference('');
  };
  const payRows = (payFor ?? []).map((k) => itemById.get(k)).filter((x): x is Item => !!x && x.remaining > 0);
  const payTotal = payRows.reduce((s, r) => s + (amounts[r.id] ?? 0), 0);

  const itemColumns: Column<Item>[] = [
    { key: 'code', header: 'Mã', value: (r) => r.code, sortable: true, width: 90 },
    { key: 'name', header: 'Nhân viên', value: (r) => r.name, sortable: true, render: (r) => <strong>{r.name}</strong> },
    { key: 'slip', header: 'Phiếu lương', value: (r) => (slipSet.has(`${runId}_${r.id}`) ? 1 : 0), render: (r) => (slipSet.has(`${runId}_${r.id}`) ? <Badge tone="info" icon="check">Đã phát hành</Badge> : <Badge>Chưa phát hành</Badge>) },
    { key: 'net', header: 'Thực lĩnh', value: (r) => r.net, align: 'right', sortable: true, render: (r) => formatVnd(r.net), total: 'sum', formatTotal: formatVnd },
    { key: 'paid', header: 'Đã trả', value: (r) => r.paidAmount, align: 'right', render: (r) => formatVnd(r.paidAmount), total: 'sum', formatTotal: formatVnd },
    { key: 'rem', header: 'Còn phải trả', value: (r) => r.remaining, align: 'right', render: (r) => formatVnd(r.remaining), total: 'sum', formatTotal: formatVnd },
    { key: 'st', header: 'Chi trả', value: (r) => r.paymentStatus, render: (r) => <Tag domain="pay" value={r.paymentStatus} /> },
    {
      key: 'act',
      header: 'Thao tác',
      render: (r) => (
        <div className="row" style={{ flexWrap: 'nowrap', gap: 'var(--space-1)' }}>
          <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setView(r); }}>Xem phiếu</Button>
          {canRecord && r.remaining > 0 ? <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); openPay([r.id]); }}>Ghi nhận chi</Button> : null}
        </div>
      ),
    },
  ];

  const payColumns: Column<Payment>[] = [
    { key: 'at', header: 'Thời điểm chi', value: (r) => r.paidAt?.getTime() ?? 0, sortable: true, render: (r) => formatDateTime(r.paidAt, c.tz) },
    { key: 'emp', header: 'Nhân viên', value: (r) => itemById.get(r.employeeId)?.name ?? r.employeeId },
    { key: 'amount', header: 'Số tiền', value: (r) => r.amount, align: 'right', render: (r) => formatVnd(r.amount), total: 'sum', formatTotal: formatVnd },
    { key: 'method', header: 'Hình thức', value: (r) => r.method, render: (r) => METHOD[r.method] ?? r.method },
    { key: 'ref', header: 'Tham chiếu', value: (r) => r.reference },
    { key: 'batch', header: 'Đợt (mã thao tác)', value: (r) => r.opId, render: (r) => <span className="text-caption">{r.opId.slice(0, 8)}</span> },
  ];

  return (
    <div>
      <PageHeader
        title={`Phiếu lương và chi trả ${periodKey ? periodLabel(periodKey) : ''}`}
        code="W28"
        breadcrumbs={[{ label: 'Bảng lương', href: '/cong-luong/bang-luong' }, { label: periodKey ? periodLabel(periodKey) : runId }]}
        description="Đã duyệt, đã phát hành phiếu và đã trả tiền là ba trạng thái khác nhau. Chi trả có thể ghi nhận nhiều đợt."
      />
      <div className="stack">
        <div className="grid-4">
          <Stat label="Trạng thái bảng lương" value={<Tag domain="payrollRun" value={status} />} />
          <Stat label="Tổng thực lĩnh" value={formatVnd(net)} />
          <Stat label="Đã chi trả" value={formatVnd(paid)} tone={paid >= net && net > 0 ? 'success' : undefined} />
          <Stat label="Còn phải trả" value={formatVnd(Math.max(0, net - paid))} tone={net - paid > 0 ? 'warning' : undefined} />
        </div>
        {!['published', 'paid'].includes(status) ? (
          <Banner tone="info" title="Chưa thể ghi nhận chi trả">
            Chỉ ghi nhận chi trả sau khi bảng lương được duyệt và đã phát hành phiếu lương. Trạng thái hiện tại không đồng nghĩa đã trả tiền.
          </Banner>
        ) : null}
        <DataTable
          caption="Phiếu lương theo nhân viên"
          columns={itemColumns}
          rows={items.data}
          rowKey={(r) => r.id}
          status={items.status}
          error={items.error?.message}
          onRetry={items.retry}
          onRowClick={setView}
          searchText={(r) => `${r.code} ${r.name}`}
          searchPlaceholder="Tìm theo mã hoặc tên"
          selectable={canRecord}
          bulkActions={(keys, clear) => (
            <Button size="sm" onClick={() => { openPay(keys); clear(); }}>Ghi nhận chi cho {keys.length} nhân viên</Button>
          )}
          emptyTitle="Bảng lương chưa có nhân viên"
        />
        <Card title="Các đợt chi trả đã ghi nhận" flush>
          <DataTable
            caption="Lịch sử chi trả"
            columns={payColumns}
            rows={[...payments.data].sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0))}
            rowKey={(r) => r.id}
            status={payments.status}
            error={payments.error?.message}
            onRetry={payments.retry}
            emptyTitle="Chưa có khoản chi nào"
            emptyDescription="Khoản chi được ghi nhận sau khi phát hành phiếu lương; mỗi lần ghi nhận là một đợt và có dòng chi trong sổ quỹ."
          />
        </Card>
      </div>

      <Drawer open={!!view} title={view ? `Phiếu lương — ${view.name}` : 'Phiếu lương'} onClose={() => setView(null)}>
        {view ? (
          <div className="stack">
            <KV
              items={[
                ['Mã nhân viên', view.code],
                ['Công thực tế / chuẩn', `${formatNumber(view.paidDays)} / ${formatNumber(view.standardDays)}`],
                ['Lương cơ bản', formatVnd(view.baseSalary)],
                ['Lương theo công', formatVnd(view.basePay)],
                ['Tăng ca', formatVnd(view.overtimePay)],
                ['Tổng thu nhập', formatVnd(view.gross)],
                ['Tổng khấu trừ', formatVnd(view.deductions)],
                ['Thực lĩnh', <strong key="n">{formatVnd(view.net)}</strong>],
                ['Đã trả', formatVnd(view.paidAmount)],
                ['Còn phải trả', formatVnd(view.remaining)],
              ]}
            />
            <Card title="Các khoản trong phiếu" flush>
              {view.lines.length === 0 ? (
                <p className="text-secondary" style={{ padding: 'var(--space-4)' }}>Phiếu không có khoản phụ cấp hay khấu trừ.</p>
              ) : (
                <ul style={{ margin: 0, padding: 'var(--space-3) var(--space-5)' }}>
                  {view.lines.map((l, i) => (
                    <li key={`${l.code}${i}`}>{LINE_TYPE[l.type] ?? l.type} · {l.name}: {l.type === 'deduction' || l.type === 'advance' ? '-' : ''}{formatVnd(l.amount)}</li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Thông tin ngân hàng">
              <BankInfo employeeId={view.id} />
            </Card>
          </div>
        ) : null}
      </Drawer>

      {payFor ? (
        <ActionDialog
          title="Ghi nhận chi trả lương"
          subject={`${periodLabel(periodKey)} · ${payRows.length} nhân viên · tổng ${formatVnd(payTotal)}`}
          impact={[
            `Ghi nhận đã chi ${formatVnd(payTotal)} cho ${payRows.length} nhân viên; mỗi khoản được ghi thêm một dòng CHI trong sổ quỹ của cơ sở.`,
            'Số đã trả cộng dồn với các đợt trước; được phép chi nhiều đợt cho đến khi đủ thực lĩnh.',
            'Không sửa được khoản đã ghi; nếu nhập sai phải xử lý bằng chứng từ điều chỉnh.',
          ]}
          confirmLabel={`Ghi nhận chi ${formatVnd(payTotal)}`}
          success="Đã ghi nhận chi trả lương."
          validate={() => {
            if (payRows.length === 0) return 'Không có nhân viên nào còn phải trả.';
            for (const r of payRows) {
              const a = amounts[r.id];
              if (!a || a <= 0) return `Nhập số tiền chi cho ${r.name}.`;
              if (a > r.remaining) return `Số tiền của ${r.name} vượt số còn phải trả (${formatVnd(r.remaining)}).`;
            }
            return null;
          }}
          run={(opId) =>
            call('payroll.recordPayment', {
              runId,
              method,
              reference: reference.trim() || undefined,
              items: payRows.map((r) => ({ employeeId: r.id, amount: amounts[r.id] })),
            }, opId)
          }
          onClose={closePay}
          onReload={run.retry}
          nameOf={(id) => itemById.get(id)?.name ?? id}
        >
          <div className="stack">
            <div className="grid-2">
              <FormField name="method" label="Hình thức chi" required>
                <Select name="method" value={method} onValueChange={setMethod} options={[{ value: 'bank_transfer', label: 'Chuyển khoản' }, { value: 'cash', label: 'Tiền mặt' }]} />
              </FormField>
              <FormField name="reference" label="Tham chiếu (nội dung chuyển khoản, số phiếu chi)">
                <Input name="reference" value={reference} onValueChange={setReference} />
              </FormField>
            </div>
            {payRows.map((r) => (
              <FormField key={r.id} name={`amt-${r.id}`} label={`${r.name} — còn phải trả ${formatVnd(r.remaining)}`} required>
                <MoneyInput name={`amt-${r.id}`} value={amounts[r.id] ?? null} onValueChange={(v) => setAmounts((p) => ({ ...p, [r.id]: v }))} />
              </FormField>
            ))}
            {fieldErr ? <Banner tone="error">{fieldErr}</Banner> : null}
          </div>
        </ActionDialog>
      ) : null}
    </div>
  );
}
