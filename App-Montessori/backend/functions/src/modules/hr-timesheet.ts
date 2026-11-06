// Bảng công: build / lock / reopen. Tính toán thuần ở lib/calc-time.ts.
import type { ActionMap, Ctx } from '../core/types';
import { Timestamp } from '../core/firebase';
import { fail, invalid } from '../core/errors';
import { createDoc, getCampus, updateDoc, dayKeyOf } from '../core/store';
import { registerApprovalHandler, createApproval, ApprovalDoc } from '../core/approvals';
import { asDocs, commitOps, Doc, needPeriod, needStr, resolveCampus, syncApproval, toDate, tzOf } from '../lib/common';
import { entryToInst, notifyEmployee } from '../lib/hr-common';
import { calcDay, DayResult, PunchMin, totalsOf, EmployeeTotals } from '../lib/calc-time';
import { addDays, listDays, minutesSinceDayStart, nextPeriodKey, periodRange } from '../lib/time';

interface Built {
  tsId: string; campusId: string; periodKey: string; from: string; to: string;
  rows: Array<Record<string, any>>; snapshots: Map<string, Record<string, any>>;
  employees: Array<{ employeeId: string; name: string; code?: string; totals: EmployeeTotals; carriedPaidDays: number; paidDaysTotal: number; issues: number }>;
  errors: Array<{ employeeId: string; name?: string; dayKey?: string; type: string; message: string; blocking: boolean }>;
}

const HOLIDAY_TYPES = new Set(['holiday', 'closed', 'no_school']);
const PAID_LEAVE = new Set(['annual', 'sick', 'maternity', 'wedding', 'bereavement']);

