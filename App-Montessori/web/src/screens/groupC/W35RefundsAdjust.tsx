'use client';
import { useMemo, useState } from 'react';
import { callApi } from '@/lib/api';
import { useScope } from '@/providers/ScopeProvider';
import { formatDateTime, formatVnd } from '@/lib/format';
import { PageHeader } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { FormField, Input, MoneyInput, Select, Textarea } from '@/components/ui/Fields';
import { Tabs } from '@/components/ui/Tabs';
import type { Tone } from '@/lib/status';
import type { ScreenProps } from '../registry';
import { ActionDialog, CHANNEL_LABELS, PayBadge, RcvBadge, num, periodLabel, str, tsMs, useCampus, useChildOptions, useScopedQuery, moneyStyle } from './parts/common';
import { isIssued, toCredit, toPay, toRcv, type Pay, type Rcv } from './parts/ledger';

interface Refund { id: string; childId: string; childName: string; amount: number; reason: string; method: string; status: string; at: number }
const REFUND_STATUS: Record<string, { label: string; tone: Tone }> = {
  requested: { label: 'Chờ duyệt', tone: 'warning' },
  approved: { label: 'Đã duyệt, chưa chi', tone: 'info' },
  rejected: { label: 'Từ chối', tone: 'error' },
  paid: { label: 'Đã chi trả', tone: 'success' },
};
const METHODS = [{ value: 'bank_transfer', label: 'Chuyển khoản' }, { value: 'cash', label: 'Tiền mặt' }];
type Dlg =
  | { k: 'request' }
  | { k: 'approve' | 'reject' | 'pay'; r: Refund }
  | { k: 'cancel'; p: Pay }
  | { k: 'adjust' };

