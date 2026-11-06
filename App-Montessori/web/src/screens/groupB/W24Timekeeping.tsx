'use client';
import { useMemo, useState } from 'react';
import { formatDateTime, formatDate, formatTime } from '@/lib/format';
import { PageHeader, Stat } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Drawer } from '@/components/ui/Drawer';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { ActionDialog, formatNumber, useCall, useCampusCtx, useCampusDocs, useEmployees } from './parts/kit';
import { Tag } from './parts/statuses';
import { minToClock, minutesToHm } from './parts/dates';
import {
  PeriodSelect, toAdjust, useDefaultPeriod, usePunches, useTimesheet, useTsDays,
  type AdjustRow, type PunchRow, type TsDay, type TsEmployee,
} from './parts/timekeepingParts';

const KIND: Record<string, string> = { in: 'Vào', out: 'Ra' };

/** W24 — Bảng chấm công nhân viên: tổng hợp theo kỳ, giữ nguyên lượt gốc, điều chỉnh hiện riêng. */
export function W24Timekeeping() {
  const c = useCampusCtx();
  const call = useCall();
  const [periodKey, setPeriodKey] = useState(useDefaultPeriod());
  const [selected, setSelected] = useState<string | null>(null);
  const [rebuild, setRebuild] = useState(false);

  const ts = useTimesheet(periodKey);
  const header = ts.data;
  const emps = useEmployees();
  const locked = header?.status === 'locked';
  const canBuild = c.can('timekeeping.approve');

  const rows = header?.employees ?? [];
  const status = ts.status === 'ready' && rows.length === 0 ? 'empty' : ts.status;

  const columns: Column<TsEmployee>[] = [
    { key: 'code', header: 'Mã', value: (r) => r.code, sortable: true, width: 90 },
    { key: 'name', header: 'Nhân viên', value: (r) => r.name, sortable: true, render: (r) => <strong>{r.name}</strong> },
    { key: 'work', header: 'Ngày đủ dữ liệu', value: (r) => r.totals.workDays, sortable: true, align: 'right' },
    {
      key: 'paid', header: 'Công tính lương', value: (r) => r.paidDaysTotal, sortable: true, align: 'right',
      render: (r) => (
        <span>
          {formatNumber(r.paidDaysTotal)}
          {r.carriedPaidDays ? <span className="text-caption text-secondary"> (gồm {formatNumber(r.carriedPaidDays)} điều chỉnh kỳ trước)</span> : null}
        </span>
      ),
    },
    { key: 'late', header: 'Đi muộn', value: (r) => r.totals.lateCount, align: 'right', render: (r) => (r.totals.lateCount ? `${r.totals.lateCount} lần · ${r.totals.lateMinutes} phút` : '—') },
    { key: 'inc', header: 'Chưa đủ dữ liệu', value: (r) => r.totals.incompleteDays, sortable: true, align: 'right', render: (r) => (r.totals.incompleteDays ? <Badge tone="warning">{r.totals.incompleteDays} ngày</Badge> : '0') },
    { key: 'abs', header: 'Vắng', value: (r) => r.totals.absentDays, align: 'right' },
    { key: 'leave', header: 'Nghỉ phép', value: (r) => r.totals.leaveDays, align: 'right', render: (r) => (r.totals.leaveDays ? `${r.totals.leaveDays} (${r.totals.unpaidLeaveDays} không lương)` : '0') },
    { key: 'ot', header: 'Tăng ca đã duyệt', value: (r) => r.totals.overtimeMinutes, align: 'right', render: (r) => minutesToHm(r.totals.overtimeMinutes) },
    { key: 'act', header: 'Chi tiết', render: (r) => <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setSelected(r.employeeId); }}>Xem chi tiết</Button> },
  ];
  const filters: TableFilter<TsEmployee>[] = [
    {
      key: 'issue', label: 'Dữ liệu', options: [{ value: 'inc', label: 'Có ngày chưa đủ dữ liệu' }, { value: 'ok', label: 'Đủ dữ liệu' }],
      predicate: (r, v) => (v === 'inc' ? r.totals.incompleteDays > 0 : r.totals.incompleteDays === 0),
    },
  ];

  const sel = rows.find((r) => r.employeeId === selected) ?? null;
  const blocking = header?.errors.filter((e) => e.blocking).length ?? 0;

  return (
    <div>
      <PageHeader
        title="Bảng chấm công nhân viên"
        code="W24"
        description="Lượt chấm gốc luôn được giữ nguyên. Thiếu lượt vào hoặc ra được ghi là «Chưa đủ dữ liệu» và không tính đủ công."
        actions={
          canBuild && !locked ? <Button icon="refresh" variant="secondary" onClick={() => setRebuild(true)}>Tính lại bảng công</Button> : undefined
        }
      />
      {locked ? (
        <Banner tone="info" title="Kỳ công đã khóa">
          Bảng công không thể tính lại trực tiếp. Muốn sửa phải mở lại kỳ có kiểm soát hoặc chuyển chênh lệch sang kỳ điều chỉnh (màn «Duyệt và khóa công»).
        </Banner>
      ) : null}
      {header && !locked && blocking > 0 ? (
        <Banner tone="warning" title={`${blocking} vấn đề công chưa xử lý`}>
          Số liệu dưới đây là bản nháp từ lần tính gần nhất ({formatDateTime(header.builtAt as Date, c.tz)}). Xử lý đề nghị bổ sung công và ngày thiếu lượt trước khi khóa kỳ.
        </Banner>
      ) : null}

      {header ? (
        <div className="grid-4" style={{ margin: 'var(--space-4) 0' }}>
          <Stat label="Trạng thái bảng công" value={<Tag domain="timesheet" value={header.status} />} hint={`${formatDate(header.fromDay)} – ${formatDate(header.toDay)}`} />
          <Stat label="Nhân viên trong bảng" value={header.employees.length} />
          <Stat label="Ngày chưa đủ dữ liệu" value={header.incompleteDays} tone={header.incompleteDays ? 'warning' : undefined} hint="Không tính đủ công" />
          <Stat label="Lỗi chặn khóa kỳ" value={blocking} tone={blocking ? 'error' : 'success'} />
        </div>
      ) : null}

      <DataTable
        caption="Bảng chấm công theo nhân viên"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.employeeId}
        status={status}
        error={ts.error?.message}
        onRetry={ts.retry}
        searchText={(r) => `${r.code} ${r.name}`}
        searchPlaceholder="Tìm theo mã hoặc tên"
        filters={filters}
        onRowClick={(r) => setSelected(r.employeeId)}
        toolbarExtra={<PeriodSelect value={periodKey} onChange={setPeriodKey} />}
        emptyTitle="Chưa có bảng công cho kỳ này"
        emptyDescription={canBuild ? 'Chọn «Tính lại bảng công» để dựng bảng công từ lịch ca, lượt chấm, nghỉ phép và tăng ca đã duyệt.' : 'Người có quyền duyệt công cần tính bảng công cho kỳ này.'}
        emptyAction={canBuild && !locked ? <Button icon="refresh" onClick={() => setRebuild(true)}>Tính bảng công</Button> : undefined}
      />

      {rebuild ? (
        <ActionDialog
          title={`Tính lại bảng công ${periodKey}`}
          subject={`${c.campusName} · kỳ ${periodKey}`}
          impact={[
            'Bảng công nháp được tính lại từ lịch ca đã công bố, lượt chấm gốc, bản điều chỉnh đã duyệt, nghỉ phép và tăng ca đã duyệt.',
            'Lượt chấm gốc không bị xóa hay sửa. Ngày thiếu lượt vẫn là «Chưa đủ dữ liệu».',
            'Nhân viên có số liệu thay đổi sẽ nhận thông báo.',
            'Không ảnh hưởng bảng lương vì lương chỉ dựng từ bảng công đã khóa.',
          ]}
          confirmLabel="Tính lại bảng công"
          success="Đã tính lại bảng công."
          run={(opId) => call('timesheet.build', { periodKey }, opId)}
          onClose={() => setRebuild(false)}
          nameOf={emps.nameOf}
          onReload={ts.retry}
        />
      ) : null}

      {sel && header ? <EmployeeDrawer periodKey={periodKey} employee={sel} from={header.fromDay} to={header.toDay} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function EmployeeDrawer({ periodKey, employee, from, to, onClose }: { periodKey: string; employee: TsEmployee; from: string; to: string; onClose: () => void }) {
  const c = useCampusCtx();
  const days = useTsDays(periodKey);
  const punches = usePunches(from, to, periodKey);
  const adjusts = useCampusDocs<AdjustRow>('punchAdjustments', toAdjust, { where: [['employeeId', '==', employee.employeeId]], tag: periodKey });

  const myDays = useMemo(() => days.data.filter((d) => d.employeeId === employee.employeeId).sort((a, b) => a.dayKey.localeCompare(b.dayKey)), [days.data, employee.employeeId]);
  const myPunches = useMemo(() => punches.data.filter((p) => p.employeeId === employee.employeeId).sort((a, b) => (a.effectiveTime?.getTime() ?? 0) - (b.effectiveTime?.getTime() ?? 0)), [punches.data, employee.employeeId]);
  const myAdj = useMemo(() => adjusts.data.filter((a) => a.dayKey >= from && a.dayKey <= to).sort((a, b) => a.dayKey.localeCompare(b.dayKey)), [adjusts.data, from, to]);

  const dayCols: Column<TsDay>[] = [
    { key: 'day', header: 'Ngày', value: (r) => r.dayKey, sortable: true, render: (r) => formatDate(r.dayKey), width: 110 },
    { key: 'status', header: 'Kết quả', value: (r) => r.status, render: (r) => <Tag domain="day" value={r.status} /> },
    {
      key: 'shifts', header: 'Ca · vào/ra',
      render: (r) => (
        <div className="stack-sm">
          {r.shifts.map((s) => (
            <span key={s.entryId} className="text-small">
              {s.shiftId}: {minToClock(s.inMin)} → {minToClock(s.outMin)}
            </span>
          ))}
        </div>
      ),
    },
    { key: 'late', header: 'Muộn/sớm (phút)', align: 'right', value: (r) => r.lateMinutes + r.earlyLeaveMinutes, render: (r) => `${r.lateMinutes} / ${r.earlyLeaveMinutes}` },
    { key: 'units', header: 'Công', align: 'right', value: (r) => r.paidUnits, render: (r) => formatNumber(r.paidUnits) },
    { key: 'issues', header: 'Vấn đề', render: (r) => (r.issues.length ? r.issues.join(' ') : '—') },
  ];
  const punchCols: Column<PunchRow>[] = [
    { key: 'day', header: 'Ngày', value: (r) => r.dayKey, sortable: true, render: (r) => formatDate(r.dayKey), width: 100 },
    { key: 'kind', header: 'Loại', value: (r) => r.kind, render: (r) => KIND[r.kind] ?? r.kind },
    { key: 'dev', header: 'Giờ thiết bị', value: (r) => r.deviceTime?.getTime(), render: (r) => formatTime(r.deviceTime, c.tz) },
    { key: 'srv', header: 'Giờ máy chủ', value: (r) => r.serverTime?.getTime(), render: (r) => formatTime(r.serverTime, c.tz) },
    { key: 'skew', header: 'Lệch giờ', align: 'right', value: (r) => r.clockSkewMinutes ?? 0, render: (r) => (r.clockSkewMinutes === null ? '—' : `${r.clockSkewMinutes} phút`) },
    { key: 'src', header: 'Nguồn', value: (r) => r.source, render: (r) => <Tag domain="punchSource" value={r.source} /> },
    { key: 'res', header: 'Vị trí', value: (r) => r.result, render: (r) => <span><Tag domain="punchResult" value={r.result} />{r.distanceM !== null ? <span className="text-caption text-secondary"> {r.distanceM} m</span> : null}</span> },
    { key: 'shift', header: 'Ca dự kiến', render: (r) => (r.expectedShift ? `${r.expectedShift.start}–${r.expectedShift.end}` : 'Ngoài ca') },
  ];
  const adjCols: Column<AdjustRow>[] = [
    { key: 'day', header: 'Ngày', value: (r) => r.dayKey, render: (r) => formatDate(r.dayKey), width: 100 },
    { key: 'kind', header: 'Loại', render: (r) => KIND[r.kind] ?? r.kind },
    { key: 'time', header: 'Giờ đề nghị', render: (r) => formatTime(r.effectiveTime ?? r.requestedTime, c.tz) },
    { key: 'orig', header: 'Lượt gốc liên kết', render: (r) => (r.originalPunchIds.length ? `${r.originalPunchIds.length} lượt (giữ nguyên)` : 'Chưa có lượt gốc') },
    { key: 'status', header: 'Trạng thái', render: (r) => <Tag domain="leave" value={r.status} /> },
    { key: 'reason', header: 'Lý do', render: (r) => r.reason },
  ];

  return (
    <Drawer open title={`Chi tiết công: ${employee.name}`} onClose={onClose}>
      <div className="stack">
        <Banner tone="info">
          Công tính theo lượt gốc cộng bản điều chỉnh đã duyệt. Bản điều chỉnh không xóa hay ghi đè lượt gốc; cả hai đều hiển thị bên dưới.
        </Banner>
        <Card title="Từng ngày" flush>
          <DataTable caption="Công từng ngày" columns={dayCols} rows={myDays} rowKey={(r) => r.id} status={days.status} error={days.error?.message} onRetry={days.retry} pageSize={31} emptyTitle="Chưa có ngày công nào" emptyDescription="Nhân viên chưa có ca trong kỳ này." />
        </Card>
        <Card title="Lượt chấm gốc" flush>
          <DataTable caption="Lượt chấm gốc" columns={punchCols} rows={myPunches} rowKey={(r) => r.id} status={punches.status} error={punches.error?.message} onRetry={punches.retry} emptyTitle="Chưa có lượt chấm" emptyDescription="Ngày có ca mà không có lượt chấm sẽ là «Chưa đủ dữ liệu» hoặc «Vắng»." />
        </Card>
        <Card title="Đề nghị bổ sung và điều chỉnh liên kết" flush>
          <DataTable caption="Điều chỉnh công" columns={adjCols} rows={myAdj} rowKey={(r) => r.id} status={adjusts.status} error={adjusts.error?.message} onRetry={adjusts.retry} emptyTitle="Không có đề nghị bổ sung" emptyDescription="Chưa có đề nghị bổ sung công nào trong kỳ." />
        </Card>
      </div>
    </Drawer>
  );
}