/** Gom dữ liệu & tính công cho một cơ sở/kỳ (không ghi). */
export async function computeTimesheet(ctx: Ctx, campusId: string, campus: Doc, periodKey: string, onlyEmployees?: string[]): Promise<Built> {
  const { from, to } = periodRange(periodKey);
  const tz = tzOf(campus);
  const tsId = `${campusId}_${periodKey}`;
  const today = dayKeyOf(ctx.now, tz);
  const dayBefore = addDays(from, -1);
  const dayAfter = addDays(to, 1);

  const rng = (c: string, f: string, t: string, extra?: [string, any]) => {
    let q = ctx.col(c).where('campusId', '==', campusId) as FirebaseFirestore.Query;
    if (extra) q = q.where(extra[0], '==', extra[1]);
    return q.where('dayKey', '>=', f).where('dayKey', '<=', t).get();
  };
  const [entriesS, punchesS, adjS, otS, leavesS, exA, exB, carryS] = await Promise.all([
    rng('rosterEntries', from, to),
    rng('punches', dayBefore, dayAfter),
    rng('punchAdjustments', dayBefore, dayAfter, ['status', 'approved']),
    rng('overtimeRequests', from, to, ['status', 'approved']),
    ctx.col('staffLeaves').where('campusId', '==', campusId).where('status', '==', 'approved').get(),
    ctx.col('calendarExceptions').where('campusId', '==', campusId).get(),
    ctx.col('calendarExceptions').where('campusId', '==', null).get(),
    ctx.col('timesheetAdjustments').where('campusId', '==', campusId).where('toPeriodKey', '==', periodKey).get(),
  ]);
  const entries = asDocs(entriesS).filter((e) => e.status !== 'superseded');
  const punches = asDocs(punchesS);
  const adjs = asDocs(adjS);
  const ots = asDocs(otS);
  const leaves = asDocs(leavesS).filter((l) => l.fromDay <= to && l.toDay >= from);
  const holidays = new Set<string>();
  for (const x of [...asDocs(exA), ...asDocs(exB)]) {
    if (x.archived || (x.type && !HOLIDAY_TYPES.has(x.type))) continue;
    const f = x.fromDay ?? x.dayKey; const t = x.toDay ?? x.dayKey;
    if (f) for (const d of listDays(f, t ?? f)) holidays.add(d);
  }
  const carried = asDocs(carryS).filter((c) => c.status === 'approved');

  const empIds = new Set<string>();
  for (const e of entries) empIds.add(e.actualEmployeeId ?? e.employeeId);
  for (const o of ots) empIds.add(o.employeeId);
  const wanted = onlyEmployees?.length ? new Set(onlyEmployees) : null;
  const empDocs = new Map<string, Doc>();
  for (const id of empIds) {
    if (wanted && !wanted.has(id)) continue;
    const s = await ctx.doc(`employees/${id}`).get();
    if (s.exists) empDocs.set(id, { id, ...(s.data() as any) });
  }

  const rows: Built['rows'] = []; const snapshots = new Map<string, any>(); const employees: Built['employees'] = []; const errors: Built['errors'] = [];
  const nowDate = ctx.now;
  for (const [empId, emp] of empDocs) {
    const myEntries = entries.filter((e) => (e.actualEmployeeId ?? e.employeeId) === empId);
    const myPunchesRaw = punches.filter((p) => p.employeeId === empId);
    const myAdjs = adjs.filter((a) => a.employeeId === empId);
    const myOt = ots.filter((o) => o.employeeId === empId);
    const myLeaves = leaves.filter((l) => l.employeeId === empId);
    // Lượt chấm hiệu lực: lượt gốc (giữ nguyên) + bản điều chỉnh đã duyệt thay thế lượt cùng loại trong ±12h.
    type P = { kind: 'in' | 'out'; at: Date; id: string; adjusted: boolean };
    let eff: P[] = myPunchesRaw.map((p) => ({ kind: p.kind, at: toDate(p.effectiveTime) ?? toDate(p.serverTime)!, id: p.id, adjusted: false })).filter((p) => p.at);
    for (const a of myAdjs) {
      const at = toDate(a.effectiveTime ?? a.requestedTime); if (!at) continue;
      eff = eff.filter((p) => !(p.kind === a.kind && Math.abs(p.at.getTime() - at.getTime()) <= 12 * 3_600_000));
      eff.push({ kind: a.kind, at, id: `adj:${a.id}`, adjusted: true });
    }
    const days: DayResult[] = [];
    const empRows: Array<Record<string, any>> = [];
    for (const day of listDays(from, to)) {
      const dayEntries = myEntries.filter((e) => e.dayKey === day);
      const ot = myOt.filter((o) => o.dayKey === day).reduce((s, o) => s + (o.approvedMinutes ?? 0), 0);
      if (!dayEntries.length && !ot) continue;
      const shifts = dayEntries.map((e) => {
        let leave: { type: string; paid: boolean } | null = null;
        const lv = myLeaves.find((l) => l.id === e.leaveId) ?? (e.employeeId === empId ? myLeaves.find((l) => l.fromDay <= day && l.toDay >= day) : undefined);
        if (lv) leave = { type: lv.type, paid: PAID_LEAVE.has(lv.type) && lv.paid !== false };
        return entryToInst(e, leave, holidays.has(day));
      });
      const pm: PunchMin[] = eff
        .map((p) => ({ kind: p.kind, min: minutesSinceDayStart(day, p.at, tz), id: p.id, adjusted: p.adjusted }))
        .filter((p) => p.min >= -1440 && p.min <= 2880);
      const maxEnd = shifts.length ? Math.max(...shifts.map((s) => s.end)) : 0;
      const finished = day < today || (day === today && minutesSinceDayStart(day, nowDate, tz) > maxEnd + 120);
      const r = calcDay(shifts, pm, { finished, approvedOvertimeMinutes: ot });
      days.push(r);
      empRows.push({
        id: `${tsId}_${empId}_${day}`, timesheetId: tsId, campusId, periodKey, employeeId: empId, dayKey: day,
        status: r.status, scheduledMinutes: r.scheduledMinutes, workedMinutes: r.workedMinutes, lateMinutes: r.lateMinutes,
        earlyLeaveMinutes: r.earlyLeaveMinutes, paidUnits: r.paidUnits, overtimeMinutes: r.overtimeMinutes,
        approvedOvertimeMinutes: ot, issues: r.issues, shifts: r.shifts, locked: false,
      });
      for (const iss of r.issues) errors.push({ employeeId: empId, name: emp.fullName, dayKey: day, type: r.status === 'incomplete' ? 'incomplete' : 'absent', message: iss, blocking: r.status === 'incomplete' });
      if (r.status === 'scheduled') errors.push({ employeeId: empId, name: emp.fullName, dayKey: day, type: 'scheduled', message: 'Ca chưa kết thúc.', blocking: true });
    }
    const totals = totalsOf(days);
    const carriedPaid = carried.filter((c) => c.employeeId === empId).reduce((s, c) => s + (c.deltaPaidDays ?? 0), 0);
    employees.push({ employeeId: empId, name: emp.fullName, code: emp.code, totals, carriedPaidDays: carriedPaid, paidDaysTotal: Math.round((totals.paidDays + carriedPaid) * 100) / 100, issues: days.reduce((s, d) => s + d.issues.length, 0) });
    rows.push(...empRows);
    snapshots.set(empId, {
      employeeId: empId, name: emp.fullName, periodKey, campusId,
      entries: myEntries.map((e) => ({ id: e.id, dayKey: e.dayKey, shiftId: e.shiftId, employeeId: e.employeeId, actualEmployeeId: e.actualEmployeeId ?? null, shiftSnapshot: e.shiftSnapshot, leaveId: e.leaveId ?? null })),
      punches: myPunchesRaw.map((p) => ({ id: p.id, kind: p.kind, time: (toDate(p.effectiveTime) ?? toDate(p.serverTime))?.toISOString(), deviceTime: toDate(p.deviceTime)?.toISOString(), source: p.source, result: p.result, immutable: true })),
      adjustments: myAdjs.map((a) => ({ id: a.id, dayKey: a.dayKey, kind: a.kind, time: toDate(a.effectiveTime ?? a.requestedTime)?.toISOString(), adjustsPunchIds: a.adjustsPunchIds ?? a.originalPunchIds ?? [] })),
      leaves: myLeaves.map((l) => ({ id: l.id, type: l.type, fromDay: l.fromDay, toDay: l.toDay, days: l.days, paid: PAID_LEAVE.has(l.type) })),
      overtime: myOt.map((o) => ({ id: o.id, dayKey: o.dayKey, approvedMinutes: o.approvedMinutes })),
      carriedAdjustments: carried.filter((c) => c.employeeId === empId).map((c) => ({ id: c.id, deltaPaidDays: c.deltaPaidDays, reason: c.reason })),
      totals,
    });
  }
  // Còn yêu cầu chưa xử lý trong kỳ → chặn khóa kỳ.
  const [pa, pl, po] = await Promise.all([
    ctx.col('punchAdjustments').where('campusId', '==', campusId).where('status', '==', 'pending').get(),
    ctx.col('staffLeaves').where('campusId', '==', campusId).where('status', '==', 'pending').get(),
    ctx.col('overtimeRequests').where('campusId', '==', campusId).where('status', '==', 'pending').get(),
  ]);
  for (const d of asDocs(pa)) if (d.dayKey >= from && d.dayKey <= to) errors.push({ employeeId: d.employeeId, name: d.employeeName, dayKey: d.dayKey, type: 'pending_adjustment', message: 'Còn đề nghị bổ sung công chờ duyệt.', blocking: true });
  for (const d of asDocs(pl)) if (d.fromDay <= to && d.toDay >= from) errors.push({ employeeId: d.employeeId, name: d.employeeName, dayKey: d.fromDay, type: 'pending_leave', message: 'Còn đơn nghỉ chờ duyệt.', blocking: true });
  for (const d of asDocs(po)) if (d.dayKey >= from && d.dayKey <= to) errors.push({ employeeId: d.employeeId, name: d.employeeName, dayKey: d.dayKey, type: 'pending_overtime', message: 'Còn đề nghị tăng ca chờ duyệt.', blocking: true });
  return { tsId, campusId, periodKey, from, to, rows, snapshots, employees, errors };
}