/** W35 — Hoàn tiền và điều chỉnh chứng từ. Duyệt hoàn khác đã chi trả; hủy phiếu và điều chỉnh tạo chứng từ liên kết, không sửa số cũ. */
export function W35RefundsAdjust(_props: ScreenProps) {
  void _props;
  const ctx = useCampus();
  const { can, tz } = useScope();
  const [tab, setTab] = useState('refunds');
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [childId, setChildId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [ref, setRef] = useState('');
  const [rcvId, setRcvId] = useState('');
  const [sign, setSign] = useState('decrease');
  const refunds = useScopedQuery<Refund>('refunds', ['payments.read', 'refunds.approve'], (id, d) => ({ id, childId: str(d.childId), childName: str(d.childName, str(d.childId)), amount: num(d.amount), reason: str(d.reason), method: str(d.method), status: str(d.status), at: tsMs(d.createdAt) }));
  const pays = useScopedQuery<Pay>('payments', 'payments.read', toPay);
  const rcv = useScopedQuery<Rcv>('receivables', 'payments.read', toRcv);
  const credits = useScopedQuery('credits', 'payments.read', toCredit);
  const { options: childOptions } = useChildOptions();
  const canWrite = !!ctx && can('payments.write', ctx.campusId);
  const canApprove = !!ctx && can('refunds.approve', ctx.campusId);
  const canAdjust = !!ctx && can('billing.write', ctx.campusId);
  const creditOf = (id: string) => credits.data.filter((c) => c.childId === id && c.status === 'open').reduce((s, c) => s + c.remaining, 0);
  const open = (k: Dlg) => { setAmount(null); setText(''); setRef(''); setChildId(''); setRcvId(''); setMethod('bank_transfer'); setSign('decrease'); setDlg(k); };

  const receipts = useMemo(() => pays.data.filter((p) => p.type === 'receipt').sort((a, b) => b.at - a.at), [pays.data]);
  const refundRows = useMemo(() => [...refunds.data].sort((a, b) => b.at - a.at), [refunds.data]);
  const childRcv = rcv.data.filter((r) => r.childId === childId && isIssued(r)).sort((a, b) => b.periodKey.localeCompare(a.periodKey));
  const selRcv = childRcv.find((r) => r.id === rcvId);

  const refundCols: Column<Refund>[] = [
    { key: 'at', header: 'Yêu cầu lúc', value: (r) => r.at, sortable: true, render: (r) => formatDateTime(r.at, ctx?.tz ?? tz) },
    { key: 'child', header: 'Trẻ', value: (r) => r.childName, render: (r) => <strong>{r.childName}</strong> },
    { key: 'amount', header: 'Số tiền', value: (r) => r.amount, align: 'right', render: (r) => <span style={moneyStyle}>{formatVnd(r.amount)}</span> },
    { key: 'reason', header: 'Lý do', value: (r) => r.reason },
    { key: 'method', header: 'Hình thức', value: (r) => r.method, render: (r) => CHANNEL_LABELS[r.method] ?? r.method },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, render: (r) => { const s = REFUND_STATUS[r.status] ?? { label: r.status, tone: 'neutral' as Tone }; return <Badge tone={s.tone}>{s.label}</Badge>; } },
    {
      key: 'a', header: 'Thao tác',
      render: (r) => (
        <div className="row" style={{ gap: 'var(--space-1)', flexWrap: 'nowrap' }}>
          {r.status === 'requested' && canApprove ? <Button size="sm" variant="tertiary" onClick={() => open({ k: 'approve', r })}>Duyệt</Button> : null}
          {r.status === 'requested' && canApprove ? <Button size="sm" variant="tertiary" onClick={() => { open({ k: 'reject', r }); }}>Từ chối</Button> : null}
          {r.status === 'approved' && canWrite ? <Button size="sm" onClick={() => { open({ k: 'pay', r }); setMethod(r.method || 'bank_transfer'); }}>Ghi nhận đã chi</Button> : null}
        </div>
      ),
    },
  ];
  const payCols: Column<Pay>[] = [
    { key: 'at', header: 'Thời điểm', value: (r) => r.at, sortable: true, render: (r) => formatDateTime(r.at, ctx?.tz ?? tz) },
    { key: 'child', header: 'Trẻ', value: (r) => r.childName, render: (r) => <strong>{r.childName}</strong> },
    { key: 'ch', header: 'Kênh', value: (r) => r.channel, render: (r) => `${CHANNEL_LABELS[r.channel] ?? r.channel}${r.reference ? ` · ${r.reference}` : ''}` },
    { key: 'amount', header: 'Số tiền', value: (r) => r.amount, align: 'right', render: (r) => <span style={moneyStyle}>{formatVnd(r.amount)}</span> },
    { key: 's', header: 'Trạng thái', value: (r) => r.status, render: (r) => <><PayBadge value={r.status} />{r.cancelRequest === 'pending' ? <Badge tone="warning">Đang chờ duyệt hủy</Badge> : null}</> },
    { key: 'a', header: 'Thao tác', render: (r) => canWrite && r.status === 'confirmed' && r.cancelRequest !== 'pending' ? <Button size="sm" variant="tertiary" onClick={() => open({ k: 'cancel', p: r })}>Hủy phiếu thu</Button> : null },
  ];

  const base = ctx ? { orgId: ctx.orgId, campusId: ctx.campusId } : null;
  return (
    <div>
      <PageHeader
        title="Hoàn tiền và điều chỉnh chứng từ"
        code="W35"
        description="Sai sót sau khi phát hành xử lý bằng chứng từ liên kết, không sửa số cũ. Duyệt hoàn tiền khác với đã chi trả."
        actions={
          <>
            {canWrite ? <Button icon="plus" onClick={() => open({ k: 'request' })}>Yêu cầu hoàn tiền</Button> : null}
            {canAdjust ? <Button variant="secondary" onClick={() => open({ k: 'adjust' })}>Điều chỉnh khoản phải thu</Button> : null}
          </>
        }
      />
      <div className="stack">
        <Tabs label="Loại chứng từ" active={tab} onChange={setTab} items={[{ id: 'refunds', label: 'Hoàn tiền' }, { id: 'receipts', label: 'Phiếu thu (hủy/đảo)' }]} />
        {tab === 'refunds' ? (
          <DataTable caption="Yêu cầu hoàn tiền" columns={refundCols} rows={refundRows} rowKey={(r) => r.id} status={refunds.status} error={refunds.error?.message} onRetry={refunds.retry}
            searchText={(r) => `${r.childName} ${r.reason}`} searchPlaceholder="Tìm theo trẻ hoặc lý do"
            filters={[{ key: 'st', label: 'Trạng thái', options: Object.entries(REFUND_STATUS).map(([value, s]) => ({ value, label: s.label })), predicate: (r, v) => r.status === v }]}
            emptyTitle="Chưa có yêu cầu hoàn tiền" emptyDescription="Hoàn tiền chỉ từ số dư có của phụ huynh. Tạo yêu cầu, chờ duyệt rồi ghi nhận khi đã chi." />
        ) : (
          <DataTable caption="Phiếu thu" columns={payCols} rows={receipts} rowKey={(r) => r.id} status={pays.status === 'ready' && receipts.length === 0 ? 'empty' : pays.status} error={pays.error?.message} onRetry={pays.retry}
            searchText={(r) => `${r.childName} ${r.reference}`} searchPlaceholder="Tìm theo trẻ hoặc mã tham chiếu"
            emptyTitle="Chưa có phiếu thu" emptyDescription="Phiếu thu đã ghi nhận xuất hiện ở đây; hủy phiếu tạo chứng từ đảo sau khi được duyệt." />
        )}
      </div>

      {dlg?.k === 'request' && base ? (
        <ActionDialog
          title="Yêu cầu hoàn tiền"
          subject={childId ? `Số dư có hiện tại: ${formatVnd(creditOf(childId))}` : 'Chọn trẻ'}
          impact={['Tạo yêu cầu hoàn tiền ở trạng thái Chờ duyệt; chưa chi tiền.', 'Số tiền hoàn không được vượt số dư có của phụ huynh.', 'Yêu cầu xuất hiện trong Trung tâm phê duyệt của người có quyền duyệt hoàn.']}
          confirmLabel="Gửi yêu cầu hoàn"
          success="Đã gửi yêu cầu hoàn tiền."
          validate={() => (!childId ? 'Chọn trẻ.' : !amount || amount <= 0 ? 'Nhập số tiền hoàn.' : amount > creditOf(childId) ? `Số dư có chỉ ${formatVnd(creditOf(childId))}. Điều chỉnh giảm khoản phải thu để tạo số dư trước.` : !text.trim() ? 'Nhập lý do.' : null)}
          run={(opId) => callApi('refund.request', { ...base, opId, payload: { childId, amount, reason: text.trim(), method } })}
          onClose={() => setDlg(null)}
        >
          <FormField name="child" label="Trẻ" required><Select name="child" value={childId} onValueChange={setChildId} placeholder="Chọn trẻ" options={childOptions} /></FormField>
          <FormField name="amount" label="Số tiền hoàn" required><MoneyInput name="amount" value={amount} onValueChange={setAmount} /></FormField>
          <FormField name="method" label="Hình thức chi"><Select name="method" value={method} onValueChange={setMethod} options={METHODS} /></FormField>
          <FormField name="reason" label="Lý do" required><Textarea name="reason" value={text} onValueChange={setText} /></FormField>
        </ActionDialog>
      ) : null}

      {dlg && (dlg.k === 'approve' || dlg.k === 'reject') && base ? (
        <ActionDialog
          title={dlg.k === 'approve' ? 'Duyệt hoàn tiền' : 'Từ chối hoàn tiền'}
          subject={`${dlg.r.childName} · ${formatVnd(dlg.r.amount)}`}
          impact={dlg.k === 'approve'
            ? ['Yêu cầu chuyển sang Đã duyệt. Duyệt KHÔNG đồng nghĩa đã chi; việc chi trả ghi nhận riêng.', `Số dư có hiện tại ${formatVnd(creditOf(dlg.r.childId))}.`, 'Người lập yêu cầu không được tự duyệt.']
            : ['Yêu cầu bị từ chối, số dư có của phụ huynh không đổi.']}
          confirmLabel={dlg.k === 'approve' ? 'Duyệt hoàn tiền' : 'Từ chối hoàn tiền'}
          tone={dlg.k === 'reject' ? 'destructive' : 'primary'}
          success={dlg.k === 'approve' ? 'Đã duyệt hoàn tiền (chưa chi).' : 'Đã từ chối hoàn tiền.'}
          validate={() => (dlg.k === 'reject' && !text.trim() ? 'Nhập lý do từ chối.' : null)}
          run={(opId) => callApi('refund.approve', { ...base, opId, payload: { id: dlg.r.id, decision: dlg.k === 'approve' ? 'approved' : 'rejected', note: text.trim() || undefined } })}
          onClose={() => setDlg(null)}
        >
          <FormField name="note" label={dlg.k === 'reject' ? 'Lý do từ chối' : 'Ý kiến'} required={dlg.k === 'reject'}><Textarea name="note" value={text} onValueChange={setText} /></FormField>
        </ActionDialog>
      ) : null}

      {dlg?.k === 'pay' && base ? (
        <ActionDialog
          title="Ghi nhận đã chi hoàn tiền"
          subject={`${dlg.r.childName} · ${formatVnd(dlg.r.amount)}`}
          impact={[`Ghi giao dịch tiền ra ${formatVnd(dlg.r.amount)} và trừ số dư có của phụ huynh.`, 'Chỉ ghi nhận sau khi đã thực sự chuyển tiền.', 'Khoản hoàn chuyển sang Đã chi trả, không hoàn tác.']}
          confirmLabel={`Ghi nhận đã chi ${formatVnd(dlg.r.amount)}`}
          success="Đã ghi nhận chi hoàn tiền."
          run={(opId) => callApi('refund.pay', { ...base, opId, payload: { id: dlg.r.id, method, reference: ref.trim() || undefined } })}
          onClose={() => setDlg(null)}
        >
          <FormField name="method" label="Hình thức chi"><Select name="method" value={method} onValueChange={setMethod} options={METHODS} /></FormField>
          <FormField name="ref" label="Mã giao dịch chi"><Input name="ref" value={ref} onValueChange={setRef} /></FormField>
        </ActionDialog>
      ) : null}

      {dlg?.k === 'cancel' && base ? (
        <ActionDialog
          title="Hủy phiếu thu"
          subject={`${dlg.p.childName} · ${formatVnd(dlg.p.amount)} · ${dlg.p.reference || CHANNEL_LABELS[dlg.p.channel]}`}
          impact={['Gửi yêu cầu hủy; chỉ có hiệu lực sau khi được duyệt.', 'Khi duyệt, tạo chứng từ đảo (phiếu gốc không bị xóa), công nợ tăng lại tương ứng và số dư có phát sinh từ phiếu bị thu hồi.', 'Không hủy được nếu số dư từ phiếu đã dùng hoặc hoàn.']}
          confirmLabel="Gửi yêu cầu hủy phiếu"
          tone="destructive"
          success="Đã gửi yêu cầu hủy phiếu thu."
          validate={() => (text.trim() ? null : 'Nhập lý do hủy.')}
          run={(opId) => callApi('payment.cancel', { ...base, opId, payload: { paymentId: dlg.p.id, reason: text.trim() } })}
          onClose={() => setDlg(null)}
        >
          <FormField name="reason" label="Lý do hủy" required><Textarea name="reason" value={text} onValueChange={setText} /></FormField>
        </ActionDialog>
      ) : null}

      {dlg?.k === 'adjust' && base ? (
        <ActionDialog
          title="Điều chỉnh khoản phải thu"
          subject={selRcv ? `${selRcv.childName} · ${periodLabel(selRcv.periodKey)} · còn nợ ${formatVnd(selRcv.balance)}` : 'Chọn trẻ và kỳ'}
          impact={['Tạo chứng từ điều chỉnh liên kết với khoản gốc ở trạng thái chờ duyệt; số cũ không bị sửa.', amount && selRcv ? `Sau khi duyệt, khoản ${sign === 'decrease' ? 'giảm' : 'tăng'} ${formatVnd(amount)}; còn nợ dự kiến ${formatVnd(Math.max(0, selRcv.balance + (sign === 'decrease' ? -amount : amount)))}.` : 'Nhập số tiền để xem số còn nợ dự kiến.', 'Giảm quá số đã thu sẽ tạo số dư có cho phụ huynh.']}
          confirmLabel="Gửi chứng từ điều chỉnh"
          success="Đã gửi chứng từ điều chỉnh chờ duyệt."
          validate={() => (!selRcv ? 'Chọn khoản phải thu.' : !amount || amount <= 0 ? 'Nhập số tiền điều chỉnh.' : !text.trim() ? 'Nhập lý do.' : null)}
          run={(opId) => callApi('receivable.adjust', { ...base, opId, payload: { receivableId: rcvId, amount: sign === 'decrease' ? -(amount ?? 0) : amount, reason: text.trim() } })}
          onClose={() => setDlg(null)}
        >
          <FormField name="child" label="Trẻ" required><Select name="child" value={childId} onValueChange={(v) => { setChildId(v); setRcvId(''); }} placeholder="Chọn trẻ" options={childOptions} /></FormField>
          <FormField name="rcv" label="Khoản phải thu" required>
            <Select name="rcv" value={rcvId} onValueChange={setRcvId} placeholder="Chọn kỳ" options={childRcv.map((r) => ({ value: r.id, label: `${periodLabel(r.periodKey)} · còn ${formatVnd(r.balance)}` }))} />
          </FormField>
          {selRcv ? <div className="text-small"><RcvBadge value={selRcv.status} /></div> : null}
          <FormField name="sign" label="Hướng điều chỉnh"><Select name="sign" value={sign} onValueChange={setSign} options={[{ value: 'decrease', label: 'Giảm khoản phải thu' }, { value: 'increase', label: 'Tăng khoản phải thu' }]} /></FormField>
          <FormField name="amount" label="Số tiền" required><MoneyInput name="amount" value={amount} onValueChange={setAmount} /></FormField>
          <FormField name="reason" label="Lý do" required><Textarea name="reason" value={text} onValueChange={setText} /></FormField>
          <Banner tone="info">Khoản chưa phát hành (nháp) không điều chỉnh được; hãy tính lại ở màn Kỳ thu.</Banner>
        </ActionDialog>
      ) : null}
    </div>
  );
}
