'use client';
import { useMemo, useState } from 'react';
import { collection } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import { useFirestoreQuery } from '@/lib/hooks/useFirestore';
import { useForm } from '@/lib/hooks/useForm';
import { useDirtyGuard } from '@/lib/hooks/dirtyStore';
import { useScope } from '@/providers/ScopeProvider';
import { dayKey, formatDate, formatTime } from '@/lib/format';
import { PageHeader } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { Banner } from '@/components/ui/Banner';
import { Stat } from '@/components/ui/Misc';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { FormField, Input, Select, Textarea, DateInput, Checkbox } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import type { ScreenProps } from '../registry';
import { ErrorDetails, KV, num, text, toDate, useCall, useCampusCtx, useCampusDocs } from './parts/kit';
import { B_STATUS, Tag } from './parts/statuses';
import { FormAction } from './parts/opsKit';

interface RouteRow { id: string; code: string; name: string; vehicle: string; driverName: string; monitorName: string; stops: string[]; childIds: string[]; active: boolean; version?: number }
interface TripRow {
  id: string; routeId: string; dayKey: string; direction: string; vehicle: string; status: string; expectedCount: number; onboardCount: number; note: string;
  problems: string[]; version?: number;
}
interface RiderRow { id: string; childId: string; childName: string; status: string; registered: boolean; boardedAt: unknown; alightedAt: unknown; receivedBy: string; note: string }
interface ChildOpt { id: string; name: string }

const DIRECTION: Record<string, string> = { to_school: 'Đón đến trường', to_home: 'Trả về nhà' };

const toRoute = (id: string, d: Record<string, unknown>): RouteRow => ({
  id, code: text(d.code, id), name: text(d.name, id), vehicle: text(d.vehicle), driverName: text(d.driverName), monitorName: text(d.monitorName),
  stops: Array.isArray(d.stops) ? (d.stops as unknown[]).map((s) => (typeof s === 'string' ? s : text((s as Record<string, unknown>)?.name))) : [],
  childIds: Array.isArray(d.childIds) ? (d.childIds as string[]) : [], active: d.active !== false, version: typeof d.version === 'number' ? d.version : undefined,
});
const toTrip = (id: string, d: Record<string, unknown>): TripRow => ({
  id, routeId: text(d.routeId), dayKey: text(d.dayKey), direction: text(d.direction, 'to_school'), vehicle: text(d.vehicle), status: text(d.status, 'planned'),
  expectedCount: num(d.expectedCount), onboardCount: num(d.onboardCount), note: text(d.note),
  problems: Array.isArray((d.endCheck as Record<string, unknown> | undefined)?.problems) ? (((d.endCheck as Record<string, unknown>).problems) as string[]) : [],
  version: typeof d.version === 'number' ? d.version : undefined,
});

function useChildOptions() {
  const c = useCampusCtx();
  return useCampusDocs<ChildOpt>('children', (id, d) => ({ id, name: text(d.fullName, text(d.name, id)) }), { enabled: c.can('children.read') });
}

/* ------------------------------------------------------------------ tuyến */

