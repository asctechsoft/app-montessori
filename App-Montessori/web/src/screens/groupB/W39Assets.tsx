'use client';
import { useMemo, useState } from 'react';
import { collection } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import { useFirestoreQuery } from '@/lib/hooks/useFirestore';
import { useForm } from '@/lib/hooks/useForm';
import { useDirtyGuard } from '@/lib/hooks/dirtyStore';
import { useScope } from '@/providers/ScopeProvider';
import { formatDate, formatDateTime, formatVnd } from '@/lib/format';
import { PageHeader } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { Banner } from '@/components/ui/Banner';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Misc';
import { FormField, Input, Select, Textarea, DateInput, MoneyInput } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import type { ScreenProps } from '../registry';
import { KV, useCall, useCampusCtx, useCampusDocs, num, text } from './parts/kit';
import { B_STATUS, Tag } from './parts/statuses';
import { FormAction, toMs } from './parts/opsKit';

interface AssetRow {
  id: string; code: string; name: string; category: string; room: string; value: number | null; purchaseDate: string; status: string; responsibleUid: string; note: string; version?: number;
}
interface RequestRow { id: string; assetId: string; title: string; description: string; priority: string; dueDate: string; status: string; version?: number }
interface HistoryRow { id: string; from: string; to: string; at: number; by: string; note: string; assigneeUid: string; toCampusId: string; fromCampusId: string }

const toAsset = (id: string, d: Record<string, unknown>): AssetRow => ({
  id, code: text(d.code, id), name: text(d.name, id), category: text(d.category), room: text(d.room), value: typeof d.value === 'number' ? d.value : null,
  purchaseDate: text(d.purchaseDate), status: text(d.status, 'created'), responsibleUid: text(d.responsibleUid), note: text(d.note), version: typeof d.version === 'number' ? d.version : undefined,
});
const toRequest = (id: string, d: Record<string, unknown>): RequestRow => ({
  id, assetId: text(d.assetId), title: text(d.title, id), description: text(d.description), priority: text(d.priority, 'normal'), dueDate: text(d.dueDate), status: text(d.status, 'open'),
  version: typeof d.version === 'number' ? d.version : undefined,
});

/** Luồng chuyển trạng thái hợp lệ (khớp ASSET_FLOW của máy chủ). */
const FLOW: Record<string, string[]> = {
  created: ['handed_over'],
  handed_over: ['in_use', 'transferred', 'disposed'],
  in_use: ['repair_requested', 'transferred', 'disposed'],
  repair_requested: ['repair_assigned'],
  repair_assigned: ['repair_accepted'],
  repair_accepted: ['in_use'],
  transferred: ['handed_over', 'in_use'],
  disposed: [],
};
const STEP_LABEL: Record<string, string> = {
  handed_over: 'Bàn giao', in_use: 'Đưa vào sử dụng', transferred: 'Điều chuyển', disposed: 'Thanh lý', repair_requested: 'Yêu cầu sửa', repair_assigned: 'Giao sửa', repair_accepted: 'Nghiệm thu sửa',
};
const PRIORITY: Record<string, string> = { low: 'Thấp', normal: 'Bình thường', high: 'Cao', urgent: 'Khẩn' };

/* ------------------------------------------------------------------ chọn người phụ trách */

function useMemberOptions() {
  const { org, canAnywhere } = useScope();
  const ok = canAnywhere('members.read');
  const q = useFirestoreQuery<{ value: string; label: string }>(
    org && ok ? `assetMembers|${org.orgId}` : null,
    () => collection(firebase().db, 'orgs', org!.orgId, 'members'),
    (id, d) => ({ value: id, label: `${text(d.displayName, id)}${d.kind === 'parent' ? ' (phụ huynh)' : ''}`, kind: d.kind, status: d.status } as never),
  );
  const options = useMemo(() => q.data.filter((m) => !m.label.endsWith('(phụ huynh)')), [q.data]);
  return { canList: ok && q.status !== 'error', options, nameOf: (uid: string) => options.find((o) => o.value === uid)?.label ?? uid };
}

