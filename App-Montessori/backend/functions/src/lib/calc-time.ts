// Tính công THUẦN (không Firebase). Mọi mốc thời gian là SỐ PHÚT tính từ 00:00 ngày bắt đầu ca
// (ca qua đêm: end > 1440, thuộc ngày bắt đầu). Xem docs/BUSINESS.txt mục 7.

export interface ShiftInst {
  id: string;            // id mục lịch (rosterEntry)
  shiftId: string;
  start: number;         // phút
  end: number;           // phút, luôn > start (qua đêm đã cộng 1440)
  breakMin: number;      // nghỉ giữa ca (phút)
  lateGrace: number;     // dung sai muộn (phút)
  earlyGrace: number;    // dung sai về sớm (phút)
  roundTo?: number;      // làm tròn xuống thời gian làm (phút), mặc định 1
  unit: number;          // số công của ca (mặc định 1)
  policy: 'full' | 'proportional'; // quy đổi công: đủ lượt = đủ công | theo tỷ lệ giờ
  leave?: { type: string; paid: boolean } | null; // nghỉ phép được duyệt
  holiday?: boolean;     // ngày nghỉ lễ (ca có lịch)
}

export interface PunchMin { kind: 'in' | 'out'; min: number; id?: string; adjusted?: boolean }

export type DayStatus = 'ok' | 'incomplete' | 'absent' | 'leave' | 'holiday' | 'scheduled' | 'off';

export interface ShiftResult {
  entryId: string; shiftId: string; status: DayStatus;
  scheduledMinutes: number; workedMinutes: number; lateMinutes: number; earlyLeaveMinutes: number;
  paidUnits: number; inMin: number | null; outMin: number | null; extraMinutes: number; issue?: string;
}

export interface DayResult {
  status: DayStatus;
  scheduledMinutes: number; workedMinutes: number; lateMinutes: number; earlyLeaveMinutes: number;
  paidUnits: number; overtimeMinutes: number; issues: string[]; shifts: ShiftResult[];
}

type Iv = [number, number];

/** Trừ các khoảng đã tính (covered) khỏi [a,b]; trả tổng phút còn lại. */
export function uncoveredMinutes(a: number, b: number, covered: Iv[]): number {
  if (b <= a) return 0;
  let free: Iv[] = [[a, b]];
  for (const [c1, c2] of covered) {
    const next: Iv[] = [];
    for (const [f1, f2] of free) {
      if (c2 <= f1 || c1 >= f2) { next.push([f1, f2]); continue; }
      if (c1 > f1) next.push([f1, c1]);
      if (c2 < f2) next.push([c2, f2]);
    }
    free = next;
  }
  return free.reduce((s, [x, y]) => s + (y - x), 0);
}

const round2 = (n: number) => Math.round(n * 100) / 100; // số công (không phải tiền)

export interface DayOpts {
  /** Ngày/ca đã kết thúc (thiếu lượt mới coi là lỗi). false = ca tương lai/đang diễn ra. */
  finished: boolean;
  /** Tăng ca đã được DUYỆT trong ngày (phút). Ở lại quá giờ không tự thành tăng ca. */
  approvedOvertimeMinutes?: number;
}