function headerOf(b: Built, ctx: Ctx, status: string, extra: Record<string, unknown> = {}) {
  const blocking = b.errors.filter((e) => e.blocking);
  return {
    campusId: b.campusId, periodKey: b.periodKey, fromDay: b.from, toDay: b.to, status,
    employees: b.employees, employeeCount: b.employees.length,
    errorCount: blocking.length, warningCount: b.errors.length - blocking.length, errors: b.errors.slice(0, 300),
    incompleteDays: b.employees.reduce((s, e) => s + e.totals.incompleteDays, 0),
    builtAt: Timestamp.now(), builtBy: ctx.uid,
    policy: { workUnit: 'Theo cấu hình ca (shift.unitPolicy: full | proportional)', late: 'Muộn/sớm vượt dung sai của ca', overnight: 'Ca qua đêm thuộc ngày bắt đầu', missingPunch: 'Thiếu lượt = incomplete, không tính đủ công' },
    ...extra,
  };
}

async function persist(ctx: Ctx, b: Built, header: Record<string, unknown>, locked: boolean) {
  const hRef = ctx.doc(`timesheets/${b.tsId}`);
  const cur = await hRef.get();
  const old = asDocs(await ctx.col('timesheetDays').where('timesheetId', '==', b.tsId).get());
  const ids = new Set(b.rows.map((r) => r.id));
  const now = Timestamp.now();
  const ops: Array<(w: FirebaseFirestore.WriteBatch) => void> = [];
  ops.push((w) => w.set(hRef, {
    ...header, createdAt: cur.data()?.createdAt ?? now, createdBy: cur.data()?.createdBy ?? ctx.uid, updatedAt: now, updatedBy: ctx.uid,
    version: ((cur.data()?.version as number | undefined) ?? 0) + 1,
    revision: ((cur.data()?.revision as number | undefined) ?? 0) + 1,
  }, { merge: true }));
  for (const r of b.rows) { const { id, ...rest } = r; ops.push((w) => w.set(ctx.doc(`timesheetDays/${id}`), { ...rest, locked, updatedAt: now, updatedBy: ctx.uid })); }
  for (const o of old) if (!ids.has(o.id)) ops.push((w) => w.delete(ctx.doc(`timesheetDays/${o.id}`))); // dữ liệu tính nháp (suy ra), không phải chứng từ
  await commitOps(ops);
}

