'use client';
import { useMemo, useState } from 'react';
import type { DocumentData } from 'firebase/firestore';
import { callApi } from '@/lib/api';
import { useAsyncAction } from '@/lib/hooks/useAsyncAction';
import { useScope } from '@/providers/ScopeProvider';
import { formatDateTime, formatVnd } from '@/lib/format';
import { PageHeader, Stat, Stepper } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { Modal } from '@/components/ui/Modal';
import { Checkbox, FormField, Input, Select, Textarea } from '@/components/ui/Fields';
import type { ScreenProps } from '../registry';
import { ActionDialog, KV, RunBadge, arr, currentPeriod, num, periodLabel, periodOptions, str, tsMs, useCampus, useScopedQuery, moneyStyle } from './parts/common';
import type { BillLine } from './parts/ledger';

interface PreviewRow {
  childId: string; name: string; lines: BillLine[]; billed: number; discount: number; net: number; openingDebt: number;
  openingBreakdown: { receivableId: string; periodKey: string; balance: number }[]; totalDue: number; mealCount: number; dueDate: string;
  existingStatus: string; errors: string[];
}
interface Preview {
  periodKey: string; rows: PreviewRow[]; errors: { childId: string; message: string }[];
  totals: { children: number; ok: number; failed: number; newReceivable: number; openingDebt: number; totalDue: number };
}
interface RunResult { childId: string; name: string; result: string; message: string; net: number }
interface Run {
  id: string; periodKey: string; status: string; created: number; updated: number; skipped: number; errors: number; totalNew: number;
  results: RunResult[]; runAt: number; issuedCount: number; version: number; approvalId: string; rejectReason: string;
}
interface ChildOpt { id: string; name: string; code: string; status: string }

const toLine = (l: DocumentData): BillLine => ({ code: str(l.code), type: str(l.type), description: str(l.description), qty: num(l.qty) || 1, unitPrice: num(l.unitPrice), amount: num(l.amount) });
const parsePreview = (d: unknown): Preview => {
  const o = (d ?? {}) as DocumentData;
  const t = (o.totals ?? {}) as DocumentData;
  return {
    periodKey: str(o.periodKey),
    rows: arr(o.rows).map((r) => ({
      childId: str(r.childId), name: str(r.name, str(r.childId)), lines: arr(r.lines).map(toLine), billed: num(r.billed), discount: num(r.discount), net: num(r.net),
      openingDebt: num(r.openingDebt), openingBreakdown: arr(r.openingBreakdown).map((b) => ({ receivableId: str(b.receivableId), periodKey: str(b.periodKey), balance: num(b.balance) })),
      totalDue: num(r.totalDue), mealCount: num(r.mealCount), dueDate: str(r.dueDate), existingStatus: str((r.existing as DocumentData | undefined)?.status),
      errors: Array.isArray(r.errors) ? (r.errors as unknown[]).map(String) : [],
    })),
    errors: arr(o.errors).map((e) => ({ childId: str(e.childId), message: str(e.message) })),
    totals: { children: num(t.children), ok: num(t.ok), failed: num(t.failed), newReceivable: num(t.newReceivable), openingDebt: num(t.openingDebt), totalDue: num(t.totalDue) },
  };
};
const toRun = (id: string, d: DocumentData): Run => {
  const c = (d.counts ?? {}) as DocumentData;
  return {
    id, periodKey: str(d.periodKey), status: str(d.status, 'draft'), created: num(c.created), updated: num(c.updated), skipped: num(c.skipped), errors: num(c.errors), totalNew: num(d.totalNew),
    results: arr(d.results).map((r) => ({ childId: str(r.childId), name: str(r.name), result: str(r.result), message: str(r.message), net: num(r.net) })),
    runAt: tsMs(d.runAt), issuedCount: num(d.issuedCount), version: num(d.version), approvalId: str(d.approvalId), rejectReason: str(d.rejectReason),
  };
};

