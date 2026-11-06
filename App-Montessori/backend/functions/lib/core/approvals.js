"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerApprovalHandler = registerApprovalHandler;
exports.getApprovalHandler = getApprovalHandler;
exports.createApproval = createApproval;
const errors_1 = require("./errors");
const store_1 = require("./store");
const handlers = new Map();
function registerApprovalHandler(type, h) {
    handlers.set(type, h);
}
function getApprovalHandler(type) {
    const h = handlers.get(type);
    if (!h)
        (0, errors_1.fail)('NOT_FOUND', `Loại phê duyệt chưa được hỗ trợ: ${type}`);
    return h;
}
/** Tạo yêu cầu phê duyệt (status=pending). Trả approvalId. requiredPerm lấy từ handler đã đăng ký. */
async function createApproval(ctx, a) {
    const h = getApprovalHandler(a.type);
    return (0, store_1.createDoc)(ctx, 'approvals', undefined, {
        type: a.type,
        campusId: a.campusId,
        summary: a.summary,
        impact: a.impact ?? {},
        refCollection: a.refCollection ?? null,
        refId: a.refId ?? null,
        payload: a.payload ?? {},
        requestedBy: ctx.uid,
        requestedByName: ctx.member?.displayName ?? ctx.uid,
        status: 'pending',
        requiredPerm: h.perm,
    });
}
