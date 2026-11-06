'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useScope } from '@/providers/ScopeProvider';
import { buildPath } from '@/lib/screens';
import { formatVnd } from '@/lib/format';
import { PageHeader, Stat } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { FormField, Select } from '@/components/ui/Fields';
import type { ScreenProps } from '../registry';
import { currentPeriod, periodOptions, useCampus, useScopedQuery, moneyStyle } from './parts/common';
import { isIssued, toCredit, toRcv, type Rcv } from './parts/ledger';

interface DebtRow {
  childId: string;
  name: string;
  newDue: number;
  oldDebt: number;
  total: number;
  credit: number;
  status: string;
  overdueCount: number;
}

const STATUS_ORDER = ['overdue', 'pending_reconciliation', 'partially_paid', 'unpaid', 'paid'];

/** W31 — Khoản phải thu và công nợ: phải thu mới của kỳ tách khỏi nợ cũ (các kỳ trước). */
export function W31Receivables(_props: ScreenProps) {
  void _props;
  const router = useRouter();
  const { can, tz } = useScope();
  const ctx = useCampus();
  const [period, setPeriod] = useState(() => currentPeriod(ctx?.tz ?? tz));
  const rcv = useScopedQuery<Rcv>('receivables', 'payments.read', toRcv);
  const cr = useScopedQuery('credits', 'payments.read', toCredit);

  const rows = useMemo<DebtRow[]>(() => {
    const by = new Map<string, DebtRow & { flags: Set<string> }>();
    for (const r of rcv.data) {
      if (!isIssued(r) || r.periodKey > period) continue;
      const row = by.get(r.childId) ?? { childId: r.childId, name: r.childName, newDue: 0, oldDebt: 0, total: 0, credit: 0, status: 'paid', overdueCount: 0, flags: new Set<string>() };
      if (r.periodKey === period) row.newDue += r.balance;
      else row.oldDebt += r.balance;
      if (r.balance > 0) {
        row.flags.add(r.pendingReconciliation ? 'pending_reconciliation' : r.status);
        if (r.status === 'overdue') row.overdueCount++;
      }
      by.set(r.childId, row);
    }
    for (const c of cr.data) if (c.status === 'open' && by.has(c.childId)) by.get(c.childId)!.credit += c.remaining;
    return [...by.values()].map((x) => {
      const status = STATUS_ORDER.find((s) => x.flags.has(s)) ?? 'paid';
      return { childId: x.childId, name: x.name, newDue: x.newDue, oldDebt: x.oldDebt, total: x.newDue + x.oldDebt, credit: x.credit, status, overdueCount: x.overdueCount };
    }).sort((a, b) => b.total - a.total);
  }, [rcv.data, cr.data, period]);

  const totals = useMemo(() => ({
    newDue: rows.reduce((s, r) => s + r.newDue, 0),
    oldDebt: rows.reduce((s, r) => s + r.oldDebt, 0),
    overdue: rows.filter((r) => r.status === 'overdue').length,
    credit: rows.reduce((s, r) => s + r.credit, 0),
  }), [rows]);

  const money = (n: number) => <span style={moneyStyle}>{formatVnd(n)}</span>;
  const columns: Column<DebtRow>[] = [
    { key: 'name', header: 'Trẻ', value: (r) => r.name, sortable: true, render: (r) => <strong>{r.name}</strong> },
    { key: 'newDue', header: 'Phải thu mới của kỳ', value: (r) => r.newDue, sortable: true, align: 'right', total: 'sum', formatTotal: money, render: (r) => money(r.newDue) },
    { key: 'oldDebt', header: 'Nợ cũ', value: (r) => r.oldDebt, sortable: true, align: 'right', total: 'sum', formatTotal: money, render: (r) => money(r.oldDebt) },
    { key: 'total', header: 'Tổng còn nợ', value: (r) => r.total, sortable: true, align: 'right', total: 'sum', formatTotal: money, render: (r) => <strong style={moneyStyle}>{formatVnd(r.total)}</strong> },
    { key: 'credit', header: 'Số dư có', value: (r) => r.credit, align: 'right', render: (r) => (r.credit ? money(r.credit) : '—') },
    { key: 'status', header: 'Tình trạng', value: (r) => r.status, sortable: true, render: (r) => <StatusBadge domain="payment" value={r.status} /> },
    {
      key: 'actions', header: 'Thao tác',
      render: (r) => (
        <div className="row" style={{ gap: 'var(--space-1)', flexWrap: 'nowrap' }}>
          <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); router.push(buildPath('/thu-tien/cong-no/:childId', { childId: r.childId })); }}>Chi tiết</Button>
          {ctx && can('payments.write', ctx.campusId) && r.total > 0 ? <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); router.push(`/thu-tien/thu?childId=${encodeURIComponent(r.childId)}`); }}>Thu tiền</Button> : null}
        </div>
      ),
    },
  ];
  const filters: TableFilter<DebtRow>[] = [
    { key: 'status', label: 'Tình trạng', options: STATUS_ORDER.map((s) => ({ value: s, label: ({ overdue: 'Quá hạn', pending_reconciliation: 'Chờ đối soát', partially_paid: 'Đã thanh toán một phần', unpaid: 'Chưa thanh toán', paid: 'Đã thanh toán' } as Record<string, string>)[s] })), predicate: (r, v) => r.status === v },
    { key: 'debt', label: 'Công nợ', options: [{ value: 'owing', label: 'Còn nợ' }, { value: 'old', label: 'Có nợ cũ' }, { value: 'credit', label: 'Có số dư có' }], predicate: (r, v) => (v === 'owing' ? r.total > 0 : v === 'old' ? r.oldDebt > 0 : r.credit > 0) },
  ];

  const status = rcv.status === 'loading' || cr.status === 'loading' ? 'loading' : rcv.status === 'error' ? 'error' : rows.length ? 'ready' : 'empty';

  return (
    <div>
      <PageHeader title="Khoản phải thu và công nợ" code="W31" description="Phải thu mới của kỳ tách riêng khỏi nợ cũ. Số dư có là tiền phụ huynh đã nộp thừa." />
      <div className="stack">
        <div className="grid-4">
          <Stat label="Phải thu mới của kỳ" value={formatVnd(totals.newDue)} />
          <Stat label="Nợ cũ" value={formatVnd(totals.oldDebt)} tone={totals.oldDebt ? 'warning' : undefined} />
          <Stat label="Trẻ quá hạn" value={totals.overdue} tone={totals.overdue ? 'error' : undefined} />
          <Stat label="Số dư có" value={formatVnd(totals.credit)} />
        </div>
        <div style={{ maxWidth: 260 }}>
          <FormField name="period" label="Kỳ xem"><Select name="period" value={period} onValueChange={setPeriod} options={periodOptions(ctx?.tz ?? tz)} /></FormField>
        </div>
        <DataTable
          caption="Công nợ theo trẻ"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.childId}
          status={status}
          error={rcv.error?.message}
          onRetry={rcv.retry}
          onRowClick={(r) => router.push(buildPath('/thu-tien/cong-no/:childId', { childId: r.childId }))}
          searchText={(r) => r.name}
          searchPlaceholder="Tìm theo tên trẻ"
          filters={filters}
          emptyTitle="Chưa có khoản phải thu đã phát hành"
          emptyDescription="Khoản phải thu xuất hiện sau khi kỳ thu được duyệt và phát hành ở màn Kỳ thu."
        />
      </div>
    </div>
  );
}
