"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mealCancelledFor = mealCancelledFor;
exports.fefoPlan = fefoPlan;
exports.stockValue = stockValue;
exports.allergyConflicts = allergyConflicts;
// Tính toán vận hành THUẦN: chốt suất ăn, FEFO kho, dị ứng thực đơn.
const time_1 = require("./time");
/**
 * Suất ăn của `mealDay` có được HỦY (không tính phí) khi nghỉ được duyệt?
 * Điều kiện: đơn nghỉ được gửi VÀ được duyệt trước giờ chốt `cutoff` (HH:mm) của ngày ăn.
 * Sau giờ chốt vẫn tính tiền vì bếp đã chuẩn bị. Ngày ăn sau ngày gửi/duyệt → luôn trước giờ chốt.
 */
function mealCancelledFor(mealDay, cutoff, submittedAt, decidedAt, tz = time_1.VN_TZ) {
    if (!decidedAt)
        return false;
    const cut = (0, time_1.timeToMin)(cutoff || '08:00');
    const before = (d) => {
        if (!d)
            return true;
        const l = (0, time_1.localDayMinutes)(d, tz);
        if (l.day < mealDay)
            return true;
        if (l.day > mealDay)
            return false;
        return l.minutes <= cut;
    };
    return before(submittedAt) && before(decidedAt);
}
const q3 = (n) => Math.round(n * 1000) / 1000; // số lượng kho: làm tròn 3 chữ số (không phải tiền)
/** FEFO: lấy lô sắp hết hạn trước; bỏ qua lô đã hết hạn tại `today`. Trả phần thiếu (shortage) nếu tồn không đủ. */
function fefoPlan(lots, qty, today) {
    const usable = lots
        .filter((l) => l.qtyRemaining > 0 && l.status !== 'closed')
        .sort((a, b) => (a.expiry ?? '9999-12-31').localeCompare(b.expiry ?? '9999-12-31') || (a.receivedAtMs ?? 0) - (b.receivedAtMs ?? 0) || a.id.localeCompare(b.id));
    let need = q3(qty);
    const picks = [];
    let expiredSkipped = 0;
    for (const l of usable) {
        if (l.expiry && l.expiry < today) {
            expiredSkipped += l.qtyRemaining;
            continue;
        }
        if (need <= 0)
            break;
        const take = q3(Math.min(l.qtyRemaining, need));
        picks.push({ lotId: l.id, qty: take });
        need = q3(need - take);
    }
    return { picks, shortage: need > 0 ? need : 0, expiredSkipped };
}
/** Giá trị tiền của lượng hàng = số lượng × đơn giá, làm tròn đồng. */
function stockValue(qty, unitCost) { return Math.round(qty * unitCost); }
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').trim();
/** Món có chứa chất gây dị ứng/trẻ không dùng được? So khớp không dấu, theo từ khóa chứa nhau. */
function allergyConflicts(dishAllergens, dishName, childAllergies) {
    const hits = [];
    const tags = dishAllergens.map(norm);
    const name = norm(dishName);
    for (const a of childAllergies) {
        const n = norm(a);
        if (!n)
            continue;
        if (tags.some((t) => t === n || t.includes(n) || n.includes(t)) || name.includes(n))
            hits.push(a);
    }
    return hits;
}
