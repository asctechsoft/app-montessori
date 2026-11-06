"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Test THUẦN: FEFO kho, dị ứng thực đơn, giá trị kho.
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const calc_ops_1 = require("../lib/calc-ops");
(0, node_test_1.describe)('Xuất kho FEFO', () => {
    const lots = [
        { id: 'L3', qtyRemaining: 10, expiry: '2026-12-31', receivedAtMs: 3 },
        { id: 'L1', qtyRemaining: 5, expiry: '2026-11-10', receivedAtMs: 1 },
        { id: 'L2', qtyRemaining: 5, expiry: '2026-11-20', receivedAtMs: 2 },
        { id: 'LX', qtyRemaining: 9, expiry: '2026-10-01', receivedAtMs: 0 }, // đã hết hạn
    ];
    (0, node_test_1.it)('lô sắp hết hạn xuất trước, bỏ lô hết hạn', () => {
        const r = (0, calc_ops_1.fefoPlan)(lots, 8, '2026-11-05');
        strict_1.default.deepEqual(r.picks, [{ lotId: 'L1', qty: 5 }, { lotId: 'L2', qty: 3 }]);
        strict_1.default.equal(r.shortage, 0);
        strict_1.default.equal(r.expiredSkipped, 9);
    });
    (0, node_test_1.it)('không đủ tồn: báo thiếu (không cho âm)', () => {
        const r = (0, calc_ops_1.fefoPlan)(lots, 30, '2026-11-05');
        strict_1.default.equal(r.shortage, 10);
        strict_1.default.equal(r.picks.reduce((s, p) => s + p.qty, 0), 20);
    });
    (0, node_test_1.it)('hủy hàng hết hạn (waste) dùng mốc rất cũ để lấy cả lô hết hạn', () => {
        const r = (0, calc_ops_1.fefoPlan)(lots, 9, '0000-00-00');
        strict_1.default.deepEqual(r.picks, [{ lotId: 'LX', qty: 9 }]);
    });
    (0, node_test_1.it)('lô không hạn dùng xuất sau cùng; số thập phân 3 chữ số', () => {
        const r = (0, calc_ops_1.fefoPlan)([{ id: 'N', qtyRemaining: 1, expiry: null }, { id: 'D', qtyRemaining: 0.5, expiry: '2027-01-01' }], 1.25, '2026-11-05');
        strict_1.default.deepEqual(r.picks, [{ lotId: 'D', qty: 0.5 }, { lotId: 'N', qty: 0.75 }]);
    });
    (0, node_test_1.it)('giá trị = số lượng × đơn giá làm tròn đồng', () => {
        strict_1.default.equal((0, calc_ops_1.stockValue)(2.5, 12_345), 30_863);
        strict_1.default.equal((0, calc_ops_1.stockValue)(0, 100), 0);
    });
});
(0, node_test_1.describe)('Cảnh báo dị ứng thực đơn', () => {
    (0, node_test_1.it)('khớp không dấu, theo nhãn hoặc tên món', () => {
        strict_1.default.deepEqual((0, calc_ops_1.allergyConflicts)(['tôm', 'sữa'], 'Canh rau', ['Tôm']), ['Tôm']);
        strict_1.default.deepEqual((0, calc_ops_1.allergyConflicts)([], 'Cháo tôm', ['tom']), ['tom']);
        strict_1.default.deepEqual((0, calc_ops_1.allergyConflicts)(['đậu phộng'], 'Chè', ['dau phong']), ['dau phong']);
    });
    (0, node_test_1.it)('không dị ứng → không cảnh báo', () => {
        strict_1.default.deepEqual((0, calc_ops_1.allergyConflicts)(['sữa'], 'Cơm thịt', ['tôm']), []);
        strict_1.default.deepEqual((0, calc_ops_1.allergyConflicts)(['sữa'], 'Cơm thịt', []), []);
        strict_1.default.deepEqual((0, calc_ops_1.allergyConflicts)(['sữa'], 'Cơm thịt', ['']), []);
    });
});