const build = async (ctx: Ctx, p: any) => {
  const { id: campusId, campus } = await resolveCampus(ctx, p, 'timekeeping.approve');
  const periodKey = needPeriod(p?.periodKey);
  const tsId = `${campusId}_${periodKey}`;
  const cur = await ctx.doc(`timesheets/${tsId}`).get();
  if (cur.exists && cur.data()?.status === 'locked') fail('INVALID_STATE', 'Bảng công kỳ này đã khóa. Mở lại kỳ có kiểm soát hoặc dùng kỳ điều chỉnh.', { reason: 'PERIOD_LOCKED' });
  const b = await computeTimesheet(ctx, campusId, campus, periodKey, Array.isArray(p?.employeeIds) ? p.employeeIds : undefined);
  const status = cur.exists && cur.data()?.status === 'reopened' ? 'reopened' : 'draft';
  const header = headerOf(b, ctx, status);
  await persist(ctx, b, header, false);
  // Báo nhân viên khi bảng công cá nhân thay đổi.
  const before = new Map<string, number>(((cur.data()?.employees as any[]) ?? []).map((e) => [e.employeeId, e.paidDaysTotal * 100000 + e.totals.workedMinutes]));
  let n = 0;
  for (const e of b.employees) {
    if (cur.exists && before.has(e.employeeId) && before.get(e.employeeId) !== e.paidDaysTotal * 100000 + e.totals.workedMinutes && n++ < 100) {
      await notifyEmployee(ctx, e.employeeId, campusId, 'Bảng công thay đổi', `Bảng công ${periodKey} của bạn vừa được cập nhật.`, { c: 'timesheets', id: tsId });
    }
  }
  await ctx.audit({ action: 'timesheet.build', collection: 'timesheets', docId: tsId, campusId, after: { employees: b.employees.length, errors: header.errorCount } });
  return {
    timesheetId: tsId, status, employeeCount: b.employees.length, rowCount: b.rows.length, errorCount: header.errorCount, warningCount: header.warningCount,
    employees: b.employees, errors: b.errors.slice(0, 300),
  };
};

