'use client';
import { useMemo, useState } from 'react';
import { callApi } from '@/lib/api';
import { useScope } from '@/providers/ScopeProvider';
import { formatDateTime, formatVnd, toDate } from '@/lib/format';
import { PageHeader, Stat } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { Modal } from '@/components/ui/Modal';
import { FormField, Select, Textarea } from '@/components/ui/Fields';
import { Tabs } from '@/components/ui/Tabs';
import type { ScreenProps } from '../registry';
import { ActionDialog, CHANNEL_LABELS, PayBadge, arr, num, obj, str, tsMs, useCampus, useChildOptions, useScopedQuery, moneyStyle } from './parts/common';
import { toPay, type Pay } from './parts/ledger';
import { csvToObjects, downloadText, readFileText, toCsv } from './parts/csv';

interface Bank { id: string; source: string; txnCode: string; amount: number; at: number; content: string; account: string; status: string; childId: string; paymentId: string }
interface ImportRow { source: string; txnCode: string; amount: number; at: string; content: string; account: string }
interface Parsed { line: number; row: ImportRow | null; error: string }

const BANK_STATUS: Record<string, { label: string; tone: 'warning' | 'success' | 'neutral' | 'info' }> = {
  unmatched: { label: 'Chưa ghép', tone: 'warning' },
  matched: { label: 'Đã ghép và ghi thu', tone: 'success' },
  ignored: { label: 'Đã bỏ qua', tone: 'neutral' },
  reversed: { label: 'Đã đảo', tone: 'neutral' },
};
const RESULT_LABEL: Record<string, string> = {
  imported_matched: 'Đã nhập và ghi thu', imported_unmatched: 'Đã nhập, chưa ghép', duplicate: 'Trùng, bỏ qua', error: 'Lỗi', ignored: 'Không phải tiền vào',
};
const TEMPLATE_HEADERS = ['source', 'txnCode', 'amount', 'at', 'content', 'account'];

function toIsoAt(text: string): string | null {
  const t = text.trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?$/.exec(t);
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}T${m[4] ?? '00'}:${m[5] ?? '00'}:00+07:00` : /^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T00:00:00+07:00` : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(t) ? (/[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? t.replace(' ', 'T') : `${t.replace(' ', 'T')}${t.length === 16 ? ':00' : ''}+07:00`) : null;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseImport(text: string): { parsed: Parsed[]; missing: string[] } {
  const { headers, rows } = csvToObjects(text);
  const missing = TEMPLATE_HEADERS.filter((h) => h !== 'account' && h !== 'content' && !headers.includes(h));
  const parsed = rows.map<Parsed>((r, i) => {
    const line = i + 2;
    const amount = Number(r.amount?.replace(/[.,\s]/g, ''));
    const at = toIsoAt(r.at ?? '');
    if (!r.source) return { line, row: null, error: 'Thiếu nguồn giao dịch.' };
    if (!r.txnCode) return { line, row: null, error: 'Thiếu mã giao dịch.' };
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(`${r.source}_${r.txnCode}`.replace(/_/g, '-'))) return { line, row: null, error: 'Nguồn và mã giao dịch chỉ gồm chữ, số, gạch.' };
    if (!Number.isSafeInteger(amount) || amount <= 0) return { line, row: null, error: 'Số tiền phải là số nguyên đồng lớn hơn 0.' };
    if (!at) return { line, row: null, error: 'Thời điểm không hợp lệ (dd/MM/yyyy HH:mm hoặc yyyy-MM-dd HH:mm).' };
    return { line, row: { source: r.source, txnCode: r.txnCode, amount, at, content: r.content ?? '', account: r.account ?? '' }, error: '' };
  });
  return { parsed, missing };
}

