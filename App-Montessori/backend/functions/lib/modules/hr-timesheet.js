"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actions = void 0;
exports.computeTimesheet = computeTimesheet;
const firebase_1 = require("../core/firebase");
const errors_1 = require("../core/errors");
const store_1 = require("../core/store");
const approvals_1 = require("../core/approvals");
const common_1 = require("../lib/common");
const hr_common_1 = require("../lib/hr-common");
const calc_time_1 = require("../lib/calc-time");
const time_1 = require("../lib/time");
const HOLIDAY_TYPES = new Set(['holiday', 'closed', 'no_school']);
const PAID_LEAVE = new Set(['annual', 'sick', 'maternity', 'wedding', 'bereavement']);
/** Gom dữ liệu & tính công cho một cơ sở/kỳ (không ghi). */
async function computeTimesheet(ctx, campusId, campus, periodKey, onlyEmployees) {
    const { from, to } = (0, time_1.periodRange)(periodKey);
    const tz = (0, common_1.tzOf)(campus);
    const tsId = `${campusId}_${periodKey}`;
    const today = (0, store_1.dayKeyOf)(ctx.now, tz);
    const dayBefore = (0, time_1.addDays)(from, -1);
    const dayAfter = (0, time_1.addDays)(to, 1);
    const rng = (c, f, t, extra) => {
        let q = ctx.col(c).where('campusId', '==', campusId);
        if (extra)
            q = q.where(extra[0], '==', extra[1]);
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
    const entries = (0, common_1.asDocs)(entriesS).filter((e) => e.status !== 'superseded');
    const punches = (0, common_1.asDocs)(punchesS);
    const adjs = (0, common_1.asDocs)(adjS);
    const ots = (0, common_1.asDocs)(otS);
    const leaves = (0, common_1.asDocs)(leavesS).filter((l) => l.fromDay <= to && l.toDay >= from);
    const holidays = new Set();
    for (const x of [...(0, common_1.asDocs)(exA), ...(0, common_1.asDocs)(exB)]) {
        if (x.archived || (x.type && !HOLIDAY_TYPES.has(x.type)))
            continue;
        const f = x.fromDay ?? x.dayKey;
        const t = x.toDay ?? x.dayKey;
        if (f)
            for (const d of (0, time_1.listDays)(f, t ?? f))
                holidays.add(d);
    }
    const carried = (0, common_1.asDocs)(carryS).filter((c) => c.status === 'approved');
    const empIds = new Set();
    for (const e of entries)
        empIds.add(e.actualEmployeeId ?? e.employeeId);
    for (const o of ots)
        empIds.add(o.employeeId);
    const wanted = onlyEmployees?.length ? new Set(onlyEmployees) : null;
    const empDocs = new Map();
    for (const id of empIds) {
        if (wanted && !wanted.has(id))
            continue;
        const s = await ctx.doc(`employees/${id}`).get();
        if (s.exists)
            empDocs.set(id, { id, ...s.data() });
    }
    const rows = [];
    const snapshots = new Map();
    const employees = [];
    const errors = [];
    const nowDate = ctx.now;
    for (const [empId, emp] of empDocs) {
        const myEntries = entries.filter((e) => (e.actualEmployeeId ?? e.employeeId) === empId);
        const myPunchesRaw = punches.filter((p) => p.employeeId === empId);
        const myAdjs = adjs.filter((a) => a.employeeId === empId);
        const myOt = ots.filter((o) => o.employeeId === empId);
        const myLeaves = leaves.filter((l) => l.employeeId === empId);
        let eff = myPunchesRaw.map((p) => ({ kind: p.kind, at: (0, common_1.toDate)(p.effectiveTime) ?? (0, common_1.toDate)(p.serverTime), id: p.id, adjusted: false })).filter((p) => p.at);
        for (const a of myAdjs) {
            const at = (0, common_1.toDate)(a.effectiveTime ?? a.requestedTime);
            if (!at)
                continue;
            eff = eff.filter((p) => !(p.kind === a.kind && Math.abs(p.at.getTime() - at.getTime()) <= 12 * 3_600_000));
            eff.push({ kind: a.kind, at, id: `adj:${a.id}`, adjusted: true });
        }
        const days = [];
        const empRows = [];
        for (const day of (0, time_1.listDays)(from, to)) {
            const dayEntries = myEntries.filter((e) => e.dayKey === day);
            const ot = myOt.filter((o) => o.dayKey === day).reduce((s, o) => s + (o.approvedMinutes ?? 0), 0);
            if (!dayEntries.length && !ot)
                continue;
            const shifts = dayEntries.map((e) => {
                let leave = null;
                const lv = myLeaves.find((l) => l.id === e.leaveId) ?? (e.employeeId === empId ? myLeaves.find((l) => l.fromDay <= day && l.toDay >= day) : undefined);
                if (lv)
                    leave = { type: lv.type, paid: PAID_LEAVE.has(lv.type) && lv.paid !== false };
                return (0, hr_common_1.entryToInst)(e, leave, holidays.has(day));
            });
            const pm = eff
                .map((p) => ({ kind: p.kind, min: (0, time_1.minutesSinceDayStart)(day, p.at, tz), id: p.id, adjusted: p.adjusted }))
                .filter((p) => p.min >= -1440 && p.min <= 2880);
            const maxEnd = shifts.length ? Math.max(...shifts.map((s) => s.end)) : 0;
            const finished = day < today || (day === today && (0, time_1.minutesSinceDayStart)(day, nowDate, tz) > maxEnd + 120);
            const r = (0, calc_time_1.calcDay)(shifts, pm, { finished, approvedOvertimeMinutes: ot });
            days.push(r);
            empRows.push({
                id: `${tsId}_${empId}_${day}`, timesheetId: tsId, campusId, periodKey, employeeId: empId, dayKey: day,
                status: r.status, scheduledMinutes: r.scheduledMinutes, workedMinutes: r.workedMinutes, lateMinutes: r.lateMinutes,
                earlyLeaveMinutes: r.earlyLeaveMinutes, paidUnits: r.paidUnits, overtimeMinutes: r.overtimeMinutes,
                approvedOvertimeMinutes: ot, issues: r.issues, shifts: r.shifts, locked: false,
            });
            for (const iss of r.issues)
                errors.push({ employeeId: empId, name: emp.fullName, dayKey: day, type: r.status === 'incomplete' ? 'incomplete' : 'absent', message: iss, blocking: r.status === 'incomplete' });
            if (r.status === 'scheduled')
                errors.push({ employeeId: empId, name: emp.fullName, dayKey: day, type: 'scheduled', message: 'Ca chưa kết thúc.', blocking: true });
        }
        const totals = (0, calc_time_1.totalsOf)(days);
        const carriedPaid = carried.filter((c) => c.employeeId === empId).reduce((s, c) => s + (c.deltaPaidDays ?? 0), 0);
        employees.push({ employeeId: empId, name: emp.fullName, code: emp.code, totals, carriedPaidDays: carriedPaid, paidDaysTotal: Math.round((totals.paidDays + carriedPaid) * 100) / 100, issues: days.reduce((s, d) => s + d.issues.length, 0) });
        rows.push(...empRows);
        snapshots.set(empId, {
            employeeId: empId, name: emp.fullName, periodKey, campusId,
            entries: myEntries.map((e) => ({ id: e.id, dayKey: e.dayKey, shiftId: e.shiftId, employeeId: e.employeeId, actualEmployeeId: e.actualEmployeeId ?? null, shiftSnapshot: e.shiftSnapshot, leaveId: e.leaveId ?? null })),
            punches: myPunchesRaw.map((p) => ({ id: p.id, kind: p.kind, time: ((0, common_1.toDate)(p.effectiveTime) ?? (0, common_1.toDate)(p.serverTime))?.toISOString(), deviceTime: (0, common_1.toDate)(p.deviceTime)?.toISOString(), source: p.source, result: p.result, immutable: true })),
            adjustments: myAdjs.map((a) => ({ id: a.id, dayKey: a.dayKey, kind: a.kind, time: (0, common_1.toDate)(a.effectiveTime ?? a.requestedTime)?.toISOString(), adjustsPunchIds: a.adjustsPunchIds ?? a.originalPunchIds ?? [] })),
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
    for (const d of (0, common_1.asDocs)(pa))
        if (d.dayKey >= from && d.dayKey <= to)
            errors.push({ employeeId: d.employeeId, name: d.employeeName, dayKey: d.dayKey, type: 'pending_adjustment', message: 'Còn đề nghị bổ sung công chờ duyệt.', blocking: true });
    for (const d of (0, common_1.asDocs)(pl))
        if (d.fromDay <= to && d.toDay >= from)
            errors.push({ employeeId: d.employeeId, name: d.employeeName, dayKey: d.fromDay, type: 'pending_leave', message: 'Còn đơn nghỉ chờ duyệt.', blocking: true });
    for (const d of (0, common_1.asDocs)(po))
        if (d.dayKey >= from && d.dayKey <= to)
            errors.push({ employeeId: d.employeeId, name: d.employeeName, dayKey: d.dayKey, type: 'pending_overtime', message: 'Còn đề nghị tăng ca chờ duyệt.', blocking: true });
    return { tsId, campusId, periodKey, from, to, rows, snapshots, employees, errors };
}
function headerOf(b, ctx, status, extra = {}) {
    const blocking = b.errors.filter((e) => e.blocking);
    return {
        campusId: b.campusId, periodKey: b.periodKey, fromDay: b.from, toDay: b.to, status,
        employees: b.employees, employeeCount: b.employees.length,
        errorCount: blocking.length, warningCount: b.errors.length - blocking.length, errors: b.errors.slice(0, 300),
        incompleteDays: b.employees.reduce((s, e) => s + e.totals.incompleteDays, 0),
        builtAt: firebase_1.Timestamp.now(), builtBy: ctx.uid,
        policy: { workUnit: 'Theo cấu hình ca (shift.unitPolicy: full | proportional)', late: 'Muộn/sớm vượt dung sai của ca', overnight: 'Ca qua đêm thuộc ngày bắt đầu', missingPunch: 'Thiếu lượt = incomplete, không tính đủ công' },
        ...extra,
    };
}
async function persist(ctx, b, header, locked) {
    const hRef = ctx.doc(`timesheets/${b.tsId}`);
    const cur = await hRef.get();
    const old = (0, common_1.asDocs)(await ctx.col('timesheetDays').where('timesheetId', '==', b.tsId).get());
    const ids = new Set(b.rows.map((r) => r.id));
    const now = firebase_1.Timestamp.now();
    const ops = [];
    ops.push((w) => w.set(hRef, {
        ...header, createdAt: cur.data()?.createdAt ?? now, createdBy: cur.data()?.createdBy ?? ctx.uid, updatedAt: now, updatedBy: ctx.uid,
        version: (cur.data()?.version ?? 0) + 1,
        revision: (cur.data()?.revision ?? 0) + 1,
    }, { merge: true }));
    for (const r of b.rows) {
        const { id, ...rest } = r;
        ops.push((w) => w.set(ctx.doc(`timesheetDays/${id}`), { ...rest, locked, updatedAt: now, updatedBy: ctx.uid }));
    }
    for (const o of old)
        if (!ids.has(o.id))
            ops.push((w) => w.delete(ctx.doc(`timesheetDays/${o.id}`))); // dữ liệu tính nháp (suy ra), không phải chứng từ
    await (0, common_1.commitOps)(ops);
}
const build = async (ctx, p) => {
    const { id: campusId, campus } = await (0, common_1.resolveCampus)(ctx, p, 'timekeeping.approve');
    const periodKey = (0, common_1.needPeriod)(p?.periodKey);
    const tsId = `${campusId}_${periodKey}`;
    const cur = await ctx.doc(`timesheets/${tsId}`).get();
    if (cur.exists && cur.data()?.status === 'locked')
        (0, errors_1.fail)('INVALID_STATE', 'Bảng công kỳ này đã khóa. Mở lại kỳ có kiểm soát hoặc dùng kỳ điều chỉnh.', { reason: 'PERIOD_LOCKED' });
    const b = await computeTimesheet(ctx, campusId, campus, periodKey, Array.isArray(p?.employeeIds) ? p.employeeIds : undefined);
    const status = cur.exists && cur.data()?.status === 'reopened' ? 'reopened' : 'draft';
    const header = headerOf(b, ctx, status);
    await persist(ctx, b, header, false);
    // Báo nhân viên khi bảng công cá nhân thay đổi.
    const before = new Map((cur.data()?.employees ?? []).map((e) => [e.employeeId, e.paidDaysTotal * 100000 + e.totals.workedMinutes]));
    let n = 0;
    for (const e of b.employees) {
        if (cur.exists && before.has(e.employeeId) && before.get(e.employeeId) !== e.paidDaysTotal * 100000 + e.totals.workedMinutes && n++ < 100) {
            await (0, hr_common_1.notifyEmployee)(ctx, e.employeeId, campusId, 'Bảng công thay đổi', `Bảng công ${periodKey} của bạn vừa được cập nhật.`, { c: 'timesheets', id: tsId });
        }
    }
    await ctx.audit({ action: 'timesheet.build', collection: 'timesheets', docId: tsId, campusId, after: { employees: b.employees.length, errors: header.errorCount } });
    return {
        timesheetId: tsId, status, employeeCount: b.employees.length, rowCount: b.rows.length, errorCount: header.errorCount, warningCount: header.warningCount,
        employees: b.employees, errors: b.errors.slice(0, 300),
    };
};
const lock = async (ctx, p) => {
    const { id: campusId, campus } = await (0, common_1.resolveCampus)(ctx, p, 'timekeeping.lock');
    const periodKey = (0, common_1.needPeriod)(p?.periodKey);
    const tsId = `${campusId}_${periodKey}`;
    const cur = await ctx.doc(`timesheets/${tsId}`).get();
    if (cur.exists && cur.data()?.status === 'locked')
        (0, errors_1.fail)('INVALID_STATE', 'Bảng công kỳ này đã được khóa.');
    const { to } = (0, time_1.periodRange)(periodKey);
    if (to >= (0, store_1.dayKeyOf)(ctx.now, (0, common_1.tzOf)(campus)))
        (0, errors_1.fail)('PRECONDITION', 'Kỳ công chưa kết thúc; chỉ khóa sau ngày cuối kỳ.', { reason: 'PERIOD_NOT_ENDED' });
    const b = await computeTimesheet(ctx, campusId, campus, periodKey); // tính lại từ dữ liệu hiện hành
    const blocking = b.errors.filter((e) => e.blocking);
    if (blocking.length)
        (0, errors_1.fail)('PRECONDITION', `Còn ${blocking.length} lỗi công chưa xử lý (thiếu lượt chấm, đề nghị chờ duyệt...). Xử lý trước khi khóa kỳ.`, { reason: 'UNRESOLVED_ERRORS', errors: blocking.slice(0, 200) });
    const lockVersion = (cur.data()?.lockVersion ?? 0) + 1;
    const header = headerOf(b, ctx, 'locked', { lockedAt: firebase_1.Timestamp.now(), lockedBy: ctx.uid, lockVersion, reportsStale: false });
    await persist(ctx, b, header, true);
    // Bản chụp: ca, lượt chấm, phép, điều chỉnh đã dùng. Đổi cấu hình ca sau đó không làm đổi kỳ đã khóa.
    await (0, common_1.commitOps)([...b.snapshots.entries()].map(([empId, snap]) => (w) => w.set(ctx.doc(`timesheets/${tsId}/snapshots/${empId}_v${lockVersion}`), { ...snap, lockVersion, lockedAt: firebase_1.Timestamp.now(), lockedBy: ctx.uid })));
    await ctx.audit({ action: 'timesheet.lock', collection: 'timesheets', docId: tsId, campusId, after: { lockVersion, employees: b.employees.length } });
    return { timesheetId: tsId, status: 'locked', lockVersion, employeeCount: b.employees.length, rowCount: b.rows.length, warnings: b.errors.filter((e) => !e.blocking).slice(0, 100) };
};
async function payrollBlocksReopen(ctx, campusId, periodKey) {
    const s = await ctx.doc(`payrollRuns/pr_${campusId}_${periodKey}`).get();
    const st = s.data()?.status;
    return s.exists && ['approved', 'published', 'paid'].includes(st) ? st : null;
}
async function applyReopen(ctx, tsId, reason, note) {
    const ts0 = await ctx.doc(`timesheets/${tsId}`).get();
    if (!ts0.exists)
        (0, errors_1.fail)('NOT_FOUND', 'Bảng công không tồn tại.');
    const t = ts0.data();
    ctx.require('timekeeping.reopen', t.campusId);
    if (t.status !== 'locked')
        (0, errors_1.fail)('INVALID_STATE', 'Kỳ công không ở trạng thái đã khóa.');
    const blocked = await payrollBlocksReopen(ctx, t.campusId, t.periodKey);
    if (blocked)
        (0, errors_1.fail)('PRECONDITION', `Bảng lương kỳ này đã ở trạng thái "${blocked}"; không mở lại kỳ công. Hãy chuyển chênh lệch sang kỳ điều chỉnh.`, { reason: 'PAYROLL_LOCKED' });
    const rows = (0, common_1.asDocs)(await ctx.col('timesheetDays').where('timesheetId', '==', tsId).get());
    const entry = { at: firebase_1.Timestamp.now(), by: ctx.uid, reason, note: note ?? null, lockVersion: t.lockVersion ?? 1 };
    await (0, store_1.updateDoc)(ctx, ctx.doc(`timesheets/${tsId}`), {
        status: 'reopened', reopenedAt: firebase_1.Timestamp.now(), reopenedBy: ctx.uid, reopenReason: reason, reportsStale: true,
        reopenHistory: [...(t.reopenHistory ?? []), entry],
    });
    await (0, common_1.commitOps)(rows.map((r) => (w) => w.update(ctx.doc(`timesheetDays/${r.id}`), { locked: false })));
    await ctx.audit({ action: 'timesheet.reopen', collection: 'timesheets', docId: tsId, campusId: t.campusId, reason });
    return { timesheetId: tsId, status: 'reopened' };
}
(0, approvals_1.registerApprovalHandler)('timesheet_reopen', {
    perm: 'timekeeping.reopen',
    onApprove: async (ctx, a, note) => applyReopen(ctx, a.refId, String(a.payload?.reason ?? ''), note),
});
const reopen = async (ctx, p) => {
    const { id: campusId } = await (0, common_1.resolveCampus)(ctx, p, 'timekeeping.lock');
    const periodKey = (0, common_1.needPeriod)(p?.periodKey);
    const reason = (0, common_1.needStr)(p?.reason, 'reason', 500);
    if (reason.length < 10)
        (0, errors_1.invalid)({ reason: 'Nêu rõ lý do mở lại kỳ (tối thiểu 10 ký tự).' });
    const tsId = `${campusId}_${periodKey}`;
    const cur = await ctx.doc(`timesheets/${tsId}`).get();
    if (!cur.exists || cur.data()?.status !== 'locked')
        (0, errors_1.fail)('INVALID_STATE', 'Chỉ mở lại được kỳ công đang ở trạng thái đã khóa.');
    if (p?.mode === 'carry_forward') {
        // Đưa chênh lệch sang KỲ ĐIỀU CHỈNH tiếp theo (kỳ đã khóa không đổi).
        const items = Array.isArray(p?.carry) ? p.carry : [];
        if (!items.length)
            (0, errors_1.invalid)({ carry: 'Nhập danh sách chênh lệch cần chuyển kỳ.' });
        const toKey = (0, time_1.nextPeriodKey)(periodKey);
        const ids = [];
        for (const it of items) {
            if (typeof it?.employeeId !== 'string' || typeof it?.deltaPaidDays !== 'number' || !Number.isFinite(it.deltaPaidDays))
                (0, errors_1.invalid)({ carry: 'Mỗi dòng cần employeeId và deltaPaidDays (số).' });
            const e = await ctx.doc(`employees/${it.employeeId}`).get();
            if (!e.exists)
                (0, errors_1.invalid)({ carry: `Nhân viên ${it.employeeId} không tồn tại.` });
            ids.push(await (0, store_1.createDoc)(ctx, 'timesheetAdjustments', undefined, {
                campusId, fromPeriodKey: periodKey, toPeriodKey: toKey, employeeId: it.employeeId, deltaPaidDays: Math.round(it.deltaPaidDays * 100) / 100,
                reason: String(it.note ?? reason).slice(0, 500), status: 'approved', approvedBy: ctx.uid,
            }));
        }
        await ctx.audit({ action: 'timesheet.carryForward', collection: 'timesheetAdjustments', docId: ids.join(','), campusId, reason, after: { toPeriodKey: toKey, count: ids.length } });
        return { mode: 'carry_forward', toPeriodKey: toKey, adjustmentIds: ids };
    }
    const blocked = await payrollBlocksReopen(ctx, campusId, periodKey);
    if (blocked)
        (0, errors_1.fail)('PRECONDITION', `Bảng lương kỳ này đã ở trạng thái "${blocked}"; không mở lại kỳ công. Dùng mode "carry_forward" để chuyển chênh lệch sang kỳ sau.`, { reason: 'PAYROLL_LOCKED' });
    const approvalId = await (0, approvals_1.createApproval)(ctx, {
        type: 'timesheet_reopen', campusId, refCollection: 'timesheets', refId: tsId, payload: { reason },
        summary: `Mở lại bảng công ${periodKey}`, impact: { periodKey, reason, effect: 'Bảng công về trạng thái mở; báo cáo kỳ trước được đánh dấu đã thay đổi.' },
    });
    await ctx.audit({ action: 'timesheet.reopen.request', collection: 'timesheets', docId: tsId, campusId, reason });
    return { mode: 'reopen', approvalId, status: 'pending' };
};
exports.actions = {
    'timesheet.build': { scope: 'org', perm: 'timekeeping.approve', handler: build },
    'timesheet.lock': { scope: 'org', perm: 'timekeeping.lock', handler: lock },
    'timesheet.reopen': { scope: 'org', perm: 'timekeeping.lock', handler: reopen },
};
void store_1.getCampus;
void common_1.syncApproval;
