// Test THUẦN (không emulator): tính phí, phân bổ thanh toán, trạng thái công nợ, chốt suất ăn.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocatePayment, BillLine, computeBillLines, deriveReceivableStatus, FeePolicyLike, prorate, receivableBalance, summarizeLines, isOverdue,
} from '../lib/calc-fee';
import { mealCancelledFor } from '../lib/calc-ops';

const policy: FeePolicyLike = {
  items: [{ code: 'HP', type: 'tuition', name: 'Học phí tháng', amount: 3_000_000 }],
  meal: { unitPrice: 35_000, mode: 'provisional' },
  discounts: [{ code: 'GIAM', name: 'Giảm học phí', amount: 300_000 }],
};

describe('Bảng thu tháng (ví dụ chuẩn BUSINESS mục 9)', () => {
  const lines = computeBillLines(policy, {
    mealCount: 22, refundMealCount: 2,
    extras: [{ code: 'DONMUON', type: 'service', description: 'Đón muộn', amount: 200_000 }],
  });
  it('các dòng: 3.000.000 + 770.000 + 200.000 − 300.000 − 70.000', () => {
    const by = (c: string) => lines.find((l: BillLine) => l.code === c)!;
    assert.equal(by('HP').amount, 3_000_000);
    assert.equal(by('MEAL').amount, 770_000);
    assert.equal(by('DONMUON').amount, 200_000);
    assert.equal(by('GIAM').amount, -300_000);
    assert.equal(by('MEAL_REFUND').amount, -70_000);
  });
  const sum = summarizeLines(lines);
  it('phải thu mới = 3.600.000', () => {
    assert.equal(sum.billed, 3_970_000);
    assert.equal(sum.discount, 370_000);
    assert.equal(sum.net, 3_600_000);
  });
  it('nợ cũ 500.000 và phải thu mới TÁCH: tổng phải đóng 4.100.000, không cộng hai lần', () => {
    const openingDebt = 500_000;
    assert.equal(openingDebt + sum.net, 4_100_000);
    // khoản kỳ mới không chứa nợ cũ
    assert.equal(receivableBalance({ billed: sum.billed, discount: sum.discount }), 3_600_000);
  });
});

describe('Phân bổ thanh toán', () => {
  const open = [
    { id: 'rcv_old', periodKey: '2026-09', dueDate: '2026-09-10', balance: 500_000 },
    { id: 'rcv_new', periodKey: '2026-10', dueDate: '2026-10-10', balance: 3_600_000 },
  ];
  it('thu 2.000.000 → 500.000 nợ cũ + 1.500.000 kỳ mới → còn 2.100.000', () => {
    const r = allocatePayment(2_000_000, open);
    assert.deepEqual(r.allocations.sort((a, b) => a.receivableId.localeCompare(b.receivableId)), [
      { receivableId: 'rcv_new', amount: 1_500_000 }, { receivableId: 'rcv_old', amount: 500_000 },
    ]);
    assert.equal(r.credit, 0);
    const remaining = open.reduce((s, x) => s + x.balance, 0) - r.allocated;
    assert.equal(remaining, 2_100_000);
  });
  it('đóng dư → phần dư thành credit, không thành doanh thu', () => {
    const r = allocatePayment(5_000_000, open);
    assert.equal(r.allocated, 4_100_000);
    assert.equal(r.credit, 900_000);
  });
  it('phân bổ thủ công vào kỳ mới trước, phần còn lại vẫn vào nợ cũ trước', () => {
    const r = allocatePayment(1_000_000, open, [{ receivableId: 'rcv_new', amount: 300_000 }]);
    const m = Object.fromEntries(r.allocations.map((a) => [a.receivableId, a.amount]));
    assert.equal(m.rcv_new, 500_000); // 300.000 thủ công + 200.000 phần còn lại sau nợ cũ
    assert.equal(m.rcv_old, 500_000);
    assert.equal(r.credit, 0);
  });
  it('từ chối phân bổ sai', () => {
    assert.throws(() => allocatePayment(100_000, open, [{ receivableId: 'rcv_old', amount: 600_000 }]), /vượt quá/);
    assert.throws(() => allocatePayment(100_000, open, [{ receivableId: 'khac', amount: 10 }]), /không thuộc/);
    assert.throws(() => allocatePayment(100_000, open, [{ receivableId: 'rcv_new', amount: 200_000 }]), /vượt quá số tiền/);
    assert.throws(() => allocatePayment(0, open), /lớn hơn 0/);
    assert.throws(() => allocatePayment(1.5, open), /số nguyên/);
  });
  it('đóng một phần chỉ trừ vào nợ cũ trước', () => {
    const r = allocatePayment(300_000, open);
    assert.deepEqual(r.allocations, [{ receivableId: 'rcv_old', amount: 300_000 }]);
  });
});