const lock = async (ctx: Ctx, p: any) => {
  const { id: campusId, campus } = await resolveCampus(ctx, p, 'timekeeping.lock');
  const periodKey = needPeriod(p?.periodKey);
  const tsId = `${campusId}_${periodKey}`;
  const cur = await ctx.doc(`timesheets/${tsId}`).get();
  if (cur.exists && cur.data()?.status === 'locked') fail('INVALID_STATE', 'Bảng công kỳ này đã được khóa.');
  const { to } = periodRange(periodKey);
  if (to >= dayKeyOf(ctx.now, tzOf(campus))) fail('PRECONDITION', 'Kỳ công chưa kết thúc; chỉ khóa sau ngày cuối kỳ.', { reason: 'PERIOD_NOT_ENDED' });
  const b = await computeTimesheet(ctx, campusId, campus, periodKey); // tính lại từ dữ liệu hiện hành
  const blocking = b.errors.filter((e) => e.blocking);
  if (blocking.length) fail('PRECONDITION', `Còn ${blocking.length} lỗi công chưa xử lý (thiếu lượt chấm, đề nghị chờ duyệt...). Xử lý trước khi khóa kỳ.`, { reason: 'UNRESOLVED_ERRORS', errors: blocking.slice(0, 200) });
  const lockVersion = ((cur.data()?.lockVersion as number | undefined) ?? 0) + 1;
  const header = headerOf(b, ctx, 'locked', { lockedAt: Timestamp.now(), lockedBy: ctx.uid, lockVersion, reportsStale: false });
  await persist(ctx, b, header, true);
  // Bản chụp: ca, lượt chấm, phép, điều chỉnh đã dùng. Đổi cấu hình ca sau đó không làm đổi kỳ đã khóa.
  await commitOps([...b.snapshots.entries()].map(([empId, snap]) => (w) => w.set(ctx.doc(`timesheets/${tsId}/snapshots/${empId}_v${lockVersion}`), { ...snap, lockVersion, lockedAt: Timestamp.now(), lockedBy: ctx.uid })));
  await ctx.audit({ action: 'timesheet.lock', collection: 'timesheets', docId: tsId, campusId, after: { lockVersion, employees: b.employees.length } });
  return { timesheetId: tsId, status: 'locked', lockVersion, employeeCount: b.employees.length, rowCount: b.rows.length, warnings: b.errors.filter((e) => !e.blocking).slice(0, 100) };
};

async function payrollBlocksReopen(ctx: Ctx, campusId: string, periodKey: string): Promise<string | null> {
  const s = await ctx.doc(`payrollRuns/pr_${campusId}_${periodKey}`).get();
  const st = s.data()?.status;
  return s.exists && ['approved', 'published', 'paid'].includes(st) ? st : null;
}

async function applyReopen(ctx: Ctx, tsId: string, reason: string, note?: string) {
  const ts0 = await ctx.doc(`timesheets/${tsId}`).get();
  if (!ts0.exists) fail('NOT_FOUND', 'Bảng công không tồn tại.');
  const t = ts0.data()!;
  ctx.require('timekeeping.reopen', t.campusId);
  if (t.status !== 'locked') fail('INVALID_STATE', 'Kỳ công không ở trạng thái đã khóa.');
  const blocked = await payrollBlocksReopen(ctx, t.campusId, t.periodKey);
  if (blocked) fail('PRECONDITION', `Bảng lương kỳ này đã ở trạng thái "${blocked}"; không mở lại kỳ công. Hãy chuyển chênh lệch sang kỳ điều chỉnh.`, { reason: 'PAYROLL_LOCKED' });
  const rows = asDocs(await ctx.col('timesheetDays').where('timesheetId', '==', tsId).get());
  const entry = { at: Timestamp.now(), by: ctx.uid, reason, note: note ?? null, lockVersion: t.lockVersion ?? 1 };
  await updateDoc(ctx, ctx.doc(`timesheets/${tsId}`), {
    status: 'reopened', reopenedAt: Timestamp.now(), reopenedBy: ctx.uid, reopenReason: reason, reportsStale: true,
    reopenHistory: [...((t.reopenHistory as unknown[]) ?? []), entry],
  });
  await commitOps(rows.map((r) => (w) => w.update(ctx.doc(`timesheetDays/${r.id}`), { locked: false })));
  await ctx.audit({ action: 'timesheet.reopen', collection: 'timesheets', docId: tsId, campusId: t.campusId, reason });
  return { timesheetId: tsId, status: 'reopened' };
}

