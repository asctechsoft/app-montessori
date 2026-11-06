'use client';
import { useMemo, useState } from 'react';
import type { DocumentData } from 'firebase/firestore';
import { formatDate, formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { Drawer } from '@/components/ui/Drawer';
import { Tabs } from '@/components/ui/Tabs';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { FormField, Textarea } from '@/components/ui/Fields';
import { ActionDialog, formatNumber, KV, num, text, toDate, useCall, useCampusCtx, useCampusDocs, useEmployees } from './parts/kit';
import { Tag } from './parts/statuses';

const LEAVE_TYPES: Record<string, string> = {
  annual: 'Phép năm', sick: 'Ốm', unpaid: 'Không lương', maternity: 'Thai sản', wedding: 'Cưới', bereavement: 'Tang', other: 'Khác',
};

interface Shortage { classId: string; className: string; dayKey: string; have: number; need: number }
interface LeaveRow {
  id: string; employeeId: string; employeeName: string; type: string; fromDay: string; toDay: string; days: number; paid: boolean; retroactive: boolean;
  reason: string; status: string; handoverTo: string; decisionNote: string; createdAt: Date | null;
  balance: { entitlement: number; used: number; remaining: number } | null;
  affectedShifts: Array<{ entryId: string; dayKey: string; shiftId: string }>; shortage: Shortage[];
}
const arr = (v: unknown): DocumentData[] => (Array.isArray(v) ? (v as DocumentData[]) : []);
const toLeave = (id: string, d: DocumentData): LeaveRow => {
  const b = d.balance as DocumentData | null | undefined;
  const w = d.warnings as DocumentData | null | undefined;
  return {
    id, employeeId: text(d.employeeId), employeeName: text(d.employeeName), type: text(d.type), fromDay: text(d.fromDay), toDay: text(d.toDay), days: num(d.days),
    paid: d.paid === true, retroactive: d.retroactive === true, reason: text(d.reason), status: text(d.status), handoverTo: text(d.handoverTo), decisionNote: text(d.decisionNote),
    createdAt: toDate(d.createdAt),
    balance: b ? { entitlement: num(b.entitlement), used: num(b.used), remaining: num(b.remaining) } : null,
    affectedShifts: arr(w?.affectedShifts).map((s) => ({ entryId: text(s.entryId), dayKey: text(s.dayKey), shiftId: text(s.shiftId) })),
    shortage: arr(w?.shortage).map((s) => ({ classId: text(s.classId), className: text(s.className), dayKey: text(s.dayKey), have: num(s.have), need: num(s.need) })),
  };
};

interface SwapRow {
  id: string; dayKey: string; shiftId: string; fromEmployeeId: string; fromName: string; toEmployeeId: string; toName: string; reason: string; status: string; decisionNote: string;
}
const toSwap = (id: string, d: DocumentData): SwapRow => ({
  id, dayKey: text(d.dayKey), shiftId: text(d.shiftId), fromEmployeeId: text(d.fromEmployeeId), fromName: text(d.fromName), toEmployeeId: text(d.toEmployeeId), toName: text(d.toName),
  reason: text(d.reason), status: text(d.status), decisionNote: text(d.decisionNote),
});

const ORDER: Record<string, number> = { pending: 0, awaiting_manager: 0, awaiting_peer: 1 };
const byStatus = (a: { status: string; fromDay?: string; dayKey?: string }, b: { status: string; fromDay?: string; dayKey?: string }) =>
  (ORDER[a.status] ?? 5) - (ORDER[b.status] ?? 5) || (b.fromDay ?? b.dayKey ?? '').localeCompare(a.fromDay ?? a.dayKey ?? '');

/** W26 — Duyệt nghỉ phép nhân viên và đổi ca. */
export function W26StaffLeave() {
  const [tab, setTab] = useState('leave');
  return (
    <div>
      <PageHeader title="Duyệt nghỉ phép và đổi ca" code="W26" description="Xem số dư phép, ca bị ảnh hưởng và cảnh báo thiếu giáo viên trước khi duyệt." />
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <Tabs items={[{ id: 'leave', label: 'Đơn nghỉ phép' }, { id: 'swap', label: 'Đổi ca' }]} active={tab} onChange={setTab} />
      </div>
      {tab === 'leave' ? <LeaveTab /> : <SwapTab />}
    </div>
  );
}

function LeaveTab() {
  const c = useCampusCtx();
  const emps = useEmployees();
  const q = useCampusDocs<LeaveRow>('staffLeaves', toLeave);
  const canDecide = c.can('leave_staff.decide');
  const rows = useMemo(() => [...q.data].sort(byStatus), [q.data]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dlg, setDlg] = useState<{ row: LeaveRow; decision: 'approved' | 'rejected' } | null>(null);
  const open = rows.find((r) => r.id === openId) ?? null;

  const columns: Column<LeaveRow>[] = [
    { key: 'emp', header: 'Nhân viên', value: (r) => r.employeeName || emps.nameOf(r.employeeId), sortable: true, render: (r) => <strong>{r.employeeName || emps.nameOf(r.employeeId)}</strong> },
    { key: 'type', header: 'Loại nghỉ', value: (r) => r.type, render: (r) => LEAVE_TYPES[r.type] ?? r.type },
    { key: 'range', header: 'Thời gian', value: (r) => r.fromDay, sortable: true, render: (r) => `${formatDate(r.fromDay)} – ${formatDate(r.toDay)}` },
    { key: 'days', header: 'Số ngày', value: (r) => r.days, align: 'right', render: (r) => formatNumber(r.days) },
    { key: 'paid', header: 'Lương', value: (r) => (r.paid ? 1 : 0), render: (r) => (r.paid ? 'Có lương' : 'Không lương') },
    { key: 'bal', header: 'Phép còn lại', align: 'right', value: (r) => r.balance?.remaining ?? null, render: (r) => (r.balance ? `${formatNumber(r.balance.remaining)} / ${formatNumber(r.balance.entitlement)}` : '—') },
    {
      key: 'warn', header: 'Cảnh báo',
      render: (r) => (
        <div className="row" style={{ gap: 'var(--space-1)' }}>
          {r.shortage.length ? <Badge tone="error">Thiếu GV {r.shortage.length}</Badge> : null}
          {r.retroactive ? <Badge tone="warning">Hồi tố</Badge> : null}
          {r.affectedShifts.length ? <Badge tone="info">{r.affectedShifts.length} ca</Badge> : null}
          {!r.shortage.length && !r.retroactive && !r.affectedShifts.length ? '—' : null}
        </div>
      ),
    },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, sortable: true, render: (r) => <Tag domain="leave" value={r.status} /> },
    { key: 'act', header: 'Thao tác', render: (r) => <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }}>Xem chi tiết</Button> },
  ];

  return (
    <>
      <DataTable
        caption="Đơn nghỉ phép nhân viên"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={q.status}
        error={q.error?.message}
        onRetry={q.retry}
        onRowClick={(r) => setOpenId(r.id)}
        searchText={(r) => `${r.employeeName} ${r.reason}`}
        searchPlaceholder="Tìm theo nhân viên, lý do"
        filters={[
          { key: 'status', label: 'Trạng thái', options: [{ value: 'pending', label: 'Chờ duyệt' }, { value: 'approved', label: 'Đã duyệt' }, { value: 'rejected', label: 'Từ chối' }], predicate: (r, v) => r.status === v },
          { key: 'type', label: 'Loại nghỉ', options: Object.entries(LEAVE_TYPES).map(([value, label]) => ({ value, label })), predicate: (r, v) => r.type === v },
        ]}
        emptyTitle="Chưa có đơn nghỉ phép"
        emptyDescription="Đơn nghỉ do nhân viên gửi trên ứng dụng sẽ hiện tại đây."
      />
      {open ? (
        <Drawer
          open
          title={`Đơn nghỉ của ${open.employeeName || emps.nameOf(open.employeeId)}`}
          onClose={() => setOpenId(null)}
          footer={
            canDecide && open.status === 'pending' ? (
              <>
                <Button variant="destructiveOutline" onClick={() => setDlg({ row: open, decision: 'rejected' })}>Từ chối</Button>
                <Button onClick={() => setDlg({ row: open, decision: 'approved' })}>Duyệt đơn</Button>
              </>
            ) : undefined
          }
        >
          <LeaveDetail row={open} nameOf={emps.nameOf} />
        </Drawer>
      ) : null}
      {dlg ? <LeaveDecide key={dlg.row.id + dlg.decision} row={dlg.row} decision={dlg.decision} onClose={() => setDlg(null)} onReload={q.retry} nameOf={emps.nameOf} /> : null}
    </>
  );
}