describe('Trạng thái công nợ', () => {
  it('overdue tính từ dueDate; partial; paid', () => {
    assert.equal(deriveReceivableStatus({ balance: 100, allocated: 0, dueDate: '2026-10-10' }, '2026-10-10'), 'unpaid');
    assert.equal(deriveReceivableStatus({ balance: 100, allocated: 0, dueDate: '2026-10-10' }, '2026-10-11'), 'overdue');
    assert.equal(deriveReceivableStatus({ balance: 60, allocated: 40, dueDate: '2026-10-10' }, '2026-10-11'), 'partially_paid');
    assert.equal(deriveReceivableStatus({ balance: 0, allocated: 100, dueDate: '2026-10-10' }, '2026-10-30'), 'paid');
    assert.equal(deriveReceivableStatus({ balance: 100, allocated: 0, status: 'draft' }, '2026-10-30'), 'draft');
    assert.equal(deriveReceivableStatus({ balance: 100, allocated: 0, status: 'cancelled' }, '2026-10-30'), 'cancelled');
    assert.equal(isOverdue({ balance: 5, dueDate: '2026-10-10' }, '2026-10-11'), true);
  });
  it('công thức nợ: balance = opening + billed + adjustUp − discount − allocated', () => {
    assert.equal(receivableBalance({ openingDebt: 500_000, billed: 3_970_000, adjustUp: 10_000, discount: 370_000, allocated: 2_000_000 }), 2_110_000);
  });
});

describe('Tính theo ngày (nhập học giữa tháng)', () => {
  it('làm tròn đồng một lần', () => {
    assert.equal(prorate(3_000_000, 10, 22), 1_363_636);
    assert.equal(prorate(3_000_000, 22, 22), 3_000_000);
  });
  it('biểu phí proration=daily chỉ áp cho học phí, không áp tiền ăn', () => {
    const lines = computeBillLines({ ...policy, proration: 'daily', discounts: [] }, { mealCount: 10, refundMealCount: 0, prorate: { days: 10, of: 22 } });
    assert.equal(lines.find((l) => l.code === 'HP')!.amount, 1_363_636);
    assert.equal(lines.find((l) => l.code === 'MEAL')!.amount, 350_000);
  });
  it('khoản giảm trừ lớn hơn khoản thu cho net âm (bị chặn ở tầng module)', () => {
    const l = computeBillLines({ items: [{ code: 'A', type: 'service', name: 'A', amount: 100_000 }], discounts: [{ code: 'D', name: 'D', amount: 300_000 }] }, { mealCount: 0, refundMealCount: 0 });
    assert.equal(summarizeLines(l).net, -200_000);
  });
});

describe('Chốt suất ăn — mốc 08:00 (AT05 phần thuần)', () => {
  const at = (s: string) => new Date(`${s}+07:00`);
  it('nghỉ được duyệt trước giờ chốt → hủy suất', () => {
    assert.equal(mealCancelledFor('2026-11-05', '08:00', at('2026-11-05T07:30:00'), at('2026-11-05T07:50:00')), true);
  });
  it('gửi/duyệt sau giờ chốt → vẫn tính tiền', () => {
    assert.equal(mealCancelledFor('2026-11-05', '08:00', at('2026-11-05T07:30:00'), at('2026-11-05T08:10:00')), false);
    assert.equal(mealCancelledFor('2026-11-05', '08:00', at('2026-11-05T08:05:00'), at('2026-11-05T08:06:00')), false);
  });
  it('gửi hôm trước → luôn trước giờ chốt', () => {
    assert.equal(mealCancelledFor('2026-11-05', '08:00', at('2026-11-04T20:00:00'), at('2026-11-04T21:00:00')), true);
  });
  it('chưa được duyệt → không hủy', () => {
    assert.equal(mealCancelledFor('2026-11-05', '08:00', at('2026-11-04T20:00:00'), null), false);
  });
  it('đúng giờ chốt (08:00) vẫn kịp', () => {
    assert.equal(mealCancelledFor('2026-11-05', '08:00', at('2026-11-05T08:00:00'), at('2026-11-05T08:00:00')), true);
  });
  it('hoàn trừ: 22 suất tạm thu, 2 suất hủy đủ điều kiện = 70.000', () => {
    const refund = 2 * 35_000;
    assert.equal(refund, 70_000);
    const lines = computeBillLines(policy, { mealCount: 22, refundMealCount: 2 });
    assert.equal(lines.find((l) => l.code === 'MEAL_REFUND')!.amount, -refund);
  });
});
