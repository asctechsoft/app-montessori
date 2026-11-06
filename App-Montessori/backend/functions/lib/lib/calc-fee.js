"use strict";
// Tính phí & phân bổ thanh toán THUẦN. Tiền = số nguyên VND. Math.round chỉ ở prorate().
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOverdue = void 0;
exports.prorate = prorate;
exports.computeBillLines = computeBillLines;
exports.summarizeLines = summarizeLines;
exports.receivableBalance = receivableBalance;
exports.deriveReceivableStatus = deriveReceivableStatus;
exports.allocatePayment = allocatePayment;
exports.mealRefundAmount = mealRefundAmount;
/** Tính tiền theo tỷ lệ ngày, làm tròn đồng (điểm làm tròn duy nhất của tính học phí). */
function prorate(amount, days, of) {
    if (!(of > 0))
        return amount;
    return Math.round((amount * Math.min(days, of)) / of);
}
function computeBillLines(policy, c) {
    const lines = [];
    const useProrate = policy.proration === 'daily' && c.prorate && c.prorate.days < c.prorate.of;
    for (const it of policy.items ?? []) {
        if (it.classIds?.length && (!c.classId || !it.classIds.includes(c.classId)))
            continue;
        const amt = it.type === 'tuition' && useProrate ? prorate(it.amount, c.prorate.days, c.prorate.of) : it.amount;
        lines.push({ code: it.code, type: it.type, description: it.name, qty: 1, unitPrice: it.amount, amount: amt });
    }
    const price = policy.meal?.unitPrice ?? 0;
    if (policy.meal && price > 0 && c.mealCount > 0) {
        lines.push({ code: 'MEAL', type: 'meal', description: `Tiền ăn ${c.mealCount} suất × ${price}`, qty: c.mealCount, unitPrice: price, amount: c.mealCount * price });
    }
    for (const d of [...(policy.discounts ?? []), ...(c.childDiscounts ?? [])]) {
        lines.push({ code: d.code, type: 'discount', description: d.name, qty: 1, unitPrice: d.amount, amount: -Math.abs(d.amount) });
    }
    if (price > 0 && c.refundMealCount > 0) {
        lines.push({ code: 'MEAL_REFUND', type: 'meal_refund', description: `Hoàn trừ tiền ăn kỳ trước ${c.refundMealCount} suất × ${price}`, qty: c.refundMealCount, unitPrice: price, amount: -(c.refundMealCount * price) });
    }
    for (const e of c.extras ?? []) {
        const type = e.type === 'discount' ? 'discount' : e.type === 'adjustment' ? 'adjustment' : 'service';
        const amt = type === 'discount' ? -Math.abs(e.amount) : e.amount;
        lines.push({ code: e.code ?? type.toUpperCase(), type, description: e.description, qty: 1, unitPrice: Math.abs(e.amount), amount: amt });
    }
    return lines;
}
/** billed = tổng dòng dương; discount = tổng |dòng âm|; net = billed − discount (phải thu mới trong kỳ). */
function summarizeLines(lines) {
    let billed = 0;
    let discount = 0;
    for (const l of lines) {
        if (l.amount >= 0)
            billed += l.amount;
        else
            discount += -l.amount;
    }
    return { billed, discount, net: billed - discount };
}
/** Công nợ một khoản: balance = openingDebt + billed + adjustUp − discount − allocated. */
function receivableBalance(r) {
    return (r.openingDebt ?? 0) + (r.billed ?? 0) + (r.adjustUp ?? 0) - (r.discount ?? 0) - (r.allocated ?? 0);
}
/** Trạng thái thanh toán suy ra từ số liệu; overdue tính từ dueDate (chỉ khi chưa trả đồng nào). */
function deriveReceivableStatus(r, today) {
    if (r.status === 'cancelled')
        return 'cancelled';
    if (r.status === 'draft')
        return 'draft';
    if (r.balance <= 0)
        return 'paid';
    if (r.allocated > 0)
        return 'partially_paid';
    if (r.dueDate && r.dueDate < today)
        return 'overdue';
    return 'unpaid';
}
const isOverdue = (r, today) => r.balance > 0 && !!r.dueDate && r.dueDate < today;
exports.isOverdue = isOverdue;
/**
 * Phân bổ thanh toán: khoản thủ công (nếu có) trước; phần còn lại vào nợ CŨ trước (periodKey nhỏ → lớn, rồi dueDate),
 * dư → credit. Ném Error (thông điệp tiếng Việt) nếu phân bổ thủ công sai.
 * Ví dụ: nợ cũ 500.000 + kỳ mới 3.600.000, thu 2.000.000 → [500.000 cũ, 1.500.000 mới], credit 0.
 */
function allocatePayment(amount, open, manual = []) {
    if (!Number.isSafeInteger(amount) || amount <= 0)
        throw new Error('Số tiền phải là số nguyên đồng lớn hơn 0.');
    const bal = new Map(open.map((r) => [r.id, r.balance]));
    const out = new Map();
    let remaining = amount;
    let manualSum = 0;
    for (const m of manual) {
        if (!Number.isSafeInteger(m.amount) || m.amount <= 0)
            throw new Error('Số tiền phân bổ phải là số nguyên đồng lớn hơn 0.');
        const b = bal.get(m.receivableId);
        if (b === undefined)
            throw new Error('Khoản phải thu không thuộc trẻ này hoặc chưa phát hành.');
        if (m.amount > b)
            throw new Error('Số tiền phân bổ vượt quá số còn nợ của khoản phải thu.');
        bal.set(m.receivableId, b - m.amount);
        out.set(m.receivableId, (out.get(m.receivableId) ?? 0) + m.amount);
        manualSum += m.amount;
    }
    if (manualSum > amount)
        throw new Error('Tổng phân bổ vượt quá số tiền thực nhận.');
    remaining -= manualSum;
    const order = [...open].sort((a, b) => a.periodKey.localeCompare(b.periodKey) || (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.id.localeCompare(b.id));
    for (const r of order) {
        if (remaining <= 0)
            break;
        const b = bal.get(r.id) ?? 0;
        if (b <= 0)
            continue;
        const take = Math.min(b, remaining);
        out.set(r.id, (out.get(r.id) ?? 0) + take);
        remaining -= take;
    }
    const allocations = [...out.entries()].map(([receivableId, a]) => ({ receivableId, amount: a }));
    return { allocations, credit: remaining, allocated: amount - remaining };
}
/** Giá trị suất ăn hoàn: mỗi suất chỉ hoàn một lần (đếm các suất không còn billable, chưa hoàn). */
function mealRefundAmount(count, unitPrice) { return count * unitPrice; }