function RouteDrawer({ route, onClose }: { route: RouteRow | null; onClose: () => void }) {
  const call = useCall();
  const c = useCampusCtx();
  const toast = useToast();
  const { confirmDiscard } = useDirtyGuard();
  const children = useChildOptions();
  const [childIds, setChildIds] = useState<string[]>(route?.childIds ?? []);
  const [manualIds, setManualIds] = useState((route?.childIds ?? []).join(', '));
  const canPick = c.can('children.read');
  const form = useForm({
    initial: { code: route?.code ?? '', name: route?.name ?? '', vehicle: route?.vehicle ?? '', driverName: route?.driverName ?? '', monitorName: route?.monitorName ?? '', stops: (route?.stops ?? []).join('\n'), active: route?.active ?? true },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.code.trim()) e.code = 'Nhập mã tuyến.';
      if (!v.name.trim()) e.name = 'Nhập tên tuyến.';
      if (v.stops.split('\n').filter((s) => s.trim()).length > 60) e.stops = 'Tối đa 60 điểm dừng.';
      return e;
    },
  });
  const ids = canPick ? childIds : manualIds.split(/[\s,;]+/).filter(Boolean);
  const dirty = form.dirty || (canPick ? childIds.join() !== (route?.childIds ?? []).join() : manualIds !== (route?.childIds ?? []).join(', '));
  const submit = form.onSubmit(async (v, opId) => {
    await call('entity.save', {
      collection: 'routes', ...(route ? { id: route.id, expectedVersion: route.version } : {}),
      data: { code: v.code.trim(), name: v.name.trim(), vehicle: v.vehicle.trim() || undefined, driverName: v.driverName.trim() || undefined, monitorName: v.monitorName.trim() || undefined, stops: v.stops.split('\n').map((s) => s.trim()).filter(Boolean), childIds: ids, active: v.active },
    }, opId);
    toast.success(route ? 'Đã lưu tuyến.' : 'Đã tạo tuyến.');
    form.reset();
    onClose();
  });
  const close = async () => {
    if (dirty && !(await confirmDiscard('đóng biểu mẫu tuyến'))) return;
    onClose();
  };
  return (
    <Drawer
      open
      title={route ? `Sửa tuyến ${route.code}` : 'Thêm tuyến xe'}
      onClose={() => void close()}
      locked={form.submitting}
      footer={
        <>
          <Button variant="secondary" onClick={() => void close()} disabled={form.submitting}>Hủy</Button>
          <Button onClick={() => void submit()} loading={form.submitting}>Lưu tuyến</Button>
        </>
      }
    >
      <form className="stack" noValidate onSubmit={submit}>
        {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
        <ErrorDetails error={form.apiError} />
        <div className="grid-2">
          <FormField name="code" label="Mã tuyến" required {...form.field('code')}><Input {...form.bind('code')} autoComplete="off" /></FormField>
          <FormField name="name" label="Tên tuyến" required {...form.field('name')}><Input {...form.bind('name')} /></FormField>
          <FormField name="vehicle" label="Biển số xe" {...form.field('vehicle')}><Input {...form.bind('vehicle')} /></FormField>
          <FormField name="driverName" label="Lái xe" {...form.field('driverName')}><Input {...form.bind('driverName')} /></FormField>
          <FormField name="monitorName" label="Giám sát / phụ xe" {...form.field('monitorName')}><Input {...form.bind('monitorName')} /></FormField>
        </div>
        <FormField name="stops" label="Điểm dừng (mỗi dòng một điểm)" {...form.field('stops')}><Textarea {...form.bind('stops')} /></FormField>
        {canPick ? (
          <FormField name="childIds" label={`Trẻ đăng ký tuyến (${childIds.length})`}>
            <div id="field-childIds" style={{ maxHeight: 220, overflow: 'auto' }} className="stack-sm">
              {children.status === 'loading' ? <span className="text-secondary">Đang tải danh sách trẻ…</span> : children.error ? <span className="text-secondary">{children.error.message}</span> : null}
              {children.data.map((k) => (
                <Checkbox key={k.id} checked={childIds.includes(k.id)} onChange={(on) => setChildIds((cur) => (on ? [...cur, k.id] : cur.filter((x) => x !== k.id)))}>{k.name}</Checkbox>
              ))}
            </div>
          </FormField>
        ) : (
          <FormField name="childIds" label="Mã trẻ đăng ký (cách nhau bằng dấu phẩy)" helper="Bạn không có quyền xem danh sách trẻ nên chỉ nhập được mã trẻ."><Input name="childIds" value={manualIds} onValueChange={setManualIds} /></FormField>
        )}
        <Checkbox checked={form.values.active} onChange={(v) => form.setValue('active', v)}>Tuyến đang hoạt động</Checkbox>
      </form>
    </Drawer>
  );
}

