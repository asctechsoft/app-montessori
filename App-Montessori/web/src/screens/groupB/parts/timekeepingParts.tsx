'use client';
// Dùng chung cho W24/W25: kỳ công, bảng công (timesheets + timesheetDays), lượt chấm gốc (punches), điều chỉnh liên kết.
import { useMemo } from 'react';
import type { DocumentData } from 'firebase/firestore';
import { Select } from '@/components/ui/Fields';
import { toDate } from '@/lib/format';
import { currentPeriod, periodOptions } from './dates';
import { num, text, useCampusCtx, useCampusDocs, useOrgDoc } from './kit';

export function PeriodSelect({ value, onChange, label = 'Kỳ công' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const c = useCampusCtx();
  const options = useMemo(() => periodOptions(c.tz), [c.tz]);
  return <Select aria-label={label} value={value} onValueChange={onChange} options={options} style={{ minWidth: 180 }} />;
}

export const useDefaultPeriod = () => currentPeriod(useCampusCtx().tz);

export interface Totals {
  workDays: number; paidDays: number; workedMinutes: number; lateMinutes: number; lateCount: number;
  earlyLeaveMinutes: number; overtimeMinutes: number; incompleteDays: number; absentDays: number; leaveDays: number; unpaidLeaveDays: number;
}
export interface TsEmployee { employeeId: string; name: string; code: string; totals: Totals; carriedPaidDays: number; paidDaysTotal: number; issues: number }
export interface TsError { employeeId: string; name: string; dayKey: string; type: string; message: string; blocking: boolean }
export interface TsHeader {
  id: string; status: string; fromDay: string; toDay: string; employees: TsEmployee[]; errors: TsError[];
  errorCount: number; warningCount: number; incompleteDays: number; builtAt: unknown; lockedAt: unknown; lockVersion: number;
  reopenHistory: Array<{ at: unknown; reason: string; note: string; lockVersion: number }>; reportsStale: boolean;
}

const totalsOf = (t: DocumentData | undefined): Totals => ({
  workDays: num(t?.workDays), paidDays: num(t?.paidDays), workedMinutes: num(t?.workedMinutes), lateMinutes: num(t?.lateMinutes), lateCount: num(t?.lateCount),
  earlyLeaveMinutes: num(t?.earlyLeaveMinutes), overtimeMinutes: num(t?.overtimeMinutes), incompleteDays: num(t?.incompleteDays), absentDays: num(t?.absentDays),
  leaveDays: num(t?.leaveDays), unpaidLeaveDays: num(t?.unpaidLeaveDays),
});

export function toHeader(id: string, d: DocumentData): TsHeader {
  const arr = (v: unknown): DocumentData[] => (Array.isArray(v) ? (v as DocumentData[]) : []);
  return {
    id, status: text(d.status, 'draft'), fromDay: text(d.fromDay), toDay: text(d.toDay),
    employees: arr(d.employees).map((e) => ({
      employeeId: text(e.employeeId), name: text(e.name), code: text(e.code), totals: totalsOf(e.totals),
      carriedPaidDays: num(e.carriedPaidDays), paidDaysTotal: num(e.paidDaysTotal), issues: num(e.issues),
    })),
    errors: arr(d.errors).map((e) => ({ employeeId: text(e.employeeId), name: text(e.name), dayKey: text(e.dayKey), type: text(e.type), message: text(e.message), blocking: e.blocking === true })),
    errorCount: num(d.errorCount), warningCount: num(d.warningCount), incompleteDays: num(d.incompleteDays), builtAt: d.builtAt, lockedAt: d.lockedAt, lockVersion: num(d.lockVersion),
    reopenHistory: arr(d.reopenHistory).map((h) => ({ at: h.at, reason: text(h.reason), note: text(h.note), lockVersion: num(h.lockVersion) })),
    reportsStale: d.reportsStale === true,
  };
}

/** Header bảng công của kỳ (timesheets/{campusId}_{periodKey}). `empty` = chưa tính bảng công. */
export function useTimesheet(periodKey: string) {
  const c = useCampusCtx();
  return useOrgDoc<TsHeader>(c.campusId ? ['timesheets', `${c.campusId}_${periodKey}`] : null, toHeader);
}

export interface ShiftDay {
  entryId: string; shiftId: string; status: string; scheduledMinutes: number; workedMinutes: number; lateMinutes: number;
  earlyLeaveMinutes: number; paidUnits: number; inMin: number | null; outMin: number | null; issue: string;
}
export interface TsDay {
  id: string; employeeId: string; dayKey: string; status: string; scheduledMinutes: number; workedMinutes: number; lateMinutes: number;
  earlyLeaveMinutes: number; paidUnits: number; overtimeMinutes: number; approvedOvertimeMinutes: number; issues: string[]; shifts: ShiftDay[];
}
export const toTsDay = (id: string, d: DocumentData): TsDay => ({
  id, employeeId: text(d.employeeId), dayKey: text(d.dayKey), status: text(d.status, 'off'), scheduledMinutes: num(d.scheduledMinutes), workedMinutes: num(d.workedMinutes),
  lateMinutes: num(d.lateMinutes), earlyLeaveMinutes: num(d.earlyLeaveMinutes), paidUnits: num(d.paidUnits), overtimeMinutes: num(d.overtimeMinutes),
  approvedOvertimeMinutes: num(d.approvedOvertimeMinutes), issues: Array.isArray(d.issues) ? (d.issues as string[]) : [],
  shifts: (Array.isArray(d.shifts) ? (d.shifts as DocumentData[]) : []).map((s) => ({
    entryId: text(s.entryId), shiftId: text(s.shiftId), status: text(s.status), scheduledMinutes: num(s.scheduledMinutes), workedMinutes: num(s.workedMinutes),
    lateMinutes: num(s.lateMinutes), earlyLeaveMinutes: num(s.earlyLeaveMinutes), paidUnits: num(s.paidUnits),
    inMin: typeof s.inMin === 'number' ? s.inMin : null, outMin: typeof s.outMin === 'number' ? s.outMin : null, issue: text(s.issue),
  })),
});

export function useTsDays(periodKey: string, enabled = true) {
  const c = useCampusCtx();
  return useCampusDocs<TsDay>('timesheetDays', toTsDay, { enabled, where: [['timesheetId', '==', `${c.campusId}_${periodKey}`]], tag: periodKey });
}

export interface PunchRow {
  id: string; employeeId: string; dayKey: string; kind: string; source: string; result: string; deviceTime: Date | null; serverTime: Date | null;
  effectiveTime: Date | null; distanceM: number | null; clockSkewMinutes: number | null; expectedShift: { start: string; end: string; dayKey: string } | null; note: string;
}
export const toPunch = (id: string, d: DocumentData): PunchRow => {
  const es = d.expectedShift as DocumentData | null | undefined;
  return {
    id, employeeId: text(d.employeeId), dayKey: text(d.dayKey), kind: text(d.kind), source: text(d.source, 'app'), result: text(d.result, 'ok'),
    deviceTime: toDate(d.deviceTime), serverTime: toDate(d.serverTime), effectiveTime: toDate(d.effectiveTime),
    distanceM: typeof d.distanceM === 'number' ? d.distanceM : null, clockSkewMinutes: typeof d.clockSkewMinutes === 'number' ? d.clockSkewMinutes : null,
    expectedShift: es ? { start: text(es.start), end: text(es.end), dayKey: text(es.dayKey) } : null, note: text(d.note),
  };
};

export function usePunches(from: string, to: string, tag: string) {
  return useCampusDocs<PunchRow>('punches', toPunch, { where: [['dayKey', '>=', from], ['dayKey', '<=', to]], tag });
}

export interface AdjustRow {
  id: string; employeeId: string; employeeName: string; dayKey: string; kind: string; requestedTime: Date | null; effectiveTime: Date | null;
  reason: string; evidencePaths: string[]; originalPunchIds: string[]; status: string; decisionNote: string; createdBy: string; version?: number;
}
export const toAdjust = (id: string, d: DocumentData): AdjustRow => ({
  id, employeeId: text(d.employeeId), employeeName: text(d.employeeName), dayKey: text(d.dayKey), kind: text(d.kind), requestedTime: toDate(d.requestedTime),
  effectiveTime: toDate(d.effectiveTime), reason: text(d.reason), evidencePaths: Array.isArray(d.evidencePaths) ? (d.evidencePaths as string[]) : [],
  originalPunchIds: Array.isArray(d.originalPunchIds) ? (d.originalPunchIds as string[]) : [], status: text(d.status), decisionNote: text(d.decisionNote),
  createdBy: text(d.createdBy), version: typeof d.version === 'number' ? d.version : undefined,
});
