'use client';
import { Suspense, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { callApi, newOpId } from '@/lib/api';
import { useForm } from '@/lib/hooks/useForm';
import { buildPath } from '@/lib/screens';
import { formatDate, formatVnd } from '@/lib/format';
import { PageHeader, Stat } from '@/components/ui/Misc';
import { Button, LinkButton } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { FormField, Input, MoneyInput, Select, Textarea } from '@/components/ui/Fields';
import { Skeleton } from '@/components/ui/Misc';
import type { ScreenProps } from '../registry';
import { ActionDialog, CHANNEL_LABELS, RcvBadge, arr, num, obj, periodLabel, str, useCampus, useScopedQuery, moneyStyle } from './parts/common';
import { isOpen, previewAllocation, toPay, toRcv, type Alloc, type Pay, type Rcv } from './parts/ledger';

interface Result { paymentId: string; allocations: Alloc[]; allocated: number; credit: number; debtBefore: number; debtAfter: number; amount: number; childId: string }

function Inner() {
  const ctx = useCampus();
  const params = useSearchParams();
  const initialChild = params.get('childId') ?? '';
  const rcvQ = useScopedQuery<Rcv>('receivables', 'payments.read', toRcv);
  const payQ = useScopedQuery<Pay>('payments', 'payments.read', toPay);
  const kids = useScopedQuery('children', 'children.read', (id, d) => ({ id, name: str(d.fullName, id), code: str(d.code), status: str(d.status) }));
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [manual, setManual] = useState<Record<string, number | null>>({});
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const op = useRef<{ sig: string; id: string }>({ sig: '', id: newOpId() });

  const form = useForm({
    initial: { childId: initialChild, channel: 'cash', amount: null as number | null, reference: '', source: '', note: '' },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.childId) e.childId = 'Chọn trẻ cần thu tiền.';
      if (v.amount === null || v.amount <= 0) e.amount = 'Nhập số tiền lớn hơn 0.';
      if (v.channel !== 'cash' && !v.reference.trim()) e.reference = 'Chuyển khoản hoặc cổng thanh toán cần mã giao dịch tham chiếu.';
      if (v.reference.trim() && !/^[A-Za-z0-9_-]{1,100}$/.test(v.reference.trim())) e.reference = 'Mã giao dịch chỉ gồm chữ, số, gạch dưới và gạch ngang.';
      if (v.source.trim() && !/^[A-Za-z0-9_-]{1,40}$/.test(v.source.trim())) e.source = 'Nguồn chỉ gồm chữ, số, gạch dưới và gạch ngang.';
      return e;
    },
  });
  const v = form.values;

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of kids.data) if (['active', 'trial'].includes(c.status)) m.set(c.id, c.code ? `${c.name} (${c.code})` : c.name);
    for (const r of rcvQ.data) if (!m.has(r.childId)) m.set(r.childId, r.childName);
    return m;
  }, [kids.data, rcvQ.data]);
  const childOptions = useMemo(() => [...names.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'vi')), [names]);

  const open = useMemo(() => rcvQ.data.filter((r) => r.childId === v.childId && isOpen(r)).sort((a, b) => a.periodKey.localeCompare(b.periodKey)), [rcvQ.data, v.childId]);
  const debt = open.reduce((s, r) => s + r.balance, 0);
  const pendingProofs = payQ.data.filter((p) => p.childId === v.childId && p.type === 'proof' && p.status === 'pending_reconciliation');
  const manualList: Alloc[] = mode === 'manual' ? Object.entries(manual).filter(([, a]) => a && a > 0).map(([receivableId, amount]) => ({ receivableId, amount: amount ?? 0 })) : [];
  const plan = v.amount && v.amount > 0 ? previewAllocation(v.amount, open.map((r) => ({ id: r.id, periodKey: r.periodKey, dueDate: r.dueDate, balance: r.balance })), manualList) : null;
  const planOk = plan && plan.ok ? plan : null;
  const planned = new Map((planOk?.allocations ?? []).map((a) => [a.receivableId, a.amount]));

  const payload = () => ({
    childId: v.childId, amount: v.amount, channel: v.channel, reference: v.reference.trim() || undefined, source: v.source.trim() || undefined,
    note: v.note.trim() || undefined, allocations: mode === 'manual' && manualList.length ? manualList : undefined,
  });
  const opId = () => {
    const sig = JSON.stringify(payload());
    if (op.current.sig !== sig) op.current = { sig, id: newOpId() };
    return op.current.id;
  };

  const submit = form.onSubmit(async () => {
    if (plan && !plan.ok) {
      form.setFormError(plan.message);
      return;
    }
    setConfirm(true);
  });

  const reset = () => {
    form.reset({ childId: '', channel: 'cash', amount: null, reference: '', source: '', note: '' });
    setManual({});
    setMode('auto');
    op.current = { sig: '', id: newOpId() };
  };

  if (!ctx) return null;
  const name = names.get(v.childId) ?? '';

  return (
    <div>
      <PageHeader title="Thu tiền và phân bổ" code="W33" description="Ghi nhận tiền thực nhận. Phân bổ vào nợ cũ trước; có thể đóng một phần; phần dư thành số dư có." />
      {result ? (
        <div className="stack">
          <Banner tone="success" title="Đã ghi nhận thu tiền">Máy chủ đã ghi phiếu thu {result.paymentId}.</Banner>
          <div className="grid-4">
            <Stat label="Số tiền thu" value={formatVnd(result.amount)} />
            <Stat label="Đã phân bổ" value={formatVnd(result.allocated)} />
            <Stat label="Thành số dư có" value={formatVnd(result.credit)} />
            <Stat label="Công nợ còn lại" value={formatVnd(result.debtAfter)} hint={`Trước khi thu: ${formatVnd(result.debtBefore)}`} />
          </div>
          <Card title="Phân bổ theo khoản">
            <table className="dt">
              <caption className="sr-only">Phân bổ của phiếu thu</caption>
              <thead><tr><th scope="col">Khoản</th><th scope="col" className="num">Đã phân bổ</th></tr></thead>
              <tbody>{result.allocations.map((a) => { const r = rcvQ.data.find((x) => x.id === a.receivableId); return <tr key={a.receivableId}><td>{r ? periodLabel(r.periodKey) : a.receivableId}</td><td className="num" style={moneyStyle}>{formatVnd(a.amount)}</td></tr>; })}</tbody>
            </table>
          </Card>
          <div className="row">
            <LinkButton href={buildPath('/thu-tien/cong-no/:childId', { childId: result.childId })} variant="secondary">Xem khoản thu của trẻ</LinkButton>
            <Button onClick={() => { setResult(null); reset(); }}>Ghi nhận khoản thu khác</Button>
          </div>
        </div>
      ) : (
        <form className="stack" noValidate onSubmit={submit}>
          {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
          <Card title="Thông tin khoản thu">
            <div className="stack">
              <div className="grid-2">
                <FormField name="childId" label="Trẻ" required {...form.field('childId')}>
                  {rcvQ.status === 'loading' ? <Skeleton height={44} /> : <Select {...form.bind('childId')} placeholder="Chọn trẻ" options={childOptions} />}
                </FormField>
                <FormField name="channel" label="Hình thức thu" required {...form.field('channel')}>
                  <Select {...form.bind('channel')} options={Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label }))} />
                </FormField>
              </div>
              <div className="grid-2">
                <FormField name="amount" label="Số tiền thực nhận" required {...form.field('amount')}><MoneyInput {...form.bind('amount')} /></FormField>
                {v.channel !== 'cash' ? (
                  <FormField name="reference" label="Mã giao dịch" required helper="Cùng nguồn và mã giao dịch chỉ được ghi thu một lần." {...form.field('reference')}><Input {...form.bind('reference')} autoComplete="off" /></FormField>
                ) : <div />}
              </div>
              {v.channel !== 'cash' ? <FormField name="source" label="Nguồn giao dịch" helper="Ví dụ tên ngân hàng hoặc cổng. Để trống = theo hình thức thu." {...form.field('source')}><Input {...form.bind('source')} autoComplete="off" /></FormField> : null}
              <FormField name="note" label="Ghi chú" {...form.field('note')}><Textarea {...form.bind('note')} /></FormField>
            </div>
          </Card>

          {v.childId ? (
            <Card title={`Công nợ của ${name || 'trẻ'}`}>
              <div className="stack">
                {pendingProofs.length ? (
                  <Banner tone="warning" title="Có biên nhận đang chờ đối soát">
                    {pendingProofs.length} biên nhận ({formatVnd(pendingProofs.reduce((s, p) => s + p.amount, 0))}) của phụ huynh chỉ là bằng chứng chờ kiểm tra, chưa được ghi thu. Xử lý ở màn Đối soát ngân hàng để tránh thu hai lần.
                  </Banner>
                ) : null}
                {open.length === 0 ? <p className="text-secondary">Trẻ không còn khoản nợ đã phát hành. Số tiền nhận sẽ thành số dư có.</p> : (
                  <>
                    <div className="row">
                      <Select name="mode" value={mode} onValueChange={(m) => setMode(m as 'auto' | 'manual')} options={[{ value: 'auto', label: 'Tự phân bổ: nợ cũ trước' }, { value: 'manual', label: 'Tự chọn phân bổ từng khoản' }]} />
                      <span className="text-small text-secondary">Tổng nợ hiện tại: <strong style={moneyStyle}>{formatVnd(debt)}</strong></span>
                    </div>
                    <table className="dt">
                      <caption className="sr-only">Các khoản còn nợ và phân bổ dự kiến</caption>
                      <thead><tr><th scope="col">Kỳ</th><th scope="col">Hạn đóng</th><th scope="col">Tình trạng</th><th scope="col" className="num">Còn nợ</th>{mode === 'manual' ? <th scope="col">Phân bổ thủ công</th> : null}<th scope="col" className="num">Phân bổ dự kiến</th><th scope="col" className="num">Còn lại sau thu</th></tr></thead>
                      <tbody>
                        {open.map((r) => (
                          <tr key={r.id}>
                            <td>{periodLabel(r.periodKey)}</td><td>{formatDate(r.dueDate)}</td><td><RcvBadge value={r.status} /></td>
                            <td className="num" style={moneyStyle}>{formatVnd(r.balance)}</td>
                            {mode === 'manual' ? <td style={{ minWidth: 160 }}><MoneyInput name={`m-${r.id}`} value={manual[r.id] ?? null} onValueChange={(a) => setManual((m) => ({ ...m, [r.id]: a }))} /></td> : null}
                            <td className="num" style={moneyStyle}>{formatVnd(planned.get(r.id) ?? 0)}</td>
                            <td className="num" style={moneyStyle}>{formatVnd(r.balance - (planned.get(r.id) ?? 0))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
                {plan && !plan.ok ? <Banner tone="error">{plan.message}</Banner> : null}
                {planOk ? (
                  <div className="grid-3">
                    <Stat label="Phân bổ vào công nợ" value={formatVnd(planOk.allocated)} />
                    <Stat label="Thành số dư có" value={formatVnd(planOk.credit)} hint={planOk.credit ? 'Phần dư giữ làm số dư có của phụ huynh' : undefined} />
                    <Stat label="Công nợ sau khi thu" value={formatVnd(debt - planOk.allocated)} hint={planOk.allocated < debt && planOk.allocated > 0 ? 'Đóng một phần' : undefined} />
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}
          <div className="row"><Button type="submit" loading={form.submitting}>Xem tác động và ghi nhận thu</Button></div>
        </form>
      )}

      {confirm && planOk ? (
        <ActionDialog
          title={`Ghi nhận thu ${formatVnd(v.amount)}`}
          subject={`${name} · ${CHANNEL_LABELS[v.channel]}${v.reference ? ` · mã ${v.reference.trim()}` : ''}`}
          impact={[
            `Ghi phiếu thu ${formatVnd(v.amount)}; công nợ giảm từ ${formatVnd(debt)} còn ${formatVnd(debt - planOk.allocated)}.`,
            ...planOk.allocations.map((a) => { const r = open.find((x) => x.id === a.receivableId); return `Phân bổ ${formatVnd(a.amount)} vào ${r ? periodLabel(r.periodKey) : 'khoản phải thu'}${r && r.balance - a.amount > 0 ? ' (đóng một phần)' : ''}.`; }),
            planOk.credit > 0 ? `Phần dư ${formatVnd(planOk.credit)} thành số dư có của phụ huynh.` : 'Không phát sinh số dư có.',
            v.channel !== 'cash' ? 'Cùng nguồn và mã giao dịch không thể ghi thu lần hai.' : 'Phiếu thu không xóa được; sai sót xử lý bằng hủy phiếu (chứng từ đảo).',
          ]}
          confirmLabel={`Ghi nhận thu ${formatVnd(v.amount)}`}
          success="Đã ghi nhận thu tiền."
          run={() => callApi('payment.record', { orgId: ctx.orgId, campusId: ctx.campusId, opId: opId(), payload: payload() })}
          onClose={() => setConfirm(false)}
          onDone={(res) => {
            const r = obj(res);
            setResult({
              paymentId: str(r.paymentId), amount: num(r.amount), allocated: num(r.allocatedAmount), credit: num(r.credit), debtBefore: num(r.debtBefore), debtAfter: num(r.debtAfter),
              allocations: arr(r.allocations).map((a) => ({ receivableId: str(a.receivableId), amount: num(a.amount) })), childId: v.childId,
            });
            reset();
          }}
        />
      ) : null}
    </div>
  );
}

/** W33 — Thu tiền và phân bổ. opId ổn định theo nội dung phiếu: bấm lại sau lỗi không thu hai lần. */
export function W33CollectPayment(_props: ScreenProps) {
  void _props;
  return <Suspense fallback={<Skeleton height={240} />}><Inner /></Suspense>;
}
