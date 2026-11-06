// Test THUẦN: FEFO kho, dị ứng thực đơn, giá trị kho.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allergyConflicts, fefoPlan, stockValue } from '../lib/calc-ops';

describe('Xuất kho FEFO', () => {
  const lots = [
    { id: 'L3', qtyRemaining: 10, expiry: '2026-12-31', receivedAtMs: 3 },
    { id: 'L1', qtyRemaining: 5, expiry: '2026-11-10', receivedAtMs: 1 },
    { id: 'L2', qtyRemaining: 5, expiry: '2026-11-20', receivedAtMs: 2 },
    { id: 'LX', qtyRemaining: 9, expiry: '2026-10-01', receivedAtMs: 0 }, // đã hết hạn
  ];
  it('lô sắp hết hạn xuất trước, bỏ lô hết hạn', () => {
    const r = fefoPlan(lots, 8, '2026-11-05');
    assert.deepEqual(r.picks, [{ lotId: 'L1', qty: 5 }, { lotId: 'L2', qty: 3 }]);
    assert.equal(r.shortage, 0);
    assert.equal(r.expiredSkipped, 9);
  });
  it('không đủ tồn: báo thiếu (không cho âm)', () => {
    const r = fefoPlan(lots, 30, '2026-11-05');
    assert.equal(r.shortage, 10);
    assert.equal(r.picks.reduce((s, p) => s + p.qty, 0), 20);
  });
  it('hủy hàng hết hạn (waste) dùng mốc rất cũ để lấy cả lô hết hạn', () => {
    const r = fefoPlan(lots, 9, '0000-00-00');
    assert.deepEqual(r.picks, [{ lotId: 'LX', qty: 9 }]);
  });
  it('lô không hạn dùng xuất sau cùng; số thập phân 3 chữ số', () => {
    const r = fefoPlan([{ id: 'N', qtyRemaining: 1, expiry: null }, { id: 'D', qtyRemaining: 0.5, expiry: '2027-01-01' }], 1.25, '2026-11-05');
    assert.deepEqual(r.picks, [{ lotId: 'D', qty: 0.5 }, { lotId: 'N', qty: 0.75 }]);
  });
  it('giá trị = số lượng × đơn giá làm tròn đồng', () => {
    assert.equal(stockValue(2.5, 12_345), 30_863);
    assert.equal(stockValue(0, 100), 0);
  });
});

describe('Cảnh báo dị ứng thực đơn', () => {
  it('khớp không dấu, theo nhãn hoặc tên món', () => {
    assert.deepEqual(allergyConflicts(['tôm', 'sữa'], 'Canh rau', ['Tôm']), ['Tôm']);
    assert.deepEqual(allergyConflicts([], 'Cháo tôm', ['tom']), ['tom']);
    assert.deepEqual(allergyConflicts(['đậu phộng'], 'Chè', ['dau phong']), ['dau phong']);
  });
  it('không dị ứng → không cảnh báo', () => {
    assert.deepEqual(allergyConflicts(['sữa'], 'Cơm thịt', ['tôm']), []);
    assert.deepEqual(allergyConflicts(['sữa'], 'Cơm thịt', []), []);
    assert.deepEqual(allergyConflicts(['sữa'], 'Cơm thịt', ['']), []);
  });
});