/* ------------------------------------------------------------------ biểu mẫu tài sản / yêu cầu */

function AssetDrawer({ asset, onClose }: { asset: AssetRow | null; onClose: () => void }) {
  const call = useCall();
  const toast = useToast();
  const { confirmDiscard } = useDirtyGuard();
  const [value, setValue] = useState<number | null>(asset?.value ?? null);
  const form = useForm({
    initial: { code: asset?.code ?? '', name: asset?.name ?? '', category: asset?.category ?? '', room: asset?.room ?? '', purchaseDate: asset?.purchaseDate ?? '', note: asset?.note ?? '' },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.code.trim()) e.code = 'Nhập mã tài sản.';
      if (!v.name.trim()) e.name = 'Nhập tên tài sản.';
      return e;
    },
  });
  const submit = form.onSubmit(async (v, opId) => {
    const data: Record<string, unknown> = { code: v.code.trim(), name: v.name.trim(), category: v.category.trim() || undefined, room: v.room.trim() || undefined, purchaseDate: v.purchaseDate || undefined, value: value ?? undefined, note: v.note.trim() || undefined };
    await call('entity.save', { collection: 'assets', id: asset?.id, data, expectedVersion: asset?.version }, opId);
    toast.success(asset ? 'Đã lưu tài sản.' : 'Đã thêm tài sản.');
    form.reset();
    onClose();
  });
  const dirty = form.dirty || value !== (asset?.value ?? null);
  const close = async () => {
    if (dirty && !(await confirmDiscard('đóng biểu mẫu tài sản'))) return;
    onClose();
  };
  return (
    <Drawer
      open
      title={asset ? `Sửa tài sản ${asset.code}` : 'Thêm tài sản'}
      onClose={() => void close()}
      locked={form.submitting}
      footer={
        <>
          <Button variant="secondary" onClick={() => void close()} disabled={form.submitting}>Hủy</Button>
          <Button onClick={() => void submit()} loading={form.submitting}>Lưu tài sản</Button>
        </>
      }
    >
      <form className="stack" noValidate onSubmit={submit}>
        {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
        {form.apiError?.code === 'VERSION_CONFLICT' ? <Banner tone="warning">Tài sản vừa được người khác sửa. Đóng biểu mẫu để xem bản mới nhất.</Banner> : null}
        <div className="grid-2">
          <FormField name="code" label="Mã tài sản" required {...form.field('code')}><Input {...form.bind('code')} autoComplete="off" /></FormField>
          <FormField name="name" label="Tên tài sản" required {...form.field('name')}><Input {...form.bind('name')} autoComplete="off" /></FormField>
          <FormField name="category" label="Loại" {...form.field('category')}><Input {...form.bind('category')} /></FormField>
          <FormField name="room" label="Phòng / vị trí" {...form.field('room')}><Input {...form.bind('room')} /></FormField>
          <FormField name="purchaseDate" label="Ngày mua" {...form.field('purchaseDate')}><DateInput {...form.bind('purchaseDate')} /></FormField>
          <FormField name="value" label="Giá trị"><MoneyInput name="value" value={value} onValueChange={setValue} /></FormField>
        </div>
        <FormField name="note" label="Ghi chú" {...form.field('note')}><Textarea {...form.bind('note')} /></FormField>
      </form>
    </Drawer>
  );
}

