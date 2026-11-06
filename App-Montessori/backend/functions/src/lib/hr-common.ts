// Helper nhân sự dùng chung giữa hr.ts và hr-timesheet.ts.
import { fail } from '../core/errors';
import type { Ctx } from '../core/types';
import { asDocs, Doc, getInCampus } from './common';
import { dayIndex, timeToMin, weekday, listDays } from './time';
import type { ShiftInst } from './calc-time';
import { sendSystemNotification } from './notify';

export const effectiveRange = (day: string, from?: string | null, to?: string | null): boolean => (!from || from <= day) && (!to || day <= to);

export async function getEmployee(ctx: Ctx, id: unknown): Promise<Doc> {
  return getInCampus(ctx, 'employees', id, null, 'Nhân viên');
}

/** Nhân viên được phân công tại cơ sở vào ngày `day`? (đợt phân công hiệu lực, hoặc cơ sở chính khi chưa có phân công). */
export async function assignedAt(ctx: Ctx, emp: Doc, campusId: string, day: string): Promise<boolean> {
  const as = asDocs(await ctx.col('staffAssignments').where('employeeId', '==', emp.id).get());
  const active = as.filter((a) => a.status !== 'cancelled');
  if (active.some((a) => a.campusId === campusId && effectiveRange(day, a.fromDay, a.toDay))) return true;
  if (active.length === 0 && emp.campusId === campusId) return true;
  return false;
}

export async function isPeriodLocked(ctx: Ctx, campusId: string, day: string): Promise<boolean> {
  const s = await ctx.doc(`timesheets/${campusId}_${day.slice(0, 7)}`).get();
  return s.exists && s.data()?.status === 'locked';
}

export interface ShiftSnapshot {
  code?: string; name?: string; startTime: string; endTime: string; breakMinutes: number;
  lateGraceMinutes: number; earlyGraceMinutes: number; roundTo: number; workUnit: number; unitPolicy: 'full' | 'proportional'; overnight: boolean;
}

export function snapshotOfShift(s: Doc): ShiftSnapshot {
  const start = timeToMin(s.startTime); const end = timeToMin(s.endTime);
  return {
    code: s.code, name: s.name, startTime: s.startTime, endTime: s.endTime,
    breakMinutes: s.breakMinutes ?? 0, lateGraceMinutes: s.lateGraceMinutes ?? 0, earlyGraceMinutes: s.earlyGraceMinutes ?? 0,
    roundTo: s.roundTo ?? 1, workUnit: typeof s.workUnit === 'number' ? s.workUnit : 1,
    unitPolicy: s.unitPolicy === 'proportional' ? 'proportional' : 'full', overnight: end <= start,
  };
}

/** Khoảng phút [start,end) của ca; ca qua đêm end += 1440. */
export function shiftWindow(snap: Pick<ShiftSnapshot, 'startTime' | 'endTime'>): { start: number; end: number } {
  const start = timeToMin(snap.startTime); let end = timeToMin(snap.endTime);
  if (end <= start) end += 1440;
  return { start, end };
}

export function entryToInst(e: Doc, leave: { type: string; paid: boolean } | null, holiday: boolean): ShiftInst {
  const sn = e.shiftSnapshot as ShiftSnapshot;
  const w = shiftWindow(sn);
  return {
    id: e.id, shiftId: e.shiftId, start: w.start, end: w.end, breakMin: sn.breakMinutes ?? 0,
    lateGrace: sn.lateGraceMinutes ?? 0, earlyGrace: sn.earlyGraceMinutes ?? 0, roundTo: sn.roundTo ?? 1,
    unit: sn.workUnit ?? 1, policy: sn.unitPolicy ?? 'full', leave, holiday,
  };
}

export interface Shortage { classId: string; className: string; dayKey: string; have: number; need: number }

/**
 * Thiếu giáo viên: với mỗi ngày CÓ lịch, mỗi lớp cần ≥ minTeachers GV được phân công và có ca (không nghỉ).
 * `entries` = các mục lịch (employeeId thực tế, dayKey) đã loại ca nghỉ phép nếu cần mô phỏng.
 */
export async function computeShortages(ctx: Ctx, campusId: string, entries: Array<{ employeeId: string; dayKey: string }>, campusDoc?: Doc): Promise<Shortage[]> {
  if (!entries.length) return [];
  const classes = asDocs(await ctx.col('classes').where('campusId', '==', campusId).get()).filter((c) => c.status !== 'archived' && !c.archived);
  if (!classes.length) return [];
  const assigns = asDocs(await ctx.col('staffAssignments').where('campusId', '==', campusId).get()).filter((a) => a.status !== 'cancelled' && a.classId);
  const byDay = new Map<string, Set<string>>();
  for (const e of entries) (byDay.get(e.dayKey) ?? byDay.set(e.dayKey, new Set()).get(e.dayKey)!).add(e.employeeId);
  const out: Shortage[] = [];
  const defNeed = (campusDoc?.minTeachersPerClass as number | undefined) ?? 1;
  for (const [day, emps] of byDay) {
    // chỉ xét ngày làm việc của cơ sở: có lịch của người trực thuộc lớp
    for (const c of classes) {
      const need = (c.minTeachers as number | undefined) ?? defNeed;
      if (need <= 0) continue;
      const teachers = new Set(assigns.filter((a) => a.classId === c.id && effectiveRange(day, a.fromDay, a.toDay) && emps.has(a.employeeId)).map((a) => a.employeeId));
      const anyAssigned = assigns.some((a) => a.classId === c.id && effectiveRange(day, a.fromDay, a.toDay));
      if (!anyAssigned) continue; // lớp chưa có phân công GV: không suy đoán
      if (teachers.size < need) out.push({ classId: c.id, className: c.name ?? c.id, dayKey: day, have: teachers.size, need });
    }
  }
  return out;
}

/** Số ngày làm việc trong khoảng nghỉ: theo lịch ca nếu có, không thì thứ 2–thứ 7. */
export async function countWorkDays(ctx: Ctx, employeeId: string, from: string, to: string): Promise<{ days: number; scheduledDays: string[] }> {
  const es = asDocs(await ctx.col('rosterEntries').where('employeeId', '==', employeeId).where('dayKey', '>=', from).where('dayKey', '<=', to).get())
    .filter((e) => e.status !== 'superseded');
  const sched = [...new Set(es.map((e) => e.dayKey as string))].sort();
  if (sched.length) return { days: sched.length, scheduledDays: sched };
  return { days: listDays(from, to).filter((d) => weekday(d) !== 0).length, scheduledDays: [] };
}

export async function notifyEmployee(ctx: Ctx, employeeId: string, campusId: string | null, title: string, body: string, ref?: { c: string; id: string }): Promise<void> {
  try {
    const s = await ctx.doc(`employees/${employeeId}`).get();
    const uid = s.data()?.uid as string | undefined;
    if (!uid) return;
    await sendSystemNotification(ctx, { campusId, title, body, category: 'hr', uids: [uid], refCollection: ref?.c, refId: ref?.id });
  } catch (e) { console.warn('notifyEmployee', (e as Error).message); }
}

export function assertPast(ctx: Ctx, day: string, today: string, what: string): void {
  if (day < today) fail('PRECONDITION', `Không được sửa ${what} của ngày đã qua (${day}); hãy dùng yêu cầu điều chỉnh.`, { reason: 'PAST_DAY' });
}

export const dayIdx = dayIndex;
