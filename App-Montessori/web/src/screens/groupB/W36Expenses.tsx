'use client';
import { useMemo, useRef, useState } from 'react';
import { formatDate, formatDateTime, formatVnd, toDate as toDateLike } from '@/lib/format';
import { useForm } from '@/lib/hooks/useForm';
import { useDirtyGuard } from '@/lib/hooks/dirtyStore';
import { useScope } from '@/providers/ScopeProvider';
import { PageHeader, Stat, EmptyState } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { Drawer } from '@/components/ui/Drawer';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { DateInput, FormField, Input, MoneyInput, Select, Textarea } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import { ActionDialog, ErrorDetails, KV, num, text, useCall, useCampusCtx, useCampusDocs, useOrgDoc } from './parts/kit';
import { Tag } from './parts/statuses';

interface Expense {
  id: string;
  category: string;
  amount: number;
  description: string;
  vendor: string;
  expenseDate: string;
  evidencePaths: string[];
  status: string;
  decisionNote: string;
  payMethod: string;
  payReference: string;
  paidAt: Date | null;
  version?: number;
}

interface LedgerRow {
  id: string;
  dir: 'in' | 'out';
  amount: number;
  channel: string;
  refType: string;
  dayKey: string;
  note: string;
}

interface Recon {
  id: string;
  channel: string;
  upto: string;
  openingBalance: number;
  inAmount: number;
  outAmount: number;
  expected: number;
  counted: number;
  variance: number;
  status: string;
  note: string;
}

interface Receivable {
  id: string;
  balance: number;
  status: string;
}

const toExpense = (id: string, d: Record<string, unknown>): Expense => ({
  id,
  category: text(d.category),
  amount: num(d.amount),
  description: text(d.description),
  vendor: text(d.vendor),
  expenseDate: text(d.expenseDate),
  evidencePaths: Array.isArray(d.evidencePaths) ? (d.evidencePaths as string[]) : [],
  status: text(d.status, 'draft'),
  decisionNote: text(d.decisionNote),
  payMethod: text(d.payMethod),
  payReference: text(d.payReference),
  paidAt: toDateLike(d.paidAt as never),
  version: typeof d.version === 'number' ? d.version : undefined,
});

const CHANNEL: Record<string, string> = { cash: 'Tiền mặt', bank_transfer: 'Chuyển khoản', gateway: 'Cổng thanh toán' };
const REF: Record<string, string> = {
  payment: 'Thu học phí', payment_reversal: 'Đảo chứng từ thu', refund: 'Hoàn tiền', expense: 'Chi theo đề nghị', payroll: 'Chi lương',
};
const CHANNEL_OPTIONS = Object.entries(CHANNEL).map(([value, label]) => ({ value, label }));
const OPEN_RECEIVABLE = ['unpaid', 'partially_paid', 'overdue'];

const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);

/* ------------------------------------------------------------------ biểu mẫu đề nghị chi */

