'use client';
import { useEffect, useMemo, useState } from 'react';
import { doc, where } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import { useDoc } from '@/lib/hooks/useFirestore';
import { dayKey, formatDate, formatTime } from '@/lib/format';
import { PageHeader, Stat } from '@/components/ui/Misc';
import { Button, LinkButton } from '@/components/ui/Button';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { DateInput, FormField } from '@/components/ui/Fields';
import { pickupEffective } from './parts/ChildGuardians';
import { activeAt, mapAssign } from './parts/assign';
import {
  dateOf, GUARDIAN_STATUS, Kv, mapGuardian, mapPickup, MetaTag, relationLabel, statusOf, str, useCampusCol, useCampusCtx, useChildrenQ, useClassesQ, type PickupRow,
} from './parts/kit';

interface HoItem { id: string; childId: string; classId: string; state: string; receivedAt: Date | null; pickedAt: Date | null; droppedBy: string; receivedBy: string; pickupPerson: string }
interface Row {
  childId: string; name: string; code: string; classId: string; className: string; state: string; receivedAt: Date | null; pickedAt: Date | null;
  droppedBy: string; receivedBy: string; pickupPerson: string; valid: number; warn: string;
}

/** W17 — Giám sát bàn giao cuối ngày: trẻ chưa trả, người đón được phép, hạn ủy quyền, liên hệ khi cần. */
export function W17Handover() {
  const { orgId, cid, tz, scopeKey } = useCampusCtx();
  const today = dayKey(new Date(), tz);
  const [day, setDay] = useState(today);
  const [open, setOpen] = useState<Row | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day);
  const dk = valid ? day : today;

  const campusDoc = useDoc<{ closeTime: string; pickupTo: string }>(orgId && cid ? `campusHours|${scopeKey}` : null, () => doc(firebase().db, 'orgs', orgId, 'campuses', cid!), (_i, d) => ({ closeTime: str(d.closeTime), pickupTo: str(d.pickupTo) }));
  const children = useChildrenQ();
  const classes = useClassesQ();
  const ho = useCampusCol<HoItem>('handovers', (id, d) => ({ id, childId: str(d.childId), classId: str(d.classId), state: str(d.state), receivedAt: dateOf(d.receivedAt), pickedAt: dateOf(d.pickedAt), droppedBy: str(d.droppedBy), receivedBy: str(d.receivedByName), pickupPerson: str(d.pickupPersonName) }), { where: [where('dayKey', '==', dk)], keyExtra: dk, enabled: valid });
  const att = useCampusCol('attendance', (id, d) => ({ id, childId: str(d.childId), status: str(d.status) }), { where: [where('dayKey', '==', dk)], keyExtra: dk, enabled: valid });
  const pickups = useCampusCol('pickupAuthorizations', mapPickup);
  const guardians = useCampusCol('guardianLinks', mapGuardian);
  const assigns = useCampusCol('assignments', mapAssign);

  const cutoff = campusDoc.data?.pickupTo || campusDoc.data?.closeTime || '';
  const hhmm = formatTime(now, tz);
  const overdueNow = dk === today && !!cutoff && hhmm > cutoff;

  const pickupsBy = useMemo(() => {
    const m = new Map<string, PickupRow[]>();
    for (const p of pickups.data) m.set(p.childId, [...(m.get(p.childId) ?? []), p]);
    return m;
  }, [pickups.data]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const seen = new Set<string>();
    const mk = (childId: string, state: string, h?: HoItem) => {
      const c = children.byId.get(childId);
      const ps = pickupsBy.get(childId) ?? [];
      const okList = ps.filter((p) => pickupEffective(p, dk).label === 'Đang có hiệu lực');
      const warn = okList.length === 0 ? 'Chưa có người đón hợp lệ' : '';
      out.push({ childId, name: c?.fullName ?? childId, code: c?.code ?? '', classId: h?.classId ?? c?.classId ?? '', className: classes.byId.get(h?.classId ?? c?.classId ?? '')?.name ?? '', state, receivedAt: h?.receivedAt ?? null, pickedAt: h?.pickedAt ?? null, droppedBy: h?.droppedBy ?? '', receivedBy: h?.receivedBy ?? '', pickupPerson: h?.pickupPerson ?? '', valid: okList.length, warn });
    };
    for (const h of ho.data) { seen.add(h.childId); mk(h.childId, h.state || 'not_received', h); }
    for (const a of att.data) if (a.status === 'present' && !seen.has(a.childId)) { seen.add(a.childId); mk(a.childId, 'not_received'); }
    return out;
  }, [ho.data, att.data, children.byId, classes.byId, pickupsBy, dk]);

  const still = rows.filter((r) => r.state === 'received');
  const picked = rows.filter((r) => r.state === 'picked_up').length;
  const missing = rows.filter((r) => r.state === 'not_received').length;
  const loading = ho.status === 'loading' || att.status === 'loading';
  const status = ho.status === 'error' ? 'error' : att.status === 'error' ? 'error' : loading ? 'loading' : statusOf('ready', rows);

  const columns: Column<Row>[] = [
    { key: 'child', header: 'Trẻ', value: (r) => r.name, sortable: true, render: (r) => <div><strong>{r.name}</strong><div className="text-caption">{r.code}</div></div> },
    { key: 'class', header: 'Lớp', value: (r) => r.className, sortable: true },
    { key: 'state', header: 'Bàn giao', value: (r) => r.state, sortable: true, render: (r) => <div><StatusBadge domain="handover" value={r.state} />{r.state === 'received' && overdueNow ? <div><Badge tone="error">Quá giờ đóng cửa</Badge></div> : null}{r.state === 'not_received' ? <div className="text-caption">Có mặt nhưng chưa ghi nhận bàn giao</div> : null}</div> },
    { key: 'in', header: 'Giờ nhận', value: (r) => r.receivedAt?.getTime() ?? 0, sortable: true, render: (r) => (r.receivedAt ? `${formatTime(r.receivedAt, tz)}${r.droppedBy ? ` · ${r.droppedBy}` : ''}` : '—') },
    { key: 'out', header: 'Giờ trả', render: (r) => (r.pickedAt ? `${formatTime(r.pickedAt, tz)}${r.pickupPerson ? ` · ${r.pickupPerson}` : ''}` : '—') },
    { key: 'auth', header: 'Người đón hợp lệ', value: (r) => r.valid, render: (r) => (r.valid > 0 ? <Badge tone="success">{r.valid} người</Badge> : <Badge tone="error">Chưa có</Badge>) },
    { key: 'act', header: 'Thao tác', render: (r) => <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setOpen(r); }}>Xem người đón</Button> },
  ];
  const filters: TableFilter<Row>[] = [
    { key: 'class', label: 'Lớp', options: classes.data.map((c) => ({ value: c.id, label: c.name })), predicate: (r, v) => r.classId === v },
    { key: 'state', label: 'Bàn giao', options: [{ value: 'received', label: 'Còn ở trường' }, { value: 'picked_up', label: 'Đã trả' }, { value: 'not_received', label: 'Chưa ghi nhận nhận' }], predicate: (r, v) => r.state === v },
  ];

  const sel = open;
  const selPickups = sel ? (pickupsBy.get(sel.childId) ?? []) : [];
  const selGuardians = sel ? guardians.data.filter((g) => g.childId === sel.childId && g.status !== 'unlinked') : [];
  const teacher = sel ? assigns.data.find((a) => a.classId === sel.classId && a.role === 'main' && activeAt(a, now)) : undefined;

  return (
    <div className="stack">
      <PageHeader title="Giám sát bàn giao cuối ngày" code="W17" description="Theo dõi trẻ đã nhận, đã trả và còn ở trường. Việc trả trẻ chỉ thực hiện trên app sau khi xác minh người đón." />
      <div className="row">
        <FormField name="ho-day" label="Ngày" error={valid ? undefined : 'Nhập ngày hợp lệ.'}><DateInput name="ho-day" value={day} onValueChange={setDay} /></FormField>
        {day !== today ? <Button variant="secondary" onClick={() => setDay(today)}>Về hôm nay</Button> : null}
      </div>
      {overdueNow && still.length > 0 ? (
        <Banner tone="error" title={`${still.length} trẻ chưa được trả sau giờ ${cutoff}`}>Liên hệ phụ huynh hoặc người đón được ủy quyền và bàn giao theo quy trình của trường. Mở «Xem người đón» để lấy số điện thoại.</Banner>
      ) : null}
      <div className="grid-4">
        <Stat label="Đã nhận hôm nay" value={rows.filter((r) => r.state !== 'not_received').length} />
        <Stat label="Đã trả" value={picked} tone="success" />
        <Stat label="Còn ở trường" value={still.length} tone={overdueNow && still.length ? 'error' : 'warning'} hint={cutoff ? `Giờ trả cuối: ${cutoff}` : undefined} />
        <Stat label="Chưa ghi nhận nhận" value={missing} hint="Có mặt nhưng thiếu bàn giao" tone={missing ? 'warning' : undefined} />
      </div>
      <DataTable
        caption={`Bàn giao ngày ${formatDate(dk)}`}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.childId}
        status={status}
        error={ho.error?.message ?? att.error?.message}
        onRetry={() => { ho.retry(); att.retry(); }}
        searchText={(r) => `${r.name} ${r.code} ${r.className}`}
        searchPlaceholder="Tìm theo tên trẻ, mã, lớp"
        filters={filters}
        onRowClick={(r) => setOpen(r)}
        emptyTitle={`Chưa có bàn giao ngày ${formatDate(dk)}`}
        emptyDescription="Dữ liệu xuất hiện sau khi giáo viên nhận trẻ trên app."
      />
      <Drawer open={!!sel} title={sel ? `Người đón của ${sel.name}` : ''} onClose={() => setOpen(null)} footer={sel ? <LinkButton href={`/tre/${sel.childId}`} variant="secondary">Mở hồ sơ trẻ</LinkButton> : undefined}>
        {sel ? (
          <div className="stack">
            <Kv items={[['Lớp', sel.className], ['Giáo viên phụ trách', teacher?.teacherName ?? 'Chưa phân công'], ['Bàn giao', <StatusBadge key="s" domain="handover" value={sel.state} />], ['Giờ nhận', sel.receivedAt ? formatTime(sel.receivedAt, tz) : ''], ['Người đưa', sel.droppedBy]]} />
            <div>
              <h3 style={{ marginBottom: 'var(--space-2)' }}>Người đón được phép</h3>
              {selPickups.length === 0 ? <Banner tone="warning">Chưa có người đón nào được ghi nhận. Liên hệ phụ huynh để bổ sung ủy quyền.</Banner> : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }} className="stack-sm">
                  {selPickups.map((p) => { const e = pickupEffective(p, dk); return (
                    <li key={p.id} style={{ border: '1px solid var(--color-borderSubtle)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                      <div className="row" style={{ justifyContent: 'space-between' }}><strong>{p.personName}</strong><Badge tone={e.tone}>{e.label}</Badge></div>
                      <div className="text-small">{relationLabel(p.relation)}{p.phone ? <> · <a href={`tel:${p.phone}`}>{p.phone}</a></> : null}</div>
                      <div className="text-caption">Hạn ủy quyền: {p.validTo ? `${formatDate(p.validFrom)} – ${formatDate(p.validTo)}` : 'không giới hạn'}{p.validFromTime || p.validToTime ? ` (${p.validFromTime || '00:00'}–${p.validToTime || '23:59'})` : ''}</div>
                    </li>); })}
                </ul>
              )}
            </div>
            <div>
              <h3 style={{ marginBottom: 'var(--space-2)' }}>Liên hệ người giám hộ</h3>
              {selGuardians.length === 0 ? <p className="text-secondary">Chưa có người giám hộ.</p> : selGuardians.map((g) => (
                <div key={g.id} className="text-small">{g.name} ({relationLabel(g.relation)}){g.phone ? <> · <a href={`tel:${g.phone}`}>{g.phone}</a></> : ''} <MetaTag meta={GUARDIAN_STATUS} value={g.status} /></div>
              ))}
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
