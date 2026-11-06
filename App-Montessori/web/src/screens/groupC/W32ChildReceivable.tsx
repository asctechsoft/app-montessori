'use client';
import { useEffect, useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { useScope } from '@/providers/ScopeProvider';
import { formatDate, formatDateTime, formatVnd } from '@/lib/format';
import { PageHeader, Stat } from '@/components/ui/Misc';
import { LinkButton } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { FormField, Select } from '@/components/ui/Fields';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Misc';
import type { ScreenProps } from '../registry';
import { KV, PayBadge, RcvBadge, CHANNEL_LABELS, periodLabel, useCampus, useScopedQuery, moneyStyle } from './parts/common';
import { PAY_TYPE_LABEL, isOpen, netOf, toCredit, toPay, toRcv, type Pay, type Rcv } from './parts/ledger';

const LINE_LABEL: Record<string, string> = { tuition: 'Học phí', meal: 'Tiền ăn', service: 'Dịch vụ', discount: 'Giảm trừ', meal_refund: 'Hoàn trừ tiền ăn kỳ trước', other: 'Khác', adjustment: 'Điều chỉnh' };

/** W32 — Chi tiết khoản thu của một trẻ: các dòng tính tiền, nợ cũ tách riêng, lịch sử thu. */
export function W32ChildReceivable({ params }: ScreenProps) {
  const childId = params.childId;
  const ctx = useCampus();
  const { can, tz } = useScope();
  const rcvQ = useScopedQuery<Rcv>('receivables', 'payments.read', toRcv, { extra: [where('childId', '==', childId)], tag: childId });
  const payQ = useScopedQuery<Pay>('payments', 'payments.read', toPay, { extra: [where('childId', '==', childId)], tag: childId });
  const crQ = useScopedQuery('credits', 'payments.read', toCredit, { extra: [where('childId', '==', childId)], tag: childId });
  const issued = useMemo(() => rcvQ.data.filter((r) => r.status !== 'draft' && r.status !== 'cancelled').sort((a, b) => b.periodKey.localeCompare(a.periodKey)), [rcvQ.data]);
  const [period, setPeriod] = useState('');
  useEffect(() => {
    if (!period && issued.length) setPeriod(issued[0].periodKey);
  }, [issued, period]);

  const name = rcvQ.data[0]?.childName ?? payQ.data[0]?.childName ?? childId;
  const sel = issued.find((r) => r.periodKey === period) ?? null;
  const older = sel ? issued.filter((r) => r.periodKey < sel.periodKey && isOpen(r)) : [];
  const oldDebt = older.reduce((s, r) => s + r.balance, 0);
  const net = sel ? netOf(sel) : 0;
  const total = sel ? sel.balance + oldDebt : 0;
  const credit = crQ.data.filter((c) => c.status === 'open').reduce((s, c) => s + c.remaining, 0);
  const canPay = !!ctx && can('payments.write', ctx.campusId);
  const canAdjust = !!ctx && (can('billing.write', ctx.campusId) || can('refunds.approve', ctx.campusId));

  const payCols: Column<Pay>[] = [
    { key: 'at', header: 'Thời điểm', value: (r) => r.at, sortable: true, render: (r) => formatDateTime(r.at, ctx?.tz ?? tz) },
    { key: 'type', header: 'Loại', value: (r) => r.type, render: (r) => PAY_TYPE_LABEL[r.type] ?? r.type },
    { key: 'channel', header: 'Kênh', value: (r) => r.channel, render: (r) => CHANNEL_LABELS[r.channel] ?? (r.channel || '—') },
    { key: 'ref', header: 'Mã tham chiếu', value: (r) => r.reference, render: (r) => r.reference || '—' },
    { key: 'amount', header: 'Số tiền', value: (r) => r.amount, align: 'right', render: (r) => <span style={moneyStyle}>{r.type === 'reversal' || r.type === 'refund' ? '-' : ''}{formatVnd(r.amount)}</span> },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, render: (r) => <PayBadge value={r.status} /> },
  ];

  const loading = rcvQ.status === 'loading' || payQ.status === 'loading';
  return (
    <div>
      <PageHeader
        title={`Khoản thu của ${name}`}
        code="W32"
        breadcrumbs={[{ label: 'Công nợ', href: '/thu-tien/cong-no' }, { label: name }]}
        actions={
          <>
            {canPay ? <LinkButton href={`/thu-tien/thu?childId=${encodeURIComponent(childId)}`}>Thu tiền</LinkButton> : null}
            {canAdjust ? <LinkButton href="/thu-tien/hoan-dieu-chinh" variant="secondary">Hoàn tiền và điều chỉnh</LinkButton> : null}
          </>
        }
      />
      {rcvQ.status === 'error' ? <ErrorState message={rcvQ.error?.message} onRetry={rcvQ.retry} /> : loading ? (
        <div className="stack"><Skeleton height={80} /><Skeleton height={220} /></div>
      ) : !sel ? (
        <EmptyState title="Trẻ chưa có khoản phải thu đã phát hành" description="Khoản phải thu xuất hiện sau khi kỳ thu được duyệt và phát hành." />
      ) : (
        <div className="stack">
          <div className="grid-4">
            <Stat label={`Phải thu mới ${periodLabel(sel.periodKey)}`} value={formatVnd(net)} />
            <Stat label="Nợ cũ (các kỳ trước)" value={formatVnd(oldDebt)} tone={oldDebt ? 'warning' : undefined} />
            <Stat label="Tổng còn phải trả" value={formatVnd(total)} hint="Phải thu mới − đã thu + nợ cũ" />
            <Stat label="Số dư có" value={formatVnd(credit)} />
          </div>
          <div style={{ maxWidth: 260 }}>
            <FormField name="period" label="Kỳ thu"><Select name="period" value={period} onValueChange={setPeriod} options={issued.map((r) => ({ value: r.periodKey, label: periodLabel(r.periodKey) }))} /></FormField>
          </div>
          <Card title={`Các dòng tính tiền ${periodLabel(sel.periodKey)}`}>
            <div className="stack">
              <KV items={[['Tình trạng', <RcvBadge key="s" value={sel.status} />], ['Hạn đóng', formatDate(sel.dueDate)], ['Cách tính tiền ăn', sel.mealMode === 'actual' ? 'Theo suất thực tế' : sel.mealMode === 'provisional' ? 'Tạm thu, hoàn trừ kỳ sau' : '—']]} columns={3} />
              <table className="dt">
                <caption className="sr-only">Các dòng của khoản phải thu</caption>
                <thead><tr><th scope="col">Khoản</th><th scope="col">Loại</th><th scope="col" className="num">Số lượng</th><th scope="col" className="num">Đơn giá</th><th scope="col" className="num">Thành tiền</th></tr></thead>
                <tbody>
                  {sel.lines.map((l, i) => (
                    <tr key={`${l.code}-${i}`}><td>{l.description}</td><td>{LINE_LABEL[l.type] ?? l.type}</td><td className="num">{l.qty}</td><td className="num" style={moneyStyle}>{formatVnd(l.unitPrice)}</td><td className="num" style={moneyStyle}>{formatVnd(l.amount)}</td></tr>
                  ))}
                  {sel.adjustUp ? <tr><td>Điều chỉnh tăng (chứng từ điều chỉnh)</td><td>Điều chỉnh</td><td className="num">1</td><td className="num" style={moneyStyle}>{formatVnd(sel.adjustUp)}</td><td className="num" style={moneyStyle}>{formatVnd(sel.adjustUp)}</td></tr> : null}
                </tbody>
                <tfoot>
                  <tr><td colSpan={4}>Phải thu mới của kỳ</td><td className="num" style={moneyStyle}>{formatVnd(net)}</td></tr>
                  {sel.allocated ? <tr><td colSpan={4}>Đã thu và phân bổ vào kỳ này</td><td className="num" style={moneyStyle}>-{formatVnd(sel.allocated)}</td></tr> : null}
                  <tr><td colSpan={4}>Nợ cũ (tách riêng)</td><td className="num" style={moneyStyle}>{formatVnd(oldDebt)}</td></tr>
                  <tr><td colSpan={4}>Tổng còn phải trả</td><td className="num" style={moneyStyle}>{formatVnd(total)}</td></tr>
                </tfoot>
              </table>
              {sel.lines.length === 0 ? <Banner tone="info">Khoản này không có dòng chi tiết được lưu.</Banner> : null}
            </div>
          </Card>
          {older.length ? (
            <Card title="Nợ cũ theo kỳ">
              <table className="dt">
                <caption className="sr-only">Nợ cũ theo kỳ</caption>
                <thead><tr><th scope="col">Kỳ</th><th scope="col">Hạn đóng</th><th scope="col">Tình trạng</th><th scope="col" className="num">Còn nợ</th></tr></thead>
                <tbody>{older.map((r) => <tr key={r.id}><td>{periodLabel(r.periodKey)}</td><td>{formatDate(r.dueDate)}</td><td><RcvBadge value={r.pendingReconciliation ? 'pending_reconciliation' : r.status} /></td><td className="num" style={moneyStyle}>{formatVnd(r.balance)}</td></tr>)}</tbody>
              </table>
            </Card>
          ) : null}
          <Card title="Lịch sử thu tiền" flush>
            <DataTable
              caption="Lịch sử thu tiền của trẻ"
              columns={payCols}
              rows={[...payQ.data].sort((a, b) => b.at - a.at)}
              rowKey={(r) => r.id}
              status={payQ.status}
              error={payQ.error?.message}
              onRetry={payQ.retry}
              emptyTitle="Chưa có giao dịch thu tiền"
              emptyDescription="Phiếu thu, biên nhận chờ đối soát và chứng từ đảo của trẻ hiện ở đây. Biên nhận chờ đối soát chưa được ghi thu."
            />
          </Card>
        </div>
      )}
    </div>
  );
}
