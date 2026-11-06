'use client';
import { useEffect, useMemo, useState } from 'react';
import { useAsyncAction } from '@/lib/hooks/useAsyncAction';
import { useForm } from '@/lib/hooks/useForm';
import { useDirtyGuard, useDirtyRegistration } from '@/lib/hooks/dirtyStore';
import { dayKey, formatDate, formatDateTime } from '@/lib/format';
import { PageHeader, Skeleton, ErrorState } from '@/components/ui/Misc';
import { Button, IconButton } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Drawer } from '@/components/ui/Drawer';
import { FormField, Input, Select, Checkbox } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import type { ScreenProps } from '../registry';
import { ErrorDetails, formatNumber, toDate, toShift, useCall, useCampusCtx, useCampusDocs, useEmployees, useOrgDoc, type ShiftRow } from './parts/kit';
import { WEEKDAY_SHORT, addDays, listDays, mondayOf, weekday } from './parts/dates';

interface EntryRow { id: string; employeeId: string; actualEmployeeId: string; dayKey: string; shiftId: string; status: string; leaveId: string }

const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const windowOf = (s: ShiftRow) => {
  const a = toMin(s.startTime);
  let b = toMin(s.endTime);
  if (b <= a) b += 1440;
  return [a, b] as const;
};
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const t = `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
  return { value: t, label: t };
});

/* ------------------------------------------------------------------ tạo ca */

function ShiftDrawer({ onClose }: { onClose: () => void }) {
  const call = useCall();
  const toast = useToast();
  const { confirmDiscard } = useDirtyGuard();
  const form = useForm({
    initial: { code: '', name: '', startTime: '07:30', endTime: '16:30', workUnit: '1', breakMinutes: '60' },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.code.trim()) e.code = 'Nhập mã ca.';
      if (!v.name.trim()) e.name = 'Nhập tên ca.';
      if (v.startTime === v.endTime) e.endTime = 'Giờ kết thúc phải khác giờ bắt đầu.';
      if (!(Number(v.workUnit) >= 0 && Number(v.workUnit) <= 3)) e.workUnit = 'Số công của ca trong khoảng 0–3.';
      if (!/^\d{1,3}$/.test(v.breakMinutes.trim())) e.breakMinutes = 'Nhập số phút nghỉ nguyên.';
      return e;
    },
  });
  const submit = form.onSubmit(async (v, opId) => {
    await call('entity.save', { collection: 'shifts', data: { code: v.code.trim(), name: v.name.trim(), startTime: v.startTime, endTime: v.endTime, workUnit: Number(v.workUnit), breakMinutes: Number(v.breakMinutes), active: true } }, opId);
    toast.success(`Đã tạo ca ${v.name.trim()}.`);
    form.reset();
    onClose();
  });
  const close = async () => {
    if (form.dirty && !(await confirmDiscard('đóng biểu mẫu ca'))) return;
    onClose();
  };
  return (
    <Drawer
      open
      title="Thêm ca làm việc"
      onClose={() => void close()}
      locked={form.submitting}
      footer={
        <>
          <Button variant="secondary" onClick={() => void close()} disabled={form.submitting}>Hủy</Button>
          <Button onClick={() => void submit()} loading={form.submitting}>Lưu ca</Button>
        </>
      }
    >
      <form className="stack" noValidate onSubmit={submit}>
        {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
        <div className="grid-2">
          <FormField name="code" label="Mã ca" required {...form.field('code')}><Input {...form.bind('code')} autoComplete="off" /></FormField>
          <FormField name="name" label="Tên ca" required {...form.field('name')}><Input {...form.bind('name')} autoComplete="off" /></FormField>
          <FormField name="startTime" label="Giờ bắt đầu" required {...form.field('startTime')}><Select {...form.bind('startTime')} options={TIMES} /></FormField>
          <FormField name="endTime" label="Giờ kết thúc" required helper="Giờ kết thúc nhỏ hơn giờ bắt đầu = ca qua đêm, tính vào ngày bắt đầu." {...form.field('endTime')}><Select {...form.bind('endTime')} options={TIMES} /></FormField>
          <FormField name="workUnit" label="Số công của ca" {...form.field('workUnit')}><Input {...form.bind('workUnit')} inputMode="decimal" /></FormField>
          <FormField name="breakMinutes" label="Nghỉ giữa ca (phút)" {...form.field('breakMinutes')}><Input {...form.bind('breakMinutes')} inputMode="numeric" /></FormField>
        </div>
      </form>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ công bố */

interface PublishProps {
  from: string; to: string; entries: Array<{ employeeId: string; dayKey: string; shiftId: string }>;
  overlapCount: number; nameOf: (id: string) => string; onClose: () => void; onDone: () => void;
}

function PublishDialog({ from, to, entries, overlapCount, nameOf, onClose, onDone }: PublishProps) {
  const call = useCall();
  const toast = useToast();
  const [ack, setAck] = useState(false);
  const action = useAsyncAction(async (opId: string) => ({ data: await call('roster.publish', { fromDay: from, toDay: to, entries, ...(ack ? { acknowledgeShortage: true } : {}) }, opId) }));
  const shortage = action.error?.details?.reason === 'TEACHER_SHORTAGE';
  const who = new Set(entries.map((e) => e.employeeId)).size;
  return (
    <ConfirmDialog
      open
      title="Công bố lịch ca"
      subject={`${formatDate(from)} – ${formatDate(to)}`}
      impact={[
        `Công bố ${entries.length} ca của ${who} nhân viên; nhân viên có tài khoản nhận thông báo.`,
        'Máy chủ kiểm tra chồng ca (kể cả ca ở cơ sở khác) và thiếu giáo viên theo lớp trước khi ghi.',
        'Ca đã công bố bị bỏ khỏi lịch này sẽ chuyển sang «thay thế»; ngày đã qua và kỳ công đã khóa không được sửa.',
        'Lịch là cơ sở tính công: ca được lưu kèm bản chụp giờ/công tại thời điểm công bố.',
      ]}
      confirmLabel="Công bố lịch"
      busy={action.busy}
      error={action.error?.message ?? null}
      onCancel={onClose}
      onConfirm={async () => {
        const res = await action.run();
        if (res) {
          toast.success('Đã công bố lịch ca.');
          onDone();
          onClose();
        }
      }}
    >
      {overlapCount > 0 ? <Banner tone="error">Còn {overlapCount} ca chồng thời gian trong lịch nháp; hãy sửa trước khi công bố.</Banner> : null}
      <ErrorDetails error={action.error} nameOf={nameOf} />
      {shortage ? (
        <Banner tone="warning" title="Thiếu giáo viên">
          <Checkbox checked={ack} onChange={setAck}>Tôi đã xem các lớp thiếu giáo viên và vẫn muốn công bố</Checkbox>
        </Banner>
      ) : null}
    </ConfirmDialog>
  );
}

/* ------------------------------------------------------------------ màn */

export function W23Roster({ screen }: ScreenProps) {
  const c = useCampusCtx();
  const toast = useToast();
  const today = dayKey(new Date(), c.tz);
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const days = useMemo(() => listDays(weekStart, addDays(weekStart, 6)), [weekStart]);
  const from = days[0];
  const to = days[6];
  const canWrite = c.can('roster.write');
  const { confirmDiscard } = useDirtyGuard();

  const emp = useEmployees();
  const shifts = useCampusDocs<ShiftRow>('shifts', toShift);
  const entries = useCampusDocs<EntryRow>('rosterEntries', (id, d) => ({
    id, employeeId: String(d.employeeId ?? ''), actualEmployeeId: String(d.actualEmployeeId ?? ''), dayKey: String(d.dayKey ?? ''), shiftId: String(d.shiftId ?? ''),
    status: String(d.status ?? 'published'), leaveId: String(d.leaveId ?? ''),
  }), { where: [['dayKey', '>=', from], ['dayKey', '<=', to]], tag: from });
  const rosterDoc = useOrgDoc<{ id: string; status: string; entryCount: number; publishedAt: unknown; shortageAcknowledged: boolean; shortages: Record<string, unknown>[] }>(
    c.campusId ? ['rosters', `${c.campusId}_${from}_${to}`] : null,
    (id, d) => ({ id, status: String(d.status ?? ''), entryCount: Number(d.entryCount ?? 0), publishedAt: d.publishedAt, shortageAcknowledged: d.shortageAcknowledged === true, shortages: Array.isArray(d.shortages) ? (d.shortages as Record<string, unknown>[]) : [] }),
  );

  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [dirty, setDirty] = useState(false);
  const [cell, setCell] = useState<{ emp: string; day: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [addShift, setAddShift] = useState(false);
  useDirtyRegistration(dirty);

  const published = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const e of entries.data) {
      if (e.status === 'superseded') continue;
      (m[`${e.employeeId}|${e.dayKey}`] ??= []).push(e.shiftId);
    }
    return m;
  }, [entries.data]);

  // Nạp lịch đã công bố vào bản nháp khi đổi tuần/dữ liệu đổi và chưa có thay đổi dở.
  useEffect(() => {
    if (dirty) return;
    if (entries.status === 'ready' || entries.status === 'empty') setDraft(published);
  }, [published, entries.status, dirty]);

  const staff = useMemo(() => emp.data.filter((e) => e.status !== 'resigned'), [emp.data]);
  const shiftById = useMemo(() => new Map(shifts.data.map((s) => [s.id, s])), [shifts.data]);
  const activeShifts = useMemo(() => shifts.data.filter((s) => s.active), [shifts.data]);

  const flat = useMemo(() => Object.entries(draft).flatMap(([k, ids]) => ids.map((shiftId) => ({ employeeId: k.split('|')[0], dayKey: k.split('|')[1], shiftId }))), [draft]);

  // Kiểm tra chồng ca ngay trên bản nháp (cùng người, kể cả ca qua đêm sang ngày sau).
  const overlaps = useMemo(() => {
    const out: Array<{ employeeId: string; dayKey: string }> = [];
    const byEmp = new Map<string, typeof flat>();
    for (const e of flat) (byEmp.get(e.employeeId) ?? byEmp.set(e.employeeId, []).get(e.employeeId)!).push(e);
    const base = (d: string) => Math.floor(new Date(`${d}T00:00:00Z`).getTime() / 86_400_000) * 1440;
    for (const [id, list] of byEmp) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const sa = shiftById.get(list[i].shiftId);
          const sb = shiftById.get(list[j].shiftId);
          if (!sa || !sb) continue;
          const [a1, a2] = windowOf(sa);
          const [b1, b2] = windowOf(sb);
          const A1 = base(list[i].dayKey) + a1; const A2 = base(list[i].dayKey) + a2;
          const B1 = base(list[j].dayKey) + b1; const B2 = base(list[j].dayKey) + b2;
          if (A1 < B2 && B1 < A2) out.push({ employeeId: id, dayKey: list[i].dayKey });
        }
      }
    }
    return out;
  }, [flat, shiftById]);

  const perDay = useMemo(() => days.map((d) => new Set(flat.filter((e) => e.dayKey === d).map((e) => e.employeeId)).size), [days, flat]);
  const changed = useMemo(() => JSON.stringify(Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, [...v].sort()]).filter(([, v]) => (v as string[]).length).sort())) !== JSON.stringify(Object.fromEntries(Object.entries(published).map(([k, v]) => [k, [...v].sort()]).sort())), [draft, published]);

  const toggle = (empId: string, day: string, shiftId: string) => {
    setDirty(true);
    setDraft((d) => {
      const k = `${empId}|${day}`;
      const cur = d[k] ?? [];
      const next = cur.includes(shiftId) ? cur.filter((x) => x !== shiftId) : [...cur, shiftId];
      return { ...d, [k]: next };
    });
  };

  const goWeek = async (start: string) => {
    if (dirty && !(await confirmDiscard('đổi tuần (lịch nháp chưa công bố sẽ mất)'))) return;
    setDirty(false);
    setWeekStart(mondayOf(start));
  };

  const loading = emp.status === 'loading' || shifts.status === 'loading' || entries.status === 'loading';
  const error = emp.error ?? shifts.error ?? entries.error;
  const reload = () => { emp.retry(); shifts.retry(); entries.retry(); };

  return (
    <div>
      <PageHeader
        title={screen.title}
        code={screen.code}
        description="Lập lịch theo tuần rồi công bố. Hệ thống kiểm tra chồng ca và thiếu giáo viên trước khi công bố."
        actions={canWrite ? <Button variant="secondary" icon="plus" onClick={() => setAddShift(true)}>Thêm ca</Button> : undefined}
      />
      <div className="stack">
        <div className="row">
          <IconButton icon="chevron-left" label="Tuần trước" onClick={() => void goWeek(addDays(weekStart, -7))} />
          <strong>Tuần {formatDate(from)} – {formatDate(to)}</strong>
          <IconButton icon="chevron-right" label="Tuần sau" onClick={() => void goWeek(addDays(weekStart, 7))} />
          <Button variant="tertiary" size="sm" onClick={() => void goWeek(today)}>Tuần này</Button>
          <span style={{ flex: 1 }} />
          {rosterDoc.data ? <Badge tone="success">Đã công bố {formatDateTime(toDate(rosterDoc.data.publishedAt as never), c.tz)} · {rosterDoc.data.entryCount} ca</Badge> : <Badge tone="neutral">Tuần này chưa công bố</Badge>}
          {dirty ? <Badge tone="warning">Có thay đổi chưa công bố</Badge> : null}
        </div>

        {rosterDoc.data?.shortageAcknowledged && rosterDoc.data.shortages.length ? (
          <Banner tone="warning" title="Lịch đã công bố có lớp thiếu giáo viên (đã xác nhận)">
            {rosterDoc.data.shortages.slice(0, 5).map((s, i) => <div key={i}>{String(s.className ?? s.classId)} ngày {formatDate(String(s.dayKey))}: có {String(s.have)}, cần {String(s.need)}.</div>)}
          </Banner>
        ) : null}
        {overlaps.length ? (
          <Banner tone="error" title={`${overlaps.length} ca chồng thời gian`}>
            {overlaps.slice(0, 6).map((o, i) => <div key={i}>{emp.nameOf(o.employeeId)} — {formatDate(o.dayKey)}</div>)}
            Sửa các ca này trước khi công bố.
          </Banner>
        ) : null}

        {loading ? <Skeleton height={240} /> : error ? <ErrorState message={error.message} onRetry={reload} /> : staff.length === 0 ? (
          <Banner tone="info">Chưa có nhân viên đang làm việc ở cơ sở này. Thêm nhân viên ở «Danh sách nhân sự».</Banner>
        ) : activeShifts.length === 0 ? (
          <Banner tone="info" title="Chưa có ca làm việc" action={canWrite ? <Button size="sm" onClick={() => setAddShift(true)}>Thêm ca</Button> : undefined}>Tạo ít nhất một ca (giờ bắt đầu, kết thúc, số công) để xếp lịch.</Banner>
        ) : (
          <Card flush>
            <div className="dt-scroll">
              <table className="dt">
                <caption className="sr-only">Lịch ca tuần {formatDate(from)} – {formatDate(to)}</caption>
                <thead>
                  <tr>
                    <th scope="col">Nhân viên</th>
                    {days.map((d) => (
                      <th key={d} scope="col">{WEEKDAY_SHORT[weekday(d)]} {d.slice(8, 10)}/{d.slice(5, 7)}{d < today ? ' ·đã qua' : ''}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {staff.map((e) => (
                    <tr key={e.id}>
                      <th scope="row" style={{ textAlign: 'left' }}>{e.fullName}<div className="text-caption text-secondary">{e.title || e.code}</div></th>
                      {days.map((d) => {
                        const ids = draft[`${e.id}|${d}`] ?? [];
                        const past = d < today;
                        return (
                          <td key={d}>
                            <Button variant="tertiary" size="sm" disabled={!canWrite || past} onClick={() => setCell({ emp: e.id, day: d })} aria-label={`Sửa ca ${e.fullName} ngày ${formatDate(d)}`}>
                              {ids.length ? ids.map((id) => shiftById.get(id)?.code ?? id).join(', ') : '＋'}
                            </Button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <th scope="row" style={{ textAlign: 'left' }}>Số người có ca</th>
                    {perDay.map((n, i) => <td key={i}>{formatNumber(n, 0)}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <div className="row">
          {canWrite ? (
            <>
              <Button onClick={() => setPublishing(true)} disabled={!dirty && !changed ? true : overlaps.length > 0 || flat.length === 0}>Công bố lịch tuần</Button>
              <Button variant="tertiary" disabled={!dirty} onClick={async () => { if (await confirmDiscard('hoàn tác lịch nháp')) { setDraft(published); setDirty(false); toast.info('Đã hoàn tác về lịch đã công bố.'); } }}>Hoàn tác thay đổi</Button>
            </>
          ) : <span className="text-secondary text-small">Bạn chỉ có quyền xem lịch.</span>}
          <span className="text-secondary text-small">Thiếu giáo viên theo lớp do máy chủ kiểm tra khi công bố (cần phân công giáo viên theo lớp).</span>
        </div>
      </div>

      {cell ? (
        <Modal
          open
          title={`Ca của ${emp.nameOf(cell.emp)} — ${formatDate(cell.day)}`}
          onClose={() => setCell(null)}
          footer={<Button onClick={() => setCell(null)}>Xong</Button>}
        >
          <div className="stack-sm">
            {activeShifts.map((s) => (
              <Checkbox key={s.id} checked={(draft[`${cell.emp}|${cell.day}`] ?? []).includes(s.id)} onChange={() => toggle(cell.emp, cell.day, s.id)}>
                {s.code} · {s.name} ({s.startTime}–{s.endTime}{s.overnight ? ', qua đêm' : ''}, {formatNumber(s.workUnit)} công)
              </Checkbox>
            ))}
            <p className="text-secondary text-small">Ca qua đêm thuộc ngày bắt đầu. Chọn nhiều ca cho một ngày nếu không chồng thời gian.</p>
          </div>
        </Modal>
      ) : null}
      {publishing ? (
        <PublishDialog from={from} to={to} entries={flat} overlapCount={overlaps.length} nameOf={emp.nameOf} onClose={() => setPublishing(false)} onDone={() => setDirty(false)} />
      ) : null}
      {addShift ? <ShiftDrawer onClose={() => setAddShift(false)} /> : null}
    </div>
  );
}