function LeaveDetail({ row, nameOf }: { row: LeaveRow; nameOf: (id: string) => string }) {
  const c = useCampusCtx();
  return (
    <div className="stack">
      <KV
        items={[
          ['Loại nghỉ', LEAVE_TYPES[row.type] ?? row.type],
          ['Trạng thái', <Tag key="s" domain="leave" value={row.status} />],
          ['Thời gian', `${formatDate(row.fromDay)} – ${formatDate(row.toDay)}`],
          ['Số ngày làm việc bị nghỉ', formatNumber(row.days)],
          ['Hưởng lương', row.paid ? 'Có lương' : 'Không lương'],
          ['Người bàn giao', row.handoverTo ? nameOf(row.handoverTo) : ''],
          ['Gửi lúc', row.createdAt ? formatDateTime(row.createdAt, c.tz) : ''],
          ['Lý do', row.reason],
        ]}
      />
      {row.retroactive ? <Banner tone="warning" title="Đơn hồi tố">Ngày bắt đầu nghỉ đã qua. Kiểm tra bảng công của các ngày này trước khi duyệt.</Banner> : null}
      {row.balance ? (
        <Banner tone={row.balance.remaining - row.days < 0 ? 'error' : 'info'} title="Số dư phép năm">
          Định mức {formatNumber(row.balance.entitlement)} ngày, đã dùng/đang chờ {formatNumber(row.balance.used)}, còn {formatNumber(row.balance.remaining)}. Sau khi duyệt đơn này còn {formatNumber(row.balance.remaining - row.days)} ngày.
        </Banner>
      ) : row.type === 'annual' ? null : <p className="text-secondary text-small">Loại nghỉ này không trừ vào phép năm.</p>}
      <div>
        <h3 style={{ margin: '0 0 var(--space-2)' }}>Ca làm bị ảnh hưởng ({row.affectedShifts.length})</h3>
        {row.affectedShifts.length ? (
          <ul style={{ margin: 0, paddingLeft: 20 }}>{row.affectedShifts.map((s) => <li key={s.entryId}>{formatDate(s.dayKey)} · ca {s.shiftId}</li>)}</ul>
        ) : <p className="text-secondary text-small">Không có ca nào trong lịch đã công bố.</p>}
      </div>
      <div>
        <h3 style={{ margin: '0 0 var(--space-2)' }}>Cảnh báo thiếu giáo viên ({row.shortage.length})</h3>
        {row.shortage.length ? (
          <Banner tone="error">
            <ul style={{ margin: 0, paddingLeft: 20 }}>{row.shortage.map((s, i) => <li key={i}>Lớp {s.className || s.classId} ngày {formatDate(s.dayKey)}: còn {s.have}, cần {s.need} giáo viên.</li>)}</ul>
            <p style={{ margin: 'var(--space-2) 0 0' }}>Cân nhắc xếp người thay thế trước khi duyệt. Khi duyệt, máy chủ tính lại cảnh báo này.</p>
          </Banner>
        ) : <p className="text-secondary text-small">Không phát hiện thiếu giáo viên.</p>}
      </div>
      {row.decisionNote ? <KV items={[['Ghi chú quyết định', row.decisionNote]]} /> : null}
    </div>
  );
}

