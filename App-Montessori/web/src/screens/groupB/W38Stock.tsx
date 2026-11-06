'use client';
import { useMemo, useState } from 'react';
import { useForm } from '@/lib/hooks/useForm';
import { useDirtyGuard } from '@/lib/hooks/dirtyStore';
import { useScope } from '@/providers/ScopeProvider';
import { addDays } from './parts/dates';
import { dayKey as dayKeyOf, formatDate, formatDateTime, formatVnd } from '@/lib/format';
import { PageHeader, Stat } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { FormField, Input, Select, Textarea, DateInput, MoneyInput, Checkbox } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import type { ScreenProps } from '../registry';
import { formatNumber, useCall, useCampusCtx, useCampusDocs, num, text, toDate } from './parts/kit';
import { Tag } from './parts/statuses';
import { FormAction, parseQty, toMs } from './parts/opsKit';

interface Conversion { unit: string; factor: number }
interface ItemRow {
  id: string; code: string; name: string; group: string; unit: string; onHand: number; minQty: number | null; conversions: Conversion[]; active: boolean; note: string; version?: number;
}
interface LotRow { id: string; itemId: string; lot: string; expiry: string; qtyRemaining: number; qtyReceived: number; unitCost: number; supplier: string; status: string }
interface MoveRow { id: string; itemId: string; lot: string; type: string; qty: number; unitCost: number; value: number; at: number; supplier: string; reason: string; purpose: string }
interface TakeLine { itemId: string; code: string; name: string; unit: string; systemQty: number; countedQty: number; variance: number; unitCost: number; varianceValue: number }
interface TakeRow { id: string; status: string; lines: TakeLine[]; varianceCount: number; totalVarianceValue: number; note: string; createdAt: number }
interface TfLine { itemId: string; code: string; name: string; unit: string; qty: number; qtyReceived?: number }
interface TfRow { id: string; fromCampusId: string; toCampusId: string; status: string; lines: TfLine[]; note: string; sentAt: number; receiveNote: string }

const toItem = (id: string, d: Record<string, unknown>): ItemRow => ({
  id, code: text(d.code, id), name: text(d.name, id), group: text(d.group), unit: text(d.unit), onHand: num(d.onHand),
  minQty: typeof d.minQty === 'number' ? d.minQty : null,
  conversions: Array.isArray(d.conversions) ? (d.conversions as Conversion[]) : [],
  active: d.active !== false && d.archived !== true, note: text(d.note), version: typeof d.version === 'number' ? d.version : undefined,
});
const toLot = (id: string, d: Record<string, unknown>): LotRow => ({
  id, itemId: text(d.itemId), lot: text(d.lot), expiry: text(d.expiry), qtyRemaining: num(d.qtyRemaining), qtyReceived: num(d.qtyReceived), unitCost: num(d.unitCost), supplier: text(d.supplier), status: text(d.status),
});
const toMove = (id: string, d: Record<string, unknown>): MoveRow => ({
  id, itemId: text(d.itemId), lot: text(d.lot), type: text(d.type), qty: num(d.qty), unitCost: num(d.unitCost), value: num(d.value), at: toMs(d.at), supplier: text(d.supplier), reason: text(d.reason), purpose: text(d.purpose),
});
const toTake = (id: string, d: Record<string, unknown>): TakeRow => ({
  id, status: text(d.status), lines: Array.isArray(d.lines) ? (d.lines as TakeLine[]) : [], varianceCount: num(d.varianceCount), totalVarianceValue: num(d.totalVarianceValue), note: text(d.note), createdAt: toMs(d.createdAt),
});
const toTf = (id: string, d: Record<string, unknown>): TfRow => ({
  id, fromCampusId: text(d.fromCampusId), toCampusId: text(d.toCampusId), status: text(d.status), lines: Array.isArray(d.lines) ? (d.lines as TfLine[]) : [], note: text(d.note), sentAt: toMs(d.sentAt), receiveNote: text(d.receiveNote),
});

const MOVE_LABEL: Record<string, string> = {
  receive: 'Nhập kho', issue: 'Xuất dùng', waste: 'Hủy / hao hụt', return_to_supplier: 'Trả nhà cung cấp', transfer_out: 'Chuyển đi', transfer_in: 'Nhận chuyển', stocktake_adjust: 'Điều chỉnh kiểm kê',
};

const EXPIRY_SOON_DAYS = 7;

/* ------------------------------------------------------------------ mặt hàng */