/** Tính công một ngày cho một nhân viên. */
export function calcDay(shiftsIn: ShiftInst[], punches: PunchMin[], opts: DayOpts): DayResult {
  const shifts = [...shiftsIn].sort((a, b) => a.start - b.start || a.end - b.end);
  const covered: Iv[] = [];
  const results: ShiftResult[] = [];
  const issues: string[] = [];
  const ins = punches.filter((p) => p.kind === 'in').sort((a, b) => a.min - b.min);
  const outs = punches.filter((p) => p.kind === 'out').sort((a, b) => a.min - b.min);

  for (const s of shifts) {
    const scheduled = Math.max(0, s.end - s.start - s.breakMin);
    const base: ShiftResult = {
      entryId: s.id, shiftId: s.shiftId, status: 'ok', scheduledMinutes: scheduled, workedMinutes: 0,
      lateMinutes: 0, earlyLeaveMinutes: 0, paidUnits: 0, inMin: null, outMin: null, extraMinutes: 0,
    };
    if (s.leave) {
      results.push({ ...base, status: 'leave', paidUnits: s.leave.paid ? s.unit : 0 });
      continue;
    }
    if (s.holiday) {
      results.push({ ...base, status: 'holiday', paidUnits: s.unit });
      continue;
    }
    const lo = s.start - 240; const hi = s.end + 300;
    const inP = ins.find((p) => p.min >= lo && p.min <= hi);
    const outP = [...outs].reverse().find((p) => p.min >= lo && p.min <= hi && (!inP || p.min > inP.min));
    if (!inP && !outP) {
      if (!opts.finished) { results.push({ ...base, status: 'scheduled' }); continue; }
      results.push({ ...base, status: 'absent', issue: 'Không có lượt chấm nào trong ca.' });
      issues.push(`Ca ${s.shiftId}: vắng (không có lượt chấm).`);
      continue;
    }
    if (!inP || !outP) {
      if (!opts.finished && inP && !outP) { results.push({ ...base, status: 'scheduled', inMin: inP.min }); continue; }
      const msg = !inP ? 'Thiếu lượt vào.' : 'Thiếu lượt ra.';
      // THIẾU LƯỢT: công chưa đủ dữ liệu, KHÔNG tự tính đủ công.
      results.push({ ...base, status: 'incomplete', inMin: inP?.min ?? null, outMin: outP?.min ?? null, issue: msg });
      issues.push(`Ca ${s.shiftId}: ${msg}`);
      continue;
    }
    const effStart = Math.max(inP.min, s.start);
    const effEnd = Math.min(outP.min, s.end);
    const span = uncoveredMinutes(effStart, effEnd, covered); // chồng lấn giữa hai ca không tính hai lần
    if (effEnd > effStart) covered.push([effStart, effEnd]);
    // Nghỉ giữa ca: trừ toàn bộ thời gian nghỉ cấu hình (tối đa bằng thời gian có mặt).
    let worked = Math.max(0, span - Math.min(s.breakMin, span));
    const rt = s.roundTo && s.roundTo > 1 ? s.roundTo : 1;
    if (rt > 1) worked = Math.floor(worked / rt) * rt;
    const late = Math.max(0, inP.min - s.start);
    const early = Math.max(0, s.end - outP.min);
    const lateMinutes = late > s.lateGrace ? late : 0;
    const earlyLeaveMinutes = early > s.earlyGrace ? early : 0;
    const extra = Math.max(0, s.start - inP.min) + Math.max(0, outP.min - s.end);
    const units = s.policy === 'proportional'
      ? (scheduled > 0 ? round2(s.unit * Math.min(1, worked / scheduled)) : 0)
      : (worked > 0 ? s.unit : 0);
    results.push({
      ...base, status: 'ok', workedMinutes: worked, lateMinutes, earlyLeaveMinutes, paidUnits: units,
      inMin: inP.min, outMin: outP.min, extraMinutes: extra,
    });
  }

  let overtime = 0;
  const approved = Math.max(0, opts.approvedOvertimeMinutes ?? 0);
  if (approved > 0) {
    if (shifts.length) {
      overtime = Math.min(approved, results.reduce((s, r) => s + r.extraMinutes, 0));
    } else {
      // ngày không có ca: tính theo các cặp vào-ra thực tế
      let w = 0;
      for (const i of ins) { const o = outs.find((x) => x.min > i.min); if (o) w += o.min - i.min; }
      overtime = Math.min(approved, w);
    }
  }

  const sum = (f: (r: ShiftResult) => number) => results.reduce((s, r) => s + f(r), 0);
  let status: DayStatus;
  if (!results.length) status = 'off';
  else if (results.some((r) => r.status === 'incomplete')) status = 'incomplete';
  else if (results.some((r) => r.status === 'absent')) status = 'absent';
  else if (results.every((r) => r.status === 'leave')) status = 'leave';
  else if (results.every((r) => r.status === 'holiday')) status = 'holiday';
  else if (results.some((r) => r.status === 'scheduled')) status = 'scheduled';
  else status = 'ok';

  return {
    status,
    scheduledMinutes: sum((r) => r.scheduledMinutes),
    workedMinutes: sum((r) => r.workedMinutes),
    lateMinutes: sum((r) => r.lateMinutes),
    earlyLeaveMinutes: sum((r) => r.earlyLeaveMinutes),
    paidUnits: round2(sum((r) => r.paidUnits)),
    overtimeMinutes: overtime,
    issues,
    shifts: results,
  };
}

export interface EmployeeTotals {
  workDays: number; paidDays: number; workedMinutes: number; lateMinutes: number; lateCount: number;
  earlyLeaveMinutes: number; overtimeMinutes: number; incompleteDays: number; absentDays: number;
  leaveDays: number; unpaidLeaveDays: number;
}

export function totalsOf(days: DayResult[]): EmployeeTotals {
  const t: EmployeeTotals = {
    workDays: 0, paidDays: 0, workedMinutes: 0, lateMinutes: 0, lateCount: 0, earlyLeaveMinutes: 0,
    overtimeMinutes: 0, incompleteDays: 0, absentDays: 0, leaveDays: 0, unpaidLeaveDays: 0,
  };
  for (const d of days) {
    if (d.status === 'ok') t.workDays++;
    if (d.status === 'incomplete') t.incompleteDays++;
    if (d.status === 'absent') t.absentDays++;
    if (d.status === 'leave') { t.leaveDays++; if (d.paidUnits === 0) t.unpaidLeaveDays++; }
    t.paidDays += d.paidUnits;
    t.workedMinutes += d.workedMinutes;
    t.lateMinutes += d.lateMinutes;
    if (d.lateMinutes > 0) t.lateCount++;
    t.earlyLeaveMinutes += d.earlyLeaveMinutes;
    t.overtimeMinutes += d.overtimeMinutes;
  }
  t.paidDays = round2(t.paidDays);
  return t;
}

/** Hai ca (day = chỉ số ngày, phút từ 00:00 của ngày đó) có chồng thời gian không. */
export function shiftsOverlap(a: { day: number; start: number; end: number }, b: { day: number; start: number; end: number }): boolean {
  const a1 = a.day * 1440 + a.start; const a2 = a.day * 1440 + a.end;
  const b1 = b.day * 1440 + b.start; const b2 = b.day * 1440 + b.end;
  return a1 < b2 && b1 < a2;
}