function LeaveDecide({ row, decision, onClose, onReload, nameOf }: { row: LeaveRow; decision: 'approved' | 'rejected'; onClose: () => void; onReload: () => void; nameOf: (id: string) => string }) {
  const call = useCall();
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const approve = decision === 'approved';
  const who = row.employeeName || nameOf(row.employeeId);
  const impact = approve
    ? [
        `Duyệt nghỉ ${LEAVE_TYPES[row.type] ?? row.type} ${formatDate(row.fromDay)} – ${formatDate(row.toDay)} (${formatNumber(row.days)} ngày, ${row.paid ? 'có lương' : 'không lương'}).`,
        `${row.affectedShifts.length} ca trong lịch được đánh dấu «nghỉ phép»; công tính theo loại nghỉ khi tính bảng công.`,
        row.shortage.length ? `Cảnh báo: thiếu giáo viên ở ${row.shortage.length} lớp-ngày. Máy chủ tính lại cảnh báo khi duyệt.` : 'Chưa phát hiện thiếu giáo viên (máy chủ kiểm tra lại khi duyệt).',
        row.balance && row.type === 'annual' ? `Số dư phép năm sau duyệt: ${formatNumber(row.balance.remaining - row.days)} ngày.` : 'Không trừ vào phép năm.',
        'Không duyệt được nếu kỳ công liên quan đã khóa hoặc số dư phép không đủ. Người lập đơn không tự duyệt đơn của mình.',
      ]
    : ['Đơn bị từ chối kèm lý do; ca làm giữ nguyên.', 'Nhân viên được thông báo kết quả.'];
  return (
    <ActionDialog
      title={`${approve ? 'Duyệt' : 'Từ chối'} đơn nghỉ`}
      subject={`${who} · ${formatDate(row.fromDay)} – ${formatDate(row.toDay)}`}
      impact={impact}
      confirmLabel={`${approve ? 'Duyệt' : 'Từ chối'} đơn của ${who}`}
      tone={approve ? 'primary' : 'destructive'}
      success={approve ? 'Đã duyệt đơn nghỉ.' : 'Đã từ chối đơn nghỉ.'}
      validate={() => {
        const m = !approve && note.trim().length < 3 ? 'Nhập lý do từ chối.' : '';
        setErr(m);
        return m ? m : null;
      }}
      run={(opId) => call('staffLeave.decide', { id: row.id, decision, note: note.trim() || undefined }, opId)}
      onClose={onClose}
      onReload={onReload}
      nameOf={nameOf}
    >
      <div style={{ marginTop: 'var(--space-3)' }}>
        <FormField name="leave-note" label={approve ? 'Ghi chú (tùy chọn)' : 'Lý do từ chối'} required={!approve} error={err || undefined}>
          <Textarea value={note} onValueChange={setNote} />
        </FormField>
      </div>
    </ActionDialog>
  );
}