function ItemDrawer({ item, onClose }: { item: ItemRow | null; onClose: () => void }) {
  const call = useCall();
  const toast = useToast();
  const { confirmDiscard } = useDirtyGuard();
  const form = useForm({
    initial: {
      code: item?.code ?? '', name: item?.name ?? '', group: item?.group ?? '', unit: item?.unit ?? '', minQty: item?.minQty === null || item?.minQty === undefined ? '' : String(item.minQty),
      conversions: item?.conversions.map((c) => `${c.unit}=${c.factor}`).join('\n') ?? '', note: item?.note ?? '',
    },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.code.trim()) e.code = 'Nhập mã mặt hàng.';
      if (!v.name.trim()) e.name = 'Nhập tên mặt hàng.';
      if (!v.unit.trim()) e.unit = 'Nhập đơn vị cơ bản (kg, hộp, cái...).';
      if (v.minQty.trim() && parseQty(v.minQty) === null) e.minQty = 'Định mức tối thiểu phải là số không âm.';
      for (const l of v.conversions.split('\n').map((x) => x.trim()).filter(Boolean)) {
        const [u, f] = l.split('=');
        if (!u?.trim() || !f || !(parseQty(f) ?? 0)) { e.conversions = 'Mỗi dòng theo dạng: đơn vị=hệ số (> 0). Ví dụ: thùng=12'; break; }
      }
      return e;
    },
  });
  const submit = form.onSubmit(async (v, opId) => {
    const conversions = v.conversions.split('\n').map((x) => x.trim()).filter(Boolean).map((l) => {
      const [u, f] = l.split('=');
      return { unit: u.trim(), factor: parseQty(f) as number };
    });
    const data: Record<string, unknown> = {
      code: v.code.trim(), name: v.name.trim(), unit: v.unit.trim(), group: v.group.trim() || undefined,
      minQty: v.minQty.trim() ? parseQty(v.minQty) : undefined, conversions, note: v.note.trim() || undefined,
    };
    await call('entity.save', { collection: 'stockItems', id: item?.id, data, expectedVersion: item?.version }, opId);
    toast.success(item ? 'Đã lưu mặt hàng.' : 'Đã thêm mặt hàng.');
    form.reset();
    onClose();
  });
  const close = async () => {
    if (form.dirty && !(await confirmDiscard('đóng biểu mẫu mặt hàng'))) return;
    onClose();
  };
  return (
    <Drawer
      open
      title={item ? `Sửa mặt hàng ${item.code}` : 'Thêm mặt hàng'}
      onClose={() => void close()}
      locked={form.submitting}
      footer={
        <>
          <Button variant="secondary" onClick={() => void close()} disabled={form.submitting}>Hủy</Button>
          <Button onClick={() => void submit()} loading={form.submitting}>Lưu mặt hàng</Button>
        </>
      }
    >
      <form className="stack" noValidate onSubmit={submit}>
        {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
        {form.apiError?.code === 'VERSION_CONFLICT' ? <Banner tone="warning">Mặt hàng vừa được người khác sửa. Đóng biểu mẫu để xem bản mới nhất.</Banner> : null}
        <div className="grid-2">
          <FormField name="code" label="Mã" required {...form.field('code')}><Input {...form.bind('code')} autoComplete="off" /></FormField>
          <FormField name="name" label="Tên" required {...form.field('name')}><Input {...form.bind('name')} autoComplete="off" /></FormField>
          <FormField name="group" label="Nhóm" {...form.field('group')}><Input {...form.bind('group')} /></FormField>
          <FormField name="unit" label="Đơn vị cơ bản" required {...form.field('unit')}><Input {...form.bind('unit')} /></FormField>
          <FormField name="minQty" label="Định mức tồn tối thiểu" helper="Cảnh báo tồn thấp khi tồn ≤ mức này." {...form.field('minQty')}><Input {...form.bind('minQty')} inputMode="decimal" /></FormField>
        </div>
        <FormField name="conversions" label="Quy đổi đơn vị" helper="Mỗi dòng: đơn vị=số đơn vị cơ bản. Ví dụ: thùng=12" {...form.field('conversions')}>
          <Textarea {...form.bind('conversions')} rows={3} />
        </FormField>
        <FormField name="note" label="Ghi chú" {...form.field('note')}><Textarea {...form.bind('note')} /></FormField>
      </form>
    </Drawer>
  );
}

