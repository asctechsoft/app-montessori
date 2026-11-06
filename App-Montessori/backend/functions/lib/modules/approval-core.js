"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCancelHook = registerCancelHook;
exports.decideApprovalCore = decideApprovalCore;
exports.cancelApprovalCore = cancelApprovalCore;
const approvals_1 = require("../core/approvals");
const errors_1 = require("../core/errors");
const firebase_1 = require("../core/firebase");
const store_1 = require("../core/store");
const util_1 = require("./util");
const LOCK_MS = 120_000;
const cancelHooks = new Map();
/** Module nghiệp vụ đăng ký việc cần làm khi yêu cầu bị hủy (vd transfer → hủy bản ghi chuyển). */
function registerCancelHook(type, fn) {
    cancelHooks.set(type, fn);
}
/**
 * Xử lý quyết định phê duyệt (dùng chung cho approval.decide và các action tắt như transfer.decide).
 * - Kiểm tra quyền tại campus của yêu cầu; chặn tự duyệt (trừ owner khi handler cho phép).
 * - Khóa mềm để handler chỉ chạy một lần; gửi lại cùng quyết định trả kết quả cũ (idempotent).
 */
async function decideApprovalCore(ctx, id, decision, note) {
    if (decision !== 'approved' && decision !== 'rejected')
        (0, errors_1.fail)('VALIDATION', 'Quyết định phải là approved hoặc rejected.', { fieldErrors: { decision: 'Giá trị không hợp lệ.' } });
    const ref = ctx.doc(`approvals/${id}`);
    const ap = (await (0, store_1.getOr404)(ref, 'Yêu cầu phê duyệt'));
    const h = (0, approvals_1.getApprovalHandler)(ap.type);
    // quyền: tại campus của yêu cầu (campusId null → toàn org)
    if (!ctx.can(h.perm, ap.campusId ?? null)) {
        await ctx.audit({ action: 'approval.decide', collection: 'approvals', docId: id, result: 'denied', campusId: ap.campusId, reason: h.perm });
        (0, errors_1.denied)('Bạn không có quyền duyệt yêu cầu này.');
    }
    if (ap.requestedBy === ctx.uid) {
        const ownerOk = h.allowSelfApprove === true && (ctx.member?.kind === 'owner' || ctx.platformAdmin);
        if (!ownerOk)
            (0, errors_1.denied)('Không được tự duyệt yêu cầu do chính mình lập.');
    }
    if (decision === 'rejected' && !(0, util_1.s)(note))
        (0, errors_1.fail)('VALIDATION', 'Vui lòng nhập lý do từ chối.', { fieldErrors: { note: 'Bắt buộc nhập.' } });
    if (ap.status !== 'pending') {
        if (ap.status === decision)
            return { ...ap, alreadyDecided: true };
        (0, errors_1.fail)('INVALID_STATE', 'Yêu cầu đã được xử lý trước đó.', { status: ap.status });
    }
    // lấy khóa
    await ctx.tx(async (t) => {
        const sn = await t.get(ref);
        const d = sn.data();
        if (d.status !== 'pending')
            (0, errors_1.fail)('INVALID_STATE', 'Yêu cầu đã được xử lý trước đó.', { status: d.status });
        if (d.lock && ctx.now.getTime() - d.lock.at.toMillis() < LOCK_MS && d.lock.by !== ctx.requestId) {
            (0, errors_1.fail)('CONFLICT', 'Yêu cầu đang được xử lý bởi người khác.');
        }
        t.update(ref, { lock: { by: ctx.requestId, at: firebase_1.Timestamp.fromDate(ctx.now) } });
    });
    let result;
    try {
        result = decision === 'approved' ? await h.onApprove(ctx, ap, note) : await (h.onReject ? h.onReject(ctx, ap, note) : Promise.resolve(null));
    }
    catch (e) {
        await ref.update({ lock: null }).catch(() => undefined);
        throw e;
    }
    const patch = {
        status: decision,
        decidedBy: ctx.uid,
        decidedByName: ctx.member?.displayName ?? ctx.uid,
        decidedAt: firebase_1.Timestamp.fromDate(ctx.now),
        decisionNote: (0, util_1.s)(note) || null,
        lock: null,
        updatedAt: firebase_1.Timestamp.fromDate(ctx.now),
        updatedBy: ctx.uid,
        version: ap.version + 1,
    };
    await ref.update(patch);
    await ctx.audit({
        action: `approval.${decision}`, collection: 'approvals', docId: id, campusId: ap.campusId,
        before: { status: 'pending', type: ap.type, summary: ap.summary }, after: { status: decision }, reason: (0, util_1.s)(note) || undefined,
    });
    return { ...ap, ...patch, result: result ?? null };
}
async function cancelApprovalCore(ctx, id, reason) {
    const ref = ctx.doc(`approvals/${id}`);
    const ap = (await (0, store_1.getOr404)(ref, 'Yêu cầu phê duyệt'));
    const h = (0, approvals_1.getApprovalHandler)(ap.type);
    const isOwnerOfReq = ap.requestedBy === ctx.uid;
    if (!isOwnerOfReq && !ctx.can(h.perm, ap.campusId ?? null))
        (0, errors_1.denied)('Bạn không có quyền hủy yêu cầu này.');
    if (ap.status === 'cancelled')
        return { ...ap, alreadyDecided: true };
    if (ap.status !== 'pending')
        (0, errors_1.fail)('INVALID_STATE', 'Chỉ hủy được yêu cầu đang chờ duyệt.', { status: ap.status });
    const hook = cancelHooks.get(ap.type);
    if (hook)
        await hook(ctx, ap, reason);
    const patch = {
        status: 'cancelled', cancelledBy: ctx.uid, cancelledAt: firebase_1.Timestamp.fromDate(ctx.now), cancelReason: (0, util_1.s)(reason) || null,
        updatedAt: firebase_1.Timestamp.fromDate(ctx.now), updatedBy: ctx.uid, version: ap.version + 1,
    };
    await ref.update(patch);
    await ctx.audit({ action: 'approval.cancel', collection: 'approvals', docId: id, campusId: ap.campusId, before: { status: 'pending' }, after: { status: 'cancelled' }, reason: (0, util_1.s)(reason) || undefined });
    return { ...ap, ...patch };
}
