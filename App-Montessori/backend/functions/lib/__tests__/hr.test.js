"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Test THUẦN: tính công, thời gian, lương.
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const calc_time_1 = require("../lib/calc-time");
const calc_pay_1 = require("../lib/calc-pay");
const time_1 = require("../lib/time");
const shift = (o = {}) => ({
    id: 'e1', shiftId: 'HC', start: 7 * 60 + 30, end: 17 * 60, breakMin: 90, lateGrace: 0, earlyGrace: 0, unit: 1, policy: 'full', ...o,
});
const m = (h, mi = 0) => h * 60 + mi;
(0, node_test_1.describe)('Tính công theo ca (BUSINESS mục 7)', () => {
    (0, node_test_1.it)('ví dụ chuẩn: ca 07:30–17:00 nghỉ 90, có mặt 07:40–17:00 → 470 phút, muộn 10', () => {
        const r = (0, calc_time_1.calcDay)([shift()], [{ kind: 'in', min: m(7, 40) }, { kind: 'out', min: m(17) }], { finished: true });
        strict_1.default.equal(r.status, 'ok');
        strict_1.default.equal(r.workedMinutes, 470);
        strict_1.default.equal(r.lateMinutes, 10);
        strict_1.default.equal(r.earlyLeaveMinutes, 0);
        strict_1.default.equal(r.paidUnits, 1);
    });
    (0, node_test_1.it)('dung sai: muộn trong ngưỡng không bị tính muộn', () => {
        const r = (0, calc_time_1.calcDay)([shift({ lateGrace: 10 })], [{ kind: 'in', min: m(7, 40) }, { kind: 'out', min: m(17) }], { finished: true });
        strict_1.default.equal(r.lateMinutes, 0);
        const r2 = (0, calc_time_1.calcDay)([shift({ lateGrace: 5 })], [{ kind: 'in', min: m(7, 40) }, { kind: 'out', min: m(17) }], { finished: true });
        strict_1.default.equal(r2.lateMinutes, 10);
    });
    (0, node_test_1.it)('về sớm', () => {
        const r = (0, calc_time_1.calcDay)([shift()], [{ kind: 'in', min: m(7, 30) }, { kind: 'out', min: m(16, 30) }], { finished: true });
        strict_1.default.equal(r.earlyLeaveMinutes, 30);
        strict_1.default.equal(r.workedMinutes, 480 - 30);
    });
    (0, node_test_1.it)('THIẾU LƯỢT RA → incomplete, KHÔNG tự tính đủ công', () => {
        const r = (0, calc_time_1.calcDay)([shift()], [{ kind: 'in', min: m(7, 30) }], { finished: true });
        strict_1.default.equal(r.status, 'incomplete');
        strict_1.default.equal(r.paidUnits, 0);
        strict_1.default.equal(r.workedMinutes, 0);
        strict_1.default.ok(r.issues.length > 0);
    });
    (0, node_test_1.it)('THIẾU LƯỢT VÀO → incomplete', () => {
        const r = (0, calc_time_1.calcDay)([shift()], [{ kind: 'out', min: m(17) }], { finished: true });
        strict_1.default.equal(r.status, 'incomplete');
        strict_1.default.equal(r.paidUnits, 0);
    });
    (0, node_test_1.it)('chưa kết thúc ngày: chưa tính là lỗi (scheduled)', () => {
        strict_1.default.equal((0, calc_time_1.calcDay)([shift()], [], { finished: false }).status, 'scheduled');
        strict_1.default.equal((0, calc_time_1.calcDay)([shift()], [{ kind: 'in', min: m(7, 30) }], { finished: false }).status, 'scheduled');
    });
    (0, node_test_1.it)('không có lượt nào, ngày đã qua → vắng', () => {
        const r = (0, calc_time_1.calcDay)([shift()], [], { finished: true });
        strict_1.default.equal(r.status, 'absent');
        strict_1.default.equal(r.paidUnits, 0);
    });
    (0, node_test_1.it)('ca qua đêm thuộc ngày bắt đầu (22:00–06:00, mốc >1440)', () => {
        const s = shift({ shiftId: 'DEM', start: m(22), end: m(30), breakMin: 0 });
        const r = (0, calc_time_1.calcDay)([s], [{ kind: 'in', min: m(21, 55) }, { kind: 'out', min: m(30, 5) }], { finished: true });
        strict_1.default.equal(r.status, 'ok');
        strict_1.default.equal(r.workedMinutes, 480);
        // thời điểm ra 06:05 hôm sau quy về phút của NGÀY BẮT ĐẦU
        const out = new Date('2026-11-06T06:05:00+07:00');
        strict_1.default.equal((0, time_1.minutesSinceDayStart)('2026-11-05', out), 1440 + 365);
    });
    (0, node_test_1.it)('chồng lấn hai ca không tính hai lần', () => {
        const a = shift({ id: 'a', shiftId: 'S', start: m(7), end: m(12), breakMin: 0 });
        const b = shift({ id: 'b', shiftId: 'C', start: m(11), end: m(16), breakMin: 0 });
        const r = (0, calc_time_1.calcDay)([a, b], [{ kind: 'in', min: m(7) }, { kind: 'out', min: m(16) }], { finished: true });
        strict_1.default.equal(r.workedMinutes, 540); // 07–16, không phải 600
        strict_1.default.equal((0, calc_time_1.uncoveredMinutes)(0, 100, [[10, 20], [15, 40]]), 70);
    });
    (0, node_test_1.it)('quy đổi công theo tỷ lệ (policy=proportional)', () => {
        const r = (0, calc_time_1.calcDay)([shift({ policy: 'proportional' })], [{ kind: 'in', min: m(7, 30) }, { kind: 'out', min: m(12, 30) }], { finished: true });
        strict_1.default.ok(r.paidUnits > 0 && r.paidUnits < 1);
    });
    (0, node_test_1.it)('làm tròn xuống theo roundTo', () => {
        const r = (0, calc_time_1.calcDay)([shift({ roundTo: 15 })], [{ kind: 'in', min: m(7, 40) }, { kind: 'out', min: m(17) }], { finished: true });
        strict_1.default.equal(r.workedMinutes, 465);
    });
    (0, node_test_1.it)('nghỉ phép có lương = đủ công, không lương = 0', () => {
        strict_1.default.equal((0, calc_time_1.calcDay)([shift({ leave: { type: 'annual', paid: true } })], [], { finished: true }).paidUnits, 1);
        const u = (0, calc_time_1.calcDay)([shift({ leave: { type: 'unpaid', paid: false } })], [], { finished: true });
        strict_1.default.equal(u.paidUnits, 0);
        strict_1.default.equal(u.status, 'leave');
    });
    (0, node_test_1.it)('tăng ca: chỉ tính phần đã được duyệt VÀ có ở lại thực tế', () => {
        const p = [{ kind: 'in', min: m(7, 30) }, { kind: 'out', min: m(17, 30) }];
        strict_1.default.equal((0, calc_time_1.calcDay)([shift()], p, { finished: true, approvedOvertimeMinutes: 60 }).overtimeMinutes, 30);
        strict_1.default.equal((0, calc_time_1.calcDay)([shift()], p, { finished: true }).overtimeMinutes, 0); // ở lại quá giờ không tự thành tăng ca
        strict_1.default.equal((0, calc_time_1.calcDay)([shift()], p, { finished: true, approvedOvertimeMinutes: 20 }).overtimeMinutes, 20);
    });
    (0, node_test_1.it)('ngày nghỉ có tăng ca được duyệt', () => {
        const r = (0, calc_time_1.calcDay)([], [{ kind: 'in', min: m(8) }, { kind: 'out', min: m(10) }], { finished: true, approvedOvertimeMinutes: 180 });
        strict_1.default.equal(r.status, 'off');
        strict_1.default.equal(r.overtimeMinutes, 120);
    });
    (0, node_test_1.it)('tổng hợp: totalsOf', () => {
        const days = [
            (0, calc_time_1.calcDay)([shift()], [{ kind: 'in', min: m(7, 40) }, { kind: 'out', min: m(17) }], { finished: true }),
            (0, calc_time_1.calcDay)([shift()], [{ kind: 'in', min: m(7, 30) }], { finished: true }),
            (0, calc_time_1.calcDay)([shift({ leave: { type: 'unpaid', paid: false } })], [], { finished: true }),
        ];
        const t = (0, calc_time_1.totalsOf)(days);
        strict_1.default.equal(t.paidDays, 1);
        strict_1.default.equal(t.incompleteDays, 1);
        strict_1.default.equal(t.lateCount, 1);
        strict_1.default.equal(t.unpaidLeaveDays, 1);
    });
    (0, node_test_1.it)('ca trùng thời gian giữa hai cơ sở bị phát hiện', () => {
        const d = (0, time_1.dayIndex)('2026-11-05');
        strict_1.default.equal((0, calc_time_1.shiftsOverlap)({ day: d, start: m(7), end: m(12) }, { day: d, start: m(11), end: m(15) }), true);
        strict_1.default.equal((0, calc_time_1.shiftsOverlap)({ day: d, start: m(7), end: m(11) }, { day: d, start: m(11), end: m(15) }), false);
        // ca qua đêm hôm trước chồng với ca sáng hôm sau
        strict_1.default.equal((0, calc_time_1.shiftsOverlap)({ day: d, start: m(22), end: m(30) }, { day: d + 1, start: m(5), end: m(9) }), true);
    });
});
(0, node_test_1.describe)('Lương (BUSINESS mục 8)', () => {
    (0, node_test_1.it)('ví dụ chuẩn: 8.000.000 × 25 / 26 = 7.692.308', () => {
        strict_1.default.equal((0, calc_pay_1.prorateSalary)(8_000_000, 25, 26), 7_692_308);
    });
    (0, node_test_1.it)('công lẻ không sai số float', () => {
        strict_1.default.equal((0, calc_pay_1.prorateSalary)(8_000_000, 25.5, 26), 7_846_154);
        strict_1.default.equal((0, calc_pay_1.prorateSalary)(10_000_000, 0, 26), 0);
        strict_1.default.equal((0, calc_pay_1.prorateSalary)(10_000_000, 26, 26), 10_000_000);
    });
    (0, node_test_1.it)('tăng ca', () => {
        strict_1.default.equal((0, calc_pay_1.overtimePay)(8_000_000, 26, 0), 0);
        strict_1.default.equal((0, calc_pay_1.overtimePay)(8_000_000, 26, 60), Math.round((8_000_000 * 60 * 1.5) / (26 * 480)));
    });
    (0, node_test_1.it)('bảng lương đủ thành phần: gross, khấu trừ, thực lĩnh', () => {
        const r = (0, calc_pay_1.computePayroll)({
            base: 8_000_000, standardDays: 26, paidDays: 25, overtimeMinutes: 0,
            components: [
                { code: 'AN', name: 'Phụ cấp ăn', type: 'allowance', calc: 'per_paid_day', amount: 30_000 },
                { code: 'TC', name: 'Phụ cấp trách nhiệm', type: 'allowance', amount: 500_000 },
                { code: 'UNG', name: 'Tạm ứng', type: 'advance', amount: 1_000_000 },
                { code: 'BH', name: 'Khấu trừ', type: 'deduction', calc: 'percent_of_base_pay', rate: 10.5 },
            ],
        });
        strict_1.default.equal(r.basePay, 7_692_308);
        strict_1.default.equal(r.allowances, 750_000 + 500_000);
        strict_1.default.equal(r.deductions, 1_000_000 + Math.round(7_692_308 * 0.105));
        strict_1.default.equal(r.gross, 7_692_308 + 1_250_000);
        strict_1.default.equal(r.net, r.gross - r.deductions);
        strict_1.default.ok(r.lines.some((l) => l.code === 'UNG' && l.amount === -1_000_000));
    });
    (0, node_test_1.it)('công chuẩn không hợp lệ', () => {
        strict_1.default.throws(() => (0, calc_pay_1.prorateSalary)(1, 1, 0));
    });
});
(0, node_test_1.describe)('Thời gian / kỳ', () => {
    (0, node_test_1.it)('periodRange, prev/next', () => {
        strict_1.default.deepEqual((0, time_1.periodRange)('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
        strict_1.default.deepEqual((0, time_1.periodRange)('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
        strict_1.default.equal((0, time_1.prevPeriodKey)('2026-01'), '2025-12');
        strict_1.default.equal((0, time_1.nextPeriodKey)('2026-12'), '2027-01');
    });
    (0, node_test_1.it)('giờ địa phương ⇄ Date', () => {
        const d = (0, time_1.zonedTimeToDate)('2026-11-05', '07:30');
        strict_1.default.equal(d.toISOString(), '2026-11-05T00:30:00.000Z');
        strict_1.default.deepEqual((0, time_1.localDayMinutes)(d), { day: '2026-11-05', minutes: 450 });
        strict_1.default.deepEqual((0, time_1.localDayMinutes)(new Date('2026-11-05T18:00:00Z')), { day: '2026-11-06', minutes: 60 });
    });
});
