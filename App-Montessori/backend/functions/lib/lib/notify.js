"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUSH_TEXT = void 0;
exports.pushToUsers = pushToUsers;
exports.parentUidsOfChildren = parentUidsOfChildren;
exports.sendSystemNotification = sendSystemNotification;
// Gửi thông báo hệ thống (không qua quy trình soạn/duyệt): dùng cho phát hành học phí, cảnh báo...
// Push FCM KHÔNG chứa nội dung chi tiết (CONTRACT §6): chỉ "Có cập nhật mới từ nhà trường".
const firebase_1 = require("../core/firebase");
const common_1 = require("./common");
exports.PUSH_TEXT = 'Có cập nhật mới từ nhà trường';
/** Gửi push tới danh sách uid (không ném lỗi). */
async function pushToUsers(uids) {
    try {
        const tokens = [];
        for (const uid of uids) {
            const s = await firebase_1.db.collection(`users/${uid}/devices`).get();
            s.forEach((d) => { const t = d.data().fcmToken; if (typeof t === 'string' && t)
                tokens.push(t); });
        }
        if (!tokens.length)
            return;
        for (let i = 0; i < tokens.length; i += 500) {
            await (0, firebase_1.messaging)().sendEachForMulticast({ tokens: tokens.slice(i, i + 500), notification: { title: 'Mầm non', body: exports.PUSH_TEXT } });
        }
    }
    catch (e) {
        console.warn('push failed', e.message);
    }
}
/** Phụ huynh (member kind=parent, active) của các trẻ; loại người bị tắt quyền xem học phí khi cần. */
async function parentUidsOfChildren(ctx, childIds, opts = {}) {
    const out = new Map(); // uid -> childIds
    for (const childId of [...new Set(childIds)]) {
        const ms = (0, common_1.asDocs)(await ctx.col('members').where('childIds', 'array-contains', childId).get());
        let blocked = new Set();
        if (opts.needViewFees) {
            const links = (0, common_1.asDocs)(await ctx.col('guardianLinks').where('childId', '==', childId).get());
            blocked = new Set(links.filter((l) => l.uid && l.perms?.viewFees === false).map((l) => l.uid));
        }
        for (const m of ms) {
            if (m.kind !== 'parent' || m.status !== 'active' || blocked.has(m.id))
                continue;
            out.set(m.id, [...(out.get(m.id) ?? []), childId]);
        }
    }
    return out;
}
/** Tạo thông báo + biên nhận cho các uid, rồi push (không nội dung nhạy cảm). Trả notificationId. */
async function sendSystemNotification(ctx, n) {
    if (!n.uids.length)
        return null;
    const ref = ctx.col('notifications').doc();
    const now = firebase_1.Timestamp.now();
    await ref.set({
        title: n.title, body: n.body, category: n.category, campusId: n.campusId, status: 'sent', system: true,
        scope: { type: 'users', ids: n.uids }, requireAck: false, sentAt: now, recipientCount: n.uids.length,
        refCollection: n.refCollection ?? null, refId: n.refId ?? null,
        createdAt: now, updatedAt: now, createdBy: ctx.uid, updatedBy: ctx.uid, version: 1,
    });
    for (let i = 0; i < n.uids.length; i += 400) {
        const b = firebase_1.db.batch();
        for (const uid of n.uids.slice(i, i + 400)) {
            b.set(ctx.col('notificationReceipts').doc(`${ref.id}_${uid}`), {
                notificationId: ref.id, notifId: ref.id, uid, campusId: n.campusId, title: n.title, category: n.category, requireAck: false, sentAt: now,
                status: 'delivered', deliveredAt: now, readAt: null, ackAt: null,
                createdAt: now, updatedAt: now, createdBy: ctx.uid, updatedBy: ctx.uid, version: 1,
            });
        }
        await b.commit();
    }
    await pushToUsers(n.uids);
    return ref.id;
}