function SwapTab() {
  const c = useCampusCtx();
  const emps = useEmployees();
  const q = useCampusDocs<SwapRow>('shiftSwaps', toSwap);
  const canDecide = c.can('leave_staff.decide');
  const rows = useMemo(() => [...q.data].sort(byStatus), [q.data]);
  const [dlg, setDlg] = useState<{ row: SwapRow; decision: 'approved' | 'rejected' } | null>(null);

  const columns: Column<SwapRow>[] = [
    { key: 'day', header: 'Ngày', value: (r) => r.dayKey, sortable: true, render: (r) => formatDate(r.dayKey), width: 110 },
    { key: 'shift', header: 'Ca', value: (r) => r.shiftId },
    { key: 'who', header: 'Đổi ca', value: (r) => r.fromName, render: (r) => `${r.fromName || emps.nameOf(r.fromEmployeeId)} → ${r.toName || emps.nameOf(r.toEmployeeId)}` },
    { key: 'reason', header: 'Lý do', value: (r) => r.reason, render: (r) => r.reason || '—' },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, sortable: true, render: (r) => <Tag domain="swap" value={r.status} /> },
    {
      key: 'act', header: 'Thao tác',
      render: (r) =>
        r.status === 'awaiting_manager' && canDecide ? (
          <div className="row" style={{ gap: 'var(--space-1)', flexWrap: 'nowrap' }}>
            <Button size="sm" onClick={() => setDlg({ row: r, decision: 'approved' })}>Duyệt</Button>
            <Button size="sm" variant="destructiveOutline" onClick={() => setDlg({ row: r, decision: 'rejected' })}>Từ chối</Button>
          </div>
        ) : r.status === 'awaiting_peer' ? <span className="text-small text-secondary">Chờ người nhận ca trả lời</span> : '—',
    },
  ];

  return (
    <>
      <DataTable
        caption="Yêu cầu đổi ca"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={q.status}
        error={q.error?.message}
        onRetry={q.retry}
        searchText={(r) => `${r.fromName} ${r.toName} ${r.reason}`}
        searchPlaceholder="Tìm theo nhân viên, lý do"
        filters={[{ key: 'status', label: 'Trạng thái', options: [{ value: 'awaiting_manager', label: 'Chờ quản lý duyệt' }, { value: 'awaiting_peer', label: 'Chờ người nhận ca' }, { value: 'approved', label: 'Đã duyệt' }, { value: 'rejected', label: 'Từ chối' }, { value: 'declined_by_peer', label: 'Người nhận từ chối' }], predicate: (r, v) => r.status === v }]}
        emptyTitle="Chưa có yêu cầu đổi ca"
        emptyDescription="Yêu cầu đổi ca giữa các nhân viên sẽ hiện tại đây sau khi người nhận ca đồng ý."
      />
      {dlg ? <SwapDecide key={dlg.row.id + dlg.decision} row={dlg.row} decision={dlg.decision} onClose={() => setDlg(null)} onReload={q.retry} nameOf={emps.nameOf} /> : null}
    </>
  );
}

