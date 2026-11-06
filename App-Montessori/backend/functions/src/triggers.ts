// Việc định kỳ (Cloud Scheduler) — region asia-southeast1.
//  - expireGrants: tính lại permsByCampus khi grant bắt đầu/hết hạn
//  - markOverdueReceivables: đánh dấu khoản phải thu quá hạn từ dueDate
//  - sendScheduledNotifications: gửi thông báo đã hẹn giờ (dùng logic gửi của modules/comms)
//  - alertChildrenStillAtSchool: sau giờ đóng cửa, cảnh báo người trực khi còn trẻ chưa trả
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, REGION, Timestamp } from './core/firebase';
import { buildCtx } from './core/context';
import { dayKeyOf, hhmmOf } from './core/store';
import type { Ctx, Member } from './core/types';
import type { Grant } from './core/permissions';
import { computeMemberPerms } from './modules/util';
import { dispatchDueNotifications } from './modules/comms';
import { rcvState } from './lib/finance-common';
import { sendSystemNotification } from './lib/notify';
import { timeToMin } from './lib/time';

const TZ = 'Asia/Ho_Chi_Minh';
const OPTS = { region: REGION, timeZone: TZ, memory: '512MiB' as const, timeoutSeconds: 540 };

/** Ctx hệ thống (không phải request của người dùng) để tái sử dụng logic của module. */
export function systemCtx(orgId: string): Ctx {
  const member = { uid: 'system', displayName: 'Hệ thống', kind: 'owner', status: 'active', grants: [], childIds: [], permsByCampus: {}, version: 1 } as unknown as Member;
  return buildCtx({ uid: 'system', token: {}, orgId, loadMember: false }, member, false);
}

async function orgIds(): Promise<string[]> {
  return (await db.collection('orgs').select('status').get()).docs.filter((d) => d.data().status !== 'suspended').map((d) => d.id);
}

// ---------------------------------------------------------------- expireGrants (hằng giờ)
export async function runExpireGrants(): Promise<number> {
  let changed = 0;
  for (const orgId of await orgIds()) {
    const ctx = systemCtx(orgId);
    const snap = await ctx.col('members').where('kind', '==', 'staff').get();
    for (const d of snap.docs) {
      const m = d.data();
      const grants = ((m.grants ?? []) as Grant[]);
      if (!grants.some((g) => g.validFrom || g.validTo)) continue; // chỉ grant có thời hạn mới đổi theo thời gian
      const { permsByCampus, permsAny } = await computeMemberPerms(ctx, 'staff', grants);
      if (JSON.stringify(permsByCampus) === JSON.stringify(m.permsByCampus ?? {})) continue;
      await d.ref.update({ permsByCampus, permsAny, permsRecomputedAt: Timestamp.now(), updatedAt: Timestamp.now(), version: (m.version ?? 0) + 1 });
      changed++;
    }
  }
  return changed;
}
export const expireGrants = onSchedule({ ...OPTS, schedule: 'every 60 minutes' }, async () => {
  const n = await runExpireGrants();
  console.log(`expireGrants: cập nhật ${n} member`);
});

// ---------------------------------------------------------------- markOverdueReceivables (hằng ngày)
export async function runMarkOverdue(now = new Date()): Promise<number> {
  let n = 0;
  for (const orgId of await orgIds()) {
    const ctx = systemCtx(orgId);
    const campuses = new Map((await ctx.col('campuses').get()).docs.map((c) => [c.id, c.data()]));
    const rs = await ctx.col('receivables').where('status', 'in', ['unpaid', 'partially_paid']).get();
    const perCampus = new Map<string, number>(); const amounts = new Map<string, number>();
    let batch = db.batch(); let inBatch = 0;
    for (const d of rs.docs) {
      const r = d.data();
      const today = dayKeyOf(now, (campuses.get(r.campusId)?.timezone as string | undefined) ?? TZ);
      if (!r.dueDate || r.dueDate >= today || !(r.balance > 0)) continue;
      const st = rcvState(r, {}, today);
      // quá hạn tính từ dueDate; khoản đã đóng một phần giữ partially_paid nhưng gắn cờ isOverdue
      batch.update(d.ref, { status: r.status === 'unpaid' ? 'overdue' : r.status, isOverdue: true, overdueSince: r.overdueSince ?? r.dueDate, updatedAt: Timestamp.now(), version: (r.version ?? 0) + 1 });
      void st;
      perCampus.set(r.campusId, (perCampus.get(r.campusId) ?? 0) + 1); amounts.set(r.campusId, (amounts.get(r.campusId) ?? 0) + r.balance);
      n++;
      if (++inBatch >= 400) { await batch.commit(); batch = db.batch(); inBatch = 0; }
    }
    if (inBatch) await batch.commit();
    for (const [campusId, count] of perCampus) {
      const day = dayKeyOf(now, (campuses.get(campusId)?.timezone as string | undefined) ?? TZ);
      await ctx.doc(`alerts/overdue_${campusId}_${day}`).set({ type: 'overdue_receivables', severity: 'warning', campusId, title: 'Khoản phải thu quá hạn', message: `${count} khoản vừa chuyển quá hạn, tổng còn ${amounts.get(campusId)}.`, count, amount: amounts.get(campusId), recipientPerm: 'payments.read', status: 'open', createdAt: Timestamp.now(), updatedAt: Timestamp.now(), version: 1 }, { merge: true });
    }
  }
  return n;
}
export const markOverdueReceivables = onSchedule({ ...OPTS, schedule: '5 1 * * *' }, async () => {
  console.log(`markOverdueReceivables: ${await runMarkOverdue()} khoản`);
});

