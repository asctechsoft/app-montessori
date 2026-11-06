"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actions = void 0;
exports.dispatchDueNotifications = dispatchDueNotifications;
const firebase_1 = require("../core/firebase");
const context_1 = require("../core/context");
const errors_1 = require("../core/errors");
const approvals_1 = require("../core/approvals");
const store_1 = require("../core/store");
const permissions_1 = require("../core/permissions");
const approval_core_1 = require("./approval-core");
const util_1 = require("./util");
const IN_SCHOOL = ['active', 'trial', 'on_leave'];
const CATEGORIES = ['general', 'event', 'urgent', 'finance', 'health', 'menu'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
function normScope(raw) {
    const sc = (0, util_1.asObj)(raw);
    const type = (0, util_1.s)(sc.type);
    if (!['org', 'campus', 'class', 'users'].includes(type))
        (0, errors_1.invalid)({ scope: 'Phạm vi gửi phải là org, campus, class hoặc users.' });
    const ids = [...new Set((0, util_1.asArr)(sc.ids).map(util_1.s).filter(Boolean))];
    for (const i of ids)
        if (!util_1.ID_PATTERN.test(i))
            (0, errors_1.invalid)({ scope: 'Mã trong phạm vi không hợp lệ.' });
    if (type !== 'org' && !ids.length)
        (0, errors_1.invalid)({ scope: 'Chọn ít nhất một đối tượng nhận.' });
    if (ids.length > 500)
        (0, errors_1.invalid)({ scope: 'Tối đa 500 đối tượng nhận.' });
    return { type: type, ids: type === 'org' ? [] : ids };
}
/** Resolve người nhận phía server + (tùy chọn) kiểm tra quyền gửi tại từng cơ sở liên quan. */
async function resolveScope(ctx, scope, checkAuth) {
    const req = (campusId) => { if (checkAuth && !ctx.can('notify.send', campusId))
        (0, errors_1.denied)('Bạn không có quyền gửi thông báo tới phạm vi này.'); };
    const members = (await ctx.col('members').where('status', '==', 'active').get()).docs.map((d) => ({ uid: d.id, ...d.data() }));
    const recipients = new Map();
    const campusIds = new Set();
    const notifyChildren = (m, childSet) => (m.childIds ?? []).some((c) => (!childSet || childSet.has(c)) && m.childPerms?.[c]?.notify !== false);
    if (scope.type === 'org') {
        req(null);
        (await ctx.col('campuses').select().get()).docs.forEach((d) => campusIds.add(d.id));
        for (const m of members) {
            if (m.kind === 'parent' ? notifyChildren(m) : true)
                recipients.set(m.uid, { kind: m.kind });
        }
    }
    else if (scope.type === 'campus' || scope.type === 'class') {
        const childSet = new Set();
        const classSet = new Set();
        if (scope.type === 'campus') {
            for (const c of scope.ids) {
                const camp = await (0, util_1.campusOf)(ctx, c);
                req(camp.id);
                campusIds.add(camp.id);
                const q = await ctx.col('children').where('campusId', '==', camp.id).get();
                q.docs.filter((d) => IN_SCHOOL.includes(d.data().status)).forEach((d) => childSet.add(d.id));
            }
        }
        else {
            for (const k of scope.ids) {
                const cs = await ctx.doc(`classes/${k}`).get();
                if (!cs.exists)
                    (0, errors_1.fail)('NOT_FOUND', 'Lớp học không tồn tại trong tổ chức.');
                req(cs.data().campusId);
                campusIds.add(cs.data().campusId);
                classSet.add(k);
                const q = await ctx.col('children').where('classId', '==', k).get();
                q.docs.filter((d) => IN_SCHOOL.includes(d.data().status)).forEach((d) => childSet.add(d.id));
            }
        }
        let assignedUids = new Set();
        if (scope.type === 'class') {
            for (const k of classSet) {
                (await ctx.col('assignments').where('classId', '==', k).get()).docs
                    .filter((d) => d.data().status !== 'cancelled' && (!d.data().validTo || d.data().validTo.toMillis() > ctx.now.getTime()))
                    .forEach((d) => assignedUids.add(d.data().uid));
            }
        }
        for (const m of members) {
            if (m.kind === 'parent') {
                if (notifyChildren(m, childSet))
                    recipients.set(m.uid, { kind: 'parent' });
                continue;
            }
            if (scope.type === 'campus') {
                if (hasAnyAt(m, [...campusIds]))
                    recipients.set(m.uid, { kind: m.kind });
            }
            else if (assignedUids.has(m.uid) || (m.grants ?? []).some((g) => (g.classIds ?? []).some((c) => classSet.has(c)))) {
                recipients.set(m.uid, { kind: m.kind });
            }
        }
        assignedUids = new Set();
    }
    else {
        // users: người nhận phải là thành viên org và có quan hệ với cơ sở mà người gửi có quyền gửi
        const byUid = new Map(members.map((m) => [m.uid, m]));
        for (const uid of scope.ids) {
            const m = byUid.get(uid);
            if (!m)
                (0, errors_1.invalid)({ scope: 'Có người nhận không thuộc tổ chức hoặc chưa kích hoạt.' });
            const rel = await campusesOfMember(ctx, m);
            const ok = rel.some((c) => !checkAuth || ctx.can('notify.send', c));
            if (!ok)
                (0, errors_1.denied)('Bạn không có quyền gửi thông báo tới một số người nhận.');
            rel.forEach((c) => campusIds.add(c));
            recipients.set(uid, { kind: m.kind });
        }
    }
    return { recipients, campusIds: [...campusIds] };
}
function hasAnyAt(m, campuses) {
    const p = (m.permsByCampus ?? {});
    return campuses.some((c) => (p[c]?.length ?? 0) > 0 || (p['*']?.length ?? 0) > 0);
}
async function campusesOfMember(ctx, m) {
    if (m.kind === 'parent') {
        const out = new Set();
        for (const c of (m.childIds ?? []).slice(0, 20)) {
            const cs = await ctx.doc(`children/${c}`).get();
            if (cs.exists)
                out.add(cs.data().campusId);
        }
        return [...out];
    }
    const keys = Object.keys(m.permsByCampus ?? {});
    if (keys.includes('*'))
        return (await ctx.col('campuses').select().get()).docs.map((d) => d.id);
    return keys;
}
// ------------------------------------------------------------------ gửi thông báo
async function deliver(ctx, id, scope, requireAck, checkAuth) {
    const ref = ctx.doc(`notifications/${id}`);
    // chiếm quyền gửi (chỉ một lần)
    const claimed = await ctx.tx(async (t) => {
        const sn = await t.get(ref);
        if (!sn.exists)
            (0, errors_1.fail)('NOT_FOUND', 'Thông báo không tồn tại.');
        const st = sn.data().status;
        if (st === 'sent' || st === 'sending')
            return null;
        t.update(ref, { status: 'sending', ...ctx.metaUpdate(sn.data().version ?? 1) });
        return { ...sn.data(), id };
    });
    if (!claimed) {
        const cur = await (0, store_1.getOr404)(ref);
        return { ...cur, alreadySent: true };
    }
    try {
        const { recipients } = await resolveScope(ctx, scope, checkAuth);
        const sentAt = firebase_1.Timestamp.fromDate(ctx.now);
        for (const part of (0, util_1.chunk)([...recipients.keys()], 400)) {
            const batch = firebase_1.db.batch();
            for (const uid of part) {
                batch.set(ctx.doc(`notificationReceipts/${id}_${uid}`), {
                    notifId: id, uid, campusId: claimed.campusId ?? null, title: claimed.title, category: claimed.category, requireAck,
                    sentAt, readAt: null, ackAt: null, recipientKind: recipients.get(uid).kind,
                });
            }
            await batch.commit();
        }
        await ref.update({
            status: 'sent', sentAt, sentBy: ctx.uid, scope, requireAck, recipientCount: recipients.size, scheduledAt: null,
            updatedAt: sentAt, updatedBy: ctx.uid, version: firebase_1.FieldValue.increment(1),
        });
        await ctx.audit({ action: 'notification.send', collection: 'notifications', docId: id, campusId: claimed.campusId ?? null, after: { scope, recipientCount: recipients.size, requireAck } });
        // push chung chung, không chứa nội dung chi tiết
        const pushed = await (0, util_1.pushToUsers)(ctx.orgId, [...recipients.keys()].filter((u) => u !== ctx.uid), { type: 'notification', notifId: id });
        return { id, status: 'sent', recipientCount: recipients.size, pushed };
    }
    catch (e) {
        await ref.update({ status: claimed.status, updatedAt: firebase_1.Timestamp.fromDate(ctx.now) }).catch(() => undefined);
        throw e;
    }
}
/** Dùng cho job định kỳ (BE-2 triggers): gửi các thông báo đã lên lịch tới hạn. Trả số thông báo đã gửi. */
async function dispatchDueNotifications(now = new Date()) {
    const snap = await firebase_1.db.collectionGroup('notifications').where('status', '==', 'scheduled').where('scheduledAt', '<=', firebase_1.Timestamp.fromDate(now)).get();
    let n = 0;
    for (const d of snap.docs) {
        const orgId = d.ref.parent.parent.id;
        const data = d.data();
        const member = { uid: data.scheduledBy ?? data.createdBy, displayName: 'Hệ thống', kind: 'owner', status: 'active', grants: [], childIds: [], permsByCampus: {}, version: 1 };
        const ctx = (0, context_1.buildCtx)({ uid: member.uid, token: {}, orgId, loadMember: false }, member, false);
        try {
            await deliver(ctx, d.id, data.scope, !!data.requireAck, false);
            n++;
        }
        catch (e) {
            console.error('dispatch notification failed', orgId, d.id, e);
            await d.ref.update({ status: 'failed', failReason: String(e?.message ?? e).slice(0, 300) }).catch(() => undefined);
        }
    }
    return n;
}
(0, approvals_1.registerApprovalHandler)('notification', {
    perm: 'notify.approve',
    async onApprove(ctx, ap) {
        const ref = ctx.doc(`notifications/${ap.refId}`);
        const n = await (0, store_1.getOr404)(ref, 'Thông báo');
        if (n.status !== 'pending_approval')
            (0, errors_1.fail)('INVALID_STATE', 'Thông báo không còn chờ duyệt.', { status: n.status });
        await ref.update({ status: 'approved', approvedBy: ctx.uid, approvedAt: firebase_1.Timestamp.fromDate(ctx.now), ...ctx.metaUpdate(n.version ?? 1) });
        return { notificationId: n.id, status: 'approved' };
    },
    async onReject(ctx, ap, note) {
        const ref = ctx.doc(`notifications/${ap.refId}`);
        const n = await ref.get();
        if (n.exists && n.data().status === 'pending_approval') {
            await ref.update({ status: 'draft', rejectNote: (0, util_1.s)(note), rejectedBy: ctx.uid, ...ctx.metaUpdate(n.data().version ?? 1) });
        }
        return null;
    },
});
function checkPaths(ctx, campusId, paths) {
    for (const p of paths) {
        const ok = typeof p === 'string' && !p.includes('..') && p.startsWith(campusId ? `orgs/${ctx.orgId}/campuses/${campusId}/` : `orgs/${ctx.orgId}/`);
        if (!ok)
            (0, errors_1.invalid)({ attachmentPaths: 'Đường dẫn tệp đính kèm không hợp lệ.' });
    }
}
exports.actions = {
    'notification.save': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const id = (0, util_1.s)(b.id);
            let existing = null;
            if (id)
                existing = await (0, store_1.getOr404)(ctx.doc(`notifications/${id}`), 'Thông báo');
            if (existing && !['draft', 'pending_approval'].includes(existing.status))
                (0, errors_1.fail)('INVALID_STATE', 'Thông báo đã gửi hoặc đã duyệt, không sửa được. Hãy tạo thông báo mới.');
            const scope = b.scope !== undefined ? normScope(b.scope) : existing?.scope;
            let campusId = existing ? (existing.campusId ?? null) : null;
            if (!existing) {
                if (scope?.type === 'org')
                    campusId = null;
                else if ((0, util_1.s)(b.campusId))
                    campusId = (await (0, util_1.campusOf)(ctx, (0, util_1.s)(b.campusId))).id;
                else if (scope?.type === 'campus')
                    campusId = scope.ids[0];
                else if (scope?.type === 'class')
                    campusId = (await (0, store_1.getOr404)(ctx.doc(`classes/${scope.ids[0]}`), 'Lớp học')).campusId;
                else
                    campusId = ctx.campusId ?? null;
            }
            if (campusId)
                await (0, util_1.campusOf)(ctx, campusId);
            ctx.require('notify.send', campusId);
            const title = (0, util_1.s)(b.title ?? existing?.title);
            const body = (0, util_1.s)(b.body ?? existing?.body);
            if (title.length < 2)
                (0, errors_1.invalid)({ title: 'Nhập tiêu đề (tối thiểu 2 ký tự).' });
            if (title.length > 150)
                (0, errors_1.invalid)({ title: 'Tiêu đề tối đa 150 ký tự.' });
            if (body.length < 1)
                (0, errors_1.invalid)({ body: 'Nhập nội dung thông báo.' });
            if (body.length > 5000)
                (0, errors_1.invalid)({ body: 'Nội dung tối đa 5000 ký tự.' });
            const category = (0, util_1.s)(b.category ?? existing?.category) || 'general';
            if (!CATEGORIES.includes(category))
                (0, errors_1.invalid)({ category: 'Loại thông báo không hợp lệ.' });
            const attachmentPaths = b.attachmentPaths !== undefined ? (0, util_1.asArr)(b.attachmentPaths).map(util_1.s) : (existing?.attachmentPaths ?? []);
            checkPaths(ctx, campusId, attachmentPaths);
            const scheduledAt = b.scheduledAt ? firebase_1.Timestamp.fromDate((0, util_1.parseWhen)(b.scheduledAt, 'scheduledAt')) : (existing?.scheduledAt ?? null);
            const data = {
                title, body, category, attachmentPaths, campusId, scope: scope ?? null,
                requireAck: typeof b.requireAck === 'boolean' ? b.requireAck : (existing?.requireAck ?? false), scheduledAt,
            };
            if (!existing) {
                const nid = await (0, store_1.createDoc)(ctx, 'notifications', undefined, { ...data, status: 'draft', authorName: ctx.member?.displayName ?? ctx.uid });
                await ctx.audit({ action: 'notification.save', collection: 'notifications', docId: nid, campusId, after: { title, category } });
                return { id: nid, ...data, status: 'draft', version: 1 };
            }
            const { after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`notifications/${id}`), { ...data, status: 'draft' }, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
            await ctx.audit({ action: 'notification.save', collection: 'notifications', docId: id, campusId, before: { title: existing.title }, after: { title } });
            return { id, ...after };
        },
    },
    'notification.submit': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const id = (0, util_1.requireId)(b.id, 'id');
            const n = await (0, store_1.getOr404)(ctx.doc(`notifications/${id}`), 'Thông báo');
            ctx.require('notify.send', n.campusId ?? null);
            if (n.status === 'pending_approval')
                return { id, status: 'pending_approval', unchanged: true };
            if (n.status !== 'draft')
                (0, errors_1.fail)('INVALID_STATE', 'Chỉ gửi duyệt được thông báo ở trạng thái nháp.', { status: n.status });
            if (!n.scope)
                (0, errors_1.invalid)({ scope: 'Chọn phạm vi người nhận trước khi gửi duyệt.' });
            const preview = await resolveScope(ctx, n.scope, true); // kiểm tra quyền + xem trước số người nhận
            if (ctx.can('notify.approve', n.campusId ?? null)) {
                const { after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`notifications/${id}`), { status: 'approved', approvedBy: ctx.uid, approvedAt: firebase_1.Timestamp.fromDate(ctx.now), autoApproved: true, recipientPreview: preview.recipients.size });
                await ctx.audit({ action: 'notification.submit', collection: 'notifications', docId: id, campusId: n.campusId ?? null, after: { status: 'approved', autoApproved: true } });
                return { id, status: 'approved', autoApproved: true, recipientPreview: preview.recipients.size, version: after.version };
            }
            const approvalId = await (0, approvals_1.createApproval)(ctx, {
                type: 'notification', campusId: n.campusId ?? null, refCollection: 'notifications', refId: id,
                summary: `Duyệt thông báo "${n.title}" gửi tới ${preview.recipients.size} người.`,
                impact: { recipients: preview.recipients.size, scope: n.scope, requireAck: n.requireAck, category: n.category },
            });
            const { after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`notifications/${id}`), { status: 'pending_approval', approvalId, recipientPreview: preview.recipients.size });
            await ctx.audit({ action: 'notification.submit', collection: 'notifications', docId: id, campusId: n.campusId ?? null, after: { status: 'pending_approval', approvalId } });
            return { id, status: 'pending_approval', approvalId, recipientPreview: preview.recipients.size, version: after.version };
        },
    },
    'notification.approve': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const n = await (0, store_1.getOr404)(ctx.doc(`notifications/${(0, util_1.requireId)(b.id, 'id')}`), 'Thông báo');
            if (!n.approvalId)
                (0, errors_1.fail)('INVALID_STATE', 'Thông báo chưa được gửi duyệt.');
            const r = await (0, approval_core_1.decideApprovalCore)(ctx, n.approvalId, (0, util_1.s)(b.decision) || 'approved', (0, util_1.s)(b.note));
            return { id: n.id, approvalId: n.approvalId, status: r.status, result: r.result ?? null };
        },
    },
    'notification.send': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const id = (0, util_1.requireId)(b.id, 'id');
            const n = await (0, store_1.getOr404)(ctx.doc(`notifications/${id}`), 'Thông báo');
            ctx.require('notify.send', n.campusId ?? null);
            if (n.status === 'sent')
                return { id, status: 'sent', alreadySent: true, recipientCount: n.recipientCount ?? null };
            const scope = b.scope !== undefined ? normScope(b.scope) : n.scope;
            if (!scope)
                (0, errors_1.invalid)({ scope: 'Chọn phạm vi người nhận.' });
            // phạm vi gửi không được rộng hơn phạm vi đã duyệt
            if (n.status === 'approved' && b.scope !== undefined && n.scope && JSON.stringify(normScope(n.scope)) !== JSON.stringify(scope)) {
                (0, errors_1.fail)('PRECONDITION', 'Phạm vi gửi khác với phạm vi đã được duyệt. Hãy gửi duyệt lại.');
            }
            if (n.status !== 'approved' && n.status !== 'scheduled') {
                if (!ctx.can('notify.approve', n.campusId ?? null))
                    (0, errors_1.fail)('PRECONDITION', 'Thông báo cần được duyệt trước khi gửi.', { status: n.status });
                if (!['draft', 'pending_approval'].includes(n.status))
                    (0, errors_1.fail)('INVALID_STATE', 'Thông báo không ở trạng thái gửi được.', { status: n.status });
            }
            const requireAck = typeof b.requireAck === 'boolean' ? b.requireAck : !!n.requireAck;
            const at = b.at ? (0, util_1.parseWhen)(b.at, 'at') : (n.status === 'scheduled' ? null : tsDate(n.scheduledAt));
            if (at && at.getTime() > ctx.now.getTime() + 60_000) {
                await resolveScope(ctx, scope, true); // kiểm tra quyền sớm
                await (0, store_1.updateDoc)(ctx, ctx.doc(`notifications/${id}`), {
                    status: 'scheduled', scope, requireAck, scheduledAt: firebase_1.Timestamp.fromDate(at), scheduledBy: ctx.uid,
                    ...(n.status === 'draft' || n.status === 'pending_approval' ? { approvedBy: ctx.uid, approvedAt: firebase_1.Timestamp.fromDate(ctx.now) } : {}),
                });
                await ctx.audit({ action: 'notification.schedule', collection: 'notifications', docId: id, campusId: n.campusId ?? null, after: { scheduledAt: at.toISOString(), scope } });
                return { id, status: 'scheduled', scheduledAt: at.toISOString() };
            }
            return deliver(ctx, id, scope, requireAck, true);
        },
    },
    'notification.markRead': {
        scope: 'org',
        kinds: ['owner', 'staff', 'parent'],
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const id = (0, util_1.requireId)(b.id ?? b.notificationId, 'id');
            const ref = ctx.doc(`notificationReceipts/${id}_${ctx.uid}`);
            const sn = await ref.get();
            if (!sn.exists)
                (0, errors_1.fail)('NOT_FOUND', 'Thông báo không còn khả dụng với bạn.');
            if (sn.data().readAt)
                return { id, readAt: sn.data().readAt, unchanged: true };
            await ref.update({ readAt: firebase_1.Timestamp.fromDate(ctx.now) });
            return { id, readAt: ctx.now.toISOString() };
        },
    },
    'notification.ack': {
        scope: 'org',
        kinds: ['owner', 'staff', 'parent'],
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const id = (0, util_1.requireId)(b.id ?? b.notificationId, 'id');
            const ref = ctx.doc(`notificationReceipts/${id}_${ctx.uid}`);
            const sn = await ref.get();
            if (!sn.exists)
                (0, errors_1.fail)('NOT_FOUND', 'Thông báo không còn khả dụng với bạn.');
            if (sn.data().requireAck !== true)
                (0, errors_1.fail)('INVALID_STATE', 'Thông báo này không yêu cầu xác nhận.');
            if (sn.data().ackAt)
                return { id, ackAt: sn.data().ackAt, unchanged: true };
            const t = firebase_1.Timestamp.fromDate(ctx.now);
            await ref.update({ ackAt: t, readAt: sn.data().readAt ?? t });
            return { id, ackAt: ctx.now.toISOString() };
        },
    },
    // ---------------------------------------------------------------- trao đổi
    'thread.open': {
        scope: 'org',
        kinds: ['owner', 'staff', 'parent'],
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const subject = (0, util_1.s)(b.subject);
            if (subject.length < 3)
                (0, errors_1.invalid)({ subject: 'Nhập chủ đề (tối thiểu 3 ký tự).' });
            if (subject.length > 200)
                (0, errors_1.invalid)({ subject: 'Chủ đề tối đa 200 ký tự.' });
            const priority = (0, util_1.s)(b.priority) || 'normal';
            if (!PRIORITIES.includes(priority))
                (0, errors_1.invalid)({ priority: 'Mức ưu tiên không hợp lệ.' });
            const isParent = ctx.member?.kind === 'parent';
            let child = null;
            let campusId;
            let participants = [];
            if (isParent) {
                const childId = (0, util_1.requireId)(b.childId, 'childId');
                (0, util_1.requireParentOf)(ctx, childId);
                child = await (0, util_1.childOf)(ctx, childId);
                campusId = child.campusId;
                participants = [ctx.uid];
            }
            else if ((0, util_1.s)(b.childId)) {
                child = await (0, util_1.childOf)(ctx, b.childId);
                campusId = child.campusId;
                ctx.require('inbox.handle', campusId);
                participants = [...new Set([...(await (0, util_1.parentUidsOfChild)(ctx, child.id, 'notify')), ctx.uid])];
            }
            else if ((0, util_1.s)(b.classId)) {
                const cls = await (0, store_1.getOr404)(ctx.doc(`classes/${(0, util_1.s)(b.classId)}`), 'Lớp học');
                campusId = cls.campusId;
                ctx.require('inbox.handle', campusId);
                participants = [ctx.uid];
            }
            else
                (0, errors_1.invalid)({ childId: 'Chọn bé hoặc lớp cho cuộc trao đổi.' });
            const now = firebase_1.Timestamp.fromDate(ctx.now);
            const data = {
                campusId: campusId, childId: child?.id ?? null, classId: child?.classId ?? ((0, util_1.s)(b.classId) || null), subject, priority, status: 'open',
                participants, createdBy: ctx.uid, createdByName: ctx.member?.displayName ?? ctx.uid, createdByKind: ctx.member?.kind ?? 'staff',
                assignedTo: null, dueAt: null, lastMessageAt: now, messageCount: 0,
            };
            const id = await (0, store_1.createDoc)(ctx, 'threads', undefined, data);
            let firstMsg = null;
            if ((0, util_1.s)(b.text))
                firstMsg = await addMessage(ctx, id, (0, util_1.s)(b.text), []);
            await ctx.audit({ action: 'thread.open', collection: 'threads', docId: id, campusId: campusId, after: { subject, childId: child?.id ?? null } });
            if (isParent) { /* nhân viên xem qua hộp thư (inbox.handle) */ }
            else
                void (0, util_1.pushToUsers)(ctx.orgId, participants.filter((u) => u !== ctx.uid), { type: 'thread', threadId: id });
            return { id, ...data, firstMessageId: firstMsg, version: 1 };
        },
    },
    'thread.post': {
        scope: 'org',
        kinds: ['owner', 'staff', 'parent'],
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const threadId = (0, util_1.requireId)(b.threadId, 'threadId');
            const th = await (0, store_1.getOr404)(ctx.doc(`threads/${threadId}`), 'Cuộc trao đổi');
            const isParent = ctx.member?.kind === 'parent';
            const participant = (th.participants ?? []).includes(ctx.uid);
            if (isParent) {
                if (!participant || !(ctx.member.childIds ?? []).includes(th.childId))
                    (0, errors_1.denied)('Bạn không thuộc cuộc trao đổi này.');
            }
            else if (!participant && !ctx.can('inbox.handle', th.campusId))
                (0, errors_1.denied)('Bạn không có quyền trả lời cuộc trao đổi này.');
            if (th.status === 'closed')
                (0, errors_1.fail)('INVALID_STATE', 'Cuộc trao đổi đã đóng. Hãy mở cuộc trao đổi mới.');
            const text = (0, util_1.s)(b.text);
            const paths = (0, util_1.asArr)(b.attachmentPaths).map(util_1.s);
            if (!text && !paths.length)
                (0, errors_1.invalid)({ text: 'Nhập nội dung tin nhắn.' });
            if (text.length > 4000)
                (0, errors_1.invalid)({ text: 'Tin nhắn tối đa 4000 ký tự.' });
            checkPaths(ctx, th.campusId, paths);
            const mid = await addMessage(ctx, threadId, text, paths);
            // push chung chung cho phía còn lại
            const targets = isParent ? (th.assignedTo ? [th.assignedTo] : []) : (th.participants ?? []).filter((u) => u !== ctx.uid);
            void (0, util_1.pushToUsers)(ctx.orgId, targets, { type: 'thread', threadId });
            return { id: mid, threadId };
        },
    },
    'thread.assign': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const threadId = (0, util_1.requireId)(b.threadId, 'threadId');
            const th = await (0, store_1.getOr404)(ctx.doc(`threads/${threadId}`), 'Cuộc trao đổi');
            ctx.require('inbox.handle', th.campusId);
            if (th.status === 'closed')
                (0, errors_1.fail)('INVALID_STATE', 'Cuộc trao đổi đã đóng.');
            const uid = (0, util_1.requireId)(b.uid, 'uid');
            const m = await ctx.doc(`members/${uid}`).get();
            if (!m.exists || m.data().status !== 'active' || m.data().kind === 'parent' || !(0, permissions_1.hasPerm)(m.data().permsByCampus, 'inbox.handle', th.campusId)) {
                (0, errors_1.invalid)({ uid: 'Người được giao không có quyền xử lý trao đổi tại cơ sở này.' });
            }
            const dueAt = b.dueAt ? firebase_1.Timestamp.fromDate((0, util_1.parseWhen)(b.dueAt, 'dueAt')) : null;
            const patch = { assignedTo: uid, assignedToName: m.data().displayName, dueAt, assignedBy: ctx.uid };
            if ((0, util_1.s)(b.priority)) {
                if (!PRIORITIES.includes((0, util_1.s)(b.priority)))
                    (0, errors_1.invalid)({ priority: 'Mức ưu tiên không hợp lệ.' });
                patch.priority = (0, util_1.s)(b.priority);
            }
            const { before, after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`threads/${threadId}`), patch);
            await ctx.audit({ action: 'thread.assign', collection: 'threads', docId: threadId, campusId: th.campusId, before: { assignedTo: before.assignedTo ?? null }, after: { assignedTo: uid } });
            void (0, util_1.pushToUsers)(ctx.orgId, [uid], { type: 'thread', threadId });
            return { id: threadId, assignedTo: uid, dueAt: dueAt ? dueAt.toDate().toISOString() : null, version: after.version };
        },
    },
    'thread.close': {
        scope: 'org',
        kinds: ['owner', 'staff', 'parent'],
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const threadId = (0, util_1.requireId)(b.threadId, 'threadId');
            const th = await (0, store_1.getOr404)(ctx.doc(`threads/${threadId}`), 'Cuộc trao đổi');
            const isParent = ctx.member?.kind === 'parent';
            if (isParent) {
                if (th.createdBy !== ctx.uid)
                    (0, errors_1.denied)('Chỉ người mở cuộc trao đổi mới đóng được.');
            }
            else
                ctx.require('inbox.handle', th.campusId);
            if (th.status === 'closed')
                return { id: threadId, status: 'closed', unchanged: true };
            const resolution = (0, util_1.s)(b.resolution);
            if (!isParent && !resolution)
                (0, errors_1.invalid)({ resolution: 'Vui lòng ghi kết quả xử lý.' });
            const { after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`threads/${threadId}`), {
                status: 'closed', resolution: resolution || null, closedBy: ctx.uid, closedAt: firebase_1.Timestamp.fromDate(ctx.now),
            });
            await ctx.audit({ action: 'thread.close', collection: 'threads', docId: threadId, campusId: th.campusId, before: { status: th.status }, after: { status: 'closed' }, reason: resolution || undefined });
            return { id: threadId, status: 'closed', version: after.version };
        },
    },
};
function tsDate(v) {
    return v instanceof firebase_1.Timestamp ? v.toDate() : null;
}
async function addMessage(ctx, threadId, text, attachmentPaths) {
    const ref = ctx.doc(`threads/${threadId}`).collection('messages').doc();
    const now = firebase_1.Timestamp.fromDate(ctx.now);
    const batch = firebase_1.db.batch();
    batch.create(ref, {
        senderUid: ctx.uid, senderName: ctx.member?.displayName ?? ctx.uid, senderKind: ctx.member?.kind ?? 'staff', text, attachmentPaths, at: now,
        createdAt: now, createdBy: ctx.uid,
    });
    batch.update(ctx.doc(`threads/${threadId}`), { lastMessageAt: now, messageCount: firebase_1.FieldValue.increment(1), updatedAt: now, updatedBy: ctx.uid, version: firebase_1.FieldValue.increment(1) });
    await batch.commit();
    return ref.id;
}
