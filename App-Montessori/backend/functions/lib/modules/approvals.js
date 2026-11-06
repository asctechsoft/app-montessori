"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actions = void 0;
const util_1 = require("./util");
const store_1 = require("../core/store");
const errors_1 = require("../core/errors");
const approval_core_1 = require("./approval-core");
// Handler cho các type của BE-1 đăng ký ngay trong module sở hữu nghiệp vụ:
//   attendance_correction → attendance.ts, transfer + enrollment_exception → children.ts, notification → comms.ts.
// (BE-2 đăng ký các type tài chính/công/kho từ module của họ.) approval.decide tra handler theo type.
const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];
exports.actions = {
    /**
     * Danh sách phê duyệt đã lọc theo quyền phía máy chủ (rules không thể chứng minh requiredPerm cho truy vấn list).
     * Thấy yêu cầu khi: là người lập, hoặc platformAdmin, hoặc có approvals.read VÀ requiredPerm của yêu cầu tại campus đó.
     */
    'approval.list': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const status = (0, util_1.s)(b.status) || 'pending';
            if (status !== 'all' && !STATUSES.includes(status))
                (0, errors_1.invalid)({ status: 'Trạng thái không hợp lệ.' });
            const type = (0, util_1.s)(b.type);
            const campusId = (0, util_1.s)(b.campusId);
            const limit = Math.min(Math.max(Math.trunc(Number(b.limit)) || 100, 1), 200);
            const out = [];
            let last;
            for (let page = 0; page < 10 && out.length < limit; page++) {
                let q = ctx.col('approvals');
                if (status !== 'all')
                    q = q.where('status', '==', status);
                if (type)
                    q = q.where('type', '==', type);
                q = q.orderBy('createdAt', 'desc').limit(100);
                if (last)
                    q = q.startAfter(last);
                const snap = await q.get();
                for (const d of snap.docs) {
                    const a = d.data();
                    const cid = a.campusId ?? null;
                    if (campusId && cid !== campusId)
                        continue;
                    const visible = ctx.platformAdmin || a.requestedBy === ctx.uid
                        || (ctx.can('approvals.read', cid) && ctx.can(String(a.requiredPerm ?? ''), cid));
                    if (!visible)
                        continue;
                    const { lock, ...rest } = a;
                    void lock;
                    out.push((0, store_1.serialize)({ id: d.id, ...rest }));
                    if (out.length >= limit)
                        break;
                }
                if (snap.size < 100)
                    break;
                last = snap.docs[snap.docs.length - 1];
            }
            return { items: out, truncated: out.length >= limit };
        },
    },
    'approval.decide': {
        scope: 'org',
        idempotent: false,
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            return (0, approval_core_1.decideApprovalCore)(ctx, (0, util_1.requireId)(b.id, 'id'), (0, util_1.s)(b.decision), (0, util_1.s)(b.note));
        },
    },
    'approval.cancel': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            return (0, approval_core_1.cancelApprovalCore)(ctx, (0, util_1.requireId)(b.id, 'id'), (0, util_1.s)(b.reason ?? b.note));
        },
    },
};