function RoutesTab({ routes }: { routes: ReturnType<typeof useCampusDocs<RouteRow>> }) {
  const c = useCampusCtx();
  const [edit, setEdit] = useState<RouteRow | 'new' | null>(null);
  const canWrite = c.can('transport.write');
  const columns: Column<RouteRow>[] = [
    { key: 'code', header: 'Mã', value: (r) => r.code, sortable: true, width: 100 },
    { key: 'name', header: 'Tuyến', value: (r) => r.name, sortable: true, render: (r) => <strong>{r.name}</strong> },
    { key: 'vehicle', header: 'Xe', value: (r) => r.vehicle },
    { key: 'driver', header: 'Lái xe / giám sát', value: (r) => r.driverName, render: (r) => [r.driverName, r.monitorName].filter(Boolean).join(' / ') || '—' },
    { key: 'stops', header: 'Điểm dừng', value: (r) => r.stops.length, render: (r) => `${r.stops.length} điểm` },
    { key: 'kids', header: 'Trẻ đăng ký', value: (r) => r.childIds.length, sortable: true },
    { key: 'active', header: 'Hoạt động', value: (r) => (r.active ? 1 : 0), render: (r) => (r.active ? 'Có' : 'Tạm dừng') },
  ];
  return (
    <>
      <DataTable
        caption="Tuyến xe"
        columns={columns}
        rows={routes.data}
        rowKey={(r) => r.id}
        status={routes.status}
        error={routes.error?.message}
        onRetry={routes.retry}
        onRowClick={canWrite ? setEdit : undefined}
        searchText={(r) => `${r.code} ${r.name} ${r.vehicle} ${r.driverName}`}
        searchPlaceholder="Tìm theo mã, tên, xe, lái xe"
        toolbarExtra={canWrite ? <Button icon="plus" onClick={() => setEdit('new')}>Thêm tuyến</Button> : undefined}
        emptyTitle="Chưa có tuyến xe"
        emptyDescription="Tạo tuyến, điểm dừng và danh sách trẻ đăng ký để lập chuyến mỗi ngày."
      />
      {edit ? <RouteDrawer key={edit === 'new' ? 'new' : edit.id} route={edit === 'new' ? null : edit} onClose={() => setEdit(null)} /> : null}
    </>
  );
}

/* ------------------------------------------------------------------ chuyến */

function TripDrawer({ routes, onClose }: { routes: RouteRow[]; onClose: () => void }) {
  const call = useCall();
  const c = useCampusCtx();
  const toast = useToast();
  const { confirmDiscard } = useDirtyGuard();
  const form = useForm({
    initial: { routeId: '', dayKey: dayKey(new Date(), c.tz), direction: 'to_school', note: '' },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.routeId) e.routeId = 'Chọn tuyến.';
      if (!v.dayKey) e.dayKey = 'Chọn ngày chạy.';
      return e;
    },
  });
  const submit = form.onSubmit(async (v, opId) => {
    const r = routes.find((x) => x.id === v.routeId);
    await call('entity.save', { collection: 'trips', data: { routeId: v.routeId, dayKey: v.dayKey, direction: v.direction, vehicle: r?.vehicle || undefined, note: v.note.trim() || undefined } }, opId);
    toast.success('Đã tạo chuyến.');
    form.reset();
    onClose();
  });
  const close = async () => {
    if (form.dirty && !(await confirmDiscard('đóng biểu mẫu chuyến'))) return;
    onClose();
  };
  return (
    <Drawer
      open
      title="Tạo chuyến xe"
      onClose={() => void close()}
      locked={form.submitting}
      footer={
        <>
          <Button variant="secondary" onClick={() => void close()} disabled={form.submitting}>Hủy</Button>
          <Button onClick={() => void submit()} loading={form.submitting}>Tạo chuyến</Button>
        </>
      }
    >
      <form className="stack" noValidate onSubmit={submit}>
        {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
        <ErrorDetails error={form.apiError} />
        <FormField name="routeId" label="Tuyến" required {...form.field('routeId')}>
          <Select {...form.bind('routeId')} placeholder="Chọn tuyến" options={routes.filter((r) => r.active).map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }))} />
        </FormField>
        <div className="grid-2">
          <FormField name="dayKey" label="Ngày chạy" required {...form.field('dayKey')}><DateInput {...form.bind('dayKey')} /></FormField>
          <FormField name="direction" label="Chiều" required {...form.field('direction')}>
            <Select {...form.bind('direction')} options={Object.entries(DIRECTION).map(([value, label]) => ({ value, label }))} />
          </FormField>
        </div>
        <FormField name="note" label="Ghi chú" {...form.field('note')}><Textarea {...form.bind('note')} /></FormField>
      </form>
    </Drawer>
  );
}