/** W34 — Đối soát giao dịch ngân hàng: nhập giao dịch, ghép, xác nhận biên nhận. */
export function W34Reconcile(_props: ScreenProps) {
  void _props;
  const ctx = useCampus();
  const { tz } = useScope();
  const bankQ = useScopedQuery<Bank>('bankTransactions', 'payments.reconcile', (id, d) => ({
    id, source: str(d.source), txnCode: str(d.txnCode), amount: num(d.amount), at: tsMs(d.at), content: str(d.content), account: str(d.account), status: str(d.status), childId: str(d.childId), paymentId: str(d.paymentId),
  }));
  const payQ = useScopedQuery<Pay>('payments', ['payments.reconcile', 'payments.read'], toPay);
  const { options: childOptions, names } = useChildOptions();
  const [tab, setTab] = useState<'bank' | 'proof'>('bank');
  const [importOpen, setImportOpen] = useState(false);
  const [assign, setAssign] = useState<Bank | null>(null);
  const [ignore, setIgnore] = useState<Bank | null>(null);
  const [proofConfirm, setProofConfirm] = useState<Pay | null>(null);
  const [proofReject, setProofReject] = useState<Pay | null>(null);
  const [bankPick, setBankPick] = useState('');
  const [childPick, setChildPick] = useState('');
  const [note, setNote] = useState('');
  const [report, setReport] = useState<{ results: { index: number; key: string; result: string; message: string }[]; counts: Record<string, number> } | null>(null);

  const banks = useMemo(() => [...bankQ.data].sort((a, b) => b.at - a.at), [bankQ.data]);
  const proofs = useMemo(() => payQ.data.filter((p) => p.type === 'proof' && p.status === 'pending_reconciliation').sort((a, b) => b.at - a.at), [payQ.data]);
  const unmatched = banks.filter((b) => b.status === 'unmatched');

  const bankCols: Column<Bank>[] = [
    { key: 'at', header: 'Thời điểm', value: (r) => r.at, sortable: true, render: (r) => formatDateTime(r.at, ctx?.tz ?? tz) },
    { key: 'src', header: 'Nguồn · mã giao dịch', value: (r) => `${r.source} ${r.txnCode}`, render: (r) => `${r.source} · ${r.txnCode}` },
    { key: 'amount', header: 'Số tiền', value: (r) => r.amount, sortable: true, align: 'right', total: 'sum', formatTotal: (n) => <span style={moneyStyle}>{formatVnd(n)}</span>, render: (r) => <span style={moneyStyle}>{formatVnd(r.amount)}</span> },
    { key: 'content', header: 'Nội dung chuyển khoản', value: (r) => r.content, render: (r) => r.content || '—' },
    { key: 'child', header: 'Trẻ đã ghép', value: (r) => names.get(r.childId) ?? r.childId, render: (r) => (r.childId ? names.get(r.childId) ?? r.childId : '—') },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, sortable: true, render: (r) => { const s = BANK_STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const }; return <Badge tone={s.tone}>{s.label}</Badge>; } },
    {
      key: 'actions', header: 'Thao tác',
      render: (r) => r.status === 'unmatched' ? (
        <div className="row" style={{ gap: 'var(--space-1)', flexWrap: 'nowrap' }}>
          <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setChildPick(''); setAssign(r); }}>Ghép với trẻ</Button>
          <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setNote(''); setIgnore(r); }}>Bỏ qua</Button>
        </div>
      ) : null,
    },
  ];
  const proofCols: Column<Pay>[] = [
    { key: 'at', header: 'Gửi lúc', value: (r) => r.at, sortable: true, render: (r) => formatDateTime(r.at, ctx?.tz ?? tz) },
    { key: 'child', header: 'Trẻ', value: (r) => r.childName, render: (r) => <strong>{r.childName}</strong> },
    { key: 'amount', header: 'Số tiền ghi trên biên nhận', value: (r) => r.amount, align: 'right', render: (r) => <span style={moneyStyle}>{formatVnd(r.amount)}</span> },
    { key: 'note', header: 'Ghi chú phụ huynh', value: (r) => r.note, render: (r) => r.note || '—' },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, render: (r) => <PayBadge value={r.status} /> },
    {
      key: 'actions', header: 'Thao tác',
      render: (r) => (
        <div className="row" style={{ gap: 'var(--space-1)', flexWrap: 'nowrap' }}>
          <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setBankPick(''); setProofConfirm(r); }}>Xác nhận</Button>
          <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setNote(''); setProofReject(r); }}>Từ chối</Button>
        </div>
      ),
    },
  ];

  const matchingBanks = proofConfirm ? unmatched.filter((b) => b.amount === proofConfirm.amount) : [];

  return (
    <div>
      <PageHeader
        title="Đối soát giao dịch ngân hàng"
        code="W34"
        description="Giao dịch cùng nguồn và mã chỉ ghi thu một lần. Ảnh biên nhận của phụ huynh chỉ là bằng chứng chờ đối soát, chưa phải đã thanh toán."
        actions={ctx ? <Button icon="plus" onClick={() => setImportOpen(true)}>Nhập giao dịch ngân hàng</Button> : undefined}
      />
      <div className="stack">
        <div className="grid-3">
          <Stat label="Giao dịch chưa ghép" value={unmatched.length} tone={unmatched.length ? 'warning' : undefined} hint={formatVnd(unmatched.reduce((s, b) => s + b.amount, 0))} />
          <Stat label="Biên nhận chờ đối soát" value={proofs.length} tone={proofs.length ? 'warning' : undefined} hint={`${formatVnd(proofs.reduce((s, p) => s + p.amount, 0))} chưa được ghi thu`} />
          <Stat label="Đã ghép" value={banks.filter((b) => b.status === 'matched').length} />
        </div>
        <Tabs label="Nguồn đối soát" active={tab} onChange={(t) => setTab(t as 'bank' | 'proof')} items={[{ id: 'bank', label: 'Giao dịch ngân hàng' }, { id: 'proof', label: `Biên nhận chờ đối soát (${proofs.length})` }]} />
        {tab === 'bank' ? (
          <DataTable
            caption="Giao dịch ngân hàng"
            columns={bankCols}
            rows={banks}
            rowKey={(r) => r.id}
            status={bankQ.status}
            error={bankQ.error?.message}
            onRetry={bankQ.retry}
            searchText={(r) => `${r.source} ${r.txnCode} ${r.content}`}
            searchPlaceholder="Tìm theo nguồn, mã hoặc nội dung"
            filters={[{ key: 'status', label: 'Trạng thái', options: Object.entries(BANK_STATUS).map(([value, s]) => ({ value, label: s.label })), predicate: (r, v) => r.status === v }]}
            emptyTitle="Chưa có giao dịch ngân hàng"
            emptyDescription="Nhập file sao kê (CSV) để đối soát với khoản phải thu."
            emptyAction={ctx ? <Button icon="plus" onClick={() => setImportOpen(true)}>Nhập giao dịch ngân hàng</Button> : undefined}
          />
        ) : (
          <DataTable
            caption="Biên nhận chờ đối soát"
            columns={proofCols}
            rows={proofs}
            rowKey={(r) => r.id}
            status={payQ.status === 'ready' && proofs.length === 0 ? 'empty' : payQ.status}
            error={payQ.error?.message}
            onRetry={payQ.retry}
            searchText={(r) => `${r.childName} ${r.note}`}
            emptyTitle="Không có biên nhận chờ đối soát"
            emptyDescription="Khi phụ huynh gửi ảnh chuyển khoản trên ứng dụng, biên nhận xuất hiện ở đây để kế toán đối chiếu với sao kê."
          />
        )}
      </div>

      {importOpen && ctx ? <ImportDrawer onClose={() => setImportOpen(false)} onDone={setReport} /> : null}

      {assign && ctx ? (
        <ActionDialog
          title="Ghép giao dịch ngân hàng với trẻ"
          subject={`${assign.source} · ${assign.txnCode} · ${formatVnd(assign.amount)}`}
          impact={[
            `Ghi thu ${formatVnd(assign.amount)} cho trẻ đã chọn, phân bổ vào nợ cũ trước, phần dư thành số dư có.`,
            'Giao dịch ngân hàng chuyển sang Đã ghép; không thể ghi thu lần hai cho cùng nguồn và mã.',
            'Trẻ phải cùng cơ sở với giao dịch.',
          ]}
          confirmLabel={`Ghép và ghi thu ${formatVnd(assign.amount)}`}
          success="Đã ghép giao dịch và ghi thu."
          validate={() => (childPick ? null : 'Chọn trẻ cần ghép.')}
          run={(opId) => callApi('payment.reconcile', { orgId: ctx.orgId, campusId: ctx.campusId, opId, payload: { bankTxnId: assign.id, childId: childPick, decision: 'confirm' } })}
          onClose={() => setAssign(null)}
        >
          <FormField name="childPick" label="Trẻ" required><Select name="childPick" value={childPick} onValueChange={setChildPick} placeholder="Chọn trẻ" options={childOptions} /></FormField>
          {assign.content ? <p className="text-small text-secondary">Nội dung chuyển khoản: {assign.content}</p> : null}
        </ActionDialog>
      ) : null}

      {ignore && ctx ? (
        <ActionDialog
          title="Bỏ qua giao dịch ngân hàng"
          subject={`${ignore.source} · ${ignore.txnCode} · ${formatVnd(ignore.amount)}`}
          impact={['Giao dịch được đánh dấu bỏ qua, không ghi thu và không ghép với trẻ nào.', 'Lý do được lưu vào nhật ký thao tác.']}
          confirmLabel="Bỏ qua giao dịch"
          success="Đã bỏ qua giao dịch."
          validate={() => (note.trim() ? null : 'Nhập lý do bỏ qua.')}
          run={(opId) => callApi('payment.reconcile', { orgId: ctx.orgId, campusId: ctx.campusId, opId, payload: { bankTxnId: ignore.id, decision: 'reject', note: note.trim() } })}
          onClose={() => setIgnore(null)}
        >
          <FormField name="note" label="Lý do" required><Textarea name="note" value={note} onValueChange={setNote} /></FormField>
        </ActionDialog>
      ) : null}

      {proofConfirm && ctx ? (
        <ActionDialog
          title="Xác nhận biên nhận đã nhận được tiền"
          subject={`${proofConfirm.childName} · ${formatVnd(proofConfirm.amount)}`}
          impact={[
            `Sau khi xác nhận, ghi thu ${formatVnd(proofConfirm.amount)}; phân bổ vào nợ cũ trước, phần dư thành số dư có.`,
            'Chỉ xác nhận khi đã đối chiếu tiền đã về tài khoản. Biên nhận trước đó chưa phải đã thanh toán.',
            matchingBanks.length ? 'Giao dịch ngân hàng được chọn bên dưới sẽ chuyển sang Đã ghép.' : 'Không có giao dịch ngân hàng chưa ghép cùng số tiền; vẫn có thể xác nhận thủ công nếu đã kiểm tra.',
          ]}
          confirmLabel={`Xác nhận ${formatVnd(proofConfirm.amount)}`}
          success="Đã xác nhận biên nhận và ghi thu."
          run={(opId) => callApi('payment.reconcile', { orgId: ctx.orgId, campusId: ctx.campusId, opId, payload: { paymentId: proofConfirm.id, bankTxnId: bankPick || undefined, decision: 'confirm' } })}
          onClose={() => setProofConfirm(null)}
        >
          <FormField name="bankPick" label="Giao dịch ngân hàng tương ứng" helper="Chỉ liệt kê giao dịch chưa ghép cùng số tiền.">
            <Select name="bankPick" value={bankPick} onValueChange={setBankPick} placeholder="Không chọn (xác nhận thủ công)" options={matchingBanks.map((b) => ({ value: b.id, label: `${b.source} · ${b.txnCode} · ${formatDateTime(b.at, ctx.tz)}` }))} />
          </FormField>
        </ActionDialog>
      ) : null}

      {proofReject && ctx ? (
        <ActionDialog
          title="Từ chối biên nhận"
          subject={`${proofReject.childName} · ${formatVnd(proofReject.amount)}`}
          impact={['Biên nhận bị từ chối, không ghi thu và công nợ không đổi.', 'Lý do được lưu vào nhật ký thao tác.']}
          confirmLabel="Từ chối biên nhận"
          tone="destructive"
          success="Đã từ chối biên nhận."
          validate={() => (note.trim() ? null : 'Nhập lý do từ chối.')}
          run={(opId) => callApi('payment.reconcile', { orgId: ctx.orgId, campusId: ctx.campusId, opId, payload: { paymentId: proofReject.id, decision: 'reject', note: note.trim() } })}
          onClose={() => setProofReject(null)}
        >
          <FormField name="note" label="Lý do" required><Textarea name="note" value={note} onValueChange={setNote} /></FormField>
        </ActionDialog>
      ) : null}

      {report ? (
        <Modal open title="Kết quả nhập giao dịch" size="lg" onClose={() => setReport(null)} footer={<Button onClick={() => setReport(null)}>Đóng</Button>}>
          <div className="stack">
            <Banner tone={report.counts.error ? 'warning' : 'success'}>
              {report.counts.imported_matched ?? 0} đã ghi thu, {report.counts.imported_unmatched ?? 0} chờ ghép, {report.counts.duplicate ?? 0} trùng bỏ qua, {report.counts.ignored ?? 0} không phải tiền vào, {report.counts.error ?? 0} lỗi.
            </Banner>
            <DataTable
              caption="Kết quả từng dòng"
              columns={[
                { key: 'i', header: 'Dòng', value: (r: { index: number }) => r.index + 2, width: 70 },
                { key: 'k', header: 'Khóa giao dịch', value: (r: { key: string }) => r.key },
                { key: 'r', header: 'Kết quả', value: (r: { result: string }) => r.result, render: (r: { result: string }) => <Badge tone={r.result === 'error' ? 'error' : r.result === 'duplicate' || r.result === 'ignored' ? 'warning' : r.result === 'imported_matched' ? 'success' : 'info'}>{RESULT_LABEL[r.result] ?? r.result}</Badge> },
                { key: 'm', header: 'Ghi chú', value: (r: { message: string }) => r.message },
              ]}
              rows={report.results}
              rowKey={(r) => String(r.index)}
              status={report.results.length ? 'ready' : 'empty'}
              pageSize={20}
              emptyTitle="Không có kết quả"
            />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function ImportDrawer({ onClose, onDone }: { onClose: () => void; onDone: (r: { results: { index: number; key: string; result: string; message: string }[]; counts: Record<string, number> }) => void }) {
  const ctx = useCampus()!;
  const [text, setText] = useState('');
  const [fileError, setFileError] = useState('');
  const [autoMatch, setAutoMatch] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const { parsed, missing } = useMemo(() => (text.trim() ? parseImport(text) : { parsed: [], missing: [] as string[] }), [text]);
  const valid = parsed.filter((p) => p.row).map((p) => p.row as ImportRow);
  const bad = parsed.filter((p) => !p.row);
  const dupKeys = new Set<string>();
  const dupCount = valid.filter((r) => { const k = `${r.source}_${r.txnCode}`; if (dupKeys.has(k)) return true; dupKeys.add(k); return false; }).length;
  const canSend = valid.length > 0 && missing.length === 0;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      setText(await readFileText(f));
      setFileError('');
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Không đọc được tệp.');
    }
  };

  return (
    <>
      <Drawer
        open={!confirm}
        title="Nhập giao dịch ngân hàng"
        onClose={onClose}
        footer={<><Button variant="secondary" onClick={onClose}>Đóng</Button><Button disabled={!canSend} onClick={() => setConfirm(true)}>Xem tác động và nhập {valid.length} dòng</Button></>}
      >
        <div className="stack">
          <p className="text-small text-secondary">Cột bắt buộc: source (nguồn), txnCode (mã giao dịch), amount (số tiền), at (thời điểm). Cột không bắt buộc: content, account. Thời điểm tính theo giờ Việt Nam (+07:00). Tối đa 1000 dòng.</p>
          <div className="row">
            <Button size="sm" variant="secondary" onClick={() => downloadText('mau-giao-dich-ngan-hang.csv', toCsv(TEMPLATE_HEADERS, []))}>Tải mẫu CSV</Button>
            <input type="file" accept=".csv,text/csv" aria-label="Chọn tệp CSV sao kê" onChange={(e) => void onFile(e.target.files?.[0])} />
          </div>
          {fileError ? <Banner tone="error">{fileError}</Banner> : null}
          <FormField name="csv" label="Hoặc dán nội dung CSV"><Textarea name="csv" value={text} onValueChange={setText} rows={6} /></FormField>
          <label className="check"><input type="checkbox" checked={autoMatch} onChange={(e) => setAutoMatch(e.target.checked)} /><span>Tự ghép khi nội dung chứa đúng một mã trẻ</span></label>
          {missing.length ? <Banner tone="error" title="Thiếu cột bắt buộc">{missing.join(', ')}</Banner> : null}
          {parsed.length ? (
            <Banner tone={bad.length ? 'warning' : 'info'} title={`${valid.length} dòng hợp lệ, ${bad.length} dòng lỗi`}>
              {bad.length ? <ul style={{ margin: 0, paddingLeft: 20 }}>{bad.slice(0, 10).map((b) => <li key={b.line}>Dòng {b.line}: {b.error}</li>)}</ul> : 'Dòng lỗi sẽ không được gửi lên.'}
              {dupCount ? <p>{dupCount} dòng trùng nguồn và mã trong file; máy chủ chỉ ghi dòng đầu.</p> : null}
            </Banner>
          ) : null}
          {valid.length ? (
            <table className="dt">
              <caption className="sr-only">Xem trước các dòng sẽ nhập</caption>
              <thead><tr><th scope="col">Nguồn</th><th scope="col">Mã giao dịch</th><th scope="col">Thời điểm</th><th scope="col" className="num">Số tiền</th></tr></thead>
              <tbody>{valid.slice(0, 8).map((r) => <tr key={`${r.source}${r.txnCode}`}><td>{r.source}</td><td>{r.txnCode}</td><td>{formatDateTime(toDate(r.at), ctx.tz)}</td><td className="num" style={moneyStyle}>{formatVnd(r.amount)}</td></tr>)}</tbody>
            </table>
          ) : null}
        </div>
      </Drawer>
      {confirm ? (
        <ActionDialog
          title={`Nhập ${valid.length} giao dịch ngân hàng`}
          subject={`Tổng ${formatVnd(valid.reduce((s, r) => s + r.amount, 0))}`}
          impact={[
            `Lưu ${valid.length} giao dịch; giao dịch trùng nguồn và mã với dữ liệu đã có sẽ bị bỏ qua, không ghi thu lần hai.`,
            autoMatch ? 'Giao dịch có nội dung chứa đúng một mã trẻ được tự ghép và ghi thu (nợ cũ trước, dư thành số dư có).' : 'Không tự ghép; mọi giao dịch ở trạng thái Chưa ghép để đối soát thủ công.',
            `${bad.length} dòng lỗi không được gửi.`,
          ]}
          confirmLabel="Nhập giao dịch"
          success="Đã nhập giao dịch ngân hàng."
          run={(opId) => callApi('bank.import', { orgId: ctx.orgId, campusId: ctx.campusId, opId, payload: { campusId: ctx.campusId, rows: valid, autoMatch } })}
          onClose={() => setConfirm(false)}
          onDone={(res) => {
            const r = obj(res);
            const results = arr(r.results).map((x) => ({ index: num(x.index), key: str(x.key), result: str(x.result), message: str(x.message) }));
            const counts: Record<string, number> = {};
            for (const x of results) counts[x.result] = (counts[x.result] ?? 0) + 1;
            onDone({ results, counts });
            onClose();
          }}
        />
      ) : null}
    </>
  );
}

void CHANNEL_LABELS;