function ReceiveDialog({ item, onClose, onReload }: { item: ItemRow; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  const c = useCampusCtx();
  const [lot, setLot] = useState('');
  const [expiry, setExpiry] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState(item.unit);
  const [cost, setCost] = useState<number | null>(null);
  const [supplier, setSupplier] = useState('');
  const today = dayKeyOf(new Date(), c.tz);
  return (
    <FormAction
      title="Nhập kho"
      subject={`${item.code} · ${item.name}`}
      impact={['Tạo lô mới và tăng tồn kho của mặt hàng.', 'Lô được theo dõi theo hạn dùng; xuất kho sẽ ưu tiên lô hết hạn trước (FEFO).', 'Phát sinh dòng lịch sử nhập kho, không sửa được sau khi ghi.']}
      confirmLabel="Nhập kho"
      success="Đã nhập kho."
      onClose={onClose}
      onReload={onReload}
      check={() => {
        const e: Record<string, string> = {};
        if (!lot.trim()) e.lot = 'Nhập số lô.';
        const q = parseQty(qty);
        if (!q || q <= 0) e.qty = 'Số lượng phải là số dương.';
        if (cost === null) e.cost = 'Nhập đơn giá (số nguyên đồng).';
        if (expiry && expiry < today) e.expiry = 'Hàng đã hết hạn, không nhập kho.';
        return e;
      }}
      run={(opId) => call('stock.receive', { itemId: item.id, lot: lot.trim(), expiry: expiry || undefined, qty: parseQty(qty), unit, unitCost: cost, supplier: supplier.trim() || undefined }, opId)}
    >
      {(errs) => (
        <div className="grid-2">
          <FormField name="lot" label="Số lô" required error={errs.lot}><Input name="lot" value={lot} onValueChange={setLot} /></FormField>
          <FormField name="expiry" label="Hạn dùng" error={errs.expiry}><DateInput name="expiry" value={expiry} onValueChange={setExpiry} /></FormField>
          <FormField name="qty" label="Số lượng" required error={errs.qty}><Input name="qty" value={qty} onValueChange={setQty} inputMode="decimal" /></FormField>
          <FormField name="unit" label="Đơn vị">
            <Select name="unit" value={unit} onValueChange={setUnit} options={[item.unit, ...item.conversions.map((x) => x.unit)].map((u) => ({ value: u, label: u }))} />
          </FormField>
          <FormField name="cost" label={`Đơn giá (theo ${unit})`} required error={errs.cost}><MoneyInput name="cost" value={cost} onValueChange={setCost} /></FormField>
          <FormField name="supplier" label="Nhà cung cấp"><Input name="supplier" value={supplier} onValueChange={setSupplier} /></FormField>
        </div>
      )}
    </FormAction>
  );
}

function IssueDialog({ item, onClose, onReload }: { item: ItemRow; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState(item.unit);
  const [purpose, setPurpose] = useState('kitchen');
  const [reason, setReason] = useState('');
  return (
    <FormAction
      title="Xuất kho"
      subject={`${item.code} · ${item.name} · tồn ${formatNumber(item.onHand, 3)} ${item.unit}`}
      impact={['Trừ tồn kho theo lô có hạn gần nhất trước (FEFO); lô hết hạn không được xuất dùng.', 'Không cho xuất âm kho: nếu không đủ, máy chủ từ chối và nêu số còn dùng được.', purpose === 'waste' ? 'Xuất hủy/hao hụt ghi lý do và được tính vào chênh lệch.' : 'Phát sinh dòng lịch sử xuất kho.']}
      confirmLabel="Xuất kho"
      tone={purpose === 'waste' ? 'destructive' : 'primary'}
      success="Đã xuất kho."
      onClose={onClose}
      onReload={onReload}
      check={() => {
        const e: Record<string, string> = {};
        const q = parseQty(qty);
        if (!q || q <= 0) e.qty = 'Số lượng phải là số dương.';
        if ((purpose === 'waste' || purpose === 'return') && reason.trim().length < 5) e.reason = 'Nhập lý do (tối thiểu 5 ký tự).';
        return e;
      }}
      run={(opId) => call('stock.issue', { itemId: item.id, qty: parseQty(qty), unit, purpose, reason: reason.trim() || undefined }, opId)}
    >
      {(errs) => (
        <div className="grid-2">
          <FormField name="qty" label="Số lượng" required error={errs.qty}><Input name="qty" value={qty} onValueChange={setQty} inputMode="decimal" /></FormField>
          <FormField name="unit" label="Đơn vị"><Select name="unit" value={unit} onValueChange={setUnit} options={[item.unit, ...item.conversions.map((x) => x.unit)].map((u) => ({ value: u, label: u }))} /></FormField>
          <FormField name="purpose" label="Mục đích">
            <Select name="purpose" value={purpose} onValueChange={setPurpose} options={[{ value: 'kitchen', label: 'Dùng cho bếp' }, { value: 'waste', label: 'Hủy / hao hụt' }, { value: 'return', label: 'Trả nhà cung cấp' }]} />
          </FormField>
          <FormField name="reason" label="Lý do" required={purpose !== 'kitchen'} error={errs.reason}><Input name="reason" value={reason} onValueChange={setReason} /></FormField>
        </div>
      )}
    </FormAction>
  );
}

/* ------------------------------------------------------------------ tab tồn kho */

function ItemsTab({ items, lots }: { items: ReturnType<typeof useCampusDocs<ItemRow>>; lots: ReturnType<typeof useCampusDocs<LotRow>> }) {
  const c = useCampusCtx();
  const canWrite = c.can('stock.write');
  const [edit, setEdit] = useState<ItemRow | 'new' | null>(null);
  const [recv, setRecv] = useState<ItemRow | null>(null);
  const [issue, setIssue] = useState<ItemRow | null>(null);
  const today = dayKeyOf(new Date(), c.tz);
  const soon = addDays(today, EXPIRY_SOON_DAYS);
  const live = useMemo(() => lots.data.filter((l) => l.qtyRemaining > 0 && l.status !== 'closed'), [lots.data]);
  const info = useMemo(() => {
    const m = new Map<string, { value: number; expired: number; soon: number }>();
    for (const l of live) {
      const x = m.get(l.itemId) ?? { value: 0, expired: 0, soon: 0 };
      x.value += l.qtyRemaining * l.unitCost;
      if (l.expiry && l.expiry < today) x.expired++;
      else if (l.expiry && l.expiry <= soon) x.soon++;
      m.set(l.itemId, x);
    }
    return m;
  }, [live, today, soon]);
  const low = items.data.filter((i) => i.active && i.minQty !== null && i.onHand <= i.minQty);
  const expiredN = [...info.values()].reduce((s, x) => s + x.expired, 0);
  const soonN = [...info.values()].reduce((s, x) => s + x.soon, 0);
  const totalValue = [...info.values()].reduce((s, x) => s + x.value, 0);

  const columns: Column<ItemRow>[] = [
    { key: 'code', header: 'Mã', value: (r) => r.code, sortable: true, width: 110 },
    { key: 'name', header: 'Mặt hàng', value: (r) => r.name, sortable: true, render: (r) => <strong>{r.name}</strong> },
    { key: 'group', header: 'Nhóm', value: (r) => r.group },
    { key: 'onHand', header: 'Tồn', value: (r) => r.onHand, sortable: true, align: 'right', render: (r) => `${formatNumber(r.onHand, 3)} ${r.unit}` },
    { key: 'min', header: 'Tối thiểu', value: (r) => r.minQty, align: 'right', render: (r) => (r.minQty === null ? '—' : `${formatNumber(r.minQty, 3)} ${r.unit}`) },
    {
      key: 'warn', header: 'Cảnh báo',
      render: (r) => {
        const x = info.get(r.id);
        return (
          <div className="row" style={{ gap: 'var(--space-1)' }}>
            {r.minQty !== null && r.onHand <= r.minQty ? <Badge tone="warning">Tồn thấp</Badge> : null}
            {x?.expired ? <Badge tone="error">{x.expired} lô hết hạn</Badge> : null}
            {x?.soon ? <Badge tone="warning">{x.soon} lô sắp hết hạn</Badge> : null}
          </div>
        );
      },
    },
    { key: 'value', header: 'Giá trị tồn', value: (r) => info.get(r.id)?.value ?? 0, align: 'right', total: 'sum', formatTotal: (n) => formatVnd(n), render: (r) => formatVnd(info.get(r.id)?.value ?? 0) },
    {
      key: 'actions', header: 'Thao tác',
      render: (r) =>
        canWrite ? (
          <div className="row" style={{ gap: 'var(--space-1)', flexWrap: 'nowrap' }}>
            <Button size="sm" variant="secondary" onClick={() => setRecv(r)}>Nhập</Button>
            <Button size="sm" variant="secondary" onClick={() => setIssue(r)}>Xuất</Button>
            <Button size="sm" variant="tertiary" onClick={() => setEdit(r)}>Sửa</Button>
          </div>
        ) : null,
    },
  ];
  const filters: TableFilter<ItemRow>[] = [
    { key: 'warn', label: 'Cảnh báo', options: [{ value: 'low', label: 'Tồn thấp' }, { value: 'expiry', label: 'Có lô sắp/đã hết hạn' }], predicate: (r, v) => (v === 'low' ? r.minQty !== null && r.onHand <= r.minQty : !!(info.get(r.id)?.expired || info.get(r.id)?.soon)) },
  ];
  return (
    <div className="stack">
      {expiredN ? <Banner tone="error" title={`${expiredN} lô đã hết hạn còn tồn`}>Hàng hết hạn không được xuất dùng. Hủy hoặc điều chỉnh qua kiểm kê.</Banner> : null}
      {soonN ? <Banner tone="warning" title={`${soonN} lô hết hạn trong ${EXPIRY_SOON_DAYS} ngày tới`}>Ưu tiên dùng trước theo FEFO.</Banner> : null}
      {low.length ? <Banner tone="warning" title={`${low.length} mặt hàng tồn thấp`}>{low.slice(0, 6).map((i) => i.name).join(', ')}{low.length > 6 ? '…' : ''}</Banner> : null}
      <div className="grid-3">
        <Stat label="Số mặt hàng" value={items.data.length} />
        <Stat label="Tồn thấp" value={low.length} tone={low.length ? 'warning' : undefined} />
        <Stat label="Giá trị tồn (theo giá nhập)" value={formatVnd(totalValue)} hint="Tổng số lượng còn × đơn giá lô" />
      </div>
      <DataTable
        caption="Tồn kho"
        columns={columns}
        rows={items.data}
        rowKey={(r) => r.id}
        status={items.status}
        error={items.error?.message}
        onRetry={items.retry}
        searchText={(r) => `${r.code} ${r.name} ${r.group}`}
        searchPlaceholder="Tìm theo mã, tên, nhóm"
        filters={filters}
        toolbarExtra={canWrite ? <Button icon="plus" onClick={() => setEdit('new')}>Thêm mặt hàng</Button> : undefined}
        emptyTitle="Chưa có mặt hàng nào"
        emptyDescription="Thêm mặt hàng rồi nhập kho theo lô và hạn dùng."
      />
      {edit ? <ItemDrawer key={edit === 'new' ? 'new' : edit.id} item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} /> : null}
      {recv ? <ReceiveDialog key={recv.id} item={recv} onClose={() => setRecv(null)} onReload={items.retry} /> : null}
      {issue ? <IssueDialog key={issue.id} item={issue} onClose={() => setIssue(null)} onReload={items.retry} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ lô, lịch sử */

function LotsTab({ lots, items }: { lots: ReturnType<typeof useCampusDocs<LotRow>>; items: ItemRow[] }) {
  const c = useCampusCtx();
  const today = dayKeyOf(new Date(), c.tz);
  const soon = addDays(today, EXPIRY_SOON_DAYS);
  const nameOf = (id: string) => items.find((i) => i.id === id);
  const rows = useMemo(() => lots.data.filter((l) => l.qtyRemaining > 0).sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999')), [lots.data]);
  const columns: Column<LotRow>[] = [
    { key: 'item', header: 'Mặt hàng', value: (r) => nameOf(r.itemId)?.name ?? r.itemId, sortable: true },
    { key: 'lot', header: 'Số lô', value: (r) => r.lot },
    { key: 'expiry', header: 'Hạn dùng', value: (r) => r.expiry || '9999', sortable: true, render: (r) => (r.expiry ? formatDate(r.expiry) : 'Không có hạn') },
    {
      key: 'state', header: 'Tình trạng',
      render: (r) => (!r.expiry ? <span className="text-secondary">—</span> : r.expiry < today ? <Badge tone="error">Đã hết hạn</Badge> : r.expiry <= soon ? <Badge tone="warning">Sắp hết hạn</Badge> : <Badge tone="success">Còn hạn</Badge>),
    },
    { key: 'qty', header: 'Còn lại', value: (r) => r.qtyRemaining, align: 'right', render: (r) => `${formatNumber(r.qtyRemaining, 3)} ${nameOf(r.itemId)?.unit ?? ''}` },
    { key: 'cost', header: 'Đơn giá', value: (r) => r.unitCost, align: 'right', render: (r) => formatVnd(r.unitCost) },
    { key: 'supplier', header: 'Nhà cung cấp', value: (r) => r.supplier },
  ];
  return (
    <DataTable
      caption="Lô hàng còn tồn"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      status={lots.status}
      error={lots.error?.message}
      onRetry={lots.retry}
      searchText={(r) => `${nameOf(r.itemId)?.name ?? ''} ${r.lot} ${r.supplier}`}
      searchPlaceholder="Tìm theo mặt hàng, lô"
      emptyTitle="Không có lô còn tồn"
      emptyDescription="Lô hàng xuất hiện sau khi nhập kho."
    />
  );
}

function MovesTab({ items }: { items: ItemRow[] }) {
  const q = useCampusDocs<MoveRow>('stockMovements', toMove);
  const rows = useMemo(() => [...q.data].sort((a, b) => b.at - a.at).slice(0, 200), [q.data]);
  const nameOf = (id: string) => items.find((i) => i.id === id);
  const columns: Column<MoveRow>[] = [
    { key: 'at', header: 'Thời điểm', value: (r) => r.at, sortable: true, render: (r) => formatDateTime(r.at ? new Date(r.at) : null) },
    { key: 'type', header: 'Loại', value: (r) => r.type, render: (r) => <Badge tone={r.qty >= 0 ? 'success' : 'neutral'}>{MOVE_LABEL[r.type] ?? r.type}</Badge> },
    { key: 'item', header: 'Mặt hàng', value: (r) => nameOf(r.itemId)?.name ?? r.itemId },
    { key: 'lot', header: 'Lô', value: (r) => r.lot },
    { key: 'qty', header: 'Số lượng', value: (r) => r.qty, align: 'right', render: (r) => `${r.qty > 0 ? '+' : ''}${formatNumber(r.qty, 3)} ${nameOf(r.itemId)?.unit ?? ''}` },
    { key: 'value', header: 'Giá trị', value: (r) => r.value, align: 'right', render: (r) => formatVnd(r.value) },
    { key: 'note', header: 'Ghi chú', render: (r) => r.reason || r.supplier || '—' },
  ];
  return (
    <DataTable
      caption="Lịch sử nhập xuất (200 dòng gần nhất)"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      status={q.status}
      error={q.error?.message}
      onRetry={q.retry}
      searchText={(r) => `${nameOf(r.itemId)?.name ?? ''} ${r.lot} ${MOVE_LABEL[r.type] ?? r.type}`}
      searchPlaceholder="Tìm theo mặt hàng, lô, loại"
      emptyTitle="Chưa có phát sinh kho"
    />
  );
}

/* ------------------------------------------------------------------ kiểm kê */

function StocktakeDialog({ items, onClose, onReload }: { items: ItemRow[]; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const filled = items.filter((i) => (counts[i.id] ?? '').trim() !== '');
  return (
    <FormAction
      title="Lập phiếu kiểm kê"
      subject={`${filled.length} mặt hàng đã nhập số đếm`}
      impact={['Chỉ các mặt hàng có nhập số đếm được đưa vào phiếu.', 'Có chênh lệch → phiếu chờ duyệt (người duyệt khác người lập); chưa điều chỉnh tồn kho cho đến khi duyệt.', 'Không chênh lệch → phiếu đóng ngay, tồn kho giữ nguyên.']}
      confirmLabel="Lập phiếu kiểm kê"
      success="Đã lập phiếu kiểm kê."
      onClose={onClose}
      onReload={onReload}
      check={() => {
        const e: Record<string, string> = {};
        if (filled.length === 0) e.all = 'Nhập số đếm cho ít nhất một mặt hàng.';
        for (const i of filled) if (parseQty(counts[i.id]) === null) e[i.id] = 'Số đếm phải là số không âm.';
        return e;
      }}
      run={(opId) => call('stock.stocktake', { counts: filled.map((i) => ({ itemId: i.id, countedQty: parseQty(counts[i.id]) })), note: note.trim() || undefined }, opId)}
    >
      {(errs) => (
        <div className="stack-sm">
          {errs.all ? <Banner tone="error">{errs.all}</Banner> : null}
          <div style={{ maxHeight: 320, overflow: 'auto' }}>
            <table className="dt" style={{ width: '100%' }}>
              <thead><tr><th>Mặt hàng</th><th>Tồn hệ thống</th><th>Số đếm</th><th>Chênh lệch</th></tr></thead>
              <tbody>
                {items.map((i) => {
                  const n = parseQty(counts[i.id] ?? '');
                  return (
                    <tr key={i.id}>
                      <td>{i.code} · {i.name}</td>
                      <td>{formatNumber(i.onHand, 3)} {i.unit}</td>
                      <td>
                        <FormField name={`c-${i.id}`} label={`Số đếm ${i.name}`} error={errs[i.id]}>
                          <Input name={`c-${i.id}`} value={counts[i.id] ?? ''} onValueChange={(v) => setCounts({ ...counts, [i.id]: v })} inputMode="decimal" />
                        </FormField>
                      </td>
                      <td>{n === null ? '—' : formatNumber(Math.round((n - i.onHand) * 1000) / 1000, 3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <FormField name="note" label="Ghi chú"><Input name="note" value={note} onValueChange={setNote} /></FormField>
        </div>
      )}
    </FormAction>
  );
}

function VarianceDialog({ take, decision, onClose, onReload }: { take: TakeRow; decision: 'approved' | 'rejected'; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  const [note, setNote] = useState('');
  const ok = decision === 'approved';
  return (
    <FormAction
      title={ok ? 'Duyệt chênh lệch kiểm kê' : 'Từ chối phiếu kiểm kê'}
      subject={`${take.varianceCount} mặt hàng chênh lệch · ${formatVnd(take.totalVarianceValue)}`}
      impact={ok ? ['Tồn kho được điều chỉnh theo số đếm: thừa tạo lô kiểm kê, thiếu trừ theo FEFO.', 'Phát sinh dòng lịch sử điều chỉnh kiểm kê, không xóa được.', 'Người lập phiếu không được tự duyệt.'] : ['Phiếu bị từ chối, tồn kho giữ nguyên.']}
      confirmLabel={ok ? 'Duyệt điều chỉnh' : 'Từ chối phiếu'}
      tone={ok ? 'primary' : 'destructive'}
      success={ok ? 'Đã duyệt chênh lệch.' : 'Đã từ chối phiếu kiểm kê.'}
      onClose={onClose}
      onReload={onReload}
      check={(): Record<string, string> => (!ok && note.trim().length < 3 ? { note: 'Nhập lý do từ chối.' } : {})}
      run={(opId) => call('stock.approveVariance', { id: take.id, decision, note: note.trim() || undefined }, opId)}
    >
      {(errs) => (
        <FormField name="note" label={ok ? 'Ghi chú' : 'Lý do'} required={!ok} error={errs.note}><Textarea name="note" value={note} onValueChange={setNote} /></FormField>
      )}
    </FormAction>
  );
}

function TakeTab({ items }: { items: ItemRow[] }) {
  const c = useCampusCtx();
  const q = useCampusDocs<TakeRow>('stocktakes', toTake);
  const [open, setOpen] = useState(false);
  const [dec, setDec] = useState<{ take: TakeRow; decision: 'approved' | 'rejected' } | null>(null);
  const [view, setView] = useState<TakeRow | null>(null);
  const rows = useMemo(() => [...q.data].sort((a, b) => b.createdAt - a.createdAt), [q.data]);
  const columns: Column<TakeRow>[] = [
    { key: 'at', header: 'Ngày lập', value: (r) => r.createdAt, sortable: true, render: (r) => formatDateTime(r.createdAt ? new Date(r.createdAt) : null) },
    { key: 'lines', header: 'Số mặt hàng', value: (r) => r.lines.length, align: 'right' },
    { key: 'var', header: 'Chênh lệch', value: (r) => r.varianceCount, align: 'right', render: (r) => (r.varianceCount ? <Badge tone="warning">{r.varianceCount} mặt hàng</Badge> : 'Khớp') },
    { key: 'val', header: 'Giá trị chênh lệch', value: (r) => r.totalVarianceValue, align: 'right', render: (r) => formatVnd(r.totalVarianceValue) },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, render: (r) => <Tag domain="stocktake" value={r.status} /> },
    {
      key: 'actions', header: 'Thao tác',
      render: (r) =>
        r.status === 'pending_approval' && c.can('campus.manage') ? (
          <div className="row" style={{ gap: 'var(--space-1)', flexWrap: 'nowrap' }}>
            <Button size="sm" onClick={(e) => { e.stopPropagation(); setDec({ take: r, decision: 'approved' }); }}>Duyệt</Button>
            <Button size="sm" variant="destructiveOutline" onClick={(e) => { e.stopPropagation(); setDec({ take: r, decision: 'rejected' }); }}>Từ chối</Button>
          </div>
        ) : null,
    },
  ];
  return (
    <div className="stack">
      <DataTable
        caption="Phiếu kiểm kê"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={q.status}
        error={q.error?.message}
        onRetry={q.retry}
        onRowClick={setView}
        toolbarExtra={c.can('stock.write') && items.length ? <Button icon="plus" onClick={() => setOpen(true)}>Lập phiếu kiểm kê</Button> : undefined}
        emptyTitle="Chưa có phiếu kiểm kê"
        emptyDescription="Lập phiếu để đối chiếu số đếm thực tế với tồn hệ thống."
      />
      {open ? <StocktakeDialog items={items.filter((i) => i.active)} onClose={() => setOpen(false)} onReload={q.retry} /> : null}
      {dec ? <VarianceDialog key={dec.take.id + dec.decision} take={dec.take} decision={dec.decision} onClose={() => setDec(null)} onReload={q.retry} /> : null}
      {view ? (
        <Drawer open title="Chi tiết phiếu kiểm kê" onClose={() => setView(null)}>
          <div className="stack">
            {view.note ? <p>{view.note}</p> : null}
            <table className="dt" style={{ width: '100%' }}>
              <thead><tr><th>Mặt hàng</th><th>Hệ thống</th><th>Đếm</th><th>Chênh lệch</th><th>Giá trị</th></tr></thead>
              <tbody>
                {view.lines.map((l) => (
                  <tr key={l.itemId}>
                    <td>{l.code} · {l.name}</td><td>{formatNumber(l.systemQty, 3)} {l.unit}</td><td>{formatNumber(l.countedQty, 3)}</td>
                    <td>{formatNumber(l.variance, 3)}</td><td>{formatVnd(l.varianceValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Drawer>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ chuyển kho */

function SendDialog({ items, onClose, onReload }: { items: ItemRow[]; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  const { campuses } = useScope();
  const c = useCampusCtx();
  const [to, setTo] = useState('');
  const [sel, setSel] = useState<Record<string, { on: boolean; qty: string }>>({});
  const [note, setNote] = useState('');
  const chosen = items.filter((i) => sel[i.id]?.on);
  return (
    <FormAction
      title="Chuyển kho sang cơ sở khác"
      subject={`Từ ${c.campusName}`}
      impact={['Trừ tồn của cơ sở giao ngay (theo FEFO, giữ số lô và hạn dùng) và tạo phiếu «Đang vận chuyển».', 'Cơ sở nhận phải xác nhận số lượng thực nhận; chênh lệch được ghi nhận.', 'Cơ sở nhận cần có sẵn mặt hàng cùng mã.']}
      confirmLabel="Gửi phiếu chuyển"
      success="Đã tạo phiếu chuyển kho."
      onClose={onClose}
      onReload={onReload}
      check={() => {
        const e: Record<string, string> = {};
        if (!to) e.to = 'Chọn cơ sở nhận.';
        if (chosen.length === 0) e.lines = 'Chọn ít nhất một mặt hàng.';
        for (const i of chosen) {
          const q = parseQty(sel[i.id].qty);
          if (!q || q <= 0) e[i.id] = 'Số lượng phải là số dương.';
          else if (q > i.onHand) e[i.id] = `Vượt tồn hiện có (${formatNumber(i.onHand, 3)}).`;
        }
        return e;
      }}
      run={(opId) => call('stock.transfer.send', { toCampusId: to, lines: chosen.map((i) => ({ itemId: i.id, qty: parseQty(sel[i.id].qty) })), note: note.trim() || undefined }, opId)}
    >
      {(errs) => (
        <div className="stack-sm">
          <FormField name="to" label="Cơ sở nhận" required error={errs.to}>
            <Select name="to" value={to} onValueChange={setTo} placeholder="Chọn cơ sở" options={campuses.filter((x) => x.id !== c.campusId).map((x) => ({ value: x.id, label: x.name }))} />
          </FormField>
          {errs.lines ? <Banner tone="error">{errs.lines}</Banner> : null}
          <div style={{ maxHeight: 260, overflow: 'auto' }} className="stack-sm">
            {items.filter((i) => i.onHand > 0).map((i) => (
              <div key={i.id} className="row">
                <Checkbox checked={!!sel[i.id]?.on} onChange={(on) => setSel({ ...sel, [i.id]: { on, qty: sel[i.id]?.qty ?? '' } })}>{i.code} · {i.name} (tồn {formatNumber(i.onHand, 3)} {i.unit})</Checkbox>
                {sel[i.id]?.on ? (
                  <FormField name={`q-${i.id}`} label={`Số lượng ${i.name}`} error={errs[i.id]}>
                    <Input name={`q-${i.id}`} value={sel[i.id].qty} onValueChange={(v) => setSel({ ...sel, [i.id]: { on: true, qty: v } })} inputMode="decimal" />
                  </FormField>
                ) : null}
              </div>
            ))}
          </div>
          <FormField name="note" label="Ghi chú"><Input name="note" value={note} onValueChange={setNote} /></FormField>
        </div>
      )}
    </FormAction>
  );
}

function ReceiveTransferDialog({ tf, onClose, onReload }: { tf: TfRow; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  const [qtys, setQtys] = useState<Record<string, string>>(() => Object.fromEntries(tf.lines.map((l) => [l.itemId, String(l.qty)])));
  const [note, setNote] = useState('');
  return (
    <FormAction
      title="Nhận hàng chuyển kho"
      subject={`Phiếu ${tf.id.slice(-8)} từ cơ sở ${tf.fromCampusId}`}
      impact={['Tạo lô nhập tại cơ sở này, giữ số lô và hạn dùng của cơ sở giao.', 'Nếu số thực nhận khác số gửi, phiếu chuyển sang «Đã nhận, có chênh lệch».', 'Phiếu chỉ nhận được một lần.']}
      confirmLabel="Xác nhận đã nhận"
      success="Đã nhận hàng chuyển kho."
      onClose={onClose}
      onReload={onReload}
      check={() => {
        const e: Record<string, string> = {};
        for (const l of tf.lines) {
          const q = parseQty(qtys[l.itemId] ?? '');
          if (q === null) e[l.itemId] = 'Nhập số lượng thực nhận (≥ 0).';
          else if (q > l.qty) e[l.itemId] = 'Không nhận nhiều hơn số đã gửi.';
        }
        return e;
      }}
      run={(opId) => call('stock.transfer.receive', { id: tf.id, lines: tf.lines.map((l) => ({ itemId: l.itemId, qtyReceived: parseQty(qtys[l.itemId]) })), note: note.trim() || undefined }, opId)}
    >
      {(errs) => (
        <div className="stack-sm">
          {tf.lines.map((l) => (
            <FormField key={l.itemId} name={`r-${l.itemId}`} label={`${l.code} · ${l.name}: gửi ${formatNumber(l.qty, 3)} ${l.unit}`} error={errs[l.itemId]}>
              <Input name={`r-${l.itemId}`} value={qtys[l.itemId] ?? ''} onValueChange={(v) => setQtys({ ...qtys, [l.itemId]: v })} inputMode="decimal" />
            </FormField>
          ))}
          <FormField name="note" label="Ghi chú"><Input name="note" value={note} onValueChange={setNote} /></FormField>
        </div>
      )}
    </FormAction>
  );
}

function TransfersTab({ items }: { items: ItemRow[] }) {
  const c = useCampusCtx();
  const { campuses } = useScope();
  const out = useCampusDocs<TfRow>('stockTransfers', toTf, { tag: 'out' });
  const inc = useCampusDocs<TfRow>('stockTransfers', toTf, { campusField: 'toCampusId', tag: 'in' });
  const [send, setSend] = useState(false);
  const [recv, setRecv] = useState<TfRow | null>(null);
  const campusName = (id: string) => campuses.find((x) => x.id === id)?.name ?? id;
  const rows = useMemo(() => {
    const m = new Map<string, TfRow>();
    [...out.data, ...inc.data].forEach((r) => m.set(r.id, r));
    return [...m.values()].sort((a, b) => b.sentAt - a.sentAt);
  }, [out.data, inc.data]);
  const status = out.status === 'error' && inc.status === 'error' ? 'error' : out.status === 'loading' || inc.status === 'loading' ? 'loading' : rows.length ? 'ready' : 'empty';
  const columns: Column<TfRow>[] = [
    { key: 'at', header: 'Ngày gửi', value: (r) => r.sentAt, sortable: true, render: (r) => formatDateTime(r.sentAt ? new Date(r.sentAt) : null) },
    { key: 'dir', header: 'Hướng', value: (r) => (r.fromCampusId === c.campusId ? 'out' : 'in'), render: (r) => (r.fromCampusId === c.campusId ? `Gửi tới ${campusName(r.toCampusId)}` : `Nhận từ ${campusName(r.fromCampusId)}`) },
    { key: 'lines', header: 'Mặt hàng', render: (r) => r.lines.map((l) => `${l.name} ${formatNumber(l.qty, 3)} ${l.unit}${l.qtyReceived !== undefined && l.qtyReceived !== l.qty ? ` (nhận ${formatNumber(l.qtyReceived, 3)})` : ''}`).join('; ') },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, render: (r) => <Tag domain="stockTransfer" value={r.status} /> },
    { key: 'actions', header: 'Thao tác', render: (r) => (r.status === 'in_transit' && r.toCampusId === c.campusId && c.can('stock.write') ? <Button size="sm" onClick={() => setRecv(r)}>Nhận hàng</Button> : null) },
  ];
  return (
    <div className="stack">
      {out.status === 'error' || inc.status === 'error' ? <Banner tone="warning">Một phần danh sách chưa tải được: {(out.error ?? inc.error)?.message}</Banner> : null}
      <DataTable
        caption="Phiếu chuyển kho"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={status}
        error={(out.error ?? inc.error)?.message}
        onRetry={() => { out.retry(); inc.retry(); }}
        toolbarExtra={c.can('stock.write') && items.length ? <Button icon="plus" onClick={() => setSend(true)}>Chuyển kho đi</Button> : undefined}
        emptyTitle="Chưa có phiếu chuyển kho"
        emptyDescription="Chuyển hàng giữa các cơ sở theo lô và hạn dùng, có xác nhận bên nhận."
      />
      {send ? <SendDialog items={items.filter((i) => i.active)} onClose={() => setSend(false)} onReload={out.retry} /> : null}
      {recv ? <ReceiveTransferDialog key={recv.id} tf={recv} onClose={() => setRecv(null)} onReload={inc.retry} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ trang */

export function W38Stock({ screen }: ScreenProps) {
  const [tab, setTab] = useState('items');
  const items = useCampusDocs<ItemRow>('stockItems', toItem);
  const lots = useCampusDocs<LotRow>('stockLots', toLot, { where: [['status', '==', 'active']] });
  return (
    <div>
      <PageHeader title={screen.title} code={screen.code} description="Nhập theo lô và hạn dùng, xuất theo FEFO, kiểm kê có duyệt chênh lệch, chuyển kho giữa các cơ sở." />
      <Tabs
        items={[{ id: 'items', label: 'Tồn kho' }, { id: 'lots', label: 'Lô và hạn dùng' }, { id: 'moves', label: 'Lịch sử' }, { id: 'take', label: 'Kiểm kê' }, { id: 'transfer', label: 'Chuyển kho' }]}
        active={tab}
        onChange={setTab}
      />
      <div style={{ marginTop: 'var(--space-4)' }}>
        {tab === 'items' ? <ItemsTab items={items} lots={lots} /> : null}
        {tab === 'lots' ? <LotsTab lots={lots} items={items.data} /> : null}
        {tab === 'moves' ? <MovesTab items={items.data} /> : null}
        {tab === 'take' ? <TakeTab items={items.data} /> : null}
        {tab === 'transfer' ? <TransfersTab items={items.data} /> : null}
      </div>
    </div>
  );
}

void Card;
void toDate;
