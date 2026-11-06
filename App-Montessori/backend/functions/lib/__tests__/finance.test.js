"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Test THUẦN (không emulator): tính phí, phân bổ thanh toán, trạng thái công nợ, chốt suất ăn.
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const calc_fee_1 = require("../lib/calc-fee");
const calc_ops_1 = require("../lib/calc-ops");
const policy = {
    items: [{ code: 'HP', type: 'tuition', name: 'Học phí tháng', amount: 3_000_000 }],
    meal: { unitPrice: 35_000, mode: 'provisional' },
    discounts: [{ code: 'GIAM', name: 'Giảm học phí', amount: 300_000 }],
};
(0, node_test_1.describe)('Bảng thu tháng (ví dụ chuẩn BUSINESS mục 9)', () => {
    const lines = (0, calc_fee_1.computeBillLines)(policy, {
        mealCount: 22, refundMealCount: 2,
        extras: [{ code: 'DONMUON', type: 'service', description: 'Đón muộn', amount: 200_000 }],
    });
    (0, node_test_1.it)('các dòng: 3.000.000 + 770.000 + 200.000 − 300.000 − 70.000', () => {
        const by = (c) => lines.find((l) => l.code === c);
        strict_1.default.equal(by('HP').amount, 3_000_000);
        strict_1.default.equal(by('MEAL').amount, 770_000);
        strict_1.default.equal(by('DONMUON').amount, 200_000);
        strict_1.default.equal(by('GIAM').amount, -300_000);
        strict_1.default.equal(by('MEAL_REFUND').amount, -70_000);
    });
    const sum = (0, calc_fee_1.summarizeLines)(lines);
    (0, node_test_1.it)('phải thu mới = 3.600.000', () => {
        strict_1.default.equal(sum.billed, 3_970_000);
        strict_1.default.equal(sum.discount, 370_000);
        strict_1.default.equal(sum.net, 3_600_000);
    });
    (0, node_test_1.it)('nợ cũ 500.000 và phải thu mới TÁCH: tổng phải đóng 4.100.000, không cộng hai lần', () => {
        const openingDebt = 500_000;
        strict_1.default.equal(openingDebt + sum.net, 4_100_000);
        // khoản kỳ mới không chứa nợ cũ
        strict_1.default.equal((0, calc_fee_1.receivableBalance)({ billed: sum.billed, discount: sum.discount }), 3_600_000);
    });
});
(0, node_test_1.describe)('Phân bổ thanh toán', () => {
    const open = [
        { id: 'rcv_old', periodKey: '2026-09', dueDate: '2026-09-10', balance: 500_000 },
        { id: 'rcv_new', periodKey: '2026-10', dueDate: '2026-10-10', balance: 3_600_000 },
    ];
    (0, node_test_1.it)('thu 2.000.000 → 500.000 nợ cũ + 1.500.000 kỳ mới → còn 2.100.000', () => {
        const r = (0, calc_fee_1.allocatePayment)(2_000_000, open);
        strict_1.default.deepEqual(r.allocations.sort((a, b) => a.receivableId.localeCompare(b.receivableId)), [
            { receivableId: 'rcv_new', amount: 1_500_000 }, { receivableId: 'rcv_old', amount: 500_000 },
        ]);
        strict_1.default.equal(r.credit, 0);
        const remaining = open.reduce((s, x) => s + x.balance, 0) - r.allocated;
        strict_1.default.equal(remaining, 2_100_000);
    });
    (0, node_test_1.it)('đóng dư → phần dư thành credit, không thành doanh thu', () => {
        const r = (0, calc_fee_1.allocatePayment)(5_000_000, open);
        strict_1.default.equal(r.allocated, 4_100_000);
        strict_1.default.equal(r.credit, 900_000);
    });
    (0, node_test_1.it)('phân bổ thủ công vào kỳ mới trước, phần còn lại vẫn vào nợ cũ trước', () => {
        const r = (0, calc_fee_1.allocatePayment)(1_000_000, open, [{ receivableId: 'rcv_new', amount: 300_000 }]);
        const m = Object.fromEntries(r.allocations.map((a) => [a.receivableId, a.amount]));
        strict_1.default.equal(m.rcv_new, 500_000); // 300.000 thủ công + 200.000 phần còn lại sau nợ cũ
        strict_1.default.equal(m.rcv_old, 500_000);
        strict_1.default.equal(r.credit, 0);
    });
    (0, node_test_1.it)('từ chối phân bổ sai', () => {
        strict_1.default.throws(() => (0, calc_fee_1.allocatePayment)(100_000, open, [{ receivableId: 'rcv_old', amount: 600_000 }]), /vượt quá/);
        strict_1.default.throws(() => (0, calc_fee_1.allocatePayment)(100_000, open, [{ receivableId: 'khac', amount: 10 }]), /không thuộc/);
        strict_1.default.throws(() => (0, calc_fee_1.allocatePayment)(100_000, open, [{ receivableId: 'rcv_new', amount: 200_000 }]), /vượt quá số tiền/);
        strict_1.default.throws(() => (0, calc_fee_1.allocatePayment)(0, open), /lớn hơn 0/);
        strict_1.default.throws(() => (0, calc_fee_1.allocatePayment)(1.5, open), /số nguyên/);
    });
    (0, node_test_1.it)('đóng một phần chỉ trừ vào nợ cũ trước', () => {
        const r = (0, calc_fee_1.allocatePayment)(300_000, open);
        strict_1.default.deepEqual(r.allocations, [{ receivableId: 'rcv_old', amount: 300_000 }]);
    });
});
(0, node_test_1.describe)('Trạng thái công nợ', () => {
    (0, node_test_1.it)('overdue tính từ dueDate; partial; paid', () => {
        strict_1.default.equal((0, calc_fee_1.deriveReceivableStatus)({ balance: 100, allocated: 0, dueDate: '2026-10-10' }, '2026-10-10'), 'unpaid');
        strict_1.default.equal((0, calc_fee_1.deriveReceivableStatus)({ balance: 100, allocated: 0, dueDate: '2026-10-10' }, '2026-10-11'), 'overdue');
        strict_1.default.equal((0, calc_fee_1.deriveReceivableStatus)({ balance: 60, allocated: 40, dueDate: '2026-10-10' }, '2026-10-11'), 'partially_paid');
        strict_1.default.equal((0, calc_fee_1.deriveReceivableStatus)({ balance: 0, allocated: 100, dueDate: '2026-10-10' }, '2026-10-30'), 'paid');
        strict_1.default.equal((0, calc_fee_1.deriveReceivableStatus)({ balance: 100, allocated: 0, status: 'draft' }, '2026-10-30'), 'draft');
        strict_1.default.equal((0, calc_fee_1.deriveReceivableStatus)({ balance: 100, allocated: 0, status: 'cancelled' }, '2026-10-30'), 'cancelled');
        strict_1.default.equal((0, calc_fee_1.isOverdue)({ balance: 5, dueDate: '2026-10-10' }, '2026-10-11'), true);
    });
    (0, node_test_1.it)('công thức nợ: balance = opening + billed + adjustUp − discount − allocated', () => {
        strict_1.default.equal((0, calc_fee_1.receivableBalance)({ openingDebt: 500_000, billed: 3_970_000, adjustUp: 10_000, discount: 370_000, allocated: 2_000_000 }), 2_110_000);
    });
});
(0, node_test_1.describe)('Tính theo ngày (nhập học giữa tháng)', () => {
    (0, node_test_1.it)('làm tròn đồng một lần', () => {
        strict_1.default.equal((0, calc_fee_1.prorate)(3_000_000, 10, 22), 1_363_636);
        strict_1.default.equal((0, calc_fee_1.prorate)(3_000_000, 22, 22), 3_000_000);
    });
    (0, node_test_1.it)('biểu phí proration=daily chỉ áp cho học phí, không áp tiền ăn', () => {
        const lines = (0, calc_fee_1.computeBillLines)({ ...policy, proration: 'daily', discounts: [] }, { mealCount: 10, refundMealCount: 0, prorate: { days: 10, of: 22 } });
        strict_1.default.equal(lines.find((l) => l.code === 'HP').amount, 1_363_636);
        strict_1.default.equal(lines.find((l) => l.code === 'MEAL').amount, 350_000);
    });
    (0, node_test_1.it)('khoản giảm trừ lớn hơn khoản thu cho net âm (bị chặn ở tầng module)', () => {
        const l = (0, calc_fee_1.computeBillLines)({ items: [{ code: 'A', type: 'service', name: 'A', amount: 100_000 }], discounts: [{ code: 'D', name: 'D', amount: 300_000 }] }, { mealCount: 0, refundMealCount: 0 });
        strict_1.default.equal((0, calc_fee_1.summarizeLines)(l).net, -200_000);
    });
});
(0, node_test_1.describe)('Chốt suất ăn — mốc 08:00 (AT05 phần thuần)', () => {
    const at = (s) => new Date(`${s}+07:00`);
    (0, node_test_1.it)('nghỉ được duyệt trước giờ chốt → hủy suất', () => {
        strict_1.default.equal((0, calc_ops_1.mealCancelledFor)('2026-11-05', '08:00', at('2026-11-05T07:30:00'), at('2026-11-05T07:50:00')), true);
    });
    (0, node_test_1.it)('gửi/duyệt sau giờ chốt → vẫn tính tiền', () => {
        strict_1.default.equal((0, calc_ops_1.mealCancelledFor)('2026-11-05', '08:00', at('2026-11-05T07:30:00'), at('2026-11-05T08:10:00')), false);
        strict_1.default.equal((0, calc_ops_1.mealCancelledFor)('2026-11-05', '08:00', at('2026-11-05T08:05:00'), at('2026-11-05T08:06:00')), false);
    });
    (0, node_test_1.it)('gửi hôm trước → luôn trước giờ chốt', () => {
        strict_1.default.equal((0, calc_ops_1.mealCancelledFor)('2026-11-05', '08:00', at('2026-11-04T20:00:00'), at('2026-11-04T21:00:00')), true);
    });
    (0, node_test_1.it)('chưa được duyệt → không hủy', () => {
        strict_1.default.equal((0, calc_ops_1.mealCancelledFor)('2026-11-05', '08:00', at('2026-11-04T20:00:00'), null), false);
    });
    (0, node_test_1.it)('đúng giờ chốt (08:00) vẫn kịp', () => {
        strict_1.default.equal((0, calc_ops_1.mealCancelledFor)('2026-11-05', '08:00', at('2026-11-05T08:00:00'), at('2026-11-05T08:00:00')), true);
    });
    (0, node_test_1.it)('hoàn trừ: 22 suất tạm thu, 2 suất hủy đủ điều kiện = 70.000', () => {
        const refund = 2 * 35_000;
        strict_1.default.equal(refund, 70_000);
        const lines = (0, calc_fee_1.computeBillLines)(policy, { mealCount: 22, refundMealCount: 2 });
        strict_1.default.equal(lines.find((l) => l.code === 'MEAL_REFUND').amount, -refund);
    });
});
