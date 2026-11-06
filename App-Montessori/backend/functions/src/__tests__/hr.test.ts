// Test THUẦN: tính công, thời gian, lương.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcDay, ShiftInst, shiftsOverlap, totalsOf, uncoveredMinutes } from '../lib/calc-time';
import { computePayroll, overtimePay, prorateSalary } from '../lib/calc-pay';
import { dayIndex, minutesSinceDayStart, periodRange, prevPeriodKey, nextPeriodKey, zonedTimeToDate, localDayMinutes } from '../lib/time';

const shift = (o: Partial<ShiftInst> = {}): ShiftInst => ({
  id: 'e1', shiftId: 'HC', start: 7 * 60 + 30, end: 17 * 60, breakMin: 90, lateGrace: 0, earlyGrace: 0, unit: 1, policy: 'full', ...o,
});
const m = (h: number, mi = 0) => h * 60 + mi;

describe('Tính công theo ca (BUSINESS mục 7)', () => {
  it('ví dụ chuẩn: ca 07:30–17:00 nghỉ 90, có mặt 07:40–17:00 → 470 phút, muộn 10', () => {
    const r = calcDay([shift()], [{ kind: 'in', min: m(7, 40) }, { kind: 'out', min: m(17) }], { finished: true });
    assert.equal(r.status, 'ok');
    assert.equal(r.workedMinutes, 470);
    assert.equal(r.lateMinutes, 10);
    assert.equal(r.earlyLeaveMinutes, 0);
    assert.equal(r.paidUnits, 1);
  });
  it('dung sai: muộn trong ngưỡng không bị tính muộn', () => {
    const r = calcDay([shift({ lateGrace: 10 })], [{ kind: 'in', min: m(7, 40) }, { kind: 'out', min: m(17) }], { finished: true });
    assert.equal(r.lateMinutes, 0);
    const r2 = calcDay([shift({ lateGrace: 5 })], [{ kind: 'in', min: m(7, 40) }, { kind: 'out', min: m(17) }], { finished: true });
    assert.equal(r2.lateMinutes, 10);
  });
  it('về sớm', () => {
    const r = calcDay([shift()], [{ kind: 'in', min: m(7, 30) }, { kind: 'out', min: m(16, 30) }], { finished: true });
    assert.equal(r.earlyLeaveMinutes, 30);
    assert.equal(r.workedMinutes, 480 - 30);
  });
  it('THIẾU LƯỢT RA → incomplete, KHÔNG tự tính đủ công', () => {
    const r = calcDay([shift()], [{ kind: 'in', min: m(7, 30) }], { finished: true });
    assert.equal(r.status, 'incomplete');
    assert.equal(r.paidUnits, 0);
    assert.equal(r.workedMinutes, 0);
    assert.ok(r.issues.length > 0);
  });
  it('THIẾU LƯỢT VÀO → incomplete', () => {
    const r = calcDay([shift()], [{ kind: 'out', min: m(17) }], { finished: true });
    assert.equal(r.status, 'incomplete');
    assert.equal(r.paidUnits, 0);
  });
  it('chưa kết thúc ngày: chưa tính là lỗi (scheduled)', () => {
    assert.equal(calcDay([shift()], [], { finished: false }).status, 'scheduled');
    assert.equal(calcDay([shift()], [{ kind: 'in', min: m(7, 30) }], { finished: false }).status, 'scheduled');
  });
  it('không có lượt nào, ngày đã qua → vắng', () => {
    const r = calcDay([shift()], [], { finished: true });
    assert.equal(r.status, 'absent');
    assert.equal(r.paidUnits, 0);
  });
  it('ca qua đêm thuộc ngày bắt đầu (22:00–06:00, mốc >1440)', () => {
    const s = shift({ shiftId: 'DEM', start: m(22), end: m(30), breakMin: 0 });
    const r = calcDay([s], [{ kind: 'in', min: m(21, 55) }, { kind: 'out', min: m(30, 5) }], { finished: true });
    assert.equal(r.status, 'ok');
    assert.equal(r.workedMinutes, 480);
    // thời điểm ra 06:05 hôm sau quy về phút của NGÀY BẮT ĐẦU
    const out = new Date('2026-11-06T06:05:00+07:00');
    assert.equal(minutesSinceDayStart('2026-11-05', out), 1440 + 365);
  });
  it('chồng lấn hai ca không tính hai lần', () => {
    const a = shift({ id: 'a', shiftId: 'S', start: m(7), end: m(12), breakMin: 0 });
    const b = shift({ id: 'b', shiftId: 'C', start: m(11), end: m(16), breakMin: 0 });
    const r = calcDay([a, b], [{ kind: 'in', min: m(7) }, { kind: 'out', min: m(16) }], { finished: true });
    assert.equal(r.workedMinutes, 540); // 07–16, không phải 600
    assert.equal(uncoveredMinutes(0, 100, [[10, 20], [15, 40]]), 70);
  });
  it('quy đổi công theo tỷ lệ (policy=proportional)', () => {
    const r = calcDay([shift({ policy: 'proportional' })], [{ kind: 'in', min: m(7, 30) }, { kind: 'out', min: m(12, 30) }], { finished: true });
    assert.ok(r.paidUnits > 0 && r.paidUnits < 1);
  });
  it('làm tròn xuống theo roundTo', () => {
    const r = calcDay([shift({ roundTo: 15 })], [{ kind: 'in', min: m(7, 40) }, { kind: 'out', min: m(17) }], { finished: true });
    assert.equal(r.workedMinutes, 465);
  });
  it('nghỉ phép có lương = đủ công, không lương = 0', () => {
    assert.equal(calcDay([shift({ leave: { type: 'annual', paid: true } })], [], { finished: true }).paidUnits, 1);
    const u = calcDay([shift({ leave: { type: 'unpaid', paid: false } })], [], { finished: true });
    assert.equal(u.paidUnits, 0);
    assert.equal(u.status, 'leave');
  });
  it('tăng ca: chỉ tính phần đã được duyệt VÀ có ở lại thực tế', () => {
    const p = [{ kind: 'in' as const, min: m(7, 30) }, { kind: 'out' as const, min: m(17, 30) }];
    assert.equal(calcDay([shift()], p, { finished: true, approvedOvertimeMinutes: 60 }).overtimeMinutes, 30);
    assert.equal(calcDay([shift()], p, { finished: true }).overtimeMinutes, 0); // ở lại quá giờ không tự thành tăng ca
    assert.equal(calcDay([shift()], p, { finished: true, approvedOvertimeMinutes: 20 }).overtimeMinutes, 20);
  });
  it('ngày nghỉ có tăng ca được duyệt', () => {
    const r = calcDay([], [{ kind: 'in', min: m(8) }, { kind: 'out', min: m(10) }], { finished: true, approvedOvertimeMinutes: 180 });
    assert.equal(r.status, 'off');
    assert.equal(r.overtimeMinutes, 120);
  });
  it('tổng hợp: totalsOf', () => {
    const days = [
      calcDay([shift()], [{ kind: 'in', min: m(7, 40) }, { kind: 'out', min: m(17) }], { finished: true }),
      calcDay([shift()], [{ kind: 'in', min: m(7, 30) }], { finished: true }),
      calcDay([shift({ leave: { type: 'unpaid', paid: false } })], [], { finished: true }),
    ];
    const t = totalsOf(days);
    assert.equal(t.paidDays, 1);
    assert.equal(t.incompleteDays, 1);
    assert.equal(t.lateCount, 1);
    assert.equal(t.unpaidLeaveDays, 1);
  });
  it('ca trùng thời gian giữa hai cơ sở bị phát hiện', () => {
    const d = dayIndex('2026-11-05');
    assert.equal(shiftsOverlap({ day: d, start: m(7), end: m(12) }, { day: d, start: m(11), end: m(15) }), true);
    assert.equal(shiftsOverlap({ day: d, start: m(7), end: m(11) }, { day: d, start: m(11), end: m(15) }), false);
    // ca qua đêm hôm trước chồng với ca sáng hôm sau
    assert.equal(shiftsOverlap({ day: d, start: m(22), end: m(30) }, { day: d + 1, start: m(5), end: m(9) }), true);
  });
});