function SwapDecide({ row, decision, onClose, onReload, nameOf }: { row: SwapRow; decision: 'approved' | 'rejected'; onClose: () => void; onReload: () => void; nameOf: (id: string) => string }) {
  const call = useCall();
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const approve = decision === 'approved';
  const from = row.fromName || nameOf(row.fromEmployeeId);
  const to = row.toName || nameOf(row.toEmployeeId);
  return (
    <ActionDialog
      title={`${approve ? 'Duyệt' : 'Từ chối'} đổi ca`}
      subject={`${formatDate(row.dayKey)} · ${from} → ${to}`}
      impact={
        approve
          ? [
              `Ca ${row.shiftId} ngày ${formatDate(row.dayKey)} do ${to} làm thực tế; ca gốc vẫn ghi tên ${from} để truy vết.`,
              'Máy chủ kiểm tra lại ca trùng của người nhận; chặn nếu trùng ca, ngày đã qua hoặc kỳ công đã khóa.',
              'Công của ca này tính cho người làm thực tế.',
            ]
          : ['Yêu cầu bị từ chối; ca giữ nguyên người làm ban đầu.', 'Hai nhân viên được thông báo.']
      }
      confirmLabel={`${approve ? 'Duyệt' : 'Từ chối'} đổi ca`}
      tone={approve ? 'primary' : 'destructive'}
      success={approve ? 'Đã duyệt đổi ca.' : 'Đã từ chối đổi ca.'}
      validate={() => {
        const m = !approve && note.trim().length < 3 ? 'Nhập lý do từ chối.' : '';
        setErr(m);
        return m ? m : null;
      }}
      run={(opId) => call('shiftSwap.decide', { id: row.id, decision, note: note.trim() || undefined }, opId)}
      onClose={onClose}
      onReload={onReload}
      nameOf={nameOf}
    >
      <div style={{ marginTop: 'var(--space-3)' }}>
        <FormField name="swap-note" label={approve ? 'Ghi chú (tùy chọn)' : 'Lý do từ chối'} required={!approve} error={err || undefined}>
          <Textarea value={note} onValueChange={setNote} />
        </FormField>
      </div>
    </ActionDialog>
  );
}
