"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ledgerData = ledgerData;
// Sổ quỹ: mọi tiền thu/chi thực tế ghi một dòng cashLedger (chỉ thêm, không sửa; đảo bằng dòng mới).
const firebase_1 = require("../core/firebase");
const store_1 = require("../core/store");
/** Dữ liệu dòng sổ quỹ (amount luôn dương; dir quyết định chiều). Dùng làm tham số cho batch/tx.set. */
function ledgerData(ctx, i) {
    const at = i.at ?? ctx.now;
    return {
        campusId: i.campusId, dir: i.dir, amount: i.amount, channel: i.channel, refType: i.refType, refId: i.refId,
        childId: i.childId ?? null, at: firebase_1.Timestamp.fromDate(at), dayKey: (0, store_1.dayKeyOf)(at, i.tz), note: i.note ?? null,
        ...ctx.metaCreate(),
    };
}