registerApprovalHandler('timesheet_reopen', {
  perm: 'timekeeping.reopen',
  onApprove: async (ctx, a: ApprovalDoc, note) => applyReopen(ctx, a.refId!, String(a.payload?.reason ?? ''), note),
});

const reopen = async (ctx: Ctx, p: any) => {
  const { id: campusId } = await resolveCampus(ctx, p, 'timekeeping.lock');
  const periodKey = needPeriod(p?.periodKey);
  const reason = needStr(p?.reason, 'reason', 500);
  if (reason.length < 10) invalid({ reason: 'Nêu rõ lý do mở lại kỳ (tối thiểu 10 ký tự).' });
  const tsId = `${campusId}_${periodKey}`;
  const cur = await ctx.doc(`timesheets/${tsId}`).get();
  if (!cur.exists || cur.data()?.status !== 'locked') fail('INVALID_STATE', 'Chỉ mở lại được kỳ công đang ở trạng thái đã khóa.');
  if (p?.mode === 'carry_forward') {
    // Đưa chênh lệch sang KỲ ĐIỀU CHỈNH tiếp theo (kỳ đã khóa không đổi).
    const items: any[] = Array.isArray(p?.carry) ? p.carry : [];
    if (!items.length) invalid({ carry: 'Nhập danh sách chênh lệch cần chuyển kỳ.' });
    const toKey = nextPeriodKey(periodKey);
    const ids: string[] = [];
    for (const it of items) {
      if (typeof it?.employeeId !== 'string' || typeof it?.deltaPaidDays !== 'number' || !Number.isFinite(it.deltaPaidDays)) invalid({ carry: 'Mỗi dòng cần employeeId và deltaPaidDays (số).' });
      const e = await ctx.doc(`employees/${it.employeeId}`).get();
      if (!e.exists) invalid({ carry: `Nhân viên ${it.employeeId} không tồn tại.` });
      ids.push(await createDoc(ctx, 'timesheetAdjustments', undefined, {
        campusId, fromPeriodKey: periodKey, toPeriodKey: toKey, employeeId: it.employeeId, deltaPaidDays: Math.round(it.deltaPaidDays * 100) / 100,
        reason: String(it.note ?? reason).slice(0, 500), status: 'approved', approvedBy: ctx.uid,
      }));
    }
    await ctx.audit({ action: 'timesheet.carryForward', collection: 'timesheetAdjustments', docId: ids.join(','), campusId, reason, after: { toPeriodKey: toKey, count: ids.length } });
    return { mode: 'carry_forward', toPeriodKey: toKey, adjustmentIds: ids };
  }
  const blocked = await payrollBlocksReopen(ctx, campusId, periodKey);
  if (blocked) fail('PRECONDITION', `Bảng lương kỳ này đã ở trạng thái "${blocked}"; không mở lại kỳ công. Dùng mode "carry_forward" để chuyển chênh lệch sang kỳ sau.`, { reason: 'PAYROLL_LOCKED' });
  const approvalId = await createApproval(ctx, {
    type: 'timesheet_reopen', campusId, refCollection: 'timesheets', refId: tsId, payload: { reason },
    summary: `Mở lại bảng công ${periodKey}`, impact: { periodKey, reason, effect: 'Bảng công về trạng thái mở; báo cáo kỳ trước được đánh dấu đã thay đổi.' },
  });
  await ctx.audit({ action: 'timesheet.reopen.request', collection: 'timesheets', docId: tsId, campusId, reason });
  return { mode: 'reopen', approvalId, status: 'pending' };
};

export const actions: ActionMap = {
  'timesheet.build': { scope: 'org', perm: 'timekeeping.approve', handler: build },
  'timesheet.lock': { scope: 'org', perm: 'timekeeping.lock', handler: lock },
  'timesheet.reopen': { scope: 'org', perm: 'timekeeping.lock', handler: reopen },
};

void getCampus; void syncApproval;