// ---------------------------------------------------------------- sendScheduledNotifications (5 phút)
export const sendScheduledNotifications = onSchedule({ ...OPTS, schedule: 'every 5 minutes' }, async () => {
  console.log(`sendScheduledNotifications: ${await dispatchDueNotifications()} thông báo`);
});

// ---------------------------------------------------------------- alertChildrenStillAtSchool
export async function runStillAtSchool(now = new Date()): Promise<number> {
  let created = 0;
  for (const orgId of await orgIds()) {
    const ctx = systemCtx(orgId);
    const campuses = (await ctx.col('campuses').where('status', '==', 'active').get()).docs;
    for (const c of campuses) {
      const cd = c.data(); const tz = (cd.timezone as string | undefined) ?? TZ;
      const close = (cd.closeTime as string | undefined) ?? '17:30';
      const nowMin = timeToMin(hhmmOf(now, tz));
      if (nowMin < timeToMin(close) + 5 || nowMin > timeToMin(close) + 360) continue; // chỉ sau giờ đóng cửa (tối đa 6 giờ)
      const day = dayKeyOf(now, tz);
      const hs = (await ctx.col('handovers').where('campusId', '==', c.id).where('dayKey', '==', day).get()).docs.filter((h) => h.data().state === 'received' && !h.data().pickedUpAt);
      const aref = ctx.doc(`alerts/still_${c.id}_${day}`);
      const ex = await aref.get();
      if (!hs.length) {
        if (ex.exists && ex.data()?.status === 'open') await aref.update({ status: 'resolved', resolvedAt: Timestamp.now(), updatedAt: Timestamp.now() });
        continue;
      }
      const childIds = hs.map((h) => h.data().childId as string);
      await aref.set({
        type: 'children_at_school', severity: 'critical', campusId: c.id, title: 'Trẻ còn ở trường sau giờ đóng cửa',
        message: `Còn ${childIds.length} trẻ chưa được trả sau ${close}. Mở danh sách cần bàn giao.`, count: childIds.length, childIds, dayKey: day,
        recipientPerm: 'handover.write', status: ex.exists && ex.data()?.status === 'ack' ? 'ack' : 'open', createdAt: ex.data()?.createdAt ?? Timestamp.now(), updatedAt: Timestamp.now(), version: (ex.data()?.version ?? 0) + 1,
      }, { merge: true });
      if (!ex.exists) {
        created++;
        // Người nhận: giáo viên trực (handover.write) và quản lý cơ sở (campus.manage) tại cơ sở này.
        const ms = (await ctx.col('members').where('kind', 'in', ['staff', 'owner']).get()).docs.filter((m) => {
          const p = (m.data().permsByCampus ?? {}) as Record<string, string[]>;
          const has = (perm: string) => (p['*'] ?? []).includes(perm) || (p[c.id] ?? []).includes(perm);
          return m.data().status === 'active' && (has('handover.write') || has('campus.manage'));
        }).map((m) => m.id);
        await sendSystemNotification(ctx, { campusId: c.id, title: 'Cảnh báo: trẻ còn ở trường', body: `Còn ${childIds.length} trẻ chưa được trả sau giờ đóng cửa.`, category: 'alert', uids: ms, refCollection: 'alerts', refId: aref.id }).catch(() => undefined);
      }
    }
  }
  return created;
}
export const alertChildrenStillAtSchool = onSchedule({ ...OPTS, schedule: 'every 10 minutes' }, async () => {
  console.log(`alertChildrenStillAtSchool: ${await runStillAtSchool()} cảnh báo mới`);
});