describe('Lương (BUSINESS mục 8)', () => {
  it('ví dụ chuẩn: 8.000.000 × 25 / 26 = 7.692.308', () => {
    assert.equal(prorateSalary(8_000_000, 25, 26), 7_692_308);
  });
  it('công lẻ không sai số float', () => {
    assert.equal(prorateSalary(8_000_000, 25.5, 26), 7_846_154);
    assert.equal(prorateSalary(10_000_000, 0, 26), 0);
    assert.equal(prorateSalary(10_000_000, 26, 26), 10_000_000);
  });
  it('tăng ca', () => {
    assert.equal(overtimePay(8_000_000, 26, 0), 0);
    assert.equal(overtimePay(8_000_000, 26, 60), Math.round((8_000_000 * 60 * 1.5) / (26 * 480)));
  });
  it('bảng lương đủ thành phần: gross, khấu trừ, thực lĩnh', () => {
    const r = computePayroll({
      base: 8_000_000, standardDays: 26, paidDays: 25, overtimeMinutes: 0,
      components: [
        { code: 'AN', name: 'Phụ cấp ăn', type: 'allowance', calc: 'per_paid_day', amount: 30_000 },
        { code: 'TC', name: 'Phụ cấp trách nhiệm', type: 'allowance', amount: 500_000 },
        { code: 'UNG', name: 'Tạm ứng', type: 'advance', amount: 1_000_000 },
        { code: 'BH', name: 'Khấu trừ', type: 'deduction', calc: 'percent_of_base_pay', rate: 10.5 },
      ],
    });
    assert.equal(r.basePay, 7_692_308);
    assert.equal(r.allowances, 750_000 + 500_000);
    assert.equal(r.deductions, 1_000_000 + Math.round(7_692_308 * 0.105));
    assert.equal(r.gross, 7_692_308 + 1_250_000);
    assert.equal(r.net, r.gross - r.deductions);
    assert.ok(r.lines.some((l) => l.code === 'UNG' && l.amount === -1_000_000));
  });
  it('công chuẩn không hợp lệ', () => {
    assert.throws(() => prorateSalary(1, 1, 0));
  });
});

describe('Thời gian / kỳ', () => {
  it('periodRange, prev/next', () => {
    assert.deepEqual(periodRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
    assert.deepEqual(periodRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
    assert.equal(prevPeriodKey('2026-01'), '2025-12');
    assert.equal(nextPeriodKey('2026-12'), '2027-01');
  });
  it('giờ địa phương ⇄ Date', () => {
    const d = zonedTimeToDate('2026-11-05', '07:30');
    assert.equal(d.toISOString(), '2026-11-05T00:30:00.000Z');
    assert.deepEqual(localDayMinutes(d), { day: '2026-11-05', minutes: 450 });
    assert.deepEqual(localDayMinutes(new Date('2026-11-05T18:00:00Z')), { day: '2026-11-06', minutes: 60 });
  });
});
