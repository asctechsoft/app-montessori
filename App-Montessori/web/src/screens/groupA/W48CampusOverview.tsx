'use client';
import { useMemo, useState } from 'react';
import { doc, where } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import { callApi } from '@/lib/api';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { useAsyncAction } from '@/lib/hooks/useAsyncAction';
import { useDoc } from '@/lib/hooks/useFirestore';
import { useAuth } from '@/providers/AuthProvider';
import { dayKey, formatDate, formatVnd } from '@/lib/format';
import { ErrorState, PageHeader, SkeletonText, Stat } from '@/components/ui/Misc';
import { Button, LinkButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Modal';
import { FormField, Textarea } from '@/components/ui/Fields';
import { StatusBadge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { num, objs, str, useCampusCol, useCampusCtx, useChildrenQ, useClassesQ, useOccupancy, IN_SCHOOL } from './parts/kit';

interface Snapshot {
  outstanding?: number; overdueAmount?: number; overdueCount?: number; openAlerts?: number;
  alerts?: unknown[]; approvals?: unknown[]; mealsToday?: { expected?: number; locked?: number; cancelled?: number } | null;
}
interface Setup { percent: number; readyToActivate: boolean; status: string; steps: { key: string; label: string; done: boolean; optional?: boolean }[] }

function Activate({ name, cid, onClose }: { name: string; cid: string; onClose: () => void }) {
  const { orgId } = useCampusCtx();
  const { refresh } = useAuth();
  const toast = useToast();
  const [reason, setReason] = useState('Hoàn tất thiết lập, bắt đầu vận hành');
  const act = useAsyncAction(async (opId: string) => {
    await callApi('campus.setStatus', { orgId, opId, payload: { campusId: cid, status: 'active', reason: reason.trim() } });
    return true as const;
  });
  return (
    <ConfirmDialog open title={`Kích hoạt vận hành ${name}`} subject={name} confirmLabel={`Kích hoạt ${name}`} busy={act.busy} error={act.error?.message} onCancel={onClose}
      impact={['Cơ sở chuyển từ «Chuẩn bị» sang «Đang hoạt động».', 'Nhân sự và phụ huynh bắt đầu dùng dữ liệu của cơ sở trên app.', 'Thay đổi được ghi vào nhật ký thao tác kèm lý do.']}
      onConfirm={async () => { if (!reason.trim()) return; if (await act.run()) { toast.success(`Đã kích hoạt ${name}.`); void refresh(); onClose(); } }}>
      <FormField name="act-reason" label="Lý do" required error={reason.trim() ? undefined : 'Nhập lý do.'}><Textarea name="act-reason" value={reason} onValueChange={setReason} /></FormField>
    </ConfirmDialog>
  );
}

/** W48 — Tổng quan vận hành cơ sở: số liệu hôm nay, việc cần xử lý, sĩ số lớp, tiến độ thiết lập khi cơ sở đang chuẩn bị. */
export function W48CampusOverview() {
  const { orgId, cid, tz, scopeKey, can, campus } = useCampusCtx();
  const today = dayKey(new Date(), tz);
  const [activating, setActivating] = useState(false);
  const campusDoc = useDoc<{ status: string; name: string }>(orgId && cid ? `ov-campus|${scopeKey}` : null, () => doc(firebase().db, 'orgs', orgId, 'campuses', cid!), (_i, d) => ({ status: str(d.status), name: str(d.name) }));
  const children = useChildrenQ(can('children.read'));
  const classes = useClassesQ(can('classes.read') || can('campus.read'));
  const occupancy = useOccupancy(children.data, children.status === 'ready' || children.status === 'empty');
  const att = useCampusCol('attendance', (id, d) => ({ id, status: str(d.status) }), { where: [where('dayKey', '==', today)], keyExtra: today, enabled: can('attendance.read') });
  const ho = useCampusCol('handovers', (id, d) => ({ id, state: str(d.state) }), { where: [where('dayKey', '==', today)], keyExtra: today, enabled: can('attendance.read') });
  const leaves = useCampusCol('leaveRequests', (id, d) => ({ id, status: str(d.status) }), { where: [where('status', '==', 'pending')], keyExtra: 'pending', enabled: can('attendance.read') });
  const meds = useCampusCol('medicationRequests', (id, d) => ({ id, status: str(d.status) }), { where: [where('status', '==', 'pending')], keyExtra: 'pending', enabled: can('medication.read') });
  const incidents = useCampusCol('incidents', (id, d) => ({ id, status: str(d.status), severity: str(d.severity) }), { where: [where('status', '==', 'open')], keyExtra: 'open', enabled: can('incident.read') && can('children.write') });
  const snap = useApiQuery<Snapshot>(orgId && cid && can('reports.read') ? `dash|${scopeKey}` : null, 'dashboard.campus', () => ({ orgId, campusId: cid ?? undefined, payload: { campusId: cid } }));
  const isPreparing = campusDoc.data?.status === 'preparing';
  const setup = useApiQuery<Setup>(orgId && cid && isPreparing ? `setup|${scopeKey}` : null, 'campus.setupProgress', () => ({ orgId, campusId: cid ?? undefined, payload: { campusId: cid } }));

  const cnt = (rows: { status: string }[], s: string | string[]) => rows.filter((r) => (Array.isArray(s) ? s.includes(r.status) : r.status === s)).length;
  const present = cnt(att.data, 'present');
  const absent = cnt(att.data, ['absent_excused', 'absent_unexcused']);
  const received = ho.data.filter((h) => h.state === 'received' || h.state === 'picked_up').length;
  const stillAt = ho.data.filter((h) => h.state === 'received').length;
  const enrolledNow = children.data.filter((c) => IN_SCHOOL.includes(c.status) && c.classId).length;
  const unconfirmed = Math.max(0, enrolledNow - att.data.length);
  const classRows = useMemo(() => classes.data.map((c) => ({ c, n: occupancy(c) })), [classes.data, occupancy]);

  if (!cid) return null;
  const name = campusDoc.data?.name || campus?.name || '';
  const dash = snap.data;
  const tile = (label: string, value: number | string, opts: { tone?: 'error' | 'success' | 'warning'; hint?: string; href?: string; show: boolean; loading?: boolean }) => (opts.show ? (
    <div key={label} className="stack-sm">
      <Stat label={label} value={opts.loading ? '…' : value} tone={opts.tone} hint={opts.hint} />
      {opts.href ? <LinkButton href={opts.href} variant="tertiary" size="sm">Xem chi tiết</LinkButton> : null}
    </div>
  ) : null);

  return (
    <div className="stack">
      <PageHeader title="Tổng quan vận hành cơ sở" code="W48" description={`${name} · ${formatDate(today)}`} actions={campusDoc.data ? <StatusBadge domain="campus" value={campusDoc.data.status} /> : undefined} />
      {campusDoc.status === 'error' ? <ErrorState message={campusDoc.error?.message} onRetry={campusDoc.retry} /> : null}

      {isPreparing ? (
        <Card title="Tiến độ thiết lập cơ sở">
          {setup.status === 'loading' ? <SkeletonText lines={4} /> : setup.status === 'error' ? <ErrorState message={setup.error?.message} onRetry={setup.retry} title="Không tải được tiến độ thiết lập" /> : setup.data ? (
            <div className="stack">
              <div className="row"><strong>{setup.data.percent}%</strong><span className="text-secondary">các bước bắt buộc đã hoàn tất</span></div>
              <ul style={{ margin: 0, paddingLeft: 'var(--space-5)' }}>
                {setup.data.steps.map((s) => <li key={s.key}>{s.label}: {s.done ? <Badge tone="success">Đã xong</Badge> : <Badge tone={s.optional ? 'neutral' : 'warning'}>{s.optional ? 'Tùy chọn, chưa làm' : 'Chưa xong'}</Badge>}</li>)}
              </ul>
              {can('campus.manage') ? (
                <div className="row">
                  <Button disabled={!setup.data.readyToActivate} onClick={() => setActivating(true)}>Kích hoạt vận hành</Button>
                  {!setup.data.readyToActivate ? <span className="text-small text-secondary">Hoàn tất các bước bắt buộc để kích hoạt.</span> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="grid-4">
        {tile('Trẻ đang học', enrolledNow, { show: can('children.read'), hint: 'Có lớp và đang học', href: '/tre', loading: children.status === 'loading' })}
        {tile('Có mặt hôm nay', present, { show: can('attendance.read'), tone: 'success', href: '/diem-danh', loading: att.status === 'loading' })}
        {tile('Nghỉ hôm nay', absent, { show: can('attendance.read'), href: '/diem-danh', loading: att.status === 'loading' })}
        {tile('Chưa điểm danh', unconfirmed, { show: can('attendance.read') && can('children.read'), tone: unconfirmed ? 'warning' : undefined, href: '/diem-danh', loading: att.status === 'loading' || children.status === 'loading' })}
        {tile('Còn ở trường', stillAt, { show: can('attendance.read'), hint: `${received} trẻ đã nhận`, tone: stillAt ? 'warning' : undefined, href: '/diem-danh/ban-giao', loading: ho.status === 'loading' })}
        {tile('Đơn nghỉ chờ duyệt', leaves.data.length, { show: can('attendance.read'), tone: leaves.data.length ? 'warning' : undefined, loading: leaves.status === 'loading' })}
        {tile('Thuốc chờ nhận', meds.data.length, { show: can('medication.read'), tone: meds.data.length ? 'warning' : undefined, href: '/cham-soc/suc-khoe', loading: meds.status === 'loading' })}
        {tile('Sự cố đang xử lý', incidents.data.length, { show: can('incident.read') && can('children.write'), tone: incidents.data.length ? 'error' : undefined, href: '/cham-soc/su-co', loading: incidents.status === 'loading' })}
      </div>
      {[att, ho, leaves, meds, children].some((q) => q.status === 'error') ? (
        <Banner tone="warning" title="Một số số liệu chưa tải được" action={<Button size="sm" variant="secondary" icon="refresh" onClick={() => [att, ho, leaves, meds, children].forEach((q) => q.status === 'error' && q.retry())}>Thử lại</Button>}>
          {[att, ho, leaves, meds, children].find((q) => q.status === 'error')?.error?.message}
        </Banner>
      ) : null}

      {can('reports.read') ? (
        <Card title="Tài chính và cảnh báo">
          {snap.status === 'loading' ? <SkeletonText lines={3} /> : snap.status === 'error' ? <ErrorState message={snap.error?.message} onRetry={snap.retry} title="Không tải được số liệu tổng hợp" /> : (
            <div className="stack">
              <div className="grid-3">
                <Stat label="Tổng công nợ còn lại" value={formatVnd(num(dash?.outstanding) ?? 0)} />
                <Stat label="Quá hạn" value={formatVnd(num(dash?.overdueAmount) ?? 0)} tone={(num(dash?.overdueAmount) ?? 0) > 0 ? 'error' : undefined} hint={`${num(dash?.overdueCount) ?? 0} khoản`} />
                <Stat label="Suất ăn hôm nay" value={dash?.mealsToday ? `${num(dash.mealsToday.locked) ?? num(dash.mealsToday.expected) ?? 0}` : '—'} hint={dash?.mealsToday ? `Dự kiến ${num(dash.mealsToday.expected) ?? 0} · báo nghỉ ${num(dash.mealsToday.cancelled) ?? 0}` : 'Chưa chốt suất ăn'} />
              </div>
              {objs(dash?.alerts).length > 0 ? (
                <div><h3 style={{ marginBottom: 'var(--space-2)' }}>Cảnh báo đang mở</h3>
                  <ul style={{ margin: 0, paddingLeft: 'var(--space-5)' }}>{objs(dash?.alerts).map((a) => <li key={str(a.id)}>{str(a.title) || str(a.type)}{a.message ? ` — ${str(a.message)}` : ''}</li>)}</ul></div>
              ) : <p className="text-secondary">Không có cảnh báo đang mở.</p>}
              {objs(dash?.approvals).length > 0 ? (
                <div><h3 style={{ marginBottom: 'var(--space-2)' }}>Yêu cầu chờ phê duyệt ({objs(dash?.approvals).length})</h3>
                  <ul style={{ margin: 0, paddingLeft: 'var(--space-5)' }}>{objs(dash?.approvals).map((a) => <li key={str(a.id)}>{str(a.summary) || str(a.type)}</li>)}</ul>
                  <LinkButton href="/phe-duyet" variant="secondary" size="sm">Mở trung tâm phê duyệt</LinkButton></div>
              ) : null}
            </div>
          )}
        </Card>
      ) : null}

      {classRows.length > 0 ? (
        <Card title="Sĩ số các lớp">
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }} className="stack-sm">
            {classRows.map(({ c, n }) => (
              <li key={c.id} className="row" style={{ justifyContent: 'space-between' }}>
                <LinkButton href={`/lop/${c.id}`} variant="tertiary" size="sm">{c.name}</LinkButton>
                <span>{n}/{c.capacity} {n >= c.capacity ? <Badge tone="error">Đã đủ</Badge> : <Badge tone="success">Còn {c.capacity - n}</Badge>}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {activating ? <Activate name={name} cid={cid} onClose={() => setActivating(false)} /> : null}
      <p className="text-caption">Số liệu cập nhật theo thời gian thực.</p>
    </div>
  );
}