function ReceiverDialog({ tripId, rider, onClose, onReload }: { tripId: string; rider: RiderRow; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [method, setMethod] = useState('id_check');
  const [pickupId, setPickupId] = useState('');
  return (
    <FormAction
      title="Bàn giao trẻ"
      subject={rider.childName}
      impact={['Ghi người nhận, quan hệ, cách xác minh và thời điểm; không sửa được.', 'Chuyến về nhà: người nhận phải có ủy quyền đón hiệu lực hoặc được xác minh trực tiếp.']}
      confirmLabel="Xác nhận bàn giao"
      success={`Đã bàn giao ${rider.childName}.`}
      onClose={onClose}
      onReload={onReload}
      check={() => {
        const e: Record<string, string> = {};
        if (!name.trim()) e.name = 'Nhập họ tên người nhận.';
        if (!relation.trim()) e.relation = 'Nhập quan hệ với trẻ.';
        return e;
      }}
      run={(opId) => call('trip.handover', { tripId, childId: rider.childId, receivedBy: { name: name.trim(), relation: relation.trim(), ...(pickupId.trim() ? { pickupPersonId: pickupId.trim() } : {}) }, ...(pickupId.trim() ? {} : { verification: { method } }) }, opId)}
    >
      {(errs) => (
        <div className="stack">
          <FormField name="rcv-name" label="Họ tên người nhận" required error={errs.name}><Input name="rcv-name" value={name} onValueChange={setName} /></FormField>
          <FormField name="rcv-rel" label="Quan hệ với trẻ" required error={errs.relation}><Input name="rcv-rel" value={relation} onValueChange={setRelation} /></FormField>
          <FormField name="rcv-pickup" label="Mã ủy quyền đón (nếu có)"><Input name="rcv-pickup" value={pickupId} onValueChange={setPickupId} /></FormField>
          {!pickupId.trim() ? (
            <FormField name="rcv-method" label="Cách xác minh">
              <Select name="rcv-method" value={method} onValueChange={setMethod} options={[{ value: 'id_check', label: 'Kiểm tra giấy tờ' }, { value: 'qr', label: 'Mã QR' }, { value: 'otp', label: 'Mã OTP' }, { value: 'phone_call', label: 'Gọi điện xác nhận' }]} />
            </FormField>
          ) : null}
        </div>
      )}
    </FormAction>
  );
}

function BoardUnregisteredDialog({ tripId, onClose, onReload }: { tripId: string; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  const [childId, setChildId] = useState('');
  const [note, setNote] = useState('');
  return (
    <FormAction
      title="Trẻ ngoài danh sách đăng ký lên xe"
      impact={['Trẻ được ghi nhận lên xe với đánh dấu «ngoài danh sách đăng ký» kèm ghi chú.', 'Số trẻ trên xe tăng thêm 1 và được đối chiếu khi kết thúc chuyến.']}
      confirmLabel="Ghi nhận lên xe"
      success="Đã ghi nhận trẻ lên xe."
      onClose={onClose}
      onReload={onReload}
      check={() => {
        const e: Record<string, string> = {};
        if (!childId.trim()) e.childId = 'Nhập mã trẻ.';
        if (note.trim().length < 3) e.note = 'Ghi chú lý do (tối thiểu 3 ký tự).';
        return e;
      }}
      run={(opId) => call('trip.board', { tripId, childId: childId.trim(), allowUnregistered: true, note: note.trim() }, opId)}
    >
      {(errs) => (
        <div className="stack">
          <FormField name="ub-child" label="Mã trẻ" required error={errs.childId}><Input name="ub-child" value={childId} onValueChange={setChildId} autoComplete="off" /></FormField>
          <FormField name="ub-note" label="Ghi chú" required error={errs.note}><Textarea name="ub-note" value={note} onValueChange={setNote} /></FormField>
        </div>
      )}
    </FormAction>
  );
}

function EndCheckDialog({ trip, systemOnboard, onClose, onReload }: { trip: TripRow; systemOnboard: number; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  const [counted, setCounted] = useState('');
  const [empty, setEmpty] = useState(false);
  const [note, setNote] = useState('');
  return (
    <FormAction
      title="Kết thúc chuyến và đối chiếu số trẻ"
      subject={`${DIRECTION[trip.direction] ?? trip.direction} · ${formatDate(trip.dayKey)}`}
      impact={[
        `Hệ thống đang ghi ${systemOnboard} trẻ còn trên xe. Số này phải bằng 0 và bằng số bạn đếm thực tế.`,
        'Nếu lệch hoặc xe chưa trống: chuyến chuyển sang «Cần rà soát» và tạo cảnh báo nghiêm trọng; không kết thúc chuyến.',
      ]}
      confirmLabel="Kết thúc chuyến"
      success="Đã kết thúc chuyến, số trẻ đã khớp."
      onClose={onClose}
      onReload={onReload}
      check={() => {
        const e: Record<string, string> = {};
        if (!/^\d{1,3}$/.test(counted.trim())) e.counted = 'Nhập số trẻ đếm thực tế còn trên xe (số nguyên ≥ 0).';
        return e;
      }}
      run={(opId) => call('trip.endCheck', { tripId: trip.id, vehicleEmpty: empty, countedOnboard: Number(counted), note: note.trim() || undefined }, opId)}
    >
      {(errs) => (
        <div className="stack">
          <FormField name="ec-count" label="Số trẻ đếm thực tế còn trên xe" required error={errs.counted}><Input name="ec-count" value={counted} onValueChange={setCounted} inputMode="numeric" /></FormField>
          <Checkbox checked={empty} onChange={setEmpty}>Tôi đã kiểm tra từng hàng ghế: xe đã trống, không sót trẻ hay đồ vật</Checkbox>
          <FormField name="ec-note" label="Ghi chú"><Textarea name="ec-note" value={note} onValueChange={setNote} /></FormField>
        </div>
      )}
    </FormAction>
  );
}

function TripDetail({ trip, route, onClose, onReload }: { trip: TripRow; route: RouteRow | undefined; onClose: () => void; onReload: () => void }) {
  const c = useCampusCtx();
  const { org } = useScope();
  const call = useCall();
  const toast = useToast();
  const canWrite = c.can('transport.write');
  const riders = useFirestoreQuery<RiderRow>(
    org ? `riders|${org.orgId}|${trip.id}` : null,
    () => collection(firebase().db, 'orgs', org!.orgId, 'trips', trip.id, 'riders'),
    (id, d) => ({
      id, childId: text(d.childId, id), childName: text(d.childName, text(d.childId, id)), status: text(d.status, 'expected'), registered: d.registered !== false,
      boardedAt: d.boardedAt, alightedAt: d.alightedAt, receivedBy: text((d.receivedBy as Record<string, unknown> | undefined)?.name), note: text(d.note),
    }),
  );
  const [busyId, setBusyId] = useState('');
  const [receiver, setReceiver] = useState<RiderRow | null>(null);
  const [unreg, setUnreg] = useState(false);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const count = (s: string) => riders.data.filter((r) => r.status === s).length;
  const expected = riders.data.filter((r) => r.registered).length;
  const boarded = riders.data.filter((r) => r.boardedAt).length;
  const still = count('onboard');

  const act = async (r: RiderRow, action: 'trip.board' | 'trip.alight') => {
    setBusyId(r.id);
    setErr(null);
    try {
      await call(action, { tripId: trip.id, childId: r.childId }, `${action}-${trip.id}-${r.childId}-${Date.now()}`.replace(/[^A-Za-z0-9_-]/g, '-'));
      toast.success(action === 'trip.board' ? `${r.childName} đã lên xe.` : `${r.childName} đã xuống xe.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId('');
    }
  };

  const columns: Column<RiderRow>[] = [
    { key: 'name', header: 'Trẻ', value: (r) => r.childName, sortable: true, render: (r) => <>{r.childName}{r.registered ? '' : ' (ngoài danh sách)'}</> },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, render: (r) => <Tag domain="rider" value={r.status} /> },
    { key: 'board', header: 'Lên xe', value: (r) => (toDate(r.boardedAt as never)?.getTime() ?? 0), render: (r) => (r.boardedAt ? formatTime(toDate(r.boardedAt as never), c.tz) : '—') },
    { key: 'alight', header: 'Xuống xe', value: (r) => (toDate(r.alightedAt as never)?.getTime() ?? 0), render: (r) => (r.alightedAt ? formatTime(toDate(r.alightedAt as never), c.tz) : '—') },
    { key: 'rcv', header: 'Người nhận', value: (r) => r.receivedBy, render: (r) => r.receivedBy || '—' },
    {
      key: 'act', header: 'Thao tác',
      render: (r) => {
        if (!canWrite || trip.status !== 'in_progress') return null;
        return (
          <div className="row" style={{ gap: 'var(--space-1)', flexWrap: 'nowrap' }}>
            {r.status === 'expected' ? <Button size="sm" variant="secondary" loading={busyId === r.id} onClick={() => void act(r, 'trip.board')}>Lên xe</Button> : null}
            {r.status === 'onboard' ? <Button size="sm" variant="secondary" loading={busyId === r.id} onClick={() => void act(r, 'trip.alight')}>Xuống xe</Button> : null}
            {r.status === 'onboard' || r.status === 'alighted' ? <Button size="sm" variant="tertiary" onClick={() => setReceiver(r)}>Bàn giao</Button> : null}
          </div>
        );
      },
    },
  ];
  const filters: TableFilter<RiderRow>[] = [{ key: 'status', label: 'Trạng thái', options: Object.entries(B_STATUS.rider).map(([value, s]) => ({ value, label: s.label })), predicate: (r, v) => r.status === v }];

  return (
    <Drawer open title={`${route?.name ?? 'Chuyến'} · ${formatDate(trip.dayKey)}`} onClose={onClose}>
      <div className="stack">
        <KV items={[['Chiều', DIRECTION[trip.direction] ?? trip.direction], ['Trạng thái', <Tag key="s" domain="trip" value={trip.status} />], ['Xe', trip.vehicle || route?.vehicle], ['Lái xe / giám sát', [route?.driverName, route?.monitorName].filter(Boolean).join(' / ')]]} />
        {trip.status === 'needs_review' ? (
          <Banner tone="error" title="Chênh lệch số trẻ trên xe — cần rà soát ngay">
            {trip.problems.length ? <ul style={{ margin: 0, paddingLeft: 20 }}>{trip.problems.map((p) => <li key={p}>{p}</li>)}</ul> : 'Kiểm tra lại từng trẻ trên xe, sau đó đối chiếu và kết thúc chuyến.'}
          </Banner>
        ) : null}
        <div className="grid-4">
          <Stat label="Đăng ký" value={expected} />
          <Stat label="Đã lên xe" value={boarded} />
          <Stat label="Còn trên xe" value={still} tone={still > 0 && trip.status !== 'in_progress' ? 'error' : undefined} hint="Hệ thống ghi nhận" />
          <Stat label="Đã bàn giao" value={count('handed_over')} hint={`Đã xuống: ${count('alighted')}`} />
        </div>
        {err ? <Banner tone="error">{err}</Banner> : null}
        {canWrite ? (
          <div className="row">
            {trip.status === 'planned' ? <Button onClick={() => setStarting(true)}>Bắt đầu chuyến</Button> : null}
            {trip.status === 'in_progress' ? <Button variant="secondary" onClick={() => setUnreg(true)}>Trẻ ngoài danh sách lên xe</Button> : null}
            {trip.status === 'in_progress' || trip.status === 'needs_review' ? <Button onClick={() => setEnding(true)}>Kết thúc chuyến và đối chiếu</Button> : null}
          </div>
        ) : null}
        <DataTable
          caption="Trẻ trên chuyến"
          columns={columns}
          rows={riders.data}
          rowKey={(r) => r.id}
          status={riders.status}
          error={riders.error?.message}
          onRetry={riders.retry}
          filters={filters}
          searchText={(r) => r.childName}
          searchPlaceholder="Tìm tên trẻ"
          emptyTitle="Chưa có danh sách trẻ"
          emptyDescription="Danh sách trẻ của chuyến được tạo khi bắt đầu chuyến, theo trẻ đăng ký tuyến."
        />
      </div>
      {receiver ? <ReceiverDialog tripId={trip.id} rider={receiver} onClose={() => setReceiver(null)} onReload={riders.retry} /> : null}
      {unreg ? <BoardUnregisteredDialog tripId={trip.id} onClose={() => setUnreg(false)} onReload={riders.retry} /> : null}
      {ending ? <EndCheckDialog trip={trip} systemOnboard={still} onClose={() => setEnding(false)} onReload={() => { riders.retry(); onReload(); }} /> : null}
      {starting ? (
        <FormAction
          title="Bắt đầu chuyến"
          subject={`${route?.name ?? 'Tuyến'} · ${formatDate(trip.dayKey)}`}
          impact={[`Tạo danh sách ${route?.childIds.length ?? 0} trẻ đăng ký tuyến (chỉ trẻ đang học) ở trạng thái «Dự kiến».`, 'Sau khi bắt đầu, ghi nhận lên xe, xuống xe và bàn giao từng trẻ.']}
          confirmLabel="Bắt đầu chuyến"
          success="Đã bắt đầu chuyến."
          onClose={() => setStarting(false)}
          onReload={onReload}
          check={(): Record<string, string> => ({})}
          run={(opId) => call('trip.start', { tripId: trip.id }, opId)}
        >
          {() => null}
        </FormAction>
      ) : null}
    </Drawer>
  );
}

function TripsTab({ routes, tripsQ }: { routes: RouteRow[]; tripsQ: ReturnType<typeof useCampusDocs<TripRow>> }) {
  const c = useCampusCtx();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const routeOf = (id: string) => routes.find((r) => r.id === id);
  const rows = useMemo(() => [...tripsQ.data].sort((a, b) => b.dayKey.localeCompare(a.dayKey)), [tripsQ.data]);
  const open = rows.find((t) => t.id === openId) ?? null;
  const columns: Column<TripRow>[] = [
    { key: 'day', header: 'Ngày', value: (r) => r.dayKey, sortable: true, render: (r) => formatDate(r.dayKey) },
    { key: 'route', header: 'Tuyến', value: (r) => routeOf(r.routeId)?.name ?? r.routeId, sortable: true, render: (r) => routeOf(r.routeId)?.name ?? r.routeId },
    { key: 'dir', header: 'Chiều', value: (r) => r.direction, render: (r) => DIRECTION[r.direction] ?? r.direction },
    { key: 'cnt', header: 'Dự kiến / trên xe', value: (r) => r.expectedCount, render: (r) => `${r.expectedCount} / ${r.onboardCount}` },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, sortable: true, render: (r) => <Tag domain="trip" value={r.status} /> },
  ];
  const filters: TableFilter<TripRow>[] = [
    { key: 'status', label: 'Trạng thái', options: Object.entries(B_STATUS.trip).map(([value, s]) => ({ value, label: s.label })), predicate: (r, v) => r.status === v },
    { key: 'dir', label: 'Chiều', options: Object.entries(DIRECTION).map(([value, label]) => ({ value, label })), predicate: (r, v) => r.direction === v },
  ];
  const review = rows.filter((t) => t.status === 'needs_review').length;
  return (
    <div className="stack">
      {review ? <Banner tone="error" title={`${review} chuyến cần rà soát vì lệch số trẻ trên xe`}>Mở chuyến để xem chi tiết và xử lý trước khi cho xe rời đi.</Banner> : null}
      <DataTable
        caption="Chuyến xe"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={tripsQ.status}
        error={tripsQ.error?.message}
        onRetry={tripsQ.retry}
        onRowClick={(r) => setOpenId(r.id)}
        filters={filters}
        searchText={(r) => `${routeOf(r.routeId)?.name ?? ''} ${r.dayKey}`}
        searchPlaceholder="Tìm theo tuyến, ngày"
        toolbarExtra={c.can('transport.write') ? <Button icon="plus" onClick={() => setCreating(true)} disabled={routes.length === 0}>Tạo chuyến</Button> : undefined}
        emptyTitle="Chưa có chuyến xe"
        emptyDescription={routes.length === 0 ? 'Tạo tuyến xe trước, sau đó lập chuyến theo ngày.' : 'Tạo chuyến đón/trả theo ngày để theo dõi từng trẻ.'}
      />
      {creating ? <TripDrawer routes={routes} onClose={() => setCreating(false)} /> : null}
      {open ? <TripDetail key={open.id} trip={open} route={routeOf(open.routeId)} onClose={() => setOpenId(null)} onReload={tripsQ.retry} /> : null}
    </div>
  );
}

/** W40 — Tuyến xe, chuyến đi và đối chiếu số trẻ trên xe. */
export function W40Transport({ screen }: ScreenProps) {
  const [tab, setTab] = useState('trips');
  const routes = useCampusDocs<RouteRow>('routes', toRoute);
  const trips = useCampusDocs<TripRow>('trips', toTrip);
  return (
    <div>
      <PageHeader title={screen.title} code={screen.code} description="Mỗi chuyến đối chiếu số trẻ trên xe (không dùng điểm danh lớp): đăng ký, đã lên, đã xuống, đã bàn giao và số đếm thực tế khi kết thúc." />
      <Tabs items={[{ id: 'trips', label: 'Chuyến đi' }, { id: 'routes', label: 'Tuyến xe' }]} active={tab} onChange={setTab} />
      <div style={{ marginTop: 'var(--space-4)' }}>
        {tab === 'trips' ? <TripsTab routes={routes.data} tripsQ={trips} /> : <RoutesTab routes={routes} />}
      </div>
    </div>
  );
}