function ExpenseDrawer({ expense, onClose }: { expense: Expense | null; onClose: () => void }) {
  const call = useCall();
  const toast = useToast();
  const { confirmDiscard } = useDirtyGuard();
  const idRef = useRef<string | undefined>(expense?.id);
  const verRef = useRef<number | undefined>(expense?.version);
  const [reload, setReload] = useState(false);

  const form = useForm({
    initial: {
      category: expense?.category ?? '',
      amount: (expense?.amount ?? null) as number | null,
      description: expense?.description ?? '',
      vendor: expense?.vendor ?? '',
      expenseDate: expense?.expenseDate ?? '',
      evidence: (expense?.evidencePaths ?? []).join('\n'),
    },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.category.trim()) e.category = 'Nhập nhóm chi (ví dụ: văn phòng phẩm, sửa chữa).';
      if (!v.amount || v.amount <= 0) e.amount = 'Nhập số tiền lớn hơn 0.';
      if (!v.description.trim()) e.description = 'Nhập nội dung chi.';
      else if (v.description.length > 500) e.description = 'Nội dung tối đa 500 ký tự.';
      if (v.vendor.length > 150) e.vendor = 'Tên nhà cung cấp tối đa 150 ký tự.';
      if (v.evidence.split('\n').filter((x) => x.trim()).length > 10) e.evidence = 'Tối đa 10 dòng chứng từ.';
      return e;
    },
  });

  const handler = (send: boolean) => async (v: typeof form.values, opId: string) => {
    const data: Record<string, unknown> = {
      category: v.category.trim(),
      amount: v.amount,
      description: v.description.trim(),
      vendor: v.vendor.trim() || undefined,
      expenseDate: v.expenseDate || undefined,
      evidencePaths: v.evidence.split('\n').map((x) => x.trim()).filter(Boolean),
    };
    {
      try {
        const res = await call<{ id: string; version?: number }>('entity.save', {
          collection: 'expenses', id: idRef.current, data, ...(idRef.current && verRef.current ? { expectedVersion: verRef.current } : {}),
        });
        idRef.current = res.id;
        verRef.current = res.version;
      } catch (e) {
        if ((e as { code?: string }).code === 'VERSION_CONFLICT') setReload(true);
        throw e;
      }
    }
    if (send) {
      await call('expense.request', { id: idRef.current }, opId);
      toast.success('Đã gửi đề nghị chi để duyệt.');
    } else toast.success('Đã lưu nháp đề nghị chi.');
    form.reset(v);
    onClose();
  };

  const saveDraft = form.onSubmit(handler(false));
  const saveSend = form.onSubmit(handler(true));

  const close = async () => {
    if (form.dirty && !(await confirmDiscard('đóng biểu mẫu đề nghị chi'))) return;
    onClose();
  };

  return (
    <Drawer
      open
      title={expense ? 'Sửa đề nghị chi' : 'Lập đề nghị chi'}
      onClose={() => void close()}
      locked={form.submitting}
      footer={
        <>
          <Button variant="tertiary" onClick={() => void close()} disabled={form.submitting}>Đóng</Button>
          <Button variant="secondary" onClick={() => void saveDraft()} disabled={form.submitting}>Lưu nháp</Button>
          <Button onClick={() => void saveSend()} loading={form.submitting}>Lưu và gửi duyệt</Button>
        </>
      }
    >
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void saveDraft(); }}>
        {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
        {reload ? <Banner tone="warning" title="Đề nghị đã được người khác thay đổi">Đóng biểu mẫu để tải bản mới nhất rồi sửa lại.</Banner> : null}
        <ErrorDetails error={form.apiError} />
        <div className="grid-2">
          <FormField name="category" label="Nhóm chi" required {...form.field('category')}>
            <Input {...form.bind('category')} autoComplete="off" />
          </FormField>
          <FormField name="amount" label="Số tiền" required {...form.field('amount')}>
            <MoneyInput {...form.bind('amount')} />
          </FormField>
        </div>
        <FormField name="description" label="Nội dung chi" required {...form.field('description')}>
          <Textarea {...form.bind('description')} />
        </FormField>
        <div className="grid-2">
          <FormField name="vendor" label="Nhà cung cấp / người nhận" {...form.field('vendor')}>
            <Input {...form.bind('vendor')} autoComplete="off" />
          </FormField>
          <FormField name="expenseDate" label="Ngày phát sinh" {...form.field('expenseDate')}>
            <DateInput {...form.bind('expenseDate')} />
          </FormField>
        </div>
        <FormField name="evidence" label="Chứng từ đính kèm" helper="Mỗi dòng một mã hoặc đường dẫn chứng từ (số hóa đơn, tệp đã tải lên kho lưu trữ). Tải tệp trực tiếp chưa hỗ trợ ở màn này." {...form.field('evidence')}>
          <Textarea {...form.bind('evidence')} />
        </FormField>
      </form>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ màn chính */

type Dlg =
  | { kind: 'request'; e: Expense }
  | { kind: 'approve'; e: Expense }
  | { kind: 'pay'; e: Expense }
  | { kind: 'reconcile' }
  | null;

/** W36 — Thu chi và quỹ cơ sở: đề nghị chi → duyệt theo hạn mức → thanh toán → sổ quỹ → đối chiếu. */
export function W36Expenses() {
  const c = useCampusCtx();
  const call = useCall();
  const scope = useScope();
  const canWrite = c.can('expenses.write');
  const canApprove = c.can('expenses.approve');
  const canReconcile = c.can('payments.reconcile');
  const canReceivable = c.can('payments.read');

  const [tab, setTab] = useState('overview');
  const [edit, setEdit] = useState<Expense | 'new' | null>(null);
  const [view, setView] = useState<Expense | null>(null);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [channel, setChannel] = useState('');

  const expenses = useCampusDocs<Expense>('expenses', toExpense, { enabled: c.can('expenses.read') });
  const ledger = useCampusDocs<LedgerRow>('cashLedger', (id, d) => ({
    id, dir: d.dir === 'in' ? 'in' : 'out', amount: num(d.amount), channel: text(d.channel), refType: text(d.refType), dayKey: text(d.dayKey), note: text(d.note),
  }), { enabled: c.can('expenses.read') });
  const recons = useCampusDocs<Recon>('fundReconciliations', (id, d) => ({
    id, channel: text(d.channel), upto: text(d.upto), openingBalance: num(d.openingBalance), inAmount: num(d.inAmount), outAmount: num(d.outAmount),
    expected: num(d.expected), counted: num(d.counted), variance: num(d.variance), status: text(d.status), note: text(d.note),
  }), { enabled: c.can('expenses.read') });
  const receivables = useCampusDocs<Receivable>('receivables', (id, d) => ({ id, balance: num(d.balance), status: text(d.status) }), { enabled: canReceivable });
  const campusDoc = useOrgDoc(['campuses', c.campusId]);
  const limit = typeof (campusDoc.data as Record<string, unknown> | null)?.expenseLimit === 'number' ? ((campusDoc.data as Record<string, unknown>).expenseLimit as number) : null;

  const fromErr = from && to && from > to ? 'Ngày bắt đầu phải trước ngày kết thúc.' : '';
  const filtered = useMemo(
    () => ledger.data.filter((r) => (!from || r.dayKey >= from) && (!to || r.dayKey <= to) && (!channel || r.channel === channel)),
    [ledger.data, from, to, channel],
  );
  const byRef = useMemo(() => {
    const m = new Map<string, { in: number; out: number }>();
    for (const r of filtered) {
      const x = m.get(r.refType) ?? { in: 0, out: 0 };
      x[r.dir] += r.amount;
      m.set(r.refType, x);
    }
    return m;
  }, [filtered]);
  const collected = (byRef.get('payment')?.in ?? 0) - (byRef.get('payment_reversal')?.out ?? 0);
  const refunded = byRef.get('refund')?.out ?? 0;
  const spent = (byRef.get('expense')?.out ?? 0) + (byRef.get('payroll')?.out ?? 0);
  const netCash = sum(filtered, (r) => (r.dir === 'in' ? r.amount : -r.amount));
  const openRcv = receivables.data.filter((r) => OPEN_RECEIVABLE.includes(r.status) && r.balance > 0);
  const receivable = sum(openRcv, (r) => r.balance);

  const closeDlg = () => setDlg(null);

  const expenseColumns: Column<Expense>[] = [
    { key: 'date', header: 'Ngày', value: (r) => r.expenseDate, sortable: true, render: (r) => (r.expenseDate ? formatDate(r.expenseDate) : '—') },
    { key: 'category', header: 'Nhóm chi', value: (r) => r.category, sortable: true },
    { key: 'desc', header: 'Nội dung', value: (r) => r.description, render: (r) => <span title={r.description}>{r.description.length > 60 ? `${r.description.slice(0, 60)}…` : r.description}</span> },
    { key: 'vendor', header: 'Nhà cung cấp', value: (r) => r.vendor },
    { key: 'amount', header: 'Số tiền', value: (r) => r.amount, sortable: true, align: 'right', render: (r) => formatVnd(r.amount), total: 'sum', formatTotal: formatVnd },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, sortable: true, render: (r) => <Tag domain="expense" value={r.status} /> },
    {
      key: 'act',
      header: 'Thao tác',
      render: (r) => (
        <div className="row" style={{ flexWrap: 'nowrap', gap: 'var(--space-1)' }}>
          {['draft', 'rejected'].includes(r.status) && canWrite ? (
            <>
              <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setEdit(r); }}>Sửa</Button>
              <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setDlg({ kind: 'request', e: r }); }}>Gửi duyệt</Button>
            </>
          ) : null}
          {r.status === 'requested' && canApprove ? <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setDlg({ kind: 'approve', e: r }); }}>Duyệt</Button> : null}
          {r.status === 'approved' && canWrite ? <Button size="sm" onClick={(e) => { e.stopPropagation(); setDlg({ kind: 'pay', e: r }); }}>Thanh toán</Button> : null}
        </div>
      ),
    },
  ];
  const expenseFilters: TableFilter<Expense>[] = [
    { key: 'status', label: 'Trạng thái', options: ['draft', 'requested', 'approved', 'rejected', 'paid'].map((v) => ({ value: v, label: { draft: 'Nháp', requested: 'Chờ duyệt', approved: 'Đã duyệt, chưa chi', rejected: 'Từ chối', paid: 'Đã thanh toán' }[v] as string })), predicate: (r, v) => r.status === v },
  ];

  const ledgerColumns: Column<LedgerRow>[] = [
    { key: 'day', header: 'Ngày', value: (r) => r.dayKey, sortable: true, render: (r) => formatDate(r.dayKey) },
    { key: 'ref', header: 'Nghiệp vụ', value: (r) => r.refType, render: (r) => REF[r.refType] ?? r.refType },
    { key: 'channel', header: 'Kênh', value: (r) => r.channel, render: (r) => CHANNEL[r.channel] ?? r.channel },
    { key: 'in', header: 'Thu vào', value: (r) => (r.dir === 'in' ? r.amount : 0), align: 'right', render: (r) => (r.dir === 'in' ? formatVnd(r.amount) : '—'), total: 'sum', formatTotal: formatVnd },
    { key: 'out', header: 'Chi ra', value: (r) => (r.dir === 'out' ? r.amount : 0), align: 'right', render: (r) => (r.dir === 'out' ? formatVnd(r.amount) : '—'), total: 'sum', formatTotal: formatVnd },
  ];

  const reconColumns: Column<Recon>[] = [
    { key: 'upto', header: 'Đối chiếu đến ngày', value: (r) => r.upto, sortable: true, render: (r) => formatDate(r.upto) },
    { key: 'ch', header: 'Kênh', value: (r) => r.channel, render: (r) => CHANNEL[r.channel] ?? r.channel },
    { key: 'open', header: 'Đầu kỳ', value: (r) => r.openingBalance, align: 'right', render: (r) => formatVnd(r.openingBalance) },
    { key: 'in', header: 'Thu', value: (r) => r.inAmount, align: 'right', render: (r) => formatVnd(r.inAmount) },
    { key: 'out', header: 'Chi', value: (r) => r.outAmount, align: 'right', render: (r) => formatVnd(r.outAmount) },
    { key: 'exp', header: 'Dự kiến', value: (r) => r.expected, align: 'right', render: (r) => formatVnd(r.expected) },
    { key: 'cnt', header: 'Đếm thực tế', value: (r) => r.counted, align: 'right', render: (r) => formatVnd(r.counted) },
    { key: 'var', header: 'Chênh lệch', value: (r) => r.variance, align: 'right', render: (r) => formatVnd(r.variance) },
    { key: 'st', header: 'Kết quả', value: (r) => r.status, render: (r) => <Tag domain="fund" value={r.status} /> },
    { key: 'note', header: 'Giải trình', value: (r) => r.note },
  ];

  return (
    <div>
      <PageHeader
        title="Thu chi và quỹ cơ sở"
        code="W36"
        description="Đề nghị chi, chứng từ, duyệt theo hạn mức, thanh toán và đối chiếu quỹ. Thực thu, phải thu và lợi nhuận là các khái niệm khác nhau."
        actions={
          <div className="row">
            {canWrite ? <Button icon="plus" onClick={() => setEdit('new')}>Lập đề nghị chi</Button> : null}
            {canReconcile ? <Button variant="secondary" onClick={() => setDlg({ kind: 'reconcile' })}>Đối chiếu quỹ</Button> : null}
          </div>
        }
      />
      <div className="stack">
        <Tabs
          items={[{ id: 'overview', label: 'Tổng quan' }, { id: 'expenses', label: 'Đề nghị chi' }, { id: 'ledger', label: 'Sổ quỹ và đối chiếu' }]}
          active={tab}
          onChange={setTab}
        />

        {tab !== 'expenses' ? (
          <Card title="Bộ lọc sổ quỹ">
            <div className="grid-3">
              <FormField name="from" label="Từ ngày" error={fromErr || undefined}><DateInput name="from" value={from} onValueChange={setFrom} invalid={!!fromErr} /></FormField>
              <FormField name="to" label="Đến ngày"><DateInput name="to" value={to} onValueChange={setTo} invalid={!!fromErr} /></FormField>
              <FormField name="channel" label="Kênh">
                <Select name="channel" value={channel} onValueChange={setChannel} placeholder="Tất cả kênh" options={CHANNEL_OPTIONS} />
              </FormField>
            </div>
          </Card>
        ) : null}

        {tab === 'overview' ? (
          <div className="stack">
            <Banner tone="info" title="Thực thu ≠ phải thu ≠ lợi nhuận">
              Thực thu là tiền đã vào sổ quỹ. Phải thu là công nợ còn mở, chưa chắc đã thu được. Màn này không tính lợi nhuận; chỉ hiển thị thu chi ròng của sổ quỹ trong khoảng đã lọc.
            </Banner>
            {ledger.status === 'error' ? (
              <Banner tone="error" title="Không tải được sổ quỹ">{ledger.error?.message} <Button size="sm" variant="secondary" onClick={ledger.retry}>Thử lại</Button></Banner>
            ) : null}
            <div className="grid-4">
              <Stat label="Thực thu trong khoảng lọc" value={formatVnd(collected)} tone="success" hint="Sổ quỹ: thu học phí trừ chứng từ thu đã đảo" />
              <Stat label="Chi thực tế" value={formatVnd(spent)} hint="Chi theo đề nghị và chi lương đã ghi sổ quỹ" />
              <Stat label="Hoàn tiền đã chi" value={formatVnd(refunded)} />
              <Stat label="Thu chi ròng (không phải lợi nhuận)" value={formatVnd(netCash)} hint="Tổng thu vào trừ tổng chi ra trong sổ quỹ đã lọc" />
            </div>
            {canReceivable ? (
              <div className="grid-4">
                <Stat
                  label="Phải thu còn mở"
                  value={receivables.status === 'error' ? '—' : formatVnd(receivable)}
                  tone={openRcv.some((r) => r.status === 'overdue') ? 'warning' : undefined}
                  hint={receivables.status === 'error' ? 'Không tải được công nợ' : `${openRcv.length} khoản; tính đến hiện tại, không theo khoảng lọc`}
                />
              </div>
            ) : (
              <p className="text-small text-secondary">Bạn không có quyền xem công nợ nên không hiển thị số phải thu.</p>
            )}
            <Card title="Phân loại theo nghiệp vụ" flush>
              <DataTable
                caption="Tổng hợp sổ quỹ theo nghiệp vụ"
                columns={[
                  { key: 'ref', header: 'Nghiệp vụ', value: (r: { ref: string }) => REF[r.ref] ?? r.ref },
                  { key: 'in', header: 'Thu vào', align: 'right', value: (r: { in: number }) => r.in, render: (r: { in: number }) => formatVnd(r.in), total: 'sum', formatTotal: formatVnd },
                  { key: 'out', header: 'Chi ra', align: 'right', value: (r: { out: number }) => r.out, render: (r: { out: number }) => formatVnd(r.out), total: 'sum', formatTotal: formatVnd },
                ]}
                rows={[...byRef.entries()].map(([ref, v]) => ({ ref, ...v }))}
                rowKey={(r) => r.ref}
                status={ledger.status === 'ready' && byRef.size === 0 ? 'empty' : ledger.status}
                error={ledger.error?.message}
                onRetry={ledger.retry}
                emptyTitle="Chưa có phát sinh trong khoảng đã chọn"
              />
            </Card>
          </div>
        ) : null}

        {tab === 'expenses' ? (
          <div className="stack">
            {limit !== null ? <Banner tone="info">Hạn mức duyệt của cơ sở: {formatVnd(limit)}. Khoản vượt hạn mức cần người duyệt cấp tổ chức.</Banner> : null}
            <DataTable
              caption="Danh sách đề nghị chi"
              columns={expenseColumns}
              rows={expenses.data}
              rowKey={(r) => r.id}
              status={expenses.status}
              error={expenses.error?.message}
              onRetry={expenses.retry}
              onRowClick={setView}
              searchText={(r) => `${r.category} ${r.description} ${r.vendor}`}
              searchPlaceholder="Tìm theo nhóm chi, nội dung, nhà cung cấp"
              filters={expenseFilters}
              emptyTitle="Chưa có đề nghị chi nào"
              emptyDescription="Lập đề nghị chi, đính kèm chứng từ rồi gửi duyệt. Chi chỉ được thanh toán sau khi duyệt."
              emptyAction={canWrite ? <Button icon="plus" onClick={() => setEdit('new')}>Lập đề nghị chi</Button> : undefined}
            />
          </div>
        ) : null}

        {tab === 'ledger' ? (
          <div className="stack">
            <DataTable
              caption="Sổ quỹ cơ sở"
              columns={ledgerColumns}
              rows={[...filtered].sort((a, b) => b.dayKey.localeCompare(a.dayKey))}
              rowKey={(r) => r.id}
              status={ledger.status === 'ready' && filtered.length === 0 ? 'empty' : ledger.status}
              error={ledger.error?.message}
              onRetry={ledger.retry}
              emptyTitle="Không có dòng sổ quỹ"
              emptyDescription="Chưa có thu chi nào trong khoảng đã lọc."
            />
            <Card title="Lịch sử đối chiếu quỹ" flush>
              <DataTable
                caption="Lịch sử đối chiếu quỹ"
                columns={reconColumns}
                rows={[...recons.data].sort((a, b) => b.upto.localeCompare(a.upto))}
                rowKey={(r) => r.id}
                status={recons.status}
                error={recons.error?.message}
                onRetry={recons.retry}
                emptyTitle="Chưa đối chiếu quỹ lần nào"
                emptyDescription="Đếm quỹ thực tế rồi đối chiếu với số dự kiến từ sổ quỹ. Chênh lệch phải có giải trình."
              />
            </Card>
          </div>
        ) : null}
      </div>

      {edit ? <ExpenseDrawer key={edit === 'new' ? 'new' : edit.id} expense={edit === 'new' ? null : edit} onClose={() => setEdit(null)} /> : null}

      <Drawer open={!!view} title="Chi tiết đề nghị chi" onClose={() => setView(null)}>
        {view ? (
          <div className="stack">
            <Tag domain="expense" value={view.status} />
            <KV
              items={[
                ['Nhóm chi', view.category],
                ['Số tiền', formatVnd(view.amount)],
                ['Nội dung', view.description],
                ['Nhà cung cấp', view.vendor],
                ['Ngày phát sinh', view.expenseDate ? formatDate(view.expenseDate) : ''],
                ['Ý kiến duyệt', view.decisionNote],
                ['Hình thức chi', CHANNEL[view.payMethod] ?? view.payMethod],
                ['Thời điểm chi', view.paidAt ? formatDateTime(view.paidAt, c.tz) : ''],
                ['Tham chiếu chi', view.payReference],
              ]}
            />
            <div>
              <div className="text-caption text-secondary">Chứng từ</div>
              {view.evidencePaths.length ? <ul style={{ margin: 0, paddingLeft: 20 }}>{view.evidencePaths.map((p) => <li key={p} style={{ overflowWrap: 'anywhere' }}>{p}</li>)}</ul> : <span>—</span>}
            </div>
          </div>
        ) : null}
      </Drawer>

      {dlg?.kind === 'request' ? (
        <ActionDialog
          title="Gửi đề nghị chi để duyệt"
          subject={`${dlg.e.category} · ${formatVnd(dlg.e.amount)}`}
          impact={['Đề nghị chuyển sang «Chờ duyệt» và không sửa được nữa cho đến khi bị từ chối.', 'Người lập không được tự duyệt đề nghị của mình.', 'Chưa chi tiền và chưa ghi sổ quỹ.']}
          confirmLabel="Gửi duyệt"
          success="Đã gửi đề nghị chi để duyệt."
          run={(opId) => call('expense.request', { id: dlg.e.id }, opId)}
          onClose={closeDlg}
          onReload={expenses.retry}
        />
      ) : null}

      {dlg?.kind === 'approve' ? <ApproveDialog e={dlg.e} limit={limit} orgWide={scope.canOrg('expenses.approve')} onClose={closeDlg} onReload={expenses.retry} /> : null}
      {dlg?.kind === 'pay' ? <PayDialog e={dlg.e} onClose={closeDlg} onReload={expenses.retry} /> : null}
      {dlg?.kind === 'reconcile' ? <ReconcileDialog ledger={ledger.data} recons={recons.data} onClose={closeDlg} onReload={recons.retry} /> : null}
      {!c.can('expenses.read') ? <EmptyState icon="lock" title="Bạn không có quyền xem thu chi" /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ hộp thoại */

function ApproveDialog({ e, limit, orgWide, onClose, onReload }: { e: Expense; limit: number | null; orgWide: boolean; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  const [decision, setDecision] = useState('approved');
  const [note, setNote] = useState('');
  const over = limit !== null && e.amount > limit;
  return (
    <ActionDialog
      title="Duyệt đề nghị chi"
      subject={`${e.category} · ${formatVnd(e.amount)}`}
      impact={
        decision === 'approved'
          ? [
              'Đề nghị chuyển sang «Đã duyệt, chưa chi». Duyệt KHÔNG có nghĩa đã chi tiền.',
              ...(over ? [`Khoản này vượt hạn mức duyệt của cơ sở (${formatVnd(limit ?? 0)}). ${orgWide ? 'Bạn có quyền duyệt cấp tổ chức.' : 'Máy chủ sẽ từ chối nếu bạn không có quyền duyệt cấp tổ chức.'}`] : []),
              'Người lập không được là người duyệt.',
            ]
          : ['Đề nghị chuyển sang «Từ chối» kèm lý do; người lập có thể sửa và gửi lại.']
      }
      confirmLabel={decision === 'approved' ? 'Duyệt đề nghị' : 'Từ chối đề nghị'}
      tone={decision === 'rejected' ? 'destructive' : 'primary'}
      success={decision === 'approved' ? 'Đã duyệt đề nghị chi.' : 'Đã từ chối đề nghị chi.'}
      validate={() => (decision === 'rejected' && !note.trim() ? 'Nhập lý do từ chối.' : null)}
      run={(opId) => call('expense.approve', { id: e.id, decision, note: note.trim() }, opId)}
      onClose={onClose}
      onReload={onReload}
    >
      <FormField name="decision" label="Quyết định" required>
        <Select name="decision" value={decision} onValueChange={setDecision} options={[{ value: 'approved', label: 'Duyệt' }, { value: 'rejected', label: 'Từ chối' }]} />
      </FormField>
      <FormField name="note" label="Ý kiến" required={decision === 'rejected'}>
        <Textarea name="note" value={note} onValueChange={setNote} />
      </FormField>
    </ActionDialog>
  );
}

function PayDialog({ e, onClose, onReload }: { e: Expense; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  const [method, setMethod] = useState('bank_transfer');
  const [day, setDay] = useState('');
  const [reference, setReference] = useState('');
  const [evidence, setEvidence] = useState('');
  return (
    <ActionDialog
      title="Thanh toán khoản chi"
      subject={`${e.category} · ${formatVnd(e.amount)}`}
      impact={[
        `Ghi nhận đã chi ${formatVnd(e.amount)} và thêm một dòng CHI vào sổ quỹ của cơ sở.`,
        'Khoản chi chuyển sang «Đã thanh toán»; không sửa hoặc thanh toán lại được.',
      ]}
      confirmLabel={`Xác nhận đã chi ${formatVnd(e.amount)}`}
      success="Đã ghi nhận thanh toán khoản chi."
      run={(opId) =>
        call('expense.pay', {
          id: e.id, method, reference: reference.trim() || undefined,
          paidAt: day ? `${day}T12:00:00+07:00` : undefined,
          evidencePaths: evidence.split('\n').map((x) => x.trim()).filter(Boolean),
        }, opId)
      }
      onClose={onClose}
      onReload={onReload}
    >
      <div className="grid-2">
        <FormField name="method" label="Hình thức chi" required>
          <Select name="method" value={method} onValueChange={setMethod} options={[{ value: 'bank_transfer', label: 'Chuyển khoản' }, { value: 'cash', label: 'Tiền mặt' }]} />
        </FormField>
        <FormField name="day" label="Ngày chi" helper="Để trống để lấy thời điểm hiện tại.">
          <DateInput name="day" value={day} onValueChange={setDay} />
        </FormField>
      </div>
      <FormField name="reference" label="Tham chiếu (số phiếu chi, nội dung chuyển khoản)">
        <Input name="reference" value={reference} onValueChange={setReference} />
      </FormField>
      <FormField name="evidence" label="Chứng từ thanh toán" helper="Mỗi dòng một mã hoặc đường dẫn.">
        <Textarea name="evidence" value={evidence} onValueChange={setEvidence} />
      </FormField>
    </ActionDialog>
  );
}

function ReconcileDialog({ ledger, recons, onClose, onReload }: { ledger: LedgerRow[]; recons: Recon[]; onClose: () => void; onReload: () => void }) {
  const c = useCampusCtx();
  const call = useCall();
  const [channel, setChannel] = useState('cash');
  const [day, setDay] = useState('');
  const [counted, setCounted] = useState<number | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const prev = [...recons].filter((r) => r.channel === channel).sort((a, b) => b.upto.localeCompare(a.upto))[0];
  const rows = ledger.filter((r) => r.channel === channel && day && r.dayKey <= day && (!prev || r.dayKey > prev.upto));
  const inAmt = sum(rows.filter((r) => r.dir === 'in'), (r) => r.amount);
  const outAmt = sum(rows.filter((r) => r.dir === 'out'), (r) => r.amount);
  const open = prev ? prev.counted : opening ?? 0;
  const expected = open + inAmt - outAmt;
  const variance = counted === null ? null : counted - expected;

  return (
    <ActionDialog
      title="Đối chiếu quỹ"
      subject={`${c.campusName} · ${CHANNEL[channel]}`}
      impact={[
        'Máy chủ tính số dự kiến từ sổ quỹ và so với số tiền bạn đếm thực tế; kết quả ghi lại để truy vết.',
        'Chỉ đối chiếu theo ngày sau lần đối chiếu gần nhất; không sửa lần đã ghi.',
        'Có chênh lệch thì bắt buộc nhập giải trình.',
      ]}
      confirmLabel="Ghi nhận đối chiếu"
      success="Đã ghi nhận đối chiếu quỹ."
      validate={() => {
        if (!day) return 'Chọn ngày đối chiếu.';
        if (prev && day <= prev.upto) return `Đã đối chiếu đến ${formatDate(prev.upto)}; chọn ngày sau đó.`;
        if (counted === null) return 'Nhập số tiền đếm thực tế.';
        if (variance !== 0 && !note.trim()) return 'Có chênh lệch: nhập giải trình.';
        return null;
      }}
      run={(opId) =>
        call('fund.reconcile', { channel, dayKey: day, countedAmount: counted, note: note.trim() || undefined, ...(!prev && opening !== null ? { openingBalance: opening } : {}) }, opId)
      }
      onClose={onClose}
      onReload={onReload}
    >
      <div className="grid-2">
        <FormField name="channel" label="Kênh" required>
          <Select name="channel" value={channel} onValueChange={setChannel} options={[{ value: 'cash', label: 'Tiền mặt' }, { value: 'bank_transfer', label: 'Chuyển khoản' }]} />
        </FormField>
        <FormField name="day" label="Đối chiếu đến ngày" required>
          <DateInput name="day" value={day} onValueChange={setDay} />
        </FormField>
      </div>
      {prev ? (
        <p className="text-small text-secondary">Lần trước: đến {formatDate(prev.upto)}, đếm {formatVnd(prev.counted)} (dùng làm số đầu kỳ).</p>
      ) : (
        <FormField name="opening" label="Số dư đầu kỳ" helper="Lần đầu tiên của kênh này: nhập số dư ban đầu (để trống = 0).">
          <MoneyInput name="opening" value={opening} onValueChange={setOpening} />
        </FormField>
      )}
      <FormField name="counted" label="Số tiền đếm thực tế" required>
        <MoneyInput name="counted" value={counted} onValueChange={setCounted} />
      </FormField>
      <div className="grid-3">
        <Stat label="Dự kiến theo sổ quỹ" value={formatVnd(expected)} hint={`Đầu kỳ ${formatVnd(open)} + thu ${formatVnd(inAmt)} − chi ${formatVnd(outAmt)}`} />
        <Stat label="Đếm thực tế" value={counted === null ? '—' : formatVnd(counted)} />
        <Stat label="Chênh lệch" value={variance === null ? '—' : formatVnd(variance)} tone={variance === null ? undefined : variance === 0 ? 'success' : 'warning'} />
      </div>
      {variance !== null && variance !== 0 ? <Badge tone="warning" icon="alert">Có chênh lệch, cần giải trình</Badge> : null}
      <FormField name="note" label="Giải trình" required={variance !== null && variance !== 0}>
        <Textarea name="note" value={note} onValueChange={setNote} />
      </FormField>
      <p className="text-caption text-secondary">Số dự kiến ở đây là bản xem trước từ dữ liệu đang hiển thị; máy chủ tính lại khi ghi nhận.</p>
    </ActionDialog>
  );
}
