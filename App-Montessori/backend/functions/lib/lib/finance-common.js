"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.childName = exports.ISSUED_STATUSES = exports.OPEN_STATUSES = void 0;
exports.rcvState = rcvState;
exports.patchOf = patchOf;
const firebase_1 = require("../core/firebase");
const calc_fee_1 = require("./calc-fee");
exports.OPEN_STATUSES = ['unpaid', 'partially_paid', 'overdue'];
exports.ISSUED_STATUSES = ['unpaid', 'partially_paid', 'overdue', 'paid'];
const childName = (c) => (c.fullName ?? c.name ?? c.displayName ?? c.id ?? '');
exports.childName = childName;
/**
 * Trạng thái + số dư mới của một khoản phải thu sau khi đổi các thành phần.
 * balance = openingDebt + billed + adjustUp − discount − allocated. (Không bao giờ sửa balance trực tiếp.)
 */
function rcvState(r, change, today) {
    const merged = {
        openingDebt: r.openingDebt ?? 0, billed: r.billed ?? 0, adjustUp: change.adjustUp ?? r.adjustUp ?? 0,
        discount: change.discount ?? r.discount ?? 0, allocated: change.allocated ?? r.allocated ?? 0,
    };
    const balance = (0, calc_fee_1.receivableBalance)(merged);
    const status = (0, calc_fee_1.deriveReceivableStatus)({ balance, allocated: merged.allocated, dueDate: r.dueDate, status: undefined }, today);
    return { ...merged, balance, status, isOverdue: (0, calc_fee_1.isOverdue)({ balance, dueDate: r.dueDate }, today) };
}
function patchOf(ctx, prevVersion, p) {
    return { ...p, updatedAt: firebase_1.Timestamp.now(), updatedBy: ctx.uid, version: (prevVersion ?? 0) + 1 };
}