function RequestDrawer({ assets, onClose }: { assets: AssetRow[]; onClose: () => void }) {
  const call = useCall();
  const toast = useToast();
  const { confirmDiscard } = useDirtyGuard();
  const form = useForm({
    initial: { assetId: '', title: '', description: '', priority: 'normal', dueDate: '' },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.title.trim()) e.title = 'Nhập nội dung yêu cầu.';
      return e;
    },
  });
  const submit = form.onSubmit(async (v, opId) => {
    await call('entity.save', { collection: 'assetRequests', data: { assetId: v.assetId || undefined, title: v.title.trim(), description: v.description.trim() || undefined, priority: v.priority, dueDate: v.dueDate || undefined } }, opId);
    toast.success('Đã tạo yêu cầu bảo trì.');
    form.reset();
    onClose();
  });
  const close = async () => {
    if (form.dirty && !(await confirmDiscard('đóng biểu mẫu yêu cầu'))) return;
    onClose();
  };
  return (
    <Drawer
      open
      title="Tạo yêu cầu bảo trì"
      onClose={() => void close()}
      locked={form.submitting}
      footer={
        <>
          <Button variant="secondary" onClick={() => void close()} disabled={form.submitting}>Hủy</Button>
          <Button onClick={() => void submit()} loading={form.submitting}>Tạo yêu cầu</Button>
        </>
      }
    >
      <form className="stack" noValidate onSubmit={submit}>
        {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
        <FormField name="assetId" label="Tài sản liên quan" {...form.field('assetId')}>
          <Select {...form.bind('assetId')} placeholder="Không gắn tài sản" options={assets.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
        </FormField>
        <FormField name="title" label="Nội dung" required {...form.field('title')}><Input {...form.bind('title')} /></FormField>
        <FormField name="description" label="Mô tả" {...form.field('description')}><Textarea {...form.bind('description')} /></FormField>
        <div className="grid-2">
          <FormField name="priority" label="Mức ưu tiên" {...form.field('priority')}>
            <Select {...form.bind('priority')} options={Object.entries(PRIORITY).map(([value, label]) => ({ value, label }))} />
          </FormField>
          <FormField name="dueDate" label="Hạn xử lý" {...form.field('dueDate')}><DateInput {...form.bind('dueDate')} /></FormField>
        </div>
      </form>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ chuyển trạng thái */

function TransitionDialog({ asset, to, onClose, onReload }: { asset: AssetRow; to: string; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  const c = useCampusCtx();
  const { campuses } = useScope();
  const members = useMemberOptions();
  const [assignee, setAssignee] = useState('');
  const [note, setNote] = useState('');
  const [toCampus, setToCampus] = useState('');
  const [room, setRoom] = useState('');
  const needAssignee = to === 'handed_over' || to === 'repair_assigned';
  const needNote = to === 'disposed' || to === 'repair_requested';
  const label = STEP_LABEL[to] ?? to;
  const impact: string[] = [
    `Trạng thái đổi từ «${B_STATUS.asset[asset.status as keyof typeof B_STATUS.asset]?.label ?? asset.status}» sang «${B_STATUS.asset[to as keyof typeof B_STATUS.asset]?.label ?? to}».`,
    'Ghi một dòng lịch sử (ai, khi nào, ghi chú) không sửa được.',
  ];
  if (to === 'repair_requested') impact.push('Tạo yêu cầu sửa chữa gắn với tài sản.');
  if (to === 'transferred') impact.push('Tài sản được chuyển sang cơ sở nhận; cơ sở này không còn quản lý tài sản đó.');
  if (to === 'disposed') impact.push('Thanh lý là bước cuối: tài sản không thể dùng lại.');
  return (
    <FormAction
      title={`${label} tài sản`}
      subject={`${asset.code} · ${asset.name}`}
      impact={impact}
      confirmLabel={`${label}`}
      tone={to === 'disposed' ? 'destructive' : 'primary'}
      success={`Đã ${label.toLowerCase()}.`}
      onClose={onClose}
      onReload={onReload}
      check={() => {
        const e: Record<string, string> = {};
        if (needAssignee && !assignee.trim()) e.assignee = 'Chọn người chịu trách nhiệm.';
        if (needNote && note.trim().length < 5) e.note = 'Ghi lý do/mô tả (tối thiểu 5 ký tự).';
        if (to === 'transferred' && !toCampus) e.toCampus = 'Chọn cơ sở nhận.';
        return e;
      }}
      run={(opId) =>
        call('asset.transition', { assetId: asset.id, to, assigneeUid: assignee.trim() || undefined, note: note.trim() || undefined, toCampusId: toCampus || undefined, room: room.trim() || undefined }, opId)
      }
    >
      {(errs) => (
        <div className="stack-sm">
          {needAssignee || to === 'transferred' || to === 'in_use' ? (
            <FormField name="assignee" label="Người chịu trách nhiệm" required={needAssignee} error={errs.assignee} helper={members.canList ? undefined : 'Không có quyền xem danh sách tài khoản: nhập mã tài khoản (uid) của nhân viên.'}>
              {members.canList ? (
                <Select name="assignee" value={assignee} onValueChange={setAssignee} placeholder="Chọn nhân viên" options={members.options} />
              ) : (
                <Input name="assignee" value={assignee} onValueChange={setAssignee} autoComplete="off" />
              )}
            </FormField>
          ) : null}
          {to === 'transferred' ? (
            <>
              <FormField name="toCampus" label="Cơ sở nhận" required error={errs.toCampus}>
                <Select name="toCampus" value={toCampus} onValueChange={setToCampus} placeholder="Chọn cơ sở" options={campuses.map((x) => ({ value: x.id, label: x.id === c.campusId ? `${x.name} (cơ sở hiện tại)` : x.name }))} />
              </FormField>
              <FormField name="room" label="Phòng / vị trí mới"><Input name="room" value={room} onValueChange={setRoom} /></FormField>
            </>
          ) : null}
          <FormField name="note" label={needNote ? 'Lý do / mô tả' : 'Ghi chú'} required={needNote} error={errs.note}>
            <Textarea name="note" value={note} onValueChange={setNote} />
          </FormField>
        </div>
      )}
    </FormAction>
  );
}

/* ------------------------------------------------------------------ lịch sử */

function HistoryDrawer({ asset, onClose }: { asset: AssetRow; onClose: () => void }) {
  const { org } = useScope();
  const members = useMemberOptions();
  const q = useFirestoreQuery<HistoryRow>(
    org ? `assetHist|${org.orgId}|${asset.id}` : null,
    () => collection(firebase().db, 'orgs', org!.orgId, 'assets', asset.id, 'history'),
    (id, d) => ({ id, from: text(d.from), to: text(d.to), at: toMs(d.at), by: text(d.by), note: text(d.note), assigneeUid: text(d.assigneeUid), toCampusId: text(d.toCampusId), fromCampusId: text(d.fromCampusId) }),
  );
  const rows = [...q.data].sort((a, b) => b.at - a.at);
  const lbl = (s: string) => B_STATUS.asset[s as keyof typeof B_STATUS.asset]?.label ?? s;
  return (
    <Drawer open title={`Lịch sử ${asset.code}`} onClose={onClose}>
      {q.status === 'loading' ? <Skeleton height={80} /> : null}
      {q.status === 'error' ? <ErrorState message={q.error?.message} onRetry={q.retry} /> : null}
      {q.status === 'empty' ? <EmptyState title="Chưa có lịch sử chuyển trạng thái" /> : null}
      {q.status === 'ready' ? (
        <ol className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {rows.map((h) => (
            <li key={h.id} className="card">
              <strong>{lbl(h.from)} → {lbl(h.to)}</strong>
              <div className="text-small text-secondary">{formatDateTime(h.at ? new Date(h.at) : null)}</div>
              {h.assigneeUid ? <div className="text-small">Người phụ trách: {members.nameOf(h.assigneeUid)}</div> : null}
              {h.toCampusId && h.toCampusId !== h.fromCampusId ? <div className="text-small">Điều chuyển sang cơ sở {h.toCampusId}</div> : null}
              {h.note ? <div className="text-small">{h.note}</div> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </Drawer>
  );
}

/* ------------------------------------------------------------------ tab */

function AssetsTab({ assets, onRequest }: { assets: ReturnType<typeof useCampusDocs<AssetRow>>; onRequest: () => void }) {
  const c = useCampusCtx();
  const members = useMemberOptions();
  const canWrite = c.can('assets.write');
  const [edit, setEdit] = useState<AssetRow | 'new' | null>(null);
  const [trans, setTrans] = useState<{ asset: AssetRow; to: string } | null>(null);
  const [hist, setHist] = useState<AssetRow | null>(null);
  void onRequest;
  const columns: Column<AssetRow>[] = [
    { key: 'code', header: 'Mã', value: (r) => r.code, sortable: true, width: 110 },
    { key: 'name', header: 'Tài sản', value: (r) => r.name, sortable: true, render: (r) => <strong>{r.name}</strong> },
    { key: 'cat', header: 'Loại', value: (r) => r.category },
    { key: 'room', header: 'Vị trí', value: (r) => r.room },
    { key: 'resp', header: 'Phụ trách', value: (r) => r.responsibleUid, render: (r) => (r.responsibleUid ? members.nameOf(r.responsibleUid) : '—') },
    { key: 'value', header: 'Giá trị', value: (r) => r.value, align: 'right', render: (r) => (r.value === null ? '—' : formatVnd(r.value)) },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, sortable: true, render: (r) => <Tag domain="asset" value={r.status} /> },
    {
      key: 'actions', header: 'Thao tác',
      render: (r) => (
        <div className="row" style={{ gap: 'var(--space-1)' }}>
          {canWrite ? (FLOW[r.status] ?? []).map((to) => (
            <Button key={to} size="sm" variant={to === 'disposed' ? 'destructiveOutline' : 'secondary'} onClick={(e) => { e.stopPropagation(); setTrans({ asset: r, to }); }}>{STEP_LABEL[to]}</Button>
          )) : null}
          {canWrite && r.status !== 'disposed' ? <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setEdit(r); }}>Sửa</Button> : null}
        </div>
      ),
    },
  ];
  const filters: TableFilter<AssetRow>[] = [
    { key: 'status', label: 'Trạng thái', options: Object.entries(B_STATUS.asset).map(([value, s]) => ({ value, label: s.label })), predicate: (r, v) => r.status === v },
  ];
  return (
    <div className="stack">
      <DataTable
        caption="Danh sách tài sản"
        columns={columns}
        rows={assets.data}
        rowKey={(r) => r.id}
        status={assets.status}
        error={assets.error?.message}
        onRetry={assets.retry}
        onRowClick={setHist}
        searchText={(r) => `${r.code} ${r.name} ${r.category} ${r.room}`}
        searchPlaceholder="Tìm theo mã, tên, loại, vị trí"
        filters={filters}
        toolbarExtra={canWrite ? <Button icon="plus" onClick={() => setEdit('new')}>Thêm tài sản</Button> : undefined}
        emptyTitle="Chưa có tài sản nào"
        emptyDescription="Thêm tài sản rồi bàn giao cho người phụ trách. Bấm vào một dòng để xem lịch sử."
      />
      {edit ? <AssetDrawer key={edit === 'new' ? 'new' : edit.id} asset={edit === 'new' ? null : edit} onClose={() => setEdit(null)} /> : null}
      {trans ? <TransitionDialog key={trans.asset.id + trans.to} asset={trans.asset} to={trans.to} onClose={() => setTrans(null)} onReload={assets.retry} /> : null}
      {hist ? <HistoryDrawer asset={hist} onClose={() => setHist(null)} /> : null}
    </div>
  );
}

function RequestsTab({ assets, openNew }: { assets: AssetRow[]; openNew: boolean }) {
  const c = useCampusCtx();
  const q = useCampusDocs<RequestRow>('assetRequests', toRequest);
  const [show, setShow] = useState(openNew);
  const [view, setView] = useState<RequestRow | null>(null);
  const name = (id: string) => assets.find((a) => a.id === id);
  const rows = useMemo(() => [...q.data].sort((a, b) => (b.dueDate || '').localeCompare(a.dueDate || '')), [q.data]);
  const columns: Column<RequestRow>[] = [
    { key: 'title', header: 'Yêu cầu', value: (r) => r.title, sortable: true, render: (r) => <strong>{r.title}</strong> },
    { key: 'asset', header: 'Tài sản', value: (r) => name(r.assetId)?.name ?? '', render: (r) => (name(r.assetId) ? `${name(r.assetId)!.code} · ${name(r.assetId)!.name}` : '—') },
    { key: 'prio', header: 'Ưu tiên', value: (r) => r.priority, render: (r) => PRIORITY[r.priority] ?? r.priority },
    { key: 'due', header: 'Hạn', value: (r) => r.dueDate, sortable: true, render: (r) => (r.dueDate ? formatDate(r.dueDate) : '—') },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, render: (r) => <Tag domain="assetRequest" value={r.status} /> },
  ];
  return (
    <div className="stack">
      <DataTable
        caption="Yêu cầu bảo trì"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={q.status}
        error={q.error?.message}
        onRetry={q.retry}
        onRowClick={setView}
        searchText={(r) => `${r.title} ${name(r.assetId)?.name ?? ''}`}
        searchPlaceholder="Tìm theo nội dung, tài sản"
        toolbarExtra={c.can('assets.write') ? <Button icon="plus" onClick={() => setShow(true)}>Tạo yêu cầu</Button> : undefined}
        emptyTitle="Chưa có yêu cầu bảo trì"
        emptyDescription="Yêu cầu sửa chữa tạo từ tài sản hoặc tạo trực tiếp tại đây."
      />
      {show ? <RequestDrawer assets={assets} onClose={() => setShow(false)} /> : null}
      {view ? (
        <Drawer open title="Chi tiết yêu cầu" onClose={() => setView(null)}>
          <KV items={[['Nội dung', view.title], ['Tài sản', name(view.assetId)?.name], ['Ưu tiên', PRIORITY[view.priority] ?? view.priority], ['Hạn', view.dueDate ? formatDate(view.dueDate) : ''], ['Trạng thái', <Tag key="s" domain="assetRequest" value={view.status} />], ['Mô tả', view.description]]} />
        </Drawer>
      ) : null}
    </div>
  );
}

export function W39Assets({ screen }: ScreenProps) {
  const [tab, setTab] = useState('assets');
  const assets = useCampusDocs<AssetRow>('assets', toAsset);
  const stats = useMemo(() => ({ repair: assets.data.filter((a) => a.status.startsWith('repair')).length }), [assets.data]);
  return (
    <div>
      <PageHeader title={screen.title} code={screen.code} description="Vòng đời tài sản: bàn giao, sử dụng, sửa chữa, điều chuyển, thanh lý. Mỗi bước được lưu lịch sử." />
      {stats.repair ? <Banner tone="warning" title={`${stats.repair} tài sản đang trong quy trình sửa chữa`}>Theo dõi ở tab «Tài sản» (lọc theo trạng thái).</Banner> : null}
      <Tabs items={[{ id: 'assets', label: 'Tài sản' }, { id: 'requests', label: 'Yêu cầu bảo trì' }]} active={tab} onChange={setTab} />
      <div style={{ marginTop: 'var(--space-4)' }}>
        {tab === 'assets' ? <AssetsTab assets={assets} onRequest={() => setTab('requests')} /> : <RequestsTab assets={assets.data} openNew={false} />}
      </div>
    </div>
  );
}

void num;
