"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actions = exports.ATT_STATUSES = void 0;
const firebase_1 = require("../core/firebase");
const errors_1 = require("../core/errors");
const approvals_1 = require("../core/approvals");
const store_1 = require("../core/store");
const validate_1 = require("../core/validate");
const approval_core_1 = require("./approval-core");
const util_1 = require("./util");
exports.ATT_STATUSES = ['present', 'absent_excused', 'absent_unexcused', 'no_class'];
const SESSIONS = ['all', 'am', 'pm'];
const IN_SCHOOL = ['active', 'trial', 'on_leave'];
const VERIFY_METHODS = ['id_check', 'qr', 'otp', 'phone_call'];
const attId = (childId, dayKey, session) => `${childId}_${dayKey}_${session}`;
const hoId = (childId, dayKey) => `${childId}_${dayKey}`;
function checkDayNotFuture(ctx, campus, dayKey, field = 'dayKey') {
    if (dayKey > (0, util_1.todayOf)(ctx, campus))
        (0, errors_1.invalid)({ [field]: 'Không thể ghi cho ngày ở tương lai.' });
}
// ------------------------------------------------------------------ điểm danh
(0, approvals_1.registerApprovalHandler)('attendance_correction', {
    perm: 'classes.write', // quản lý lớp/hiệu trưởng duyệt; giáo viên không tự duyệt
    async onApprove(ctx, ap) {
        const corrRef = ctx.doc(`attendanceCorrections/${ap.refId}`);
        const corr = await (0, store_1.getOr404)(corrRef, 'Yêu cầu sửa điểm danh');
        if (corr.status !== 'pending')
            (0, errors_1.fail)('INVALID_STATE', 'Yêu cầu sửa không còn chờ duyệt.');
        const attRef = ctx.doc(`attendance/${corr.attendanceId}`);
        const cur = await (0, store_1.getOr404)(attRef, 'Bản ghi điểm danh');
        const after = (0, util_1.asObj)(corr.after);
        const patch = {};
        for (const k of ['status', 'arrivedAt', 'note', 'healthNote'])
            if (k in after)
                patch[k] = after[k] ?? null;
        const before = Object.fromEntries(Object.keys(patch).map((k) => [k, cur[k] ?? null]));
        await attRef.update({
            ...patch,
            corrections: firebase_1.FieldValue.arrayUnion({ id: corr.id, before, after: patch, reason: corr.reason, requestedBy: corr.requestedBy, approvedBy: ctx.uid, at: firebase_1.Timestamp.fromDate(ctx.now) }),
            correctionCount: firebase_1.FieldValue.increment(1),
            ...ctx.metaUpdate(cur.version ?? 1),
        });
        await corrRef.update({ status: 'approved', before, approvedBy: ctx.uid, decidedAt: firebase_1.Timestamp.fromDate(ctx.now), ...ctx.metaUpdate(corr.version ?? 1) });
        await ctx.audit({ action: 'attendance.correction.apply', collection: 'attendance', docId: corr.attendanceId, campusId: corr.campusId, before, after: patch, reason: corr.reason });
        return { attendanceId: corr.attendanceId, before, after: patch };
    },
    async onReject(ctx, ap, note) {
        const corrRef = ctx.doc(`attendanceCorrections/${ap.refId}`);
        const corr = await corrRef.get();
        if (corr.exists && corr.data().status === 'pending') {
            await corrRef.update({ status: 'rejected', rejectedBy: ctx.uid, decisionNote: (0, util_1.s)(note), decidedAt: firebase_1.Timestamp.fromDate(ctx.now), ...ctx.metaUpdate(corr.data().version ?? 1) });
        }
        return null;
    },
});
/** Danh sách trẻ có phân lớp hiệu lực tại lớp vào ngày dayKey (map childId → enrollment). */
async function classRoster(ctx, classId, dayKey) {
    const q = await ctx.col('enrollments').where('classId', '==', classId).get();
    const out = new Set();
    for (const d of q.docs) {
        const e = d.data();
        if (e.status === 'cancelled')
            continue;
        if ((!e.startDate || e.startDate <= dayKey) && (!e.endDate || dayKey <= e.endDate))
            out.add(e.childId);
    }
    return out;
}
function sanitizeItem(raw, idx) {
    const it = (0, util_1.asObj)(raw);
    const childId = (0, util_1.requireId)(it.childId, `items[${idx}].childId`);
    const status = (0, util_1.s)(it.status);
    if (!exports.ATT_STATUSES.includes(status))
        (0, errors_1.invalid)({ [`items[${idx}].status`]: 'Trạng thái điểm danh không hợp lệ.' });
    let arrivedAt = null;
    if (it.arrivedAt) {
        const d = (0, util_1.parseWhen)(it.arrivedAt, `items[${idx}].arrivedAt`);
        arrivedAt = firebase_1.Timestamp.fromDate(d);
    }
    if (status !== 'present' && arrivedAt)
        (0, errors_1.invalid)({ [`items[${idx}].arrivedAt`]: 'Chỉ nhập giờ đến cho trẻ có mặt.' });
    return {
        childId, status, arrivedAt, droppedBy: (0, util_1.s)(it.droppedBy) || null, note: (0, util_1.s)(it.note).slice(0, 500) || null, healthNote: (0, util_1.s)(it.healthNote).slice(0, 500) || null,
    };
}
exports.actions = {
    'attendance.mark': {
        scope: 'campus',
        perm: 'attendance.write',
        idempotent: true,
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const campusId = ctx.campusId;
            const cls = await (0, util_1.classOf)(ctx, b.classId);
            if (cls.campusId !== campusId)
                (0, errors_1.denied)('Lớp không thuộc cơ sở của yêu cầu.');
            await (0, util_1.requireClassAccess)(ctx, campusId, cls.id);
            const campus = await (0, util_1.campusOf)(ctx, campusId);
            const dayKey = (0, util_1.requireDay)(b.dayKey, 'dayKey');
            checkDayNotFuture(ctx, campus, dayKey);
            const session = (0, util_1.s)(b.session) || 'all';
            if (!SESSIONS.includes(session))
                (0, errors_1.invalid)({ session: 'Buổi phải là all, am hoặc pm.' });
            const rawItems = (0, util_1.asArr)(b.items);
            if (!rawItems.length)
                (0, errors_1.invalid)({ items: 'Danh sách điểm danh trống.' });
            if (rawItems.length > 200)
                (0, errors_1.invalid)({ items: 'Tối đa 200 trẻ mỗi lần gửi.' });
            const byChild = new Map();
            rawItems.forEach((r, i) => { const it = sanitizeItem(r, i); byChild.set(it.childId, it); });
            const closure = await ctx.doc(`attendanceClosures/${cls.id}_${dayKey}`).get();
            if (closure.exists)
                (0, errors_1.fail)('INVALID_STATE', 'Điểm danh ngày này đã chốt. Hãy gửi yêu cầu sửa điểm danh (attendance.requestCorrection).', { reason: 'closed' });
            const roster = await classRoster(ctx, cls.id, dayKey);
            const saved = [];
            const rejected = [];
            const items = [...byChild.values()];
            for (const it of items)
                if (!roster.has(it.childId))
                    rejected.push({ childId: it.childId, reason: 'Trẻ không thuộc lớp này trong ngày đã chọn.' });
            const valid = items.filter((it) => roster.has(it.childId));
            const nowTs = firebase_1.Timestamp.fromDate(ctx.now);
            const doneAt = nowTs;
            for (const part of (0, util_1.chunk)(valid, 150)) {
                const r = await ctx.tx(async (t) => {
                    const lSaved = [];
                    const lRejected = [];
                    const reads = await Promise.all(part.map(async (it) => {
                        const ids = SESSIONS.map((ss) => attId(it.childId, dayKey, ss));
                        const snaps = await Promise.all(ids.map((id) => t.get(ctx.doc(`attendance/${id}`))));
                        return { it, snaps };
                    }));
                    for (const { it, snaps } of reads) {
                        const mine = snaps[SESSIONS.indexOf(session)];
                        const clash = snaps.find((sn, i) => sn.exists && SESSIONS[i] !== session && (session === 'all' || SESSIONS[i] === 'all'));
                        if (clash) {
                            lRejected.push({ childId: it.childId, reason: 'Đã có điểm danh theo buổi/cả ngày khác cho trẻ này.' });
                            continue;
                        }
                        if (mine.exists && mine.data().closed === true) {
                            lRejected.push({ childId: it.childId, reason: 'Bản ghi đã chốt, cần yêu cầu sửa.' });
                            continue;
                        }
                        const ref = ctx.doc(`attendance/${attId(it.childId, dayKey, session)}`);
                        if (!mine.exists) {
                            t.create(ref, {
                                childId: it.childId, classId: cls.id, campusId, dayKey, session, status: it.status, arrivedAt: it.arrivedAt, droppedBy: it.droppedBy,
                                note: it.note, healthNote: it.healthNote, closed: false, markedBy: ctx.uid, markedByName: ctx.member?.displayName ?? ctx.uid, markedAt: doneAt,
                                ...ctx.metaCreate(),
                            });
                            lSaved.push({ childId: it.childId, id: ref.id, status: it.status, created: true });
                        }
                        else {
                            const cur = mine.data();
                            const upd = {
                                status: it.status, arrivedAt: it.arrivedAt ?? cur.arrivedAt ?? null, droppedBy: it.droppedBy ?? cur.droppedBy ?? null,
                                note: it.note ?? cur.note ?? null, healthNote: it.healthNote ?? cur.healthNote ?? null,
                                lastMarkedBy: ctx.uid, lastMarkedAt: doneAt, ...ctx.metaUpdate(cur.version ?? 1),
                            };
                            if (cur.status !== it.status)
                                upd.changes = firebase_1.FieldValue.arrayUnion({ from: cur.status, to: it.status, by: ctx.uid, at: doneAt });
                            t.update(ref, upd);
                            lSaved.push({ childId: it.childId, id: ref.id, status: it.status, created: false });
                        }
                    }
                    return { lSaved, lRejected };
                });
                saved.push(...r.lSaved);
                rejected.push(...r.lRejected);
            }
            await ctx.audit({
                action: 'attendance.mark', collection: 'attendance', docId: `${cls.id}_${dayKey}_${session}`, campusId,
                after: { classId: cls.id, dayKey, session, saved: saved.length, rejected: rejected.length },
            });
            return { classId: cls.id, dayKey, session, saved, rejected };
        },
    },
    'attendance.close': {
        scope: 'campus',
        perm: 'attendance.write',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const campusId = ctx.campusId;
            const cls = await (0, util_1.classOf)(ctx, b.classId);
            if (cls.campusId !== campusId)
                (0, errors_1.denied)('Lớp không thuộc cơ sở của yêu cầu.');
            await (0, util_1.requireClassAccess)(ctx, campusId, cls.id);
            const campus = await (0, util_1.campusOf)(ctx, campusId);
            const dayKey = (0, util_1.requireDay)(b.dayKey, 'dayKey');
            checkDayNotFuture(ctx, campus, dayKey);
            const closureRef = ctx.doc(`attendanceClosures/${cls.id}_${dayKey}`);
            if ((await closureRef.get()).exists)
                return { classId: cls.id, dayKey, alreadyClosed: true };
            const roster = await classRoster(ctx, cls.id, dayKey);
            const q = await ctx.col('attendance').where('classId', '==', cls.id).where('dayKey', '==', dayKey).get();
            const marked = new Set(q.docs.map((d) => d.data().childId));
            const missing = [...roster].filter((c) => !marked.has(c));
            if (missing.length && b.allowUnconfirmed !== true) {
                (0, errors_1.fail)('PRECONDITION', `Còn ${missing.length} trẻ chưa được điểm danh. Hoàn tất hoặc chọn chốt với trạng thái "Chưa xác nhận".`, { missingChildIds: missing });
            }
            const nowTs = firebase_1.Timestamp.fromDate(ctx.now);
            for (const part of (0, util_1.chunk)(missing, 400)) {
                const batch = firebase_1.db.batch();
                for (const childId of part) {
                    batch.create(ctx.doc(`attendance/${attId(childId, dayKey, 'all')}`), {
                        childId, classId: cls.id, campusId, dayKey, session: 'all', status: 'unconfirmed', closed: false, markedBy: ctx.uid, markedAt: nowTs, ...ctx.metaCreate(),
                    });
                }
                await batch.commit();
            }
            try {
                await closureRef.create({
                    classId: cls.id, campusId, dayKey, closedBy: ctx.uid, closedByName: ctx.member?.displayName ?? ctx.uid, closedAt: nowTs,
                    total: roster.size, unconfirmed: missing.length, ...ctx.metaCreate(),
                });
            }
            catch {
                return { classId: cls.id, dayKey, alreadyClosed: true };
            }
            const all = await ctx.col('attendance').where('classId', '==', cls.id).where('dayKey', '==', dayKey).get();
            for (const part of (0, util_1.chunk)(all.docs, 400)) {
                const batch = firebase_1.db.batch();
                part.forEach((d) => batch.update(d.ref, { closed: true, closedAt: nowTs, closedBy: ctx.uid }));
                await batch.commit();
            }
            await ctx.audit({ action: 'attendance.close', collection: 'attendanceClosures', docId: `${cls.id}_${dayKey}`, campusId, after: { total: roster.size, unconfirmed: missing.length } });
            return { classId: cls.id, dayKey, closed: true, total: roster.size, unconfirmed: missing.length };
        },
    },
    'attendance.requestCorrection': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const attendanceId = (0, util_1.requireId)(b.attendanceId, 'attendanceId');
            const att = await (0, store_1.getOr404)(ctx.doc(`attendance/${attendanceId}`), 'Bản ghi điểm danh');
            ctx.require('attendance.write', att.campusId);
            await (0, util_1.requireClassAccess)(ctx, att.campusId, att.classId);
            if (att.closed !== true)
                (0, errors_1.fail)('INVALID_STATE', 'Điểm danh chưa chốt, hãy sửa trực tiếp bằng attendance.mark.');
            const reason = (0, util_1.s)(b.reason);
            if (!reason)
                (0, errors_1.invalid)({ reason: 'Vui lòng nhập lý do sửa.' });
            const nv = (0, util_1.asObj)(b.newValue);
            const after = {};
            if (nv.status !== undefined) {
                if (![...exports.ATT_STATUSES, 'unconfirmed'].includes((0, util_1.s)(nv.status)) || (0, util_1.s)(nv.status) === 'unconfirmed')
                    (0, errors_1.invalid)({ 'newValue.status': 'Trạng thái không hợp lệ.' });
                after.status = (0, util_1.s)(nv.status);
            }
            if (nv.arrivedAt !== undefined)
                after.arrivedAt = nv.arrivedAt ? firebase_1.Timestamp.fromDate((0, util_1.parseWhen)(nv.arrivedAt, 'newValue.arrivedAt')) : null;
            if (nv.note !== undefined)
                after.note = (0, util_1.s)(nv.note).slice(0, 500) || null;
            if (nv.healthNote !== undefined)
                after.healthNote = (0, util_1.s)(nv.healthNote).slice(0, 500) || null;
            if (!Object.keys(after).length)
                (0, errors_1.invalid)({ newValue: 'Chưa có giá trị mới.' });
            const dup = await ctx.col('attendanceCorrections').where('attendanceId', '==', attendanceId).where('status', '==', 'pending').limit(1).get();
            if (!dup.empty)
                (0, errors_1.fail)('CONFLICT', 'Đã có yêu cầu sửa đang chờ duyệt cho bản ghi này.', { correctionId: dup.docs[0].id });
            const before = Object.fromEntries(Object.keys(after).map((k) => [k, att[k] ?? null]));
            const corrId = await (0, store_1.createDoc)(ctx, 'attendanceCorrections', undefined, {
                attendanceId, childId: att.childId, classId: att.classId, campusId: att.campusId, dayKey: att.dayKey, before, after, reason,
                status: 'pending', requestedBy: ctx.uid, requestedByName: ctx.member?.displayName ?? ctx.uid,
            });
            const child = await (0, store_1.getOr404)(ctx.doc(`children/${att.childId}`), 'Hồ sơ trẻ');
            const approvalId = await (0, approvals_1.createApproval)(ctx, {
                type: 'attendance_correction', campusId: att.campusId, refCollection: 'attendanceCorrections', refId: corrId,
                summary: `Sửa điểm danh ${child.fullName} ngày ${att.dayKey}: ${before.status ?? att.status} → ${after.status ?? att.status}.`,
                impact: { attendanceId, dayKey: att.dayKey, before, after, reason },
            });
            await ctx.doc(`attendanceCorrections/${corrId}`).update({ approvalId });
            await ctx.audit({ action: 'attendance.requestCorrection', collection: 'attendanceCorrections', docId: corrId, campusId: att.campusId, before, after, reason });
            return { id: corrId, approvalId, status: 'pending' };
        },
    },
    'attendance.decideCorrection': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const corr = await (0, store_1.getOr404)(ctx.doc(`attendanceCorrections/${(0, util_1.requireId)(b.id, 'id')}`), 'Yêu cầu sửa điểm danh');
            if (!corr.approvalId)
                (0, errors_1.fail)('INVALID_STATE', 'Yêu cầu sửa thiếu phiếu phê duyệt.');
            const r = await (0, approval_core_1.decideApprovalCore)(ctx, corr.approvalId, (0, util_1.s)(b.decision), (0, util_1.s)(b.note));
            return { id: corr.id, approvalId: corr.approvalId, status: r.status, result: r.result ?? null };
        },
    },
    // ---------------------------------------------------------------- bàn giao
    'handover.receive': {
        scope: 'org',
        idempotent: true,
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const child = await (0, util_1.childOf)(ctx, b.childId);
            ctx.require('handover.write', child.campusId);
            await (0, util_1.requireClassAccess)(ctx, child.campusId, child.classId ?? null);
            if (!IN_SCHOOL.includes(child.status) || !child.classId)
                (0, errors_1.fail)('INVALID_STATE', 'Trẻ không ở trạng thái đang học nên chưa thể nhận.');
            const campus = await (0, util_1.campusOf)(ctx, child.campusId);
            const dayKey = (0, util_1.requireDay)(b.dayKey, 'dayKey');
            checkDayNotFuture(ctx, campus, dayKey);
            const droppedBy = (0, util_1.s)(b.droppedBy);
            if (!droppedBy)
                (0, errors_1.invalid)({ droppedBy: 'Vui lòng ghi người đưa trẻ.' });
            const at = pickTime(ctx, b.at);
            const ref = ctx.doc(`handovers/${hoId(child.id, dayKey)}`);
            const attRef = ctx.doc(`attendance/${attId(child.id, dayKey, 'all')}`);
            const closureRef = ctx.doc(`attendanceClosures/${child.classId}_${dayKey}`);
            const out = await ctx.tx(async (t) => {
                const [hs, as_, cl] = await Promise.all([t.get(ref), t.get(attRef), t.get(closureRef)]);
                if (hs.exists) {
                    const st = hs.data().state;
                    if (st === 'received')
                        return { ...hs.data(), id: ref.id, alreadyReceived: true };
                    if (st === 'picked_up')
                        (0, errors_1.fail)('INVALID_STATE', 'Trẻ đã được trả trong ngày, không nhận lại bằng thao tác này.', { reason: 'already_picked_up' });
                }
                const data = {
                    childId: child.id, classId: child.classId, campusId: child.campusId, dayKey, state: 'received', receivedAt: firebase_1.Timestamp.fromDate(at),
                    receivedBy: ctx.uid, receivedByName: ctx.member?.displayName ?? ctx.uid, droppedBy, recordedAt: firebase_1.Timestamp.fromDate(ctx.now),
                };
                if (hs.exists)
                    t.update(ref, { ...data, ...ctx.metaUpdate(hs.data().version ?? 1) });
                else
                    t.create(ref, { ...data, pickedAt: null, pickedBy: null, ...ctx.metaCreate() });
                let attendance = 'untouched';
                if (!cl.exists) {
                    if (!as_.exists) {
                        t.create(attRef, {
                            childId: child.id, classId: child.classId, campusId: child.campusId, dayKey, session: 'all', status: 'present', arrivedAt: firebase_1.Timestamp.fromDate(at),
                            droppedBy, note: null, healthNote: null, closed: false, markedBy: ctx.uid, markedByName: ctx.member?.displayName ?? ctx.uid, markedAt: firebase_1.Timestamp.fromDate(ctx.now),
                            source: 'handover', ...ctx.metaCreate(),
                        });
                        attendance = 'created';
                    }
                    else if (!as_.data().closed && as_.data().status !== 'present') {
                        t.update(attRef, { status: 'present', arrivedAt: firebase_1.Timestamp.fromDate(at), droppedBy, ...ctx.metaUpdate(as_.data().version ?? 1) });
                        attendance = 'updated';
                    }
                }
                return { ...data, id: ref.id, attendance, alreadyReceived: false };
            });
            if (!out.alreadyReceived) {
                await ctx.audit({ action: 'handover.receive', collection: 'handovers', docId: ref.id, campusId: child.campusId, after: { dayKey, droppedBy } });
                void (0, util_1.pushToUsers)(ctx.orgId, await (0, util_1.parentUidsOfChild)(ctx, child.id, 'notify'), { type: 'handover', childId: child.id });
            }
            return out;
        },
    },
    'handover.pickup': {
        scope: 'org',
        idempotent: true,
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const child = await (0, util_1.childOf)(ctx, b.childId);
            ctx.require('handover.write', child.campusId);
            await (0, util_1.requireClassAccess)(ctx, child.campusId, child.classId ?? null);
            const campus = await (0, util_1.campusOf)(ctx, child.campusId);
            const dayKey = (0, util_1.requireDay)(b.dayKey, 'dayKey');
            checkDayNotFuture(ctx, campus, dayKey);
            const v = (0, util_1.asObj)(b.verification);
            const method = (0, util_1.s)(v.method);
            if (!VERIFY_METHODS.includes(method))
                (0, errors_1.invalid)({ 'verification.method': 'Chọn phương thức xác minh người đón.' });
            let paId = (0, util_1.requireId)(b.pickupPersonId, 'pickupPersonId');
            const at = pickTime(ctx, b.at);
            const hoRef = ctx.doc(`handovers/${hoId(child.id, dayKey)}`);
            let paRef = ctx.doc(`pickupAuthorizations/${paId}`);
            const res = await ctx.tx(async (t) => {
                let [hs, pa] = await Promise.all([t.get(hoRef), t.get(paRef)]);
                if (!pa.exists && !paId.startsWith('pa_')) { // tương thích: truyền id guardianLink
                    const alt = ctx.doc(`pickupAuthorizations/pa_${paId}`);
                    const altSnap = await t.get(alt);
                    if (altSnap.exists) {
                        pa = altSnap;
                        paRef = alt;
                        paId = alt.id;
                    }
                }
                const block = (reason, message) => (0, errors_1.fail)('PRECONDITION', message, { reason });
                if (!hs.exists || hs.data().state === 'not_received')
                    block('not_received', 'Trẻ chưa được nhà trường nhận nên chưa thể trả. Hãy xử lý bổ sung theo quy trình.');
                if (hs.data().state === 'picked_up')
                    block('already_picked_up', 'Trẻ đã được trả trước đó, không xác nhận lặp.');
                if (!pa.exists)
                    block('authorization_not_found', 'Không tìm thấy người đón trong danh sách được phép.');
                const a = pa.data();
                if (a.childId !== child.id)
                    block('authorization_wrong_child', 'Người đón không được phép đón trẻ này.');
                if (a.status === 'revoked')
                    block('authorization_revoked', 'Ủy quyền đón đã bị thu hồi. Liên hệ quản lý.');
                if (a.status === 'pending')
                    block('authorization_pending', 'Ủy quyền đang chờ nhà trường xác nhận.');
                if (a.status !== 'approved')
                    block('authorization_rejected', 'Ủy quyền đón không được chấp thuận.');
                const today = (0, store_1.dayKeyOf)(at, campus.timezone || 'Asia/Ho_Chi_Minh');
                if (a.validFrom && a.validFrom > today)
                    block('authorization_not_started', 'Ủy quyền đón chưa có hiệu lực.');
                if (a.validTo && a.validTo < today)
                    block('authorization_expired', 'Ủy quyền đón đã hết hạn.');
                const hhmm = (0, store_1.hhmmOf)(at, campus.timezone || 'Asia/Ho_Chi_Minh');
                if (a.validFromTime && a.validFrom === today && hhmm < a.validFromTime)
                    block('authorization_not_started', 'Ủy quyền đón chưa đến giờ hiệu lực.');
                if (a.validToTime && a.validTo === today && hhmm > a.validToTime)
                    block('authorization_expired', 'Ủy quyền đón đã hết giờ hiệu lực.');
                const upd = {
                    state: 'picked_up', pickedAt: firebase_1.Timestamp.fromDate(at), pickedBy: ctx.uid, pickedByName: ctx.member?.displayName ?? ctx.uid,
                    pickupPersonId: pa.id, pickupPersonName: a.personName, pickupRelation: a.relation ?? null,
                    verification: { method, note: (0, util_1.s)(v.note) || null, supportOnly: method === 'qr' || method === 'otp' },
                    pickupRecordedAt: firebase_1.Timestamp.fromDate(ctx.now),
                    ...ctx.metaUpdate(hs.data().version ?? 1),
                };
                t.update(hoRef, upd);
                return { ...hs.data(), ...upd, id: hoRef.id };
            });
            await ctx.audit({
                action: 'handover.pickup', collection: 'handovers', docId: hoRef.id, campusId: child.campusId,
                before: { state: 'received' }, after: { state: 'picked_up', pickupPersonId: res.pickupPersonId, method },
            });
            void (0, util_1.pushToUsers)(ctx.orgId, await (0, util_1.parentUidsOfChild)(ctx, child.id, 'notify'), { type: 'handover', childId: child.id });
            return res;
        },
    },
    // ---------------------------------------------------------------- ủy quyền đón
    'pickupAuth.save': {
        scope: 'org',
        kinds: ['owner', 'staff', 'parent'],
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const id = (0, util_1.s)(b.id);
            let existing = null;
            if (id)
                existing = await (0, store_1.getOr404)(ctx.doc(`pickupAuthorizations/${id}`), 'Ủy quyền đón');
            const child = await (0, util_1.childOf)(ctx, existing ? existing.childId : b.childId);
            const isParent = ctx.member?.kind === 'parent';
            if (isParent) {
                (0, util_1.requireParentOf)(ctx, child.id);
                if (ctx.member.childPerms?.[child.id]?.pickup !== true)
                    (0, errors_1.denied)('Bạn không có quyền ủy quyền đón cho bé này.');
            }
            else
                ctx.require('children.write', child.campusId);
            if (existing) {
                if (existing.type === 'guardian')
                    (0, errors_1.fail)('INVALID_STATE', 'Người giám hộ được quản lý qua liên kết giám hộ, không sửa ở đây.');
                if (existing.status === 'revoked' || existing.status === 'rejected')
                    (0, errors_1.fail)('INVALID_STATE', 'Ủy quyền đã bị thu hồi hoặc từ chối. Hãy tạo ủy quyền mới.');
                if (isParent && existing.requestedBy !== ctx.uid)
                    (0, errors_1.denied)('Bạn chỉ sửa được ủy quyền do chính mình tạo.');
            }
            const personName = (0, util_1.s)(b.personName ?? existing?.personName);
            if (personName.length < 2)
                (0, errors_1.invalid)({ personName: 'Nhập họ tên người đón.' });
            const relation = (0, util_1.s)(b.relation ?? existing?.relation);
            if (!relation)
                (0, errors_1.invalid)({ relation: 'Nhập quan hệ với trẻ.' });
            const idLast4 = (0, util_1.s)(b.idNumberLast4 ?? existing?.idNumberLast4);
            if (idLast4 && !/^\w{3,6}$/.test(idLast4))
                (0, errors_1.invalid)({ idNumberLast4: 'Chỉ nhập 4 ký tự cuối giấy tờ.' });
            const campus = await (0, util_1.campusOf)(ctx, child.campusId);
            const today = (0, util_1.todayOf)(ctx, campus);
            const validFrom = b.validFrom !== undefined ? (0, util_1.requireDay)(b.validFrom, 'validFrom') : (existing?.validFrom ?? today);
            const validTo = b.validTo !== undefined ? (0, util_1.requireDay)(b.validTo, 'validTo') : existing?.validTo;
            if (!validTo)
                (0, errors_1.invalid)({ validTo: 'Ủy quyền cần có ngày hết hạn.' });
            if (validTo < validFrom)
                (0, errors_1.invalid)({ validTo: 'Ngày hết hạn phải từ ngày bắt đầu trở đi.' });
            if (validTo < today)
                (0, errors_1.invalid)({ validTo: 'Ngày hết hạn đã qua.' });
            if ((0, util_1.daysBetween)(validFrom, validTo).length > 366)
                (0, errors_1.invalid)({ validTo: 'Ủy quyền tối đa 1 năm.' });
            for (const k of ['validFromTime', 'validToTime'])
                if (b[k] && !validate_1.TIME_RE.test((0, util_1.s)(b[k])))
                    (0, errors_1.invalid)({ [k]: 'Giờ không hợp lệ (HH:mm).' });
            const data = {
                childId: child.id, campusId: child.campusId, personName, phone: (0, util_1.s)(b.phone ?? existing?.phone) || null, relation, idNumberLast4: idLast4 || null,
                idType: (0, util_1.s)(b.idType ?? existing?.idType) || null, validFrom, validTo,
                validFromTime: (0, util_1.s)(b.validFromTime ?? existing?.validFromTime) || null, validToTime: (0, util_1.s)(b.validToTime ?? existing?.validToTime) || null,
                note: (0, util_1.s)(b.note ?? existing?.note).slice(0, 500), type: 'delegate',
            };
            if (!existing) {
                const status = isParent ? 'pending' : 'approved';
                const extra = isParent ? {} : { approvedBy: ctx.uid, approvedAt: firebase_1.Timestamp.fromDate(ctx.now) };
                const nid = await (0, store_1.createDoc)(ctx, 'pickupAuthorizations', undefined, { ...data, status, requestedBy: ctx.uid, requestedByName: ctx.member?.displayName ?? ctx.uid, ...extra });
                await ctx.audit({ action: 'pickupAuth.save', collection: 'pickupAuthorizations', docId: nid, campusId: child.campusId, after: { personName, validFrom, validTo, status } });
                return { id: nid, ...data, status, version: 1 };
            }
            // sửa: phụ huynh sửa ủy quyền đã duyệt → quay về chờ duyệt
            const patch = { ...data };
            if (isParent && existing.status === 'approved') {
                patch.status = 'pending';
                patch.approvedBy = null;
            }
            const { before, after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`pickupAuthorizations/${id}`), patch, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
            await ctx.audit({ action: 'pickupAuth.save', collection: 'pickupAuthorizations', docId: id, campusId: child.campusId, before: { personName: before.personName, validTo: before.validTo, status: before.status }, after: { personName, validTo, status: after.status } });
            return { id, ...after };
        },
    },
    'pickupAuth.decide': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const id = (0, util_1.requireId)(b.id, 'id');
            const pa = await (0, store_1.getOr404)(ctx.doc(`pickupAuthorizations/${id}`), 'Ủy quyền đón');
            ctx.require('children.write', pa.campusId);
            const decision = (0, util_1.s)(b.decision);
            if (decision !== 'approved' && decision !== 'rejected')
                (0, errors_1.invalid)({ decision: 'Quyết định phải là approved hoặc rejected.' });
            if (pa.status === decision)
                return { id, status: decision, unchanged: true };
            if (pa.status !== 'pending')
                (0, errors_1.fail)('INVALID_STATE', 'Ủy quyền không còn ở trạng thái chờ xác nhận.', { status: pa.status });
            if (decision === 'rejected' && !(0, util_1.s)(b.note))
                (0, errors_1.invalid)({ note: 'Vui lòng nhập lý do từ chối.' });
            if (decision === 'approved' && pa.validTo && pa.validTo < (0, util_1.todayOf)(ctx, await (0, util_1.campusOf)(ctx, pa.campusId)))
                (0, errors_1.invalid)({ validTo: 'Ủy quyền đã quá hạn, không thể duyệt.' });
            const patch = decision === 'approved'
                ? { status: 'approved', approvedBy: ctx.uid, approvedAt: firebase_1.Timestamp.fromDate(ctx.now), decisionNote: (0, util_1.s)(b.note) || null }
                : { status: 'rejected', rejectedBy: ctx.uid, rejectedAt: firebase_1.Timestamp.fromDate(ctx.now), decisionNote: (0, util_1.s)(b.note) };
            const { after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`pickupAuthorizations/${id}`), patch, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
            await ctx.audit({ action: 'pickupAuth.decide', collection: 'pickupAuthorizations', docId: id, campusId: pa.campusId, before: { status: 'pending' }, after: { status: decision }, reason: (0, util_1.s)(b.note) || undefined });
            if (pa.requestedBy)
                void (0, util_1.pushToUsers)(ctx.orgId, [pa.requestedBy], { type: 'pickupAuth', id });
            return { id, status: decision, version: after.version };
        },
    },
    'pickupAuth.revoke': {
        scope: 'org',
        kinds: ['owner', 'staff', 'parent'],
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const id = (0, util_1.requireId)(b.id, 'id');
            const pa = await (0, store_1.getOr404)(ctx.doc(`pickupAuthorizations/${id}`), 'Ủy quyền đón');
            const reason = (0, util_1.s)(b.reason);
            if (!reason)
                (0, errors_1.invalid)({ reason: 'Vui lòng nhập lý do thu hồi.' });
            if (ctx.member?.kind === 'parent') {
                (0, util_1.requireParentOf)(ctx, pa.childId);
            }
            else
                ctx.require('children.write', pa.campusId);
            if (pa.type === 'guardian')
                (0, errors_1.fail)('INVALID_STATE', 'Quyền đón của người giám hộ được thu hồi qua liên kết giám hộ (child.linkGuardian / child.unlinkGuardian).');
            if (pa.status === 'revoked')
                return { id, status: 'revoked', unchanged: true };
            const { after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`pickupAuthorizations/${id}`), {
                status: 'revoked', revokedAt: firebase_1.Timestamp.fromDate(ctx.now), revokedBy: ctx.uid, revokeReason: reason,
            });
            await ctx.audit({ action: 'pickupAuth.revoke', collection: 'pickupAuthorizations', docId: id, campusId: pa.campusId, before: { status: pa.status }, after: { status: 'revoked' }, reason });
            return { id, status: 'revoked', version: after.version };
        },
    },
    // ---------------------------------------------------------------- đơn nghỉ
    'leave.submit': {
        scope: 'org',
        kinds: ['parent'],
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const childId = (0, util_1.requireId)(b.childId, 'childId');
            (0, util_1.requireParentOf)(ctx, childId);
            const child = await (0, util_1.childOf)(ctx, childId);
            if (!IN_SCHOOL.includes(child.status))
                (0, errors_1.fail)('INVALID_STATE', 'Bé hiện không ở trạng thái đang học.');
            const campus = await (0, util_1.campusOf)(ctx, child.campusId);
            const fromDay = (0, util_1.requireDay)(b.fromDay, 'fromDay');
            const toDay = (0, util_1.requireDay)(b.toDay ?? b.fromDay, 'toDay');
            if (toDay < fromDay)
                (0, errors_1.invalid)({ toDay: 'Ngày kết thúc phải từ ngày bắt đầu trở đi.' });
            if (fromDay < (0, util_1.todayOf)(ctx, campus))
                (0, errors_1.invalid)({ fromDay: 'Không thể xin nghỉ cho ngày đã qua.' });
            if ((0, util_1.daysBetween)(fromDay, toDay).length > 60)
                (0, errors_1.invalid)({ toDay: 'Một đơn nghỉ tối đa 60 ngày.' });
            const session = (0, util_1.s)(b.session) || 'all';
            if (!SESSIONS.includes(session))
                (0, errors_1.invalid)({ session: 'Buổi phải là all, am hoặc pm.' });
            const reasonId = (0, util_1.s)(b.reasonId);
            if (!reasonId)
                (0, errors_1.invalid)({ reasonId: 'Chọn lý do nghỉ.' });
            const existing = (await ctx.col('leaveRequests').where('childId', '==', childId).get()).docs
                .filter((d) => ['pending', 'approved'].includes(d.data().status) && d.data().fromDay <= toDay && d.data().toDay >= fromDay);
            if (existing.length)
                (0, errors_1.fail)('CONFLICT', 'Đã có đơn nghỉ trùng thời gian cho bé.', { leaveId: existing[0].id });
            const data = {
                childId, classId: child.classId ?? null, campusId: child.campusId, fromDay, toDay, session, reasonId, reasonText: (0, util_1.s)(b.reasonText) || null,
                note: (0, util_1.s)(b.note).slice(0, 500), status: 'pending', submittedAt: firebase_1.Timestamp.fromDate(ctx.now), submittedBy: ctx.uid,
                submittedByName: ctx.member?.displayName ?? ctx.uid, mealCancelled: null, mealCancelledDays: [],
            };
            const id = await (0, store_1.createDoc)(ctx, 'leaveRequests', undefined, data);
            await ctx.audit({ action: 'leave.submit', collection: 'leaveRequests', docId: id, campusId: child.campusId, after: { childId, fromDay, toDay, session } });
            return { id, ...data, version: 1 };
        },
    },
    'leave.decide': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const id = (0, util_1.requireId)(b.id, 'id');
            const lv = await (0, store_1.getOr404)(ctx.doc(`leaveRequests/${id}`), 'Đơn xin nghỉ');
            ctx.require('leave.decide', lv.campusId);
            await (0, util_1.requireClassAccess)(ctx, lv.campusId, lv.classId ?? null);
            const decision = (0, util_1.s)(b.decision);
            if (decision !== 'approved' && decision !== 'rejected')
                (0, errors_1.invalid)({ decision: 'Quyết định phải là approved hoặc rejected.' });
            if (lv.status === decision)
                return { id, status: decision, unchanged: true };
            if (lv.status !== 'pending')
                (0, errors_1.fail)('INVALID_STATE', 'Đơn không còn ở trạng thái chờ duyệt.', { status: lv.status });
            if (decision === 'rejected' && !(0, util_1.s)(b.note))
                (0, errors_1.invalid)({ note: 'Vui lòng nhập lý do từ chối.' });
            const campus = await (0, util_1.campusOf)(ctx, lv.campusId);
            const tz = campus.timezone || 'Asia/Ho_Chi_Minh';
            const cutoff = campus.mealCutoff && validate_1.TIME_RE.test(campus.mealCutoff) ? campus.mealCutoff : '08:30';
            const submitted = (0, util_1.tsOf)(lv.submittedAt) ?? ctx.now;
            const sDay = (0, store_1.dayKeyOf)(submitted, tz);
            const sTime = (0, store_1.hhmmOf)(submitted, tz);
            const days = (0, util_1.daysBetween)(lv.fromDay, lv.toDay);
            // Mốc chốt tính theo thời điểm GỬI đơn (submittedAt): gửi trước giờ chốt của ngày nghỉ thì hủy được suất ăn ngày đó.
            const mealCancelledDays = decision === 'approved' ? days.filter((d) => d > sDay || (d === sDay && sTime <= cutoff)) : [];
            const patch = {
                status: decision, decidedBy: ctx.uid, decidedByName: ctx.member?.displayName ?? ctx.uid, decidedAt: firebase_1.Timestamp.fromDate(ctx.now),
                decisionNote: (0, util_1.s)(b.note) || null, mealCancelled: mealCancelledDays.length > 0, mealCancelledDays, mealCutoffUsed: cutoff,
                affectsAttendance: false, // đơn nghỉ KHÔNG tự thay điểm danh thực tế
            };
            const { after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`leaveRequests/${id}`), patch, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
            await ctx.audit({ action: 'leave.decide', collection: 'leaveRequests', docId: id, campusId: lv.campusId, before: { status: 'pending' }, after: { status: decision, mealCancelledDays }, reason: (0, util_1.s)(b.note) || undefined });
            if (lv.submittedBy)
                void (0, util_1.pushToUsers)(ctx.orgId, [lv.submittedBy], { type: 'leave', id });
            return { id, status: decision, mealCancelled: patch.mealCancelled, mealCancelledDays, version: after.version };
        },
    },
    'leave.cancel': {
        scope: 'org',
        kinds: ['owner', 'staff', 'parent'],
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const id = (0, util_1.requireId)(b.id, 'id');
            const lv = await (0, store_1.getOr404)(ctx.doc(`leaveRequests/${id}`), 'Đơn xin nghỉ');
            if (ctx.member?.kind === 'parent')
                (0, util_1.requireParentOf)(ctx, lv.childId);
            else
                ctx.require('leave.decide', lv.campusId);
            if (lv.status === 'cancelled')
                return { id, status: 'cancelled', unchanged: true };
            const campus = await (0, util_1.campusOf)(ctx, lv.campusId);
            const today = (0, util_1.todayOf)(ctx, campus);
            if (!['pending', 'approved'].includes(lv.status))
                (0, errors_1.fail)('INVALID_STATE', 'Đơn đã xử lý, không hủy được.', { status: lv.status });
            if (lv.status === 'approved' && lv.fromDay <= today)
                (0, errors_1.fail)('INVALID_STATE', 'Đơn đã bắt đầu hiệu lực, hãy liên hệ nhà trường để điều chỉnh.');
            const { after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`leaveRequests/${id}`), {
                status: 'cancelled', cancelledAt: firebase_1.Timestamp.fromDate(ctx.now), cancelledBy: ctx.uid, cancelReason: (0, util_1.s)(b.reason) || null, mealCancelled: false, mealCancelledDays: [],
            });
            await ctx.audit({ action: 'leave.cancel', collection: 'leaveRequests', docId: id, campusId: lv.campusId, before: { status: lv.status, mealCancelledDays: lv.mealCancelledDays ?? [] }, after: { status: 'cancelled' }, reason: (0, util_1.s)(b.reason) || undefined });
            return { id, status: 'cancelled', version: after.version };
        },
    },
};
/** `at` do client gửi chỉ được chấp nhận trong khoảng hợp lý quanh giờ máy chủ; ngoài khoảng → dùng giờ máy chủ. */
function pickTime(ctx, v) {
    if (!v)
        return ctx.now;
    const d = (0, util_1.parseWhen)(v, 'at');
    if (!d)
        return ctx.now;
    const diff = d.getTime() - ctx.now.getTime();
    if (diff > 5 * 60_000 || diff < -18 * 3600_000)
        return ctx.now;
    return d;
}
