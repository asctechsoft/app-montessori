// Gửi thông báo hệ thống (không qua quy trình soạn/duyệt): dùng cho phát hành học phí, cảnh báo...
// Push FCM KHÔNG chứa nội dung chi tiết (CONTRACT §6): chỉ "Có cập nhật mới từ nhà trường".
import { db, messaging, Timestamp } from '../core/firebase';
import type { Ctx } from '../core/types';
import { asDocs } from './common';

export const PUSH_TEXT = 'Có cập nhật mới từ nhà trường';

/** Gửi push tới danh sách uid (không ném lỗi). */
export async function pushToUsers(uids: string[]): Promise<void> {
  try {
    const tokens: string[] = [];
    for (const uid of uids) {
      const s = await db.collection(`users/${uid}/devices`).get();
      s.forEach((d) => { const t = d.data().fcmToken; if (typeof t === 'string' && t) tokens.push(t); });
    }
    if (!tokens.length) return;
    for (let i = 0; i < tokens.length; i += 500) {
      await messaging().sendEachForMulticast({ tokens: tokens.slice(i, i + 500), notification: { title: 'Mầm non', body: PUSH_TEXT } });
    }
  } catch (e) {
    console.warn('push failed', (e as Error).message);
  }
}

/** Phụ huynh (member kind=parent, active) của các trẻ; loại người bị tắt quyền xem học phí khi cần. */
export async function parentUidsOfChildren(ctx: Ctx, childIds: string[], opts: { needViewFees?: boolean } = {}): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(); // uid -> childIds
  for (const childId of [...new Set(childIds)]) {
    const ms = asDocs(await ctx.col('members').where('childIds', 'array-contains', childId).get());
    let blocked = new Set<string>();
    if (opts.needViewFees) {
      const links = asDocs(await ctx.col('guardianLinks').where('childId', '==', childId).get());
      blocked = new Set(links.filter((l) => l.uid && l.perms?.viewFees === false).map((l) => l.uid as string));
    }
    for (const m of ms) {
      if (m.kind !== 'parent' || m.status !== 'active' || blocked.has(m.id)) continue;
      out.set(m.id, [...(out.get(m.id) ?? []), childId]);
    }
  }
  return out;
}

/** Tạo thông báo + biên nhận cho các uid, rồi push (không nội dung nhạy cảm). Trả notificationId. */
export async function sendSystemNotification(
  ctx: Ctx,
  n: { campusId: string | null; title: string; body: string; category: string; uids: string[]; refCollection?: string; refId?: string },
): Promise<string | null> {
  if (!n.uids.length) return null;
  const ref = ctx.col('notifications').doc();
  const now = Timestamp.now();
  await ref.set({
    title: n.title, body: n.body, category: n.category, campusId: n.campusId, status: 'sent', system: true,
    scope: { type: 'users', ids: n.uids }, requireAck: false, sentAt: now, recipientCount: n.uids.length,
    refCollection: n.refCollection ?? null, refId: n.refId ?? null,
    createdAt: now, updatedAt: now, createdBy: ctx.uid, updatedBy: ctx.uid, version: 1,
  });
  for (let i = 0; i < n.uids.length; i += 400) {
    const b = db.batch();
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
