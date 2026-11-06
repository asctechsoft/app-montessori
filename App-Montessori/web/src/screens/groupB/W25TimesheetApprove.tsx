'use client';
import { useMemo, useState } from 'react';
import type { DocumentData } from 'firebase/firestore';
import { dayKey as dayKeyOf, formatDate, formatDateTime, formatTime } from '@/lib/format';
import { PageHeader, Stat } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Tabs';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { FormField, Input, Select, Textarea } from '@/components/ui/Fields';
import { ActionDialog, formatNumber, num, text, useCall, useCampusCtx, useCampusDocs, useEmployees } from './parts/kit';
import { Tag } from './parts/statuses';
import { addDays } from './parts/dates';
import { PeriodSelect, toAdjust, toPunch, useDefaultPeriod, useTimesheet, type AdjustRow, type PunchRow, type TsError } from './parts/timekeepingParts';

interface OvertimeRow {
  id: string; employeeId: string; employeeName: string; dayKey: string; minutes: number; reason: string; status: string; createdBy: string;
}
const toOvertime = (id: string, d: DocumentData): OvertimeRow => ({
  id, employeeId: text(d.employeeId), employeeName: text(d.employeeName), dayKey: text(d.dayKey), minutes: num(d.minutes), reason: text(d.reason), status: text(d.status), createdBy: text(d.createdBy),
});

type Pending =
  | { type: 'adjust'; id: string; employeeId: string; employeeName: string; dayKey: string; data: AdjustRow }
  | { type: 'ot'; id: string; employeeId: string; employeeName: string; dayKey: string; data: OvertimeRow };

