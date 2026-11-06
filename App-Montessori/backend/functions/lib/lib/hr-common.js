"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dayIdx = exports.effectiveRange = void 0;
exports.getEmployee = getEmployee;
exports.assignedAt = assignedAt;
exports.isPeriodLocked = isPeriodLocked;
exports.snapshotOfShift = snapshotOfShift;
exports.shiftWindow = shiftWindow;
exports.entryToInst = entryToInst;
exports.computeShortages = computeShortages;
exports.countWorkDays = countWorkDays;
exports.notifyEmployee = notifyEmployee;
exports.assertPast = assertPast;
// Helper nhân sự dùng chung giữa hr.ts và hr-timesheet.ts.
const errors_1 = require("../core/errors");
const common_1 = require("./common");
const time_1 = require("./time");
const notify_1 = require("./notify");
const effectiveRange = (day, from, to) => (!from || from <= day) && (!to || day <= to);
exports.effectiveRange = effectiveRange;
async function getEmployee(ctx, id) {
    return (0, common_1.getInCampus)(ctx, 'employees', id, null, 'Nhân viên');
}
/** Nhân viên được phân công tại cơ sở vào ngày `day`? (đợt phân công hiệu lực, hoặc cơ sở chính khi chưa có phân công). */
async function assignedAt(ctx, emp, campusId, day) {
    const as = (0, common_1.asDocs)(await ctx.col('staffAssignments').where('employeeId', '==', emp.id).get());
    const active = as.filter((a) => a.status !== 'cancelled');
    if (active.some((a) => a.campusId === campusId && (0, exports.effectiveRange)(day, a.fromDay, a.toDay)))
        return true;
    if (active.length === 0 && emp.campusId === campusId)
        return true;
    return false;
}
async function isPeriodLocked(ctx, campusId, day) {
    const s = await ctx.doc(`timesheets/${campusId}_${day.slice(0, 7)}`).get();
    return s.exists && s.data()?.status === 'locked';
}
function snapshotOfShift(s) {
    const start = (0, time_1.timeToMin)(s.startTime);
    const end = (0, time_1.timeToMin)(s.endTime);
    return {
        code: s.code, name: s.name, startTime: s.startTime, endTime: s.endTime,
        breakMinutes: s.breakMinutes ?? 0, lateGraceMinutes: s.lateGraceMinutes ?? 0, earlyGraceMinutes: s.earlyGraceMinutes ?? 0,
        roundTo: s.roundTo ?? 1, workUnit: typeof s.workUnit === 'number' ? s.workUnit : 1,
        unitPolicy: s.unitPolicy === 'proportional' ? 'proportional' : 'full', overnight: end <= start,
    };
}
/** Khoảng phút [start,end) của ca; ca qua đêm end += 1440. */
function shiftWindow(snap) {
    const start = (0, time_1.timeToMin)(snap.startTime);
    let end = (0, time_1.timeToMin)(snap.endTime);
    if (end <= start)
        end += 1440;
    return { start, end };
}
function entryToInst(e, leave, holiday) {
    const sn = e.shiftSnapshot;
    const w = shiftWindow(sn);
    return {
        id: e.id, shiftId: e.shiftId, start: w.start, end: w.end, breakMin: sn.breakMinutes ?? 0,
        lateGrace: sn.lateGraceMinutes ?? 0, earlyGrace: sn.earlyGraceMinutes ?? 0, roundTo: sn.roundTo ?? 1,
        unit: sn.workUnit ?? 1, policy: sn.unitPolicy ?? 'full', leave, holiday,
    };
}
/**
 * Thiếu giáo viên: với mỗi ngày CÓ lịch, mỗi lớp cần ≥ minTeachers GV được phân công và có ca (không nghỉ).
 * `entries` = các mục lịch (employeeId thực tế, dayKey) đã loại ca nghỉ phép nếu cần mô phỏng.
 */
async function computeShortages(ctx, campusId, entries, campusDoc) {
    if (!entries.length)
        return [];
    const classes = (0, common_1.asDocs)(await ctx.col('classes').where('campusId', '==', campusId).get()).filter((c) => c.status !== 'archived' && !c.archived);
    if (!classes.length)
        return [];
    const assigns = (0, common_1.asDocs)(await ctx.col('staffAssignments').where('campusId', '==', campusId).get()).filter((a) => a.status !== 'cancelled' && a.classId);
    const byDay = new Map();
    for (const e of entries)
        (byDay.get(e.dayKey) ?? byDay.set(e.dayKey, new Set()).get(e.dayKey)).add(e.employeeId);
    const out = [];
    const defNeed = campusDoc?.minTeachersPerClass ?? 1;
    for (const [day, emps] of byDay) {
        // chỉ xét ngày làm việc của cơ sở: có lịch của người trực thuộc lớp
        for (const c of classes) {
            const need = c.minTeachers ?? defNeed;
            if (need <= 0)
                continue;
            const teachers = new Set(assigns.filter((a) => a.classId === c.id && (0, exports.effectiveRange)(day, a.fromDay, a.toDay) && emps.has(a.employeeId)).map((a) => a.employeeId));
            const anyAssigned = assigns.some((a) => a.classId === c.id && (0, exports.effectiveRange)(day, a.fromDay, a.toDay));
            if (!anyAssigned)
                continue; // lớp chưa có phân công GV: không suy đoán
            if (teachers.size < need)
                out.push({ classId: c.id, className: c.name ?? c.id, dayKey: day, have: teachers.size, need });
        }
    }
    return out;
}
/** Số ngày làm việc trong khoảng nghỉ: theo lịch ca nếu có, không thì thứ 2–thứ 7. */
async function countWorkDays(ctx, employeeId, from, to) {
    const es = (0, common_1.asDocs)(await ctx.col('rosterEntries').where('employeeId', '==', employeeId).where('dayKey', '>=', from).where('dayKey', '<=', to).get())
        .filter((e) => e.status !== 'superseded');
    const sched = [...new Set(es.map((e) => e.dayKey))].sort();
    if (sched.length)
        return { days: sched.length, scheduledDays: sched };
    return { days: (0, time_1.listDays)(from, to).filter((d) => (0, time_1.weekday)(d) !== 0).length, scheduledDays: [] };
}
async function notifyEmployee(ctx, employeeId, campusId, title, body, ref) {
    try {
        const s = await ctx.doc(`employees/${employeeId}`).get();
        const uid = s.data()?.uid;
        if (!uid)
            return;
        await (0, notify_1.sendSystemNotification)(ctx, { campusId, title, body, category: 'hr', uids: [uid], refCollection: ref?.c, refId: ref?.id });
    }
    catch (e) {
        console.warn('notifyEmployee', e.message);
    }
}
function assertPast(ctx, day, today, what) {
    if (day < today)
        (0, errors_1.fail)('PRECONDITION', `Không được sửa ${what} của ngày đã qua (${day}); hãy dùng yêu cầu điều chỉnh.`, { reason: 'PAST_DAY' });
}
exports.dayIdx = time_1.dayIndex;