const RESULT_LABEL: Record<string, string> = { created: 'Đã tạo nháp', updated: 'Đã cập nhật nháp', skipped_existing: 'Bỏ qua (đã phát hành)', error: 'Lỗi' };
const lineTypeLabel = (t: string) => ({ tuition: 'Học phí', meal: 'Tiền ăn', service: 'Dịch vụ', discount: 'Giảm trừ', meal_refund: 'Hoàn trừ tiền ăn', other: 'Khác', adjustment: 'Điều chỉnh' }[t] ?? t);

function LinesTable({ row }: { row: PreviewRow }) {
  return (
    <div className="stack">
      <table className="dt">
        <caption className="sr-only">Các dòng tính tiền của {row.name}</caption>
        <thead><tr><th scope="col">Khoản</th><th scope="col">Loại</th><th scope="col" className="num">Số lượng</th><th scope="col" className="num">Đơn giá</th><th scope="col" className="num">Thành tiền</th></tr></thead>
        <tbody>
          {row.lines.map((l, i) => (
            <tr key={`${l.code}-${i}`}><td>{l.description}</td><td>{lineTypeLabel(l.type)}</td><td className="num">{l.qty}</td><td className="num" style={moneyStyle}>{formatVnd(l.unitPrice)}</td><td className="num" style={moneyStyle}>{formatVnd(l.amount)}</td></tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={4}>Phải thu mới của kỳ</td><td className="num" style={moneyStyle}>{formatVnd(row.net)}</td></tr>
          <tr><td colSpan={4}>Nợ cũ (tách riêng, không cộng vào khoản kỳ mới)</td><td className="num" style={moneyStyle}>{formatVnd(row.openingDebt)}</td></tr>
          <tr><td colSpan={4}>Tổng cần thu</td><td className="num" style={moneyStyle}>{formatVnd(row.totalDue)}</td></tr>
        </tfoot>
      </table>
      {row.openingBreakdown.length ? (
        <p className="text-small text-secondary">Nợ cũ gồm: {row.openingBreakdown.map((b) => `${periodLabel(b.periodKey)} ${formatVnd(b.balance)}`).join(', ')}.</p>
      ) : null}
      {row.errors.length ? <Banner tone="error" title="Dòng lỗi">{row.errors.join(' ')}</Banner> : null}
    </div>
  );
}

function ResultsTable({ results }: { results: RunResult[] }) {
  const cols: Column<RunResult>[] = [
    { key: 'name', header: 'Trẻ', value: (r) => r.name, sortable: true },
    { key: 'result', header: 'Kết quả', value: (r) => r.result, render: (r) => <Badge tone={r.result === 'error' ? 'error' : r.result === 'skipped_existing' ? 'warning' : 'success'}>{RESULT_LABEL[r.result] ?? r.result}</Badge> },
    { key: 'net', header: 'Phải thu mới', value: (r) => r.net, align: 'right', render: (r) => (r.result === 'error' ? '—' : <span style={moneyStyle}>{formatVnd(r.net)}</span>) },
    { key: 'msg', header: 'Ghi chú', value: (r) => r.message },
  ];
  return <DataTable caption="Kết quả từng bản ghi" columns={cols} rows={results} rowKey={(r) => r.childId} status={results.length ? 'ready' : 'empty'} emptyTitle="Chưa có kết quả" pageSize={20} />;
}

/** W30 — Lập và phát hành kỳ thu. */
export function W30BillingRuns(_props: ScreenProps) {
  void _props;
  const ctx = useCampus();
  const { can, tz } = useScope();
  const canWrite = !!ctx && can('billing.write', ctx.campusId);
  const canApprove = !!ctx && can('billing.approve', ctx.campusId);
  const [period, setPeriod] = useState(() => currentPeriod(ctx?.tz ?? tz));
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [picked, setPicked] = useState<string[]>([]);
  const [childQuery, setChildQuery] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewKey, setPreviewKey] = useState('');
  const [row, setRow] = useState<PreviewRow | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saved, setSaved] = useState<{ title: string; results: RunResult[]; note?: string } | null>(null);
  const [runDetail, setRunDetail] = useState<string | null>(null);
  const [dlg, setDlg] = useState<{ kind: 'approve' | 'reject' | 'publish'; run: Run } | null>(null);
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState('');

  const runs = useScopedQuery<Run>('billingRuns', ['billing.write', 'billing.approve', 'fees.read', 'payments.read'], toRun);
  const kids = useScopedQuery<ChildOpt>('children', 'children.read', (id, d) => ({ id, name: str(d.fullName, id), code: str(d.code), status: str(d.status) }));
  const childOptions = useMemo(() => kids.data.filter((c) => ['active', 'trial'].includes(c.status)).sort((a, b) => a.name.localeCompare(b.name, 'vi')), [kids.data]);
  const shownKids = childOptions.filter((c) => `${c.name} ${c.code}`.toLowerCase().includes(childQuery.trim().toLowerCase()));
  const runList = useMemo(() => [...runs.data].sort((a, b) => b.periodKey.localeCompare(a.periodKey)), [runs.data]);
  const currentRun = runDetail ? runs.data.find((r) => r.id === runDetail) ?? null : null;

  const childIds = scope === 'selected' ? picked : undefined;
  const reqKey = `${period}|${scope}|${picked.join(',')}`;
  const stale = !!preview && previewKey !== reqKey;

  const compute = useAsyncAction(async () => {
    const res = await callApi('billing.preview', { orgId: ctx!.orgId, campusId: ctx!.campusId, payload: { campusId: ctx!.campusId, periodKey: period, childIds } });
    setPreview(parsePreview(res));
    setPreviewKey(reqKey);
    return true as const;
  });

  const step = !preview ? 0 : currentRun?.status === 'published' ? 3 : 1;
  const okRows = preview?.rows.filter((r) => r.errors.length === 0) ?? [];

  const previewCols: Column<PreviewRow>[] = [
    { key: 'name', header: 'Trẻ', value: (r) => r.name, sortable: true, render: (r) => <strong>{r.name}</strong> },
    { key: 'net', header: 'Phải thu mới', value: (r) => r.net, sortable: true, align: 'right', total: 'sum', formatTotal: (n) => <span style={moneyStyle}>{formatVnd(n)}</span>, render: (r) => <span style={moneyStyle}>{formatVnd(r.net)}</span> },
    { key: 'debt', header: 'Nợ cũ (tách riêng)', value: (r) => r.openingDebt, sortable: true, align: 'right', total: 'sum', formatTotal: (n) => <span style={moneyStyle}>{formatVnd(n)}</span>, render: (r) => <span style={moneyStyle}>{formatVnd(r.openingDebt)}</span> },
    { key: 'due', header: 'Tổng cần thu', value: (r) => r.totalDue, sortable: true, align: 'right', total: 'sum', formatTotal: (n) => <span style={moneyStyle}>{formatVnd(n)}</span>, render: (r) => <strong style={moneyStyle}>{formatVnd(r.totalDue)}</strong> },
    {
      key: 'state', header: 'Tình trạng', value: (r) => (r.errors.length ? 'error' : r.existingStatus || 'new'),
      render: (r) => r.errors.length ? <Badge tone="error">Lỗi: {r.errors[0]}</Badge> : r.existingStatus && r.existingStatus !== 'draft' ? <Badge tone="warning">Đã phát hành, sẽ bỏ qua</Badge> : r.existingStatus === 'draft' ? <Badge tone="info">Đã có nháp, sẽ cập nhật</Badge> : <Badge tone="neutral">Mới</Badge>,
    },
  ];
  const runCols: Column<Run>[] = [
    { key: 'period', header: 'Kỳ thu', value: (r) => r.periodKey, sortable: true, render: (r) => <strong>{periodLabel(r.periodKey)}</strong> },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, render: (r) => <RunBadge value={r.status} /> },
    { key: 'total', header: 'Phải thu mới', value: (r) => r.totalNew, align: 'right', render: (r) => <span style={moneyStyle}>{formatVnd(r.totalNew)}</span> },
    { key: 'counts', header: 'Bản ghi', value: (r) => r.created + r.updated, render: (r) => `${r.created + r.updated} nháp, ${r.skipped} bỏ qua, ${r.errors} lỗi${r.status === 'published' ? `; đã phát hành ${r.issuedCount}` : ''}` },
    { key: 'at', header: 'Lập lúc', value: (r) => r.runAt, render: (r) => formatDateTime(r.runAt, ctx?.tz) },
    {
      key: 'actions', header: 'Thao tác',
      render: (r) => (
        <div className="row" style={{ gap: 'var(--space-1)', flexWrap: 'nowrap' }}>
          <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setRunDetail(r.id); }}>Xem</Button>
          {(r.status === 'draft' || r.status === 'rejected') && (canApprove || canWrite) ? <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setAck(false); setDlg({ kind: 'approve', run: r }); }}>{canApprove ? 'Duyệt' : 'Gửi duyệt'}</Button> : null}
          {r.status === 'submitted' && canApprove ? <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setAck(false); setDlg({ kind: 'approve', run: r }); }}>Duyệt</Button> : null}
          {r.status === 'submitted' && canApprove ? <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setNote(''); setDlg({ kind: 'reject', run: r }); }}>Từ chối</Button> : null}
          {r.status === 'approved' && canWrite ? <Button size="sm" onClick={(e) => { e.stopPropagation(); setDlg({ kind: 'publish', run: r }); }}>Phát hành</Button> : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Lập và phát hành kỳ thu" code="W30" description="Chọn kỳ và trẻ, tính bản nháp, duyệt rồi phát hành. Nợ cũ luôn tách khỏi phải thu mới." />
      <div className="stack">
        <Stepper steps={['Chọn kỳ và trẻ', 'Tính nháp, lưu', 'Duyệt', 'Phát hành']} current={step} />
        {canWrite ? (
          <Card title="1. Chọn kỳ và trẻ">
            <div className="stack">
              <div className="grid-3">
                <FormField name="period" label="Kỳ thu" required><Select name="period" value={period} onValueChange={setPeriod} options={periodOptions(ctx?.tz ?? tz)} /></FormField>
                <FormField name="scope" label="Phạm vi trẻ">
                  <Select name="scope" value={scope} onValueChange={(v) => setScope(v as 'all' | 'selected')} options={[{ value: 'all', label: 'Tất cả trẻ đang học' }, { value: 'selected', label: 'Chọn từng trẻ' }]} />
                </FormField>
              </div>
              {scope === 'selected' ? (
                kids.status === 'error' ? <Banner tone="warning" title="Không tải được danh sách trẻ">{kids.error?.message} Bạn vẫn có thể tính cho tất cả trẻ.</Banner> : (
                  <div className="stack-sm">
                    <FormField name="childQuery" label="Tìm trẻ"><Input name="childQuery" value={childQuery} onValueChange={setChildQuery} placeholder="Tên hoặc mã trẻ" /></FormField>
                    <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)' }}>
                      {kids.status === 'loading' ? <p className="text-secondary">Đang tải danh sách trẻ...</p> : shownKids.length === 0 ? <p className="text-secondary">Không có trẻ phù hợp.</p> : shownKids.map((c) => (
                        <Checkbox key={c.id} checked={picked.includes(c.id)} onChange={(v) => setPicked((p) => (v ? [...p, c.id] : p.filter((x) => x !== c.id)))}>{c.name} {c.code ? `(${c.code})` : ''}</Checkbox>
                      ))}
                    </div>
                    <span className="text-small text-secondary">Đã chọn {picked.length} trẻ.</span>
                  </div>
                )
              ) : null}
              {compute.error ? <Banner tone="error">{compute.error.message}</Banner> : null}
              <div><Button loading={compute.busy} onClick={() => { if (scope === 'selected' && picked.length === 0) return; void compute.run(); }} disabled={scope === 'selected' && picked.length === 0}>Tính bản nháp</Button></div>
            </div>
          </Card>
        ) : null}

        {preview ? (
          <Card title={`2. Bản nháp ${periodLabel(preview.periodKey)}`}>
            <div className="stack">
              {stale ? <Banner tone="warning" title="Lựa chọn đã đổi">Kết quả bên dưới tính cho lựa chọn trước. Bấm Tính bản nháp để cập nhật.</Banner> : null}
              <div className="grid-4">
                <Stat label="Trẻ được tính" value={preview.totals.children} hint={`${preview.totals.ok} hợp lệ, ${preview.totals.failed} lỗi`} tone={preview.totals.failed ? 'warning' : undefined} />
                <Stat label="Phải thu mới" value={formatVnd(preview.totals.newReceivable)} />
                <Stat label="Nợ cũ (tách riêng)" value={formatVnd(preview.totals.openingDebt)} />
                <Stat label="Tổng cần thu" value={formatVnd(preview.totals.totalDue)} hint="Phải thu mới + nợ cũ" />
              </div>
              {preview.errors.length ? (
                <Banner tone="error" title={`${preview.errors.length} dòng lỗi cần xử lý`}>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>{preview.errors.slice(0, 8).map((e, i) => <li key={i}>{e.message}</li>)}</ul>
                  {preview.errors.length > 8 ? <p>và {preview.errors.length - 8} lỗi khác.</p> : null}
                </Banner>
              ) : null}
              <DataTable
                caption="Bản nháp kỳ thu từng trẻ"
                columns={previewCols}
                rows={preview.rows}
                rowKey={(r) => r.childId}
                status={preview.rows.length ? 'ready' : 'empty'}
                onRowClick={setRow}
                searchText={(r) => r.name}
                searchPlaceholder="Tìm theo tên trẻ"
                emptyTitle="Không có trẻ nào cần lập khoản thu"
                emptyDescription="Không có trẻ đang học trong kỳ này theo phạm vi đã chọn."
                pageSize={15}
              />
              {canWrite ? (
                <div className="row">
                  <Button disabled={stale || okRows.length === 0} onClick={() => setSaveOpen(true)}>Lưu bản nháp kỳ thu</Button>
                  <span className="text-small text-secondary">Chạy lại nhiều lần không tạo khoản trùng: mỗi trẻ một khoản mỗi kỳ.</span>
                </div>
              ) : null}
            </div>
          </Card>
        ) : null}

        <Card title="3. Kỳ thu đã lưu: duyệt và phát hành" flush>
          <DataTable
            caption="Các kỳ thu"
            columns={runCols}
            rows={runList}
            rowKey={(r) => r.id}
            status={runs.status}
            error={runs.error?.message}
            onRetry={runs.retry}
            onRowClick={(r) => setRunDetail(r.id)}
            emptyTitle="Chưa có kỳ thu nào"
            emptyDescription="Tính bản nháp rồi lưu để tạo kỳ thu đầu tiên."
          />
        </Card>
      </div>

      {row ? <Drawer open title={`Chi tiết tính tiền: ${row.name}`} onClose={() => setRow(null)} footer={<Button variant="secondary" onClick={() => setRow(null)}>Đóng</Button>}><LinesTable row={row} /></Drawer> : null}

      {saveOpen && preview && ctx ? (
        <ActionDialog
          title={`Lưu bản nháp kỳ thu ${periodLabel(preview.periodKey)}`}
          subject={`${okRows.length} trẻ hợp lệ, ${preview.totals.failed} trẻ lỗi`}
          impact={[
            `Tạo hoặc cập nhật ${okRows.length} khoản phải thu ở trạng thái nháp, tổng phải thu mới ${formatVnd(okRows.reduce((s, r) => s + r.net, 0))}.`,
            'Khoản nháp chưa hiển thị cho phụ huynh và chưa tính vào công nợ cho đến khi được duyệt và phát hành.',
            `Nợ cũ ${formatVnd(okRows.reduce((s, r) => s + r.openingDebt, 0))} giữ nguyên ở các kỳ trước, không cộng vào khoản kỳ mới.`,
            'Trẻ đã có khoản phát hành trong kỳ bị bỏ qua; trẻ lỗi không tạo khoản.',
          ]}
          confirmLabel="Lưu bản nháp"
          success="Đã lưu bản nháp kỳ thu."
          run={(opId) => callApi('billing.run', { orgId: ctx.orgId, campusId: ctx.campusId, opId, payload: { campusId: ctx.campusId, periodKey: preview.periodKey, childIds } })}
          onClose={() => setSaveOpen(false)}
          onDone={(res) => {
            const r = (res ?? {}) as DocumentData;
            setSaved({ title: `Kết quả lưu nháp ${periodLabel(preview.periodKey)}`, results: arr(r.results).map((x) => ({ childId: str(x.childId), name: str(x.name), result: str(x.result), message: str(x.message), net: num(x.net) })) });
          }}
        />
      ) : null}

      {dlg && ctx && dlg.kind === 'approve' ? (
        <ActionDialog
          title={canApprove ? `Duyệt kỳ thu ${periodLabel(dlg.run.periodKey)}` : `Gửi duyệt kỳ thu ${periodLabel(dlg.run.periodKey)}`}
          subject={`Phải thu mới ${formatVnd(dlg.run.totalNew)} · ${dlg.run.created + dlg.run.updated} khoản nháp`}
          impact={canApprove ? [
            'Kỳ thu chuyển sang Đã duyệt; chưa phát hành và phụ huynh chưa thấy.',
            'Người lập không được tự duyệt kỳ thu do mình lập (trừ chủ chuỗi theo quy định).',
            `${dlg.run.errors} dòng lỗi không tạo khoản phải thu.`,
          ] : [
            'Kỳ thu chuyển sang Chờ duyệt và xuất hiện ở Trung tâm phê duyệt của người có thẩm quyền.',
            'Bạn không thể phát hành cho đến khi được duyệt.',
            `${dlg.run.errors} dòng lỗi không tạo khoản phải thu.`,
          ]}
          confirmLabel={canApprove ? 'Duyệt kỳ thu' : 'Gửi duyệt'}
          success={canApprove ? 'Đã duyệt kỳ thu.' : 'Đã gửi duyệt kỳ thu.'}
          validate={() => (dlg.run.errors > 0 && !ack ? 'Kỳ thu còn dòng lỗi. Tích xác nhận bỏ qua các dòng lỗi để tiếp tục.' : null)}
          run={(opId) => callApi('billing.approve', { orgId: ctx.orgId, campusId: ctx.campusId, opId, payload: { runId: dlg.run.id, acknowledgeErrors: ack || undefined } })}
          onClose={() => setDlg(null)}
        >
          {dlg.run.errors > 0 ? <Checkbox checked={ack} onChange={setAck}>Tôi đã xem {dlg.run.errors} dòng lỗi và đồng ý bỏ qua.</Checkbox> : null}
        </ActionDialog>
      ) : null}

      {dlg && ctx && dlg.kind === 'reject' ? (
        <ActionDialog
          title={`Từ chối kỳ thu ${periodLabel(dlg.run.periodKey)}`}
          subject={`Phải thu mới ${formatVnd(dlg.run.totalNew)}`}
          impact={['Kỳ thu bị từ chối, người lập có thể tính lại và gửi duyệt lần nữa.', 'Không có khoản nào được phát hành.']}
          confirmLabel="Từ chối kỳ thu"
          tone="destructive"
          success="Đã từ chối kỳ thu."
          validate={() => (note.trim() ? null : 'Nhập lý do từ chối.')}
          run={(opId) => callApi('billing.approve', { orgId: ctx.orgId, campusId: ctx.campusId, opId, payload: { runId: dlg.run.id, decision: 'rejected', note: note.trim() } })}
          onClose={() => setDlg(null)}
        >
          <FormField name="note" label="Lý do từ chối" required><Textarea name="note" value={note} onValueChange={setNote} /></FormField>
        </ActionDialog>
      ) : null}

      {dlg && ctx && dlg.kind === 'publish' ? (
        <ActionDialog
          title={`Phát hành kỳ thu ${periodLabel(dlg.run.periodKey)}`}
          subject={`${dlg.run.created + dlg.run.updated} khoản phải thu, tổng phải thu mới ${formatVnd(dlg.run.totalNew)}`}
          impact={[
            `Phát hành ${dlg.run.created + dlg.run.updated} khoản phải thu: chuyển từ nháp sang chưa thanh toán (hoặc quá hạn nếu đã quá hạn đóng).`,
            'Gửi thông báo tới phụ huynh có quyền xem học phí (nội dung chung, không nêu số tiền).',
            'Sau khi phát hành không sửa được khoản; sai sót xử lý bằng chứng từ điều chỉnh.',
            'Nợ cũ giữ ở các kỳ trước, không bị cộng lại vào khoản kỳ mới.',
          ]}
          confirmLabel="Phát hành kỳ thu"
          success="Đã phát hành kỳ thu."
          run={(opId) => callApi('billing.publish', { orgId: ctx.orgId, campusId: ctx.campusId, opId, payload: { runId: dlg.run.id } })}
          onClose={() => setDlg(null)}
          onDone={(res) => {
            const r = (res ?? {}) as DocumentData;
            setSaved({ title: `Đã phát hành ${periodLabel(dlg.run.periodKey)}`, results: dlg.run.results, note: `Đã phát hành ${num(r.issued)} khoản; thông báo tới ${num(r.notifiedParents)} phụ huynh.` });
          }}
        />
      ) : null}

      {currentRun ? (
        <Drawer open title={`Kỳ thu ${periodLabel(currentRun.periodKey)}`} onClose={() => setRunDetail(null)} footer={<Button variant="secondary" onClick={() => setRunDetail(null)}>Đóng</Button>}>
          <div className="stack">
            <KV items={[
              ['Trạng thái', <RunBadge key="s" value={currentRun.status} />],
              ['Phải thu mới', <span key="t" style={moneyStyle}>{formatVnd(currentRun.totalNew)}</span>],
              ['Khoản nháp', `${currentRun.created} tạo mới, ${currentRun.updated} cập nhật`],
              ['Bỏ qua / lỗi', `${currentRun.skipped} / ${currentRun.errors}`],
              ['Đã phát hành', currentRun.status === 'published' ? `${currentRun.issuedCount} khoản` : 'Chưa'],
              ['Lập lúc', formatDateTime(currentRun.runAt, ctx?.tz)],
            ]} />
            {currentRun.rejectReason ? <Banner tone="warning" title="Lý do từ chối">{currentRun.rejectReason}</Banner> : null}
            <ResultsTable results={currentRun.results} />
          </div>
        </Drawer>
      ) : null}

      {saved ? (
        <Modal open title={saved.title} size="lg" onClose={() => setSaved(null)} footer={<Button onClick={() => setSaved(null)}>Đóng</Button>}>
          <div className="stack">
            {saved.note ? <Banner tone="success">{saved.note}</Banner> : null}
            <ResultsTable results={saved.results} />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