/** W25 — Duyệt bổ sung công, tăng ca và khóa/mở lại kỳ công. */
export function W25TimesheetApprove() {
  const c = useCampusCtx();
  const showApprove = c.can('timekeeping.approve');
  const showLock = c.can('timekeeping.lock') || c.can('timekeeping.reopen');
  const [tab, setTab] = useState<string>(showApprove ? 'pending' : 'lock');
  const tabs = [
    ...(showApprove ? [{ id: 'pending', label: 'Đề nghị chờ duyệt' }] : []),
    ...(showLock ? [{ id: 'lock', label: 'Khóa công' }] : []),
  ];
  return (
    <div>
      <PageHeader title="Duyệt bổ sung và khóa công" code="W25" description="Đối chiếu lượt chấm gốc với đề nghị bổ sung, duyệt tăng ca, rồi khóa kỳ công làm căn cứ tính lương." />
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <Tabs items={tabs} active={tab} onChange={setTab} />
      </div>
      {tab === 'pending' && showApprove ? <PendingTab /> : <LockTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ đề nghị chờ duyệt */

function PendingTab() {
  const c = useCampusCtx();
  const emps = useEmployees();
  const adj = useCampusDocs<AdjustRow>('punchAdjustments', toAdjust, { where: [['status', '==', 'pending']] });
  const ot = useCampusDocs<OvertimeRow>('overtimeRequests', toOvertime, { where: [['status', '==', 'pending']] });
  const since = useMemo(() => addDays(dayKeyOf(new Date(), c.tz), -62), [c.tz]);
  const punches = useCampusDocs<PunchRow>('punches', toPunch, { where: [['dayKey', '>=', since]], tag: 'recent' });
  const [dlg, setDlg] = useState<{ row: Pending; decision: 'approved' | 'rejected' } | null>(null);

  const rows = useMemo<Pending[]>(() => {
    const a: Pending[] = adj.data.map((d) => ({ type: 'adjust', id: d.id, employeeId: d.employeeId, employeeName: d.employeeName || emps.nameOf(d.employeeId), dayKey: d.dayKey, data: d }));
    const o: Pending[] = ot.data.map((d) => ({ type: 'ot', id: d.id, employeeId: d.employeeId, employeeName: d.employeeName || emps.nameOf(d.employeeId), dayKey: d.dayKey, data: d }));
    return [...a, ...o].sort((x, y) => x.dayKey.localeCompare(y.dayKey));
  }, [adj.data, ot.data, emps]);

  // Gộp trạng thái hai nguồn: lỗi nếu một nguồn lỗi; loading nếu đang tải; empty khi cả hai trống.
  const status = adj.status === 'error' || ot.status === 'error' ? 'error' : adj.status === 'loading' || ot.status === 'loading' ? 'loading' : rows.length === 0 ? 'empty' : 'ready';
  const retry = () => { adj.retry(); ot.retry(); };

  const originalsOf = (p: Extract<Pending, { type: 'adjust' }>): PunchRow[] =>
    punches.data.filter((x) => x.employeeId === p.employeeId && x.dayKey === p.dayKey && x.kind === p.data.kind);

  const columns: Column<Pending>[] = [
    { key: 'type', header: 'Loại', value: (r) => r.type, render: (r) => <Badge tone={r.type === 'adjust' ? 'info' : 'neutral'}>{r.type === 'adjust' ? 'Bổ sung công' : 'Tăng ca'}</Badge> },
    { key: 'emp', header: 'Nhân viên', value: (r) => r.employeeName, sortable: true, render: (r) => <strong>{r.employeeName}</strong> },
    { key: 'day', header: 'Ngày', value: (r) => r.dayKey, sortable: true, render: (r) => formatDate(r.dayKey), width: 110 },
    {
      key: 'cmp', header: 'Lượt gốc ↔ đề nghị',
      render: (r) => {
        if (r.type === 'ot') return `Đề nghị tăng ca ${r.data.minutes} phút`;
        const kind = r.data.kind === 'in' ? 'vào' : 'ra';
        const orig = originalsOf(r);
        return (
          <div className="stack-sm">
            <span>Đề nghị lượt {kind}: <strong>{formatTime(r.data.requestedTime, c.tz)}</strong></span>
            <span className="text-small text-secondary">
              {punches.status === 'loading' ? 'Đang tải lượt gốc…' : orig.length ? `Lượt gốc: ${orig.map((p) => `${formatTime(p.effectiveTime, c.tz)} (${p.source === 'app' ? 'ứng dụng' : p.source === 'device' ? 'máy' : 'thủ công'})`).join(', ')}` : 'Không có lượt gốc (thiếu lượt)'}
            </span>
          </div>
        );
      },
    },
    { key: 'reason', header: 'Lý do', value: (r) => r.data.reason, render: (r) => <span>{r.data.reason}{r.type === 'adjust' && r.data.evidencePaths.length ? <span className="text-caption text-secondary"> · {r.data.evidencePaths.length} minh chứng</span> : null}</span> },
    {
      key: 'act', header: 'Thao tác',
      render: (r) => (
        <div className="row" style={{ gap: 'var(--space-1)', flexWrap: 'nowrap' }}>
          <Button size="sm" onClick={(e) => { e.stopPropagation(); setDlg({ row: r, decision: 'approved' }); }}>Duyệt</Button>
          <Button size="sm" variant="destructiveOutline" onClick={(e) => { e.stopPropagation(); setDlg({ row: r, decision: 'rejected' }); }}>Từ chối</Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Banner tone="info">Người lập đề nghị không được tự duyệt đề nghị của mình; máy chủ sẽ từ chối và báo lý do. Duyệt bổ sung tạo bản điều chỉnh liên kết, lượt gốc vẫn được giữ.</Banner>
      <div style={{ height: 'var(--space-4)' }} />
      <DataTable
        caption="Đề nghị chờ duyệt"
        columns={columns}
        rows={rows}
        rowKey={(r) => `${r.type}_${r.id}`}
        status={status}
        error={adj.error?.message ?? ot.error?.message}
        onRetry={retry}
        searchText={(r) => `${r.employeeName} ${r.data.reason}`}
        searchPlaceholder="Tìm theo nhân viên, lý do"
        filters={[{ key: 'type', label: 'Loại', options: [{ value: 'adjust', label: 'Bổ sung công' }, { value: 'ot', label: 'Tăng ca' }], predicate: (r, v) => r.type === v }]}
        emptyTitle="Không có đề nghị chờ duyệt"
        emptyDescription="Các đề nghị bổ sung công và tăng ca của nhân viên sẽ xuất hiện tại đây."
      />
      {dlg ? <DecideDialog key={dlg.row.type + dlg.row.id} row={dlg.row} decision={dlg.decision} original={dlg.row.type === 'adjust' ? originalsOf(dlg.row) : []} onClose={() => setDlg(null)} onReload={retry} /> : null}
    </>
  );
}

function DecideDialog({ row, decision, original, onClose, onReload }: { row: Pending; decision: 'approved' | 'rejected'; original: PunchRow[]; onClose: () => void; onReload: () => void }) {
  const c = useCampusCtx();
  const call = useCall();
  const [note, setNote] = useState('');
  const [minutes, setMinutes] = useState(row.type === 'ot' ? String(row.data.minutes) : '');
  const [err, setErr] = useState<{ note?: string; minutes?: string }>({});
  const approve = decision === 'approved';

  const impact = approve
    ? row.type === 'adjust'
      ? [
          `Tạo bản điều chỉnh liên kết: lượt ${row.data.kind === 'in' ? 'vào' : 'ra'} ngày ${formatDate(row.dayKey)} tính theo ${formatTime(row.data.requestedTime, c.tz)}.`,
          original.length ? `Lượt gốc (${original.map((p) => formatTime(p.effectiveTime, c.tz)).join(', ')}) được giữ nguyên, không bị xóa.` : 'Ngày này chưa có lượt gốc; bản điều chỉnh bổ sung lượt còn thiếu.',
          'Bảng công cần được tính lại để cập nhật số công.',
          'Không duyệt được nếu kỳ công đã khóa.',
        ]
      : [`Duyệt tối đa ${minutes || row.data.minutes} phút tăng ca ngày ${formatDate(row.dayKey)}; số phút này được cộng vào bảng công khi tính lại.`, 'Không duyệt được nếu kỳ công đã khóa.']
    : ['Đề nghị bị từ chối kèm lý do; công của ngày này giữ nguyên theo lượt chấm gốc.', 'Nhân viên được thông báo kết quả.'];

  const validate = () => {
    const e: { note?: string; minutes?: string } = {};
    if (!approve && note.trim().length < 3) e.note = 'Nhập lý do từ chối.';
    if (approve && row.type === 'ot') {
      const n = Number(minutes);
      if (!Number.isInteger(n) || n <= 0) e.minutes = 'Nhập số phút nguyên dương.';
      else if (n > row.data.minutes) e.minutes = `Không vượt quá ${row.data.minutes} phút đề nghị.`;
    }
    setErr(e);
    return Object.keys(e).length ? 'Kiểm tra lại các trường được đánh dấu.' : null;
  };

  return (
    <ActionDialog
      title={`${approve ? 'Duyệt' : 'Từ chối'} ${row.type === 'adjust' ? 'bổ sung công' : 'tăng ca'}`}
      subject={`${row.employeeName} · ${formatDate(row.dayKey)}`}
      impact={impact}
      confirmLabel={`${approve ? 'Duyệt' : 'Từ chối'} đề nghị của ${row.employeeName}`}
      tone={approve ? 'primary' : 'destructive'}
      success={approve ? 'Đã duyệt đề nghị.' : 'Đã từ chối đề nghị.'}
      validate={validate}
      onReload={onReload}
      onClose={onClose}
      run={(opId) =>
        row.type === 'adjust'
          ? call('punchAdjust.decide', { id: row.id, decision, note: note.trim() || undefined }, opId)
          : call('overtime.decide', { id: row.id, decision, note: note.trim() || undefined, ...(approve ? { approvedMinutes: Number(minutes) } : {}) }, opId)
      }
    >
      <div className="stack" style={{ marginTop: 'var(--space-3)' }}>
        {row.type === 'ot' && approve ? (
          <FormField name="minutes" label="Số phút duyệt" required error={err.minutes}>
            <Input value={minutes} onValueChange={setMinutes} inputMode="numeric" />
          </FormField>
        ) : null}
        <FormField name="note" label={approve ? 'Ghi chú (tùy chọn)' : 'Lý do từ chối'} required={!approve} error={err.note}>
          <Textarea value={note} onValueChange={setNote} />
        </FormField>
      </div>
    </ActionDialog>
  );
}

/* ------------------------------------------------------------------ khóa công */

interface AdjustmentRow { id: string; employeeId: string; deltaPaidDays: number; reason: string; toPeriodKey: string; fromPeriodKey: string; status: string }

function LockTab() {
  const c = useCampusCtx();
  const call = useCall();
  const emps = useEmployees();
  const [periodKey, setPeriodKey] = useState(useDefaultPeriod());
  const ts = useTimesheet(periodKey);
  const h = ts.data;
  const adjustments = useCampusDocs<AdjustmentRow>(
    'timesheetAdjustments',
    (id, d) => ({ id, employeeId: text(d.employeeId), deltaPaidDays: num(d.deltaPaidDays), reason: text(d.reason), toPeriodKey: text(d.toPeriodKey), fromPeriodKey: text(d.fromPeriodKey), status: text(d.status) }),
    { where: [['fromPeriodKey', '==', periodKey]], tag: periodKey },
  );
  const [dlg, setDlg] = useState<'lock' | 'reopen' | 'carry' | null>(null);

  const locked = h?.status === 'locked';
  const today = dayKeyOf(new Date(), c.tz);
  const ended = !!h && h.toDay < today;
  const blockers = h?.errors.filter((e) => e.blocking) ?? [];
  const warnings = h?.errors.filter((e) => !e.blocking) ?? [];
  const pendingReq = blockers.filter((e) => e.type.startsWith('pending_')).length;
  const canLock = c.can('timekeeping.lock');
  const canReopen = c.can('timekeeping.reopen') || canLock;

  const errCols: Column<TsError>[] = [
    { key: 'emp', header: 'Nhân viên', value: (r) => r.name, render: (r) => r.name || emps.nameOf(r.employeeId) },
    { key: 'day', header: 'Ngày', value: (r) => r.dayKey, render: (r) => (r.dayKey ? formatDate(r.dayKey) : '—'), width: 110 },
    { key: 'type', header: 'Loại', value: (r) => r.type, render: (r) => <Badge tone={r.blocking ? 'error' : 'warning'}>{r.blocking ? 'Chặn khóa' : 'Cảnh báo'}</Badge> },
    { key: 'msg', header: 'Nội dung', value: (r) => r.message },
  ];
  const adjCols: Column<AdjustmentRow>[] = [
    { key: 'emp', header: 'Nhân viên', render: (r) => emps.nameOf(r.employeeId) },
    { key: 'to', header: 'Chuyển sang kỳ', value: (r) => r.toPeriodKey },
    { key: 'delta', header: 'Chênh lệch công', align: 'right', value: (r) => r.deltaPaidDays, render: (r) => (r.deltaPaidDays > 0 ? '+' : '') + formatNumber(r.deltaPaidDays) },
    { key: 'reason', header: 'Lý do', value: (r) => r.reason },
    { key: 'status', header: 'Trạng thái', render: (r) => <Tag domain="leave" value={r.status} /> },
  ];

  const lockDisabledReason = !h ? 'Chưa có bảng công. Hãy tính bảng công trước.' : locked ? 'Kỳ công đã khóa.' : !ended ? `Kỳ công kết thúc ngày ${formatDate(h.toDay)}; chỉ khóa sau ngày cuối kỳ.` : '';

  return (
    <div className="stack">
      <div className="row">
        <PeriodSelect value={periodKey} onChange={setPeriodKey} />
        {h ? <Tag domain="timesheet" value={h.status} /> : null}
      </div>

      {ts.status === 'error' ? <Banner tone="error" title="Không tải được bảng công" action={<Button size="sm" variant="secondary" onClick={ts.retry}>Thử lại</Button>}>{ts.error?.message}</Banner> : null}
      {ts.status === 'empty' ? <Banner tone="info" title="Chưa có bảng công cho kỳ này">Người có quyền duyệt công cần tính bảng công ở màn «Chấm công» trước khi khóa kỳ.</Banner> : null}

      {h ? (
        <>
          <div className="grid-4">
            <Stat label="Lỗi chặn khóa kỳ" value={blockers.length} tone={blockers.length ? 'error' : 'success'} hint="Từ lần tính gần nhất" />
            <Stat label="Ngày chưa đủ dữ liệu" value={h.incompleteDays} tone={h.incompleteDays ? 'warning' : undefined} />
            <Stat label="Đề nghị chờ duyệt" value={pendingReq} tone={pendingReq ? 'warning' : undefined} />
            <Stat label="Cảnh báo" value={warnings.length} />
          </div>
          {locked ? (
            <Banner tone="success" title={`Đã khóa lần ${h.lockVersion}`}>
              Khóa lúc {formatDateTime(h.lockedAt as Date, c.tz)}. Bảng lương được dựng từ bảng công này. {h.reportsStale ? 'Báo cáo kỳ này đã được đánh dấu cần cập nhật do từng mở lại.' : ''}
            </Banner>
          ) : blockers.length ? (
            <Banner tone="warning" title="Chưa thể khóa kỳ">Xử lý các lỗi bên dưới (bổ sung lượt chấm, duyệt đề nghị) rồi tính lại bảng công. Khi khóa, máy chủ tính lại và chặn nếu còn lỗi.</Banner>
          ) : null}

          <Card title="Lỗi và cảnh báo công" flush>
            <DataTable caption="Lỗi công" columns={errCols} rows={h.errors} rowKey={(r) => `${r.employeeId}_${r.dayKey}_${r.type}`} status={h.errors.length ? 'ready' : 'empty'} emptyTitle="Không có lỗi công" emptyDescription="Bảng công không còn lỗi hay đề nghị chờ xử lý." searchText={(r) => `${r.name} ${r.message}`} />
          </Card>

          <div className="row">
            {canLock && !locked ? (
              <span className="row">
                <Button icon="lock" disabled={!!lockDisabledReason} onClick={() => setDlg('lock')}>Khóa kỳ công</Button>
                {lockDisabledReason ? <span className="text-small text-secondary">{lockDisabledReason}</span> : null}
              </span>
            ) : null}
            {locked && canReopen ? <Button variant="secondary" onClick={() => setDlg('reopen')}>Mở lại kỳ công</Button> : null}
            {locked && canReopen ? <Button variant="tertiary" onClick={() => setDlg('carry')}>Chuyển sang kỳ điều chỉnh</Button> : null}
          </div>

          <Card title="Lịch sử mở lại kỳ" flush>
            {h.reopenHistory.length === 0 ? (
              <p className="text-secondary" style={{ padding: 'var(--space-4)', margin: 0 }}>Kỳ này chưa từng được mở lại.</p>
            ) : (
              <ul style={{ margin: 0, padding: 'var(--space-4) var(--space-6)' }}>
                {h.reopenHistory.map((x, i) => (
                  <li key={i}>{formatDateTime(x.at as Date, c.tz)} · khóa lần {x.lockVersion}: {x.reason}{x.note ? ` (${x.note})` : ''}</li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}

      <Card title="Điều chỉnh liên kết sang kỳ sau" flush>
        <DataTable caption="Điều chỉnh liên kết" columns={adjCols} rows={adjustments.data} rowKey={(r) => r.id} status={adjustments.status} error={adjustments.error?.message} onRetry={adjustments.retry} emptyTitle="Chưa có điều chỉnh" emptyDescription="Chênh lệch công của kỳ đã khóa được chuyển sang kỳ sau sẽ hiện tại đây." />
      </Card>

      {dlg === 'lock' && h ? (
        <ActionDialog
          title={`Khóa kỳ công ${periodKey}`}
          subject={`${c.campusName} · ${h.employees.length} nhân viên`}
          impact={[
            'Máy chủ tính lại bảng công từ dữ liệu hiện hành và lưu bản chụp (ca, lượt chấm, phép, điều chỉnh) cho từng nhân viên.',
            'Sau khi khóa không sửa trực tiếp được: đổi lịch ca, bổ sung công, duyệt nghỉ trong kỳ đều bị chặn.',
            'Bảng lương chỉ được dựng từ bảng công đã khóa này.',
            'Muốn sửa phải mở lại kỳ (cần người có quyền mở lại duyệt) hoặc chuyển chênh lệch sang kỳ điều chỉnh sau.',
          ]}
          confirmLabel={`Khóa kỳ ${periodKey}`}
          success="Đã khóa kỳ công."
          run={(opId) => call('timesheet.lock', { periodKey }, opId)}
          onClose={() => setDlg(null)}
          nameOf={emps.nameOf}
          onReload={ts.retry}
        />
      ) : null}
      {dlg === 'reopen' ? <ReopenDialog periodKey={periodKey} onClose={() => setDlg(null)} onReload={ts.retry} /> : null}
      {dlg === 'carry' && h ? <CarryDialog periodKey={periodKey} employees={h.employees.map((e) => ({ value: e.employeeId, label: `${e.name} (${e.code})` }))} onClose={() => setDlg(null)} /> : null}
    </div>
  );
}

function ReopenDialog({ periodKey, onClose, onReload }: { periodKey: string; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  const emps = useEmployees();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  return (
    <ActionDialog
      title={`Mở lại kỳ công ${periodKey}`}
      impact={[
        'Gửi yêu cầu mở lại kỳ; kỳ chỉ mở sau khi người có quyền mở lại kỳ duyệt ở Trung tâm phê duyệt.',
        'Khi mở: bảng công về trạng thái chỉnh sửa được, báo cáo kỳ này được đánh dấu đã thay đổi, lịch sử mở lại được ghi.',
        'Không mở lại được nếu bảng lương kỳ này đã duyệt hoặc phát hành; khi đó dùng «Chuyển sang kỳ điều chỉnh».',
      ]}
      confirmLabel="Gửi yêu cầu mở lại kỳ"
      success="Đã gửi yêu cầu mở lại kỳ công; chờ người có quyền duyệt."
      validate={() => {
        const m = reason.trim().length < 10 ? 'Nêu rõ lý do mở lại kỳ (tối thiểu 10 ký tự).' : '';
        setErr(m);
        return m ? m : null;
      }}
      run={(opId) => call('timesheet.reopen', { periodKey, reason: reason.trim() }, opId)}
      onClose={onClose}
      onReload={onReload}
      nameOf={emps.nameOf}
    >
      <div style={{ marginTop: 'var(--space-3)' }}>
        <FormField name="reopen-reason" label="Lý do mở lại" required error={err || undefined}>
          <Textarea value={reason} onValueChange={setReason} />
        </FormField>
      </div>
    </ActionDialog>
  );
}

interface CarryLine { employeeId: string; delta: string; note: string }

function CarryDialog({ periodKey, employees, onClose }: { periodKey: string; employees: { value: string; label: string }[]; onClose: () => void }) {
  const call = useCall();
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<CarryLine[]>([{ employeeId: '', delta: '', note: '' }]);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const upd = (i: number, p: Partial<CarryLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));

  const validate = () => {
    const e: Record<string, string> = {};
    if (reason.trim().length < 10) e.reason = 'Nêu rõ lý do (tối thiểu 10 ký tự).';
    lines.forEach((l, i) => {
      if (!l.employeeId) e[`emp${i}`] = 'Chọn nhân viên.';
      const n = Number(l.delta.replace(',', '.'));
      if (!l.delta.trim() || !Number.isFinite(n) || n === 0) e[`delta${i}`] = 'Nhập số công chênh lệch khác 0 (âm nếu trừ).';
    });
    if (new Set(lines.map((l) => l.employeeId)).size !== lines.length) e.dup = 'Mỗi nhân viên chỉ một dòng.';
    setErrs(e);
    return Object.keys(e).length ? 'Kiểm tra lại các trường được đánh dấu.' : null;
  };

  return (
    <ActionDialog
      title={`Chuyển chênh lệch sang kỳ sau (từ ${periodKey})`}
      impact={[
        'Kỳ công đã khóa KHÔNG thay đổi; mỗi dòng tạo một điều chỉnh liên kết với kỳ gốc.',
        'Chênh lệch công được cộng vào bảng công của kỳ kế tiếp và vào lương kỳ đó.',
        'Điều chỉnh được duyệt ngay, ghi vào nhật ký thao tác kèm lý do.',
      ]}
      confirmLabel="Tạo điều chỉnh sang kỳ sau"
      success="Đã tạo điều chỉnh sang kỳ sau."
      validate={validate}
      run={(opId) =>
        call('timesheet.reopen', {
          periodKey, mode: 'carry_forward', reason: reason.trim(),
          carry: lines.map((l) => ({ employeeId: l.employeeId, deltaPaidDays: Number(l.delta.replace(',', '.')), note: l.note.trim() || undefined })),
        }, opId)
      }
      onClose={onClose}
    >
      <div className="stack" style={{ marginTop: 'var(--space-3)' }}>
        <FormField name="carry-reason" label="Lý do chung" required error={errs.reason}>
          <Textarea value={reason} onValueChange={setReason} />
        </FormField>
        {lines.map((l, i) => (
          <div key={i} className="grid-3">
            <FormField name={`carry-emp-${i}`} label="Nhân viên" required error={errs[`emp${i}`]}>
              <Select value={l.employeeId} onValueChange={(v) => upd(i, { employeeId: v })} placeholder="Chọn nhân viên" options={employees} />
            </FormField>
            <FormField name={`carry-delta-${i}`} label="Công chênh lệch" required error={errs[`delta${i}`]}>
              <Input value={l.delta} onValueChange={(v) => upd(i, { delta: v })} inputMode="decimal" placeholder="vd. 0,5 hoặc -1" />
            </FormField>
            <FormField name={`carry-note-${i}`} label="Ghi chú dòng">
              <Input value={l.note} onValueChange={(v) => upd(i, { note: v })} />
            </FormField>
          </div>
        ))}
        {errs.dup ? <Banner tone="error">{errs.dup}</Banner> : null}
        <div className="row">
          <Button size="sm" variant="secondary" icon="plus" onClick={() => setLines((ls) => [...ls, { employeeId: '', delta: '', note: '' }])}>Thêm dòng</Button>
          {lines.length > 1 ? <Button size="sm" variant="tertiary" onClick={() => setLines((ls) => ls.slice(0, -1))}>Bỏ dòng cuối</Button> : null}
        </div>
      </div>
    </ActionDialog>
  );
}
