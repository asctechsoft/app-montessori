"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.alertChildrenStillAtSchool = exports.sendScheduledNotifications = exports.markOverdueReceivables = exports.expireGrants = void 0;
exports.systemCtx = systemCtx;
exports.runExpireGrants = runExpireGrants;
exports.runMarkOverdue = runMarkOverdue;
exports.runStillAtSchool = runStillAtSchool;
// Việc định kỳ (Cloud Scheduler) — region asia-southeast1.
//  - expireGrants: tính lại permsByCampus khi grant bắt đầu/hết hạn
//  - markOverdueReceivables: đánh dấu khoản phải thu quá hạn từ dueDate
//  - sendScheduledNotifications: gửi thông báo đã hẹn giờ (dùng logic gửi của modules/comms)
//  - alertChildrenStillAtSchool: sau giờ đóng cửa, cảnh báo người trực khi còn trẻ chưa trả
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_1 = require("./core/firebase");
const context_1 = require("./core/context");
const store_1 = require("./core/store");
const util_1 = require("./modules/util");
const comms_1 = require("./modules/comms");
const finance_common_1 = require("./lib/finance-common");
const notify_1 = require("./lib/notify");
const time_1 = require("./lib/time");
const TZ = 'Asia/Ho_Chi_Minh';
const OPTS = { region: firebase_1.REGION, timeZone: TZ, memory: '512MiB', timeoutSeconds: 540 };
/** Ctx hệ thống (không phải request của người dùng) để tái sử dụng logic của module. */
function systemCtx(orgId) {
    const member = { uid: 'system', displayName: 'Hệ thống', kind: 'owner', status: 'active', grants: [], childIds: [], permsByCampus: {}, version: 1 };
    return (0, context_1.buildCtx)({ uid: 'system', token: {}, orgId, loadMember: false }, member, false);
}
async function orgIds() {
    return (await firebase_1.db.collection('orgs').select('status').get()).docs.filter((d) => d.data().status !== 'suspended').map((d) => d.id);
}
// ---------------------------------------------------------------- expireGrants (hằng giờ)
async function runExpireGrants() {
    let changed = 0;
    for (const orgId of await orgIds()) {
        const ctx = systemCtx(orgId);
        const snap = await ctx.col('members').where('kind', '==', 'staff').get();
        for (const d of snap.docs) {
            const m = d.data();
            const grants = (m.grants ?? []);
            if (!grants.some((g) => g.validFrom || g.validTo))
                continue; // chỉ grant có thời hạn mới đổi theo thời gian
            const { permsByCampus, permsAny } = await (0, util_1.computeMemberPerms)(ctx, 'staff', grants);
            if (JSON.stringify(permsByCampus) === JSON.stringify(m.permsByCampus ?? {}))
                continue;
            await d.ref.update({ permsByCampus, permsAny, permsRecomputedAt: firebase_1.Timestamp.now(), updatedAt: firebase_1.Timestamp.now(), version: (m.version ?? 0) + 1 });
            changed++;
        }
    }
    return changed;
}
exports.expireGrants = (0, scheduler_1.onSchedule)({ ...OPTS, schedule: 'every 60 minutes' }, async () => {
    const n = await runExpireGrants();
    console.log(`expireGrants: cập nhật ${n} member`);
});
// ---------------------------------------------------------------- markOverdueReceivables (hằng ngày)
async function runMarkOverdue(now = new Date()) {
    let n = 0;
    for (const orgId of await orgIds()) {
        const ctx = systemCtx(orgId);
        const campuses = new Map((await ctx.col('campuses').get()).docs.map((c) => [c.id, c.data()]));
        const rs = await ctx.col('receivables').where('status', 'in', ['unpaid', 'partially_paid']).get();
        const perCampus = new Map();
        const amounts = new Map();
        let batch = firebase_1.db.batch();
        let inBatch = 0;
        for (const d of rs.docs) {
            const r = d.data();
            const today = (0, store_1.dayKeyOf)(now, campuses.get(r.campusId)?.timezone ?? TZ);
            if (!r.dueDate || r.dueDate >= today || !(r.balance > 0))
                continue;
            const st = (0, finance_common_1.rcvState)(r, {}, today);
            // quá hạn tính từ dueDate; khoản đã đóng một phần giữ partially_paid nhưng gắn cờ isOverdue
            batch.update(d.ref, { status: r.status === 'unpaid' ? 'overdue' : r.status, isOverdue: true, overdueSince: r.overdueSince ?? r.dueDate, updatedAt: firebase_1.Timestamp.now(), version: (r.version ?? 0) + 1 });
            void st;
            perCampus.set(r.campusId, (perCampus.get(r.campusId) ?? 0) + 1);
            amounts.set(r.campusId, (amounts.get(r.campusId) ?? 0) + r.balance);
            n++;
            if (++inBatch >= 400) {
                await batch.commit();
                batch = firebase_1.db.batch();
                inBatch = 0;
            }
        }
        if (inBatch)
            await batch.commit();
        for (const [campusId, count] of perCampus) {
            const day = (0, store_1.dayKeyOf)(now, campuses.get(campusId)?.timezone ?? TZ);
            await ctx.doc(`alerts/overdue_${campusId}_${day}`).set({ type: 'overdue_receivables', severity: 'warning', campusId, title: 'Khoản phải thu quá hạn', message: `${count} khoản vừa chuyển quá hạn, tổng còn ${amounts.get(campusId)}.`, count, amount: amounts.get(campusId), recipientPerm: 'payments.read', status: 'open', createdAt: firebase_1.Timestamp.now(), updatedAt: firebase_1.Timestamp.now(), version: 1 }, { merge: true });
        }
    }
    return n;
}
exports.markOverdueReceivables = (0, scheduler_1.onSchedule)({ ...OPTS, schedule: '5 1 * * *' }, async () => {
    console.log(`markOverdueReceivables: ${await runMarkOverdue()} khoản`);
});
// ---------------------------------------------------------------- sendScheduledNotifications (5 phút)
exports.sendScheduledNotifications = (0, scheduler_1.onSchedule)({ ...OPTS, schedule: 'every 5 minutes' }, async () => {
    console.log(`sendScheduledNotifications: ${await (0, comms_1.dispatchDueNotifications)()} thông báo`);
});
// ---------------------------------------------------------------- alertChildrenStillAtSchool
async function runStillAtSchool(now = new Date()) {
    let created = 0;
    for (const orgId of await orgIds()) {
        const ctx = systemCtx(orgId);
        const campuses = (await ctx.col('campuses').where('status', '==', 'active').get()).docs;
        for (const c of campuses) {
            const cd = c.data();
            const tz = cd.timezone ?? TZ;
            const close = cd.closeTime ?? '17:30';
            const nowMin = (0, time_1.timeToMin)((0, store_1.hhmmOf)(now, tz));
            if (nowMin < (0, time_1.timeToMin)(close) + 5 || nowMin > (0, time_1.timeToMin)(close) + 360)
                continue; // chỉ sau giờ đóng cửa (tối đa 6 giờ)
            const day = (0, store_1.dayKeyOf)(now, tz);
            const hs = (await ctx.col('handovers').where('campusId', '==', c.id).where('dayKey', '==', day).get()).docs.filter((h) => h.data().state === 'received' && !h.data().pickedUpAt);
            const aref = ctx.doc(`alerts/still_${c.id}_${day}`);
            const ex = await aref.get();
            if (!hs.length) {
                if (ex.exists && ex.data()?.status === 'open')
                    await aref.update({ status: 'resolved', resolvedAt: firebase_1.Timestamp.now(), updatedAt: firebase_1.Timestamp.now() });
                continue;
            }
            const childIds = hs.map((h) => h.data().childId);
            await aref.set({
                type: 'children_at_school', severity: 'critical', campusId: c.id, title: 'Trẻ còn ở trường sau giờ đóng cửa',
                message: `Còn ${childIds.length} trẻ chưa được trả sau ${close}. Mở danh sách cần bàn giao.`, count: childIds.length, childIds, dayKey: day,
                recipientPerm: 'handover.write', status: ex.exists && ex.data()?.status === 'ack' ? 'ack' : 'open', createdAt: ex.data()?.createdAt ?? firebase_1.Timestamp.now(), updatedAt: firebase_1.Timestamp.now(), version: (ex.data()?.version ?? 0) + 1,
            }, { merge: true });
            if (!ex.exists) {
                created++;
                // Người nhận: giáo viên trực (handover.write) và quản lý cơ sở (campus.manage) tại cơ sở này.
                const ms = (await ctx.col('members').where('kind', 'in', ['staff', 'owner']).get()).docs.filter((m) => {
                    const p = (m.data().permsByCampus ?? {});
                    const has = (perm) => (p['*'] ?? []).includes(perm) || (p[c.id] ?? []).includes(perm);
                    return m.data().status === 'active' && (has('handover.write') || has('campus.manage'));
                }).map((m) => m.id);
                await (0, notify_1.sendSystemNotification)(ctx, { campusId: c.id, title: 'Cảnh báo: trẻ còn ở trường', body: `Còn ${childIds.length} trẻ chưa được trả sau giờ đóng cửa.`, category: 'alert', uids: ms, refCollection: 'alerts', refId: aref.id }).catch(() => undefined);
            }
        }
    }
    return created;
}
exports.alertChildrenStillAtSchool = (0, scheduler_1.onSchedule)({ ...OPTS, schedule: 'every 10 minutes' }, async () => {
    console.log(`alertChildrenStillAtSchool: ${await runStillAtSchool()} cảnh báo mới`);
});
