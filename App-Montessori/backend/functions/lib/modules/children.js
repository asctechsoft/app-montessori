"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actions = exports.CHILD_STATUSES = exports.LEAD_STATUSES = void 0;
exports.activeEnrollmentCount = activeEnrollmentCount;
exports.syncEnrolledCount = syncEnrolledCount;
const firebase_1 = require("../core/firebase");
const errors_1 = require("../core/errors");
const approvals_1 = require("../core/approvals");
const store_1 = require("../core/store");
const validate_1 = require("../core/validate");
const permissions_1 = require("../core/permissions");
const approval_core_1 = require("./approval-core");
const people_1 = require("./people");
const util_1 = require("./util");
exports.LEAD_STATUSES = ['new', 'contacted', 'tour_scheduled', 'trial', 'documents', 'approved', 'enrolled', 'lost'];
exports.CHILD_STATUSES = ['pending', 'active', 'trial', 'on_leave', 'withdrawn', 'archived'];
const IN_SCHOOL = ['active', 'trial', 'on_leave'];
// ------------------------------------------------------------------ nội bộ: lớp & sĩ số
async function activeEnrollmentCount(ctx, classId) {
    return (await ctx.col('enrollments').where('classId', '==', classId).where('status', '==', 'active').count().get()).data().count;
}
async function syncEnrolledCount(ctx, classId) {
    if (!classId)
        return;
    const n = await activeEnrollmentCount(ctx, classId);
    await ctx.doc(`classes/${classId}`).update({ enrolledCount: n, updatedAt: firebase_1.Timestamp.fromDate(ctx.now) }).catch(() => undefined);
}
async function freeSeatSuggestions(ctx, campusId, excludeClassId) {
    const classes = (await ctx.col('classes').where('campusId', '==', campusId).get()).docs
        .filter((d) => !d.data().archived && d.data().status !== 'closed' && d.id !== excludeClassId);
    const out = [];
    for (const c of classes) {
        const enrolled = await activeEnrollmentCount(ctx, c.id);
        const cap = c.data().capacity ?? 0;
        if (cap - enrolled > 0)
            out.push({ classId: c.id, name: c.data().name, capacity: cap, enrolled, free: cap - enrolled });
    }
    return out;
}
async function requireOpenClass(ctx, classId) {
    const cls = await (0, util_1.classOf)(ctx, classId);
    if (cls.archived === true || cls.status === 'closed')
        (0, errors_1.fail)('INVALID_STATE', 'Lớp đã đóng hoặc đã lưu trữ.');
    return cls;
}
// ------------------------------------------------------------------ nội bộ: hồ sơ trẻ
const childSchema = {
    code: { t: 'string', min: 2, max: 20, pattern: /^[A-Za-z0-9_-]+$/ },
    fullName: { t: 'string', req: true, min: 2, max: 120 },
    nickname: { t: 'string', max: 60 },
    dob: { t: 'day', req: true },
    gender: { t: 'string', oneOf: ['male', 'female', 'other'] },
    address: { t: 'string', max: 300 },
    photoConsent: { t: 'bool' },
    avatarPath: { t: 'string', max: 300 },
    notes: { t: 'string', max: 1000 },
    missingDocuments: { t: 'array', max: 30, of: { t: 'string', max: 100 } },
};
const healthSchema = {
    allergies: { t: 'array', max: 30, of: { t: 'string', max: 100 } },
    conditions: { t: 'array', max: 30, of: { t: 'string', max: 200 } },
    dietNote: { t: 'string', max: 500 },
    bloodType: { t: 'string', max: 5 },
    doctor: { t: 'string', max: 120 },
    hospital: { t: 'string', max: 120 },
    emergencyContact: { t: 'object' },
    notes: { t: 'string', max: 1000 },
};
function normName(v) {
    return v.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}
function checkDob(ctx, dob) {
    const today = (0, util_1.todayOf)(ctx);
    if (dob > today)
        (0, errors_1.invalid)({ dob: 'Ngày sinh không được ở tương lai.' });
    if (dob < (0, util_1.addDays)(today, -365 * 15))
        (0, errors_1.invalid)({ dob: 'Ngày sinh không hợp lý đối với trẻ mầm non.' });
}
async function findDuplicates(ctx, fullName, dob, exceptId) {
    const snap = await ctx.col('children').where('dob', '==', dob).get();
    return snap.docs.filter((d) => d.id !== exceptId && normName(d.data().fullName ?? '') === normName(fullName) && d.data().status !== 'archived')
        .map((d) => ({ id: d.id, code: d.data().code, fullName: d.data().fullName, campusId: d.data().campusId, status: d.data().status }));
}
async function writeHealth(ctx, childId, campusId, rawHealth) {
    const h = (0, validate_1.validate)((0, util_1.asObj)(rawHealth), healthSchema, { partial: true });
    if (!Object.keys(h).length)
        return;
    const ref = ctx.doc(`children/${childId}/private/health`);
    const snap = await ref.get();
    const before = snap.exists ? snap.data() : null;
    if (snap.exists)
        await ref.update({ ...h, ...ctx.metaUpdate(before.version ?? 1) });
    else
        await ref.create({ ...h, childId, campusId, ...ctx.metaCreate() });
    await ctx.audit({ action: 'child.health.write', collection: 'children/private', docId: `${childId}/health`, campusId, before: before ? '[đã có]' : null, after: Object.keys(h) });
}
/** Mã tự sinh MN001... bằng bộ đếm trong transaction; trùng mã báo lỗi. */
async function createChildDoc(ctx, campusId, data, extra, force = false) {
    const ref = ctx.col('children').doc();
    const counterRef = ctx.doc('counters/childCode');
    const code = await ctx.tx(async (t) => {
        let chosen = (0, util_1.s)(data.code).toUpperCase();
        let next;
        if (!chosen) {
            const cs = await t.get(counterRef);
            let n = (cs.exists ? cs.data().value : 0) + 1;
            for (let i = 0; i < 100; i++, n++) {
                const probe = `MN${String(n).padStart(3, '0')}`;
                if (!(await t.get(ctx.doc(`childCodes/${probe}`))).exists) {
                    chosen = probe;
                    next = n;
                    break;
                }
            }
            if (!chosen)
                (0, errors_1.fail)('INTERNAL', 'Không sinh được mã trẻ. Vui lòng thử lại.');
        }
        else if ((await t.get(ctx.doc(`childCodes/${chosen}`))).exists) {
            (0, errors_1.invalid)({ code: `Mã trẻ ${chosen} đã tồn tại.` }, 'Dữ liệu bị trùng.');
        }
        if (next !== undefined)
            t.set(counterRef, { value: next, updatedAt: firebase_1.Timestamp.fromDate(ctx.now) });
        t.create(ctx.doc(`childCodes/${chosen}`), { childId: ref.id, campusId, createdAt: firebase_1.Timestamp.fromDate(ctx.now) });
        t.create(ref, { ...data, code: chosen, campusId, ...extra, ...ctx.metaCreate() });
        return chosen;
    });
    void force;
    return { id: ref.id, code };
}
async function performEnroll(ctx, p, force) {
    const cls = await requireOpenClass(ctx, p.classId);
    const campusId = cls.campusId;
    const classRef = ctx.doc(`classes/${cls.id}`);
    const enrRef = ctx.col('enrollments').doc();
    let child;
    const status = p.childStatus && ['active', 'trial'].includes(p.childStatus) ? p.childStatus : 'active';
    if (p.existingChildId) {
        const c = await (0, util_1.childOf)(ctx, p.existingChildId);
        if (c.campusId !== campusId)
            (0, errors_1.fail)('INVALID_STATE', 'Trẻ thuộc cơ sở khác. Hãy dùng chức năng chuyển cơ sở.');
        if (c.classId && IN_SCHOOL.includes(c.status))
            (0, errors_1.fail)('CONFLICT', 'Trẻ đã được xếp lớp. Hãy dùng chức năng chuyển lớp.');
        child = { id: c.id, code: c.code };
    }
    else {
        child = { id: '', code: '' };
    }
    const childRef = p.existingChildId ? ctx.doc(`children/${p.existingChildId}`) : ctx.col('children').doc();
    const counterRef = ctx.doc('counters/childCode');
    await ctx.tx(async (t) => {
        const cs = await t.get(classRef);
        if (!cs.exists)
            (0, errors_1.fail)('NOT_FOUND', 'Lớp học không tồn tại.');
        const cap = cs.data().capacity ?? 0;
        const q = await t.get(ctx.col('enrollments').where('classId', '==', cls.id).where('status', '==', 'active'));
        if (!force && q.size >= cap) {
            (0, errors_1.fail)('LIMIT', `Lớp đã đủ sĩ số (${q.size}/${cap}).`, { capacity: cap, enrolled: q.size, classId: cls.id });
        }
        if (!p.existingChildId) {
            let chosen = (0, util_1.s)(p.childData.code).toUpperCase();
            let next;
            if (!chosen) {
                const cn = await t.get(counterRef);
                let n = (cn.exists ? cn.data().value : 0) + 1;
                for (let i = 0; i < 100; i++, n++) {
                    const probe = `MN${String(n).padStart(3, '0')}`;
                    if (!(await t.get(ctx.doc(`childCodes/${probe}`))).exists) {
                        chosen = probe;
                        next = n;
                        break;
                    }
                }
                if (!chosen)
                    (0, errors_1.fail)('INTERNAL', 'Không sinh được mã trẻ. Vui lòng thử lại.');
            }
            else if ((await t.get(ctx.doc(`childCodes/${chosen}`))).exists) {
                (0, errors_1.invalid)({ code: `Mã trẻ ${chosen} đã tồn tại.` }, 'Dữ liệu bị trùng.');
            }
            if (next !== undefined)
                t.set(counterRef, { value: next, updatedAt: firebase_1.Timestamp.fromDate(ctx.now) });
            t.create(ctx.doc(`childCodes/${chosen}`), { childId: childRef.id, campusId, createdAt: firebase_1.Timestamp.fromDate(ctx.now) });
            t.create(childRef, {
                ...p.childData, code: chosen, campusId, classId: cls.id, status, enrolledAt: p.startDate, leadId: p.leadId ?? null,
                archived: false, ...ctx.metaCreate(),
            });
            child = { id: childRef.id, code: chosen };
        }
        else {
            const cur = await t.get(childRef);
            t.update(childRef, { classId: cls.id, status, enrolledAt: p.startDate, ...ctx.metaUpdate(cur.data().version ?? 1) });
        }
        t.create(enrRef, {
            childId: childRef.id, classId: cls.id, campusId, startDate: p.startDate, endDate: null, status: 'active',
            feePlanId: p.feePlanId ?? null, source: 'enroll', exception: force && q.size >= cap, ...ctx.metaCreate(),
        });
        t.update(classRef, { enrolledCount: q.size + 1 });
    });
    if (p.health)
        await writeHealth(ctx, child.id, campusId, p.health);
    const guardians = [];
    const full = await (0, util_1.childOf)(ctx, child.id);
    for (const g of p.guardians)
        guardians.push(await (0, people_1.linkGuardianCore)(ctx, full, g.guardian, g.perms));
    if (p.leadId) {
        const lr = ctx.doc(`leads/${p.leadId}`);
        const ls = await lr.get();
        if (ls.exists) {
            await lr.update({
                status: 'enrolled', enrolledChildId: child.id, enrolledAt: firebase_1.Timestamp.fromDate(ctx.now),
                statusHistory: firebase_1.FieldValue.arrayUnion({ status: 'enrolled', at: firebase_1.Timestamp.fromDate(ctx.now), by: ctx.uid, note: 'Nhập học' }),
                ...ctx.metaUpdate(ls.data().version ?? 1),
            });
        }
    }
    await ctx.audit({
        action: 'lead.enroll', collection: 'enrollments', docId: enrRef.id, campusId,
        after: { childId: child.id, code: child.code, classId: cls.id, startDate: p.startDate, exception: force },
    });
    return { childId: child.id, code: child.code, enrollmentId: enrRef.id, classId: cls.id, campusId, guardians: guardians.map((g) => ({ id: g.id, status: g.status, inviteCode: g.inviteCode ?? null, warning: g.warning })) };
}
// ------------------------------------------------------------------ nội bộ: chuyển lớp/cơ sở
async function executeTransfer(ctx, tr) {
    const child = await (0, util_1.childOf)(ctx, tr.childId);
    if (!IN_SCHOOL.includes(child.status) || child.classId !== tr.fromClassId) {
        (0, errors_1.fail)('INVALID_STATE', 'Trẻ không còn ở lớp ban đầu nên không thể thực hiện chuyển.');
    }
    const toClass = await requireOpenClass(ctx, tr.toClassId);
    const effective = tr.effectiveDate;
    const childRef = ctx.doc(`children/${child.id}`);
    const newEnr = ctx.col('enrollments').doc();
    const trRef = ctx.doc(`transfers/${tr.id}`);
    const cross = tr.fromCampusId !== tr.toCampusId;
    await ctx.tx(async (t) => {
        const cs = await t.get(ctx.doc(`classes/${toClass.id}`));
        const cap = cs.data().capacity ?? 0;
        const full = await t.get(ctx.col('enrollments').where('classId', '==', toClass.id).where('status', '==', 'active'));
        if (full.size >= cap)
            (0, errors_1.fail)('LIMIT', `Lớp đến đã đủ sĩ số (${full.size}/${cap}). Chưa thể hoàn tất chuyển.`, { capacity: cap, enrolled: full.size });
        const oldQ = await t.get(ctx.col('enrollments').where('childId', '==', child.id).where('status', '==', 'active'));
        const cur = await t.get(childRef);
        const trs = await t.get(trRef);
        for (const o of oldQ.docs) {
            const start = o.data().startDate ?? effective;
            const end = (0, util_1.addDays)(effective, -1);
            t.update(o.ref, { status: 'ended', endDate: end < start ? start : end, endReason: 'transfer', transferId: tr.id, ...ctx.metaUpdate(o.data().version ?? 1) });
        }
        t.create(newEnr, {
            childId: child.id, classId: toClass.id, campusId: toClass.campusId, startDate: effective, endDate: null, status: 'active',
            source: 'transfer', transferId: tr.id, ...ctx.metaCreate(),
        });
        t.update(childRef, { classId: toClass.id, campusId: toClass.campusId, ...ctx.metaUpdate(cur.data().version ?? 1) });
        t.update(trRef, {
            status: 'completed', completedAt: firebase_1.Timestamp.fromDate(ctx.now), completedBy: ctx.uid, newEnrollmentId: newEnr.id,
            ...ctx.metaUpdate(trs.data().version ?? 1),
        });
    });
    await syncEnrolledCount(ctx, tr.fromClassId);
    await syncEnrolledCount(ctx, toClass.id);
    const moved = { receivables: 0, deposits: 0, guardianLinks: 0, pickupAuthorizations: 0 };
    if (cross) {
        const toCampus = toClass.campusId;
        for (const col of ['guardianLinks', 'pickupAuthorizations']) {
            const q = await ctx.col(col).where('childId', '==', child.id).get();
            for (const grp of (0, util_1.chunk)(q.docs, 400)) {
                const b = firebase_1.db.batch();
                grp.forEach((d) => b.update(d.ref, { campusId: toCampus, updatedAt: firebase_1.Timestamp.fromDate(ctx.now), version: firebase_1.FieldValue.increment(1) }));
                await b.commit();
                moved[col] += grp.length;
            }
        }
        if (tr.debtHandling === 'move') {
            const q = await ctx.col('receivables').where('childId', '==', child.id).get();
            const open = q.docs.filter((d) => !['paid', 'cancelled'].includes(d.data().status));
            for (const grp of (0, util_1.chunk)(open, 400)) {
                const b = firebase_1.db.batch();
                grp.forEach((d) => b.update(d.ref, { campusId: toCampus, movedFromCampusId: tr.fromCampusId, movedByTransferId: tr.id, updatedAt: firebase_1.Timestamp.fromDate(ctx.now), version: firebase_1.FieldValue.increment(1) }));
                await b.commit();
                moved.receivables += grp.length;
            }
        }
        const dq = await ctx.col('deposits').where('childId', '==', child.id).get();
        const held = dq.docs.filter((d) => d.data().status === 'held');
        if (tr.depositHandling === 'move') {
            for (const d of held) {
                await d.ref.update({ campusId: toCampus, movedFromCampusId: tr.fromCampusId, updatedAt: firebase_1.Timestamp.fromDate(ctx.now), version: firebase_1.FieldValue.increment(1) });
                await (0, store_1.createDoc)(ctx, 'depositMovements', undefined, {
                    transferId: tr.id, childId: child.id, depositId: d.id, amount: d.data().amount ?? 0, fromCampusId: tr.fromCampusId, toCampusId: toCampus,
                    campusId: toCampus, type: 'transfer', note: 'Điều chuyển đặt cọc khi chuyển cơ sở',
                });
                moved.deposits++;
            }
        }
        else if (tr.depositHandling === 'refund' && held.length) {
            await trRef.update({ depositRefundPending: held.map((d) => d.id) });
        }
    }
    await ctx.audit({
        action: 'transfer.execute', collection: 'transfers', docId: tr.id, campusId: toClass.campusId,
        before: { classId: tr.fromClassId, campusId: tr.fromCampusId }, after: { classId: toClass.id, campusId: toClass.campusId, effectiveDate: effective, moved },
    });
    return { moved, newEnrollmentId: newEnr.id };
}
async function cancelOtherTransferApprovals(ctx, tr, exceptApprovalId, status = 'cancelled') {
    for (const side of Object.values((0, util_1.asObj)(tr.sides))) {
        const aid = side.approvalId;
        if (!aid || aid === exceptApprovalId)
            continue;
        const r = ctx.doc(`approvals/${aid}`);
        const sn = await r.get();
        if (sn.exists && sn.data().status === 'pending')
            await r.update({ status, cancelReason: 'Yêu cầu chuyển đã đóng', updatedAt: firebase_1.Timestamp.fromDate(ctx.now), version: firebase_1.FieldValue.increment(1) });
    }
}
(0, approvals_1.registerApprovalHandler)('transfer', {
    perm: 'children.transfer',
    async onApprove(ctx, ap) {
        const trRef = ctx.doc(`transfers/${ap.refId}`);
        const tr = (await (0, store_1.getOr404)(trRef, 'Yêu cầu chuyển'));
        if (tr.status !== 'pending')
            (0, errors_1.fail)('INVALID_STATE', 'Yêu cầu chuyển không còn ở trạng thái chờ duyệt.', { status: tr.status });
        const sides = (0, util_1.asObj)(tr.sides);
        const key = ap.campusId;
        if (!sides[key])
            (0, errors_1.fail)('INVALID_STATE', 'Yêu cầu chuyển không có bước duyệt tại cơ sở này.');
        const others = Object.entries(sides).filter(([k]) => k !== key);
        const allOthersOk = others.every(([, v]) => v.status === 'approved');
        sides[key] = { ...sides[key], status: 'approved', decidedBy: ctx.uid, decidedAt: firebase_1.Timestamp.fromDate(ctx.now) };
        if (allOthersOk) {
            await executeTransfer(ctx, { ...tr, sides });
            await trRef.update({ sides });
            return { transferId: tr.id, completed: true };
        }
        await trRef.update({ sides, ...ctx.metaUpdate(tr.version ?? 1) });
        await ctx.audit({ action: 'transfer.approveSide', collection: 'transfers', docId: tr.id, campusId: key, after: { side: key } });
        return { transferId: tr.id, completed: false, waitingFor: others.filter(([, v]) => v.status !== 'approved').map(([k]) => k) };
    },
    async onReject(ctx, ap, note) {
        const trRef = ctx.doc(`transfers/${ap.refId}`);
        const tr = (await (0, store_1.getOr404)(trRef, 'Yêu cầu chuyển'));
        if (tr.status !== 'pending')
            return null;
        const sides = (0, util_1.asObj)(tr.sides);
        sides[ap.campusId] = { ...sides[ap.campusId], status: 'rejected', decidedBy: ctx.uid, decidedAt: firebase_1.Timestamp.fromDate(ctx.now), note: (0, util_1.s)(note) };
        await trRef.update({ status: 'rejected', sides, rejectedBy: ctx.uid, rejectNote: (0, util_1.s)(note), ...ctx.metaUpdate(tr.version ?? 1) });
        await cancelOtherTransferApprovals(ctx, tr, ap.id);
        return { transferId: tr.id, status: 'rejected' };
    },
});
(0, approval_core_1.registerCancelHook)('transfer', async (ctx, ap, reason) => {
    const trRef = ctx.doc(`transfers/${ap.refId}`);
    const tr = await trRef.get();
    if (!tr.exists || tr.data().status !== 'pending')
        return;
    await trRef.update({ status: 'cancelled', cancelReason: (0, util_1.s)(reason), ...ctx.metaUpdate(tr.data().version ?? 1) });
    await cancelOtherTransferApprovals(ctx, tr.data(), ap.id);
});
(0, approvals_1.registerApprovalHandler)('enrollment_exception', {
    perm: 'classes.write',
    async onApprove(ctx, ap) {
        const pl = (0, util_1.asObj)(ap.payload);
        const result = await performEnroll(ctx, {
            existingChildId: pl.existingChildId, childData: (0, util_1.asObj)(pl.childData), health: pl.health, classId: pl.classId, startDate: pl.startDate,
            feePlanId: pl.feePlanId, guardians: (0, util_1.asArr)(pl.guardians), leadId: pl.leadId, childStatus: pl.childStatus,
        }, true);
        return result;
    },
});
// ------------------------------------------------------------------ actions
const leadSchema = {
    childName: { t: 'string', req: true, min: 2, max: 120 },
    childDob: { t: 'day' },
    parentName: { t: 'string', req: true, min: 2, max: 120 },
    phone: { t: 'string', req: true, max: 30 },
    email: { t: 'string', max: 120 },
    source: { t: 'string', max: 60 },
    interestedClassId: { t: 'string', max: 128 },
    note: { t: 'string', max: 1000 },
    tourAt: { t: 'string', max: 40 },
    assignedTo: { t: 'string', max: 128 },
    documents: { t: 'array', max: 30, of: { t: 'string', max: 100 } },
};
exports.actions = {
    // ---------------- tuyển sinh
    'lead.save': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const id = (0, util_1.s)(b.id);
            let existing = null;
            if (id)
                existing = await (0, store_1.getOr404)(ctx.doc(`leads/${id}`), 'Khách quan tâm');
            const campusId = existing ? existing.campusId : (await (0, util_1.campusOf)(ctx, (0, util_1.s)(b.campusId) || (0, util_1.s)(ctx.campusId))).id;
            ctx.require('leads.write', campusId);
            if (existing?.status === 'enrolled')
                (0, errors_1.fail)('INVALID_STATE', 'Khách đã nhập học, không thể sửa nhu cầu.');
            const d = (0, validate_1.validate)(b, leadSchema, { partial: !!existing });
            if (d.phone !== undefined)
                d.phone = (0, util_1.normPhone)(d.phone);
            if (d.email)
                d.email = (0, util_1.s)(d.email).toLowerCase();
            if (d.tourAt) {
                const w = (0, util_1.parseWhen)(d.tourAt, 'tourAt');
                d.tourAt = firebase_1.Timestamp.fromDate(w);
            }
            const note = (0, util_1.s)(b.consultNote);
            if (!existing) {
                const dup = (await ctx.col('leads').where('phone', '==', d.phone).get()).docs
                    .filter((x) => x.data().campusId === campusId && !['lost', 'enrolled'].includes(x.data().status))
                    .map((x) => ({ id: x.id, childName: x.data().childName, status: x.data().status }));
                const data = {
                    ...d, campusId, status: 'new', statusHistory: [{ status: 'new', at: firebase_1.Timestamp.fromDate(ctx.now), by: ctx.uid }],
                    consultNotes: note ? [{ at: firebase_1.Timestamp.fromDate(ctx.now), by: ctx.uid, byName: ctx.member?.displayName ?? '', text: note }] : [],
                    archived: false,
                };
                const nid = await (0, store_1.createDoc)(ctx, 'leads', undefined, data);
                await ctx.audit({ action: 'lead.save', collection: 'leads', docId: nid, campusId, after: { childName: d.childName, phone: d.phone } });
                return { id: nid, ...data, version: 1, duplicates: dup };
            }
            const patch = { ...d };
            if (note)
                patch.consultNotes = firebase_1.FieldValue.arrayUnion({ at: firebase_1.Timestamp.fromDate(ctx.now), by: ctx.uid, byName: ctx.member?.displayName ?? '', text: note });
            if (!Object.keys(patch).length)
                (0, errors_1.invalid)({ childName: 'Không có thay đổi để lưu.' });
            const { before, after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`leads/${id}`), patch, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
            await ctx.audit({ action: 'lead.save', collection: 'leads', docId: id, campusId, before: Object.fromEntries(Object.keys(d).map((k) => [k, before[k] ?? null])), after: d });
            return { id, ...after, duplicates: [] };
        },
    },
    'lead.setStatus': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const id = (0, util_1.requireId)(b.id, 'id');
            const status = (0, util_1.s)(b.status);
            if (!exports.LEAD_STATUSES.includes(status))
                (0, errors_1.invalid)({ status: 'Trạng thái không hợp lệ.' });
            const lead = await (0, store_1.getOr404)(ctx.doc(`leads/${id}`), 'Khách quan tâm');
            ctx.require('leads.write', lead.campusId);
            if (lead.status === status)
                return { id, status, unchanged: true };
            if (lead.status === 'enrolled')
                (0, errors_1.fail)('INVALID_STATE', 'Khách đã nhập học, không đổi trạng thái được nữa.');
            if (status === 'enrolled' && !lead.enrolledChildId)
                (0, errors_1.fail)('INVALID_STATE', 'Chỉ chuyển sang "đã nhập học" thông qua thao tác nhập học (lead.enroll).');
            if (status === 'lost' && !(0, util_1.s)(b.lostReason))
                (0, errors_1.invalid)({ lostReason: 'Vui lòng nhập lý do không tiếp tục.' });
            const patch = {
                status,
                statusHistory: firebase_1.FieldValue.arrayUnion({ status, at: firebase_1.Timestamp.fromDate(ctx.now), by: ctx.uid, note: (0, util_1.s)(b.note) || null }),
            };
            if (status === 'lost')
                patch.lostReason = (0, util_1.s)(b.lostReason);
            if (b.tourAt)
                patch.tourAt = firebase_1.Timestamp.fromDate((0, util_1.parseWhen)(b.tourAt, 'tourAt'));
            const { after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`leads/${id}`), patch, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
            await ctx.audit({ action: 'lead.setStatus', collection: 'leads', docId: id, campusId: lead.campusId, before: { status: lead.status }, after: { status }, reason: (0, util_1.s)(b.note) || (0, util_1.s)(b.lostReason) || undefined });
            return { id, status, version: after.version };
        },
    },
    'lead.enroll': {
        scope: 'org',
        idempotent: true,
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const cls = await requireOpenClass(ctx, (0, util_1.s)(b.classId));
            ctx.require('children.write', cls.campusId);
            const startDate = (0, util_1.requireDay)(b.startDate, 'startDate');
            const campus = await (0, util_1.campusOf)(ctx, cls.campusId);
            if (startDate < (0, util_1.addDays)((0, util_1.todayOf)(ctx, campus), -31))
                (0, errors_1.invalid)({ startDate: 'Ngày nhập học quá xa trong quá khứ.' });
            const childIn = (0, util_1.asObj)(b.child);
            const existingChildId = (0, util_1.s)(childIn.id) || undefined;
            let childData = {};
            if (!existingChildId) {
                childData = (0, validate_1.validate)(childIn, childSchema);
                checkDob(ctx, childData.dob);
                const dups = await findDuplicates(ctx, childData.fullName, childData.dob);
                if (dups.length && b.confirmDuplicate !== true)
                    (0, errors_1.fail)('CONFLICT', 'Đã có hồ sơ trẻ trùng tên và ngày sinh. Kiểm tra lại hoặc xác nhận tạo mới.', { duplicates: dups });
                childData.archived = false;
            }
            let leadId;
            if ((0, util_1.s)(b.leadId)) {
                leadId = (0, util_1.requireId)(b.leadId, 'leadId');
                const lead = await (0, store_1.getOr404)(ctx.doc(`leads/${leadId}`), 'Khách quan tâm');
                ctx.require('leads.read', lead.campusId);
                if (lead.status === 'enrolled')
                    (0, errors_1.fail)('CONFLICT', 'Khách này đã được nhập học.');
                if (lead.status === 'lost')
                    (0, errors_1.fail)('INVALID_STATE', 'Khách đã dừng quan tâm. Hãy mở lại trạng thái trước khi nhập học.');
            }
            const guardians = (0, util_1.asArr)(b.guardians).map((g0) => {
                const g = (0, util_1.asObj)(g0);
                return { guardian: { name: g.name, phone: g.phone, email: g.email, relation: g.relation }, perms: g.perms ?? { notify: true } };
            });
            if (childIn.health || b.health)
                ctx.require('children.health.read', cls.campusId);
            const params = {
                existingChildId, childData, health: childIn.health ?? b.health, classId: cls.id, startDate, feePlanId: (0, util_1.s)(b.feePlanId) || undefined,
                guardians, leadId, childStatus: (0, util_1.s)(childIn.status),
            };
            // cảnh báo độ tuổi
            const warnings = [];
            const dob = childData.dob;
            if (dob && (cls.minAgeMonths !== undefined || cls.maxAgeMonths !== undefined)) {
                const months = (Date.parse(startDate) - Date.parse(dob)) / (30.4375 * 86400_000);
                if ((cls.minAgeMonths !== undefined && months < cls.minAgeMonths) || (cls.maxAgeMonths !== undefined && months > cls.maxAgeMonths)) {
                    warnings.push('Độ tuổi của trẻ nằm ngoài khối tuổi của lớp.');
                }
            }
            const enrolled = await activeEnrollmentCount(ctx, cls.id);
            const cap = cls.capacity ?? 0;
            if (enrolled >= cap) {
                if (b.requestException === true) {
                    if (!(0, util_1.s)(b.exceptionReason))
                        (0, errors_1.invalid)({ exceptionReason: 'Vui lòng nhập lý do xin nhận vượt sĩ số.' });
                    const name = existingChildId ? (await (0, util_1.childOf)(ctx, existingChildId)).fullName : childData.fullName;
                    const approvalId = await (0, approvals_1.createApproval)(ctx, {
                        type: 'enrollment_exception', campusId: cls.campusId,
                        summary: `Xin nhận trẻ ${name} vào lớp ${cls.name} vượt sĩ số (${enrolled}/${cap}).`,
                        impact: { classId: cls.id, capacity: cap, enrolled, after: enrolled + 1, reason: (0, util_1.s)(b.exceptionReason) },
                        refCollection: 'classes', refId: cls.id,
                        payload: { ...params, exceptionReason: (0, util_1.s)(b.exceptionReason) },
                    });
                    await ctx.audit({ action: 'lead.enroll.requestException', collection: 'approvals', docId: approvalId, campusId: cls.campusId, reason: (0, util_1.s)(b.exceptionReason) });
                    return { status: 'pending_approval', approvalId, capacity: cap, enrolled };
                }
                (0, errors_1.fail)('LIMIT', `Lớp ${cls.name} đã đủ sĩ số (${enrolled}/${cap}).`, {
                    capacity: cap, enrolled, classId: cls.id, suggestions: await freeSeatSuggestions(ctx, cls.campusId, cls.id),
                });
            }
            const result = await performEnroll(ctx, params, false);
            return { status: 'enrolled', ...result, warnings };
        },
    },
    // ---------------- hồ sơ trẻ
    'child.save': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b0 = (0, util_1.asObj)(p);
            const b = b0.child ? { ...b0, ...(0, util_1.asObj)(b0.child) } : b0;
            const id = (0, util_1.s)(b.id);
            const health = b.health;
            if (!id) {
                const campusId = (await (0, util_1.campusOf)(ctx, (0, util_1.s)(b.campusId) || (0, util_1.s)(ctx.campusId))).id;
                ctx.require('children.write', campusId);
                const d = (0, validate_1.validate)(b, childSchema);
                checkDob(ctx, d.dob);
                const dups = await findDuplicates(ctx, d.fullName, d.dob);
                if (dups.length && b.confirmDuplicate !== true)
                    (0, errors_1.fail)('CONFLICT', 'Đã có hồ sơ trẻ trùng tên và ngày sinh. Kiểm tra lại hoặc xác nhận tạo mới.', { duplicates: dups });
                if (health)
                    ctx.require('children.health.read', campusId);
                const status = ['pending', 'trial'].includes((0, util_1.s)(b.status)) ? (0, util_1.s)(b.status) : 'pending';
                const created = await createChildDoc(ctx, campusId, d, { classId: null, status, archived: false });
                if (health)
                    await writeHealth(ctx, created.id, campusId, health);
                await ctx.audit({ action: 'child.save', collection: 'children', docId: created.id, campusId, after: { code: created.code, fullName: d.fullName } });
                return { id: created.id, code: created.code, campusId, status, version: 1 };
            }
            const cur = await (0, util_1.childOf)(ctx, id);
            ctx.require('children.write', cur.campusId);
            if (cur.status === 'archived')
                (0, errors_1.fail)('INVALID_STATE', 'Hồ sơ đã lưu trữ, không thể sửa.');
            if (b.code !== undefined && (0, util_1.s)(b.code).toUpperCase() !== cur.code)
                (0, errors_1.invalid)({ code: 'Không được đổi mã trẻ.' });
            if (b.campusId !== undefined && (0, util_1.s)(b.campusId) && (0, util_1.s)(b.campusId) !== cur.campusId)
                (0, errors_1.invalid)({ campusId: 'Đổi cơ sở phải dùng chức năng chuyển cơ sở.' });
            const { code: _c, ...schemaNoCode } = childSchema;
            void _c;
            const d = (0, validate_1.validate)(b, schemaNoCode, { partial: true });
            if (d.dob)
                checkDob(ctx, d.dob);
            if ((d.fullName || d.dob) && b.confirmDuplicate !== true) {
                const dups = await findDuplicates(ctx, d.fullName ?? cur.fullName, d.dob ?? cur.dob, id);
                if (dups.length)
                    (0, errors_1.fail)('CONFLICT', 'Đã có hồ sơ trẻ trùng tên và ngày sinh.', { duplicates: dups });
            }
            if (health)
                ctx.require('children.health.read', cur.campusId);
            let after = cur;
            if (Object.keys(d).length) {
                const r = await (0, store_1.updateDoc)(ctx, ctx.doc(`children/${id}`), d, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
                after = r.after;
                await ctx.audit({ action: 'child.save', collection: 'children', docId: id, campusId: cur.campusId, before: Object.fromEntries(Object.keys(d).map((k) => [k, r.before[k] ?? null])), after: d });
            }
            else if (!health)
                (0, errors_1.invalid)({ fullName: 'Không có thay đổi để lưu.' });
            if (health)
                await writeHealth(ctx, id, cur.campusId, health);
            return { id, code: cur.code, campusId: cur.campusId, status: after.status, version: after.version };
        },
    },
    'child.setStatus': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const child = await (0, util_1.childOf)(ctx, b.childId);
            ctx.require('children.write', child.campusId);
            const status = (0, util_1.s)(b.status);
            if (!exports.CHILD_STATUSES.includes(status))
                (0, errors_1.invalid)({ status: 'Trạng thái không hợp lệ.' });
            const effectiveDate = (0, util_1.requireDay)(b.effectiveDate, 'effectiveDate');
            const reason = (0, util_1.s)(b.reason);
            if (!reason)
                (0, errors_1.invalid)({ reason: 'Vui lòng nhập lý do.' });
            if (child.status === status)
                return { childId: child.id, status, unchanged: true };
            const leaving = status === 'withdrawn' || status === 'archived';
            if (['withdrawn', 'archived'].includes(child.status) && IN_SCHOOL.includes(status)) {
                (0, errors_1.fail)('INVALID_STATE', 'Trẻ đã thôi học. Hãy nhập học lại bằng chức năng nhập học.');
            }
            if (IN_SCHOOL.includes(status) && !child.classId)
                (0, errors_1.fail)('INVALID_STATE', 'Trẻ chưa được xếp lớp nên chưa thể đặt trạng thái này.');
            const prevClass = child.classId ?? null;
            const patch = { status, statusEffectiveDate: effectiveDate, statusReason: reason };
            if (leaving || status === 'pending')
                patch.classId = null;
            if (leaving)
                patch.lastClassId = prevClass;
            const { before, after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`children/${child.id}`), patch, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
            if (leaving || status === 'pending') {
                const q = await ctx.col('enrollments').where('childId', '==', child.id).where('status', '==', 'active').get();
                for (const e of q.docs) {
                    const start = e.data().startDate ?? effectiveDate;
                    await e.ref.update({ status: 'ended', endDate: effectiveDate < start ? start : effectiveDate, endReason: status, ...ctx.metaUpdate(e.data().version ?? 1) });
                }
                await syncEnrolledCount(ctx, prevClass);
            }
            await (0, store_1.createDoc)(ctx, 'childStatusHistory', undefined, {
                childId: child.id, campusId: child.campusId, from: before.status, to: status, effectiveDate, reason,
                at: firebase_1.Timestamp.fromDate(ctx.now), by: ctx.uid, byName: ctx.member?.displayName ?? ctx.uid,
            });
            let outstanding = 0;
            if (leaving) {
                const r = await ctx.col('receivables').where('childId', '==', child.id).get();
                outstanding = r.docs.filter((d) => !['paid', 'cancelled', 'draft'].includes(d.data().status) && (typeof d.data().balance !== 'number' || d.data().balance > 0)).length;
            }
            await ctx.audit({ action: 'child.setStatus', collection: 'children', docId: child.id, campusId: child.campusId, before: { status: before.status, classId: prevClass }, after: { status, effectiveDate }, reason });
            return { childId: child.id, status, effectiveDate, version: after.version, outstandingReceivables: outstanding };
        },
    },
    'child.linkGuardian': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const child = await (0, util_1.childOf)(ctx, b.childId);
            ctx.require('children.write', child.campusId);
            if (child.status === 'archived')
                (0, errors_1.fail)('INVALID_STATE', 'Hồ sơ đã lưu trữ.');
            const r = await (0, people_1.linkGuardianCore)(ctx, child, b.guardian, b.perms);
            return { id: r.id, status: r.status, uid: r.uid ?? null, inviteCode: r.inviteCode ?? null, perms: r.perms, warning: r.warning ?? null };
        },
    },
    'child.unlinkGuardian': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const child = await (0, util_1.childOf)(ctx, b.childId);
            ctx.require('children.write', child.campusId);
            const r = await (0, people_1.unlinkGuardianCore)(ctx, child, (0, util_1.requireId)(b.linkId ?? b.id, 'linkId'), (0, util_1.s)(b.reason));
            return { id: r.id, status: 'unlinked' };
        },
    },
    // ---------------- phân công giáo viên
    'assignment.save': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const id = (0, util_1.s)(b.id);
            let existing = null;
            if (id)
                existing = await (0, store_1.getOr404)(ctx.doc(`assignments/${id}`), 'Phân công');
            const cls = await (0, util_1.classOf)(ctx, existing ? existing.classId : b.classId);
            ctx.require('classes.write', cls.campusId);
            if (existing && b.cancel === true) {
                const { after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`assignments/${id}`), { status: 'cancelled', cancelReason: (0, util_1.s)(b.reason) || null });
                await ctx.audit({ action: 'assignment.cancel', collection: 'assignments', docId: id, campusId: cls.campusId, before: { status: existing.status }, after: { status: 'cancelled' }, reason: (0, util_1.s)(b.reason) || undefined });
                return { id, status: 'cancelled', version: after.version };
            }
            const uid = (0, util_1.requireId)(existing ? existing.uid : b.uid, 'uid');
            const role = (0, util_1.s)(b.role ?? existing?.role);
            if (!['main', 'assistant', 'substitute'].includes(role))
                (0, errors_1.invalid)({ role: 'Vai trò phải là main, assistant hoặc substitute.' });
            const mem = await ctx.doc(`members/${uid}`).get();
            if (!mem.exists || mem.data().status !== 'active' || mem.data().kind === 'parent')
                (0, errors_1.invalid)({ uid: 'Nhân sự không tồn tại hoặc chưa kích hoạt.' });
            if (!(0, permissions_1.hasPerm)(mem.data().permsByCampus, 'attendance.write', cls.campusId))
                (0, errors_1.invalid)({ uid: 'Nhân sự chưa được cấp vai trò giáo viên tại cơ sở này.' });
            const from = (0, util_1.parseWhen)(b.validFrom ?? existing?.validFrom, 'validFrom') ?? ctx.now;
            const to = (0, util_1.parseWhen)(b.validTo === null ? null : (b.validTo ?? (0, util_1.tsOf)(existing?.validTo)?.toISOString()), 'validTo', true);
            if (to && to <= from)
                (0, errors_1.invalid)({ validTo: 'Thời điểm kết thúc phải sau thời điểm bắt đầu.' });
            const fromMs = from.getTime();
            const toMs = to ? to.getTime() : Infinity;
            const all = await ctx.col('assignments').where('campusId', '==', cls.campusId).get();
            const conflicts = all.docs.filter((d) => {
                const a = d.data();
                if (d.id === id || a.status === 'cancelled')
                    return false;
                const aFrom = (0, util_1.tsOf)(a.validFrom)?.getTime() ?? 0;
                const aTo = (0, util_1.tsOf)(a.validTo)?.getTime() ?? Infinity;
                if (!(fromMs < aTo && aFrom < toMs))
                    return false;
                if (a.uid === uid)
                    return true; // một người không thể hai phân công trùng thời gian
                return a.classId === cls.id && a.role === 'main' && role === 'main'; // một lớp chỉ một giáo viên chính tại một thời điểm
            }).map((d) => ({ id: d.id, classId: d.data().classId, uid: d.data().uid, role: d.data().role, validFrom: d.data().validFrom, validTo: d.data().validTo ?? null }));
            if (conflicts.length)
                (0, errors_1.fail)('CONFLICT', 'Phân công bị chồng lấn với phân công khác.', { conflicts });
            const data = { classId: cls.id, campusId: cls.campusId, uid, role, validFrom: firebase_1.Timestamp.fromDate(from), validTo: to ? firebase_1.Timestamp.fromDate(to) : null, note: (0, util_1.s)(b.note), employeeId: mem.data().employeeId ?? null };
            if (!existing) {
                const nid = await (0, store_1.createDoc)(ctx, 'assignments', undefined, { ...data, status: 'active', teacherName: mem.data().displayName });
                await ctx.audit({ action: 'assignment.save', collection: 'assignments', docId: nid, campusId: cls.campusId, after: { classId: cls.id, uid, role } });
                return { id: nid, ...data, status: 'active', version: 1 };
            }
            const { before, after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`assignments/${id}`), data, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
            await ctx.audit({ action: 'assignment.save', collection: 'assignments', docId: id, campusId: cls.campusId, before: { uid: before.uid, role: before.role }, after: { uid, role } });
            return { id, ...after };
        },
    },
    // ---------------- chuyển lớp / cơ sở
    'transfer.request': {
        scope: 'org',
        idempotent: true,
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const child = await (0, util_1.childOf)(ctx, b.childId);
            ctx.require('children.transfer', child.campusId);
            if (!IN_SCHOOL.includes(child.status) || !child.classId)
                (0, errors_1.fail)('INVALID_STATE', 'Chỉ chuyển được trẻ đang học và đã có lớp.');
            if (!(0, util_1.s)(b.toClassId))
                (0, errors_1.invalid)({ toClassId: 'Vui lòng chọn lớp đến.' });
            const toClass = await requireOpenClass(ctx, (0, util_1.s)(b.toClassId));
            if ((0, util_1.s)(b.toCampusId) && (0, util_1.s)(b.toCampusId) !== toClass.campusId)
                (0, errors_1.invalid)({ toCampusId: 'Lớp đến không thuộc cơ sở đã chọn.' });
            if (toClass.id === child.classId)
                (0, errors_1.invalid)({ toClassId: 'Lớp đến trùng lớp hiện tại.' });
            const effectiveDate = (0, util_1.requireDay)(b.effectiveDate, 'effectiveDate');
            const campus = await (0, util_1.campusOf)(ctx, child.campusId);
            if (effectiveDate < (0, util_1.todayOf)(ctx, campus))
                (0, errors_1.invalid)({ effectiveDate: 'Ngày hiệu lực không được ở quá khứ.' });
            const cross = toClass.campusId !== child.campusId;
            const debtHandling = (0, util_1.s)(b.debtHandling) || 'stay';
            const depositHandling = (0, util_1.s)(b.depositHandling) || 'stay';
            if (!['stay', 'move'].includes(debtHandling))
                (0, errors_1.invalid)({ debtHandling: 'Chọn stay hoặc move.' });
            if (!['stay', 'move', 'refund'].includes(depositHandling))
                (0, errors_1.invalid)({ depositHandling: 'Chọn stay, move hoặc refund.' });
            const pend = await ctx.col('transfers').where('childId', '==', child.id).where('status', '==', 'pending').limit(1).get();
            if (!pend.empty)
                (0, errors_1.fail)('CONFLICT', 'Trẻ đang có yêu cầu chuyển chờ duyệt.', { transferId: pend.docs[0].id });
            const enrolled = await activeEnrollmentCount(ctx, toClass.id);
            const cap = toClass.capacity ?? 0;
            if (enrolled >= cap) {
                (0, errors_1.fail)('LIMIT', `Lớp đến đã đủ sĩ số (${enrolled}/${cap}).`, { capacity: cap, enrolled, suggestions: await freeSeatSuggestions(ctx, toClass.campusId, toClass.id) });
            }
            // tác động: công nợ & đặt cọc
            const rc = await ctx.col('receivables').where('childId', '==', child.id).get();
            const openDebt = rc.docs.filter((d) => !['paid', 'cancelled', 'draft'].includes(d.data().status));
            const debtAmount = openDebt.reduce((sum, d) => sum + (typeof d.data().balance === 'number' ? d.data().balance : 0), 0);
            const dp = await ctx.col('deposits').where('childId', '==', child.id).get();
            const held = dp.docs.filter((d) => d.data().status === 'held');
            const impact = {
                fromClassId: child.classId, toClassId: toClass.id, crossCampus: cross, effectiveDate, debtHandling, depositHandling,
                openReceivables: openDebt.length, openDebtAmount: debtAmount, depositsHeld: held.length, depositAmount: held.reduce((x, d) => x + (d.data().amount ?? 0), 0),
            };
            const trId = await (0, store_1.createDoc)(ctx, 'transfers', undefined, {
                childId: child.id, childName: child.fullName, childCode: child.code, fromCampusId: child.campusId, fromClassId: child.classId,
                toCampusId: toClass.campusId, toClassId: toClass.id, effectiveDate, debtHandling, depositHandling, reason: (0, util_1.s)(b.reason),
                crossCampus: cross, campusId: child.campusId, status: 'pending', sides: {}, impact,
            });
            const campuses = [...new Set([child.campusId, toClass.campusId])];
            const sides = {};
            for (const c of campuses) {
                const approvalId = await (0, approvals_1.createApproval)(ctx, {
                    type: 'transfer', campusId: c,
                    summary: `Chuyển ${child.fullName} (${child.code}) ${cross ? 'sang cơ sở khác' : 'sang lớp khác'} từ ${effectiveDate}.`,
                    impact, refCollection: 'transfers', refId: trId, payload: { transferId: trId },
                });
                sides[c] = { status: 'pending', approvalId };
            }
            await ctx.doc(`transfers/${trId}`).update({ sides });
            await ctx.audit({ action: 'transfer.request', collection: 'transfers', docId: trId, campusId: child.campusId, after: impact, reason: (0, util_1.s)(b.reason) || undefined });
            return { id: trId, status: 'pending', sides, impact };
        },
    },
    'transfer.decide': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const id = (0, util_1.requireId)(b.id, 'id');
            const tr = await (0, store_1.getOr404)(ctx.doc(`transfers/${id}`), 'Yêu cầu chuyển');
            const sides = (0, util_1.asObj)(tr.sides);
            const pending = Object.entries(sides).filter(([, v]) => v.status === 'pending');
            let key = (0, util_1.s)(b.campusId);
            if (!key) {
                const mine = pending.filter(([c]) => ctx.can('children.transfer', c));
                if (!mine.length)
                    (0, errors_1.denied)('Bạn không có quyền duyệt yêu cầu chuyển này.');
                key = mine[0][0];
            }
            const side = sides[key];
            if (!side)
                (0, errors_1.invalid)({ campusId: 'Cơ sở không thuộc yêu cầu chuyển này.' });
            const r = await (0, approval_core_1.decideApprovalCore)(ctx, side.approvalId, (0, util_1.s)(b.decision), (0, util_1.s)(b.note));
            const fresh = await ctx.doc(`transfers/${id}`).get();
            return { id, transferStatus: fresh.data().status, approval: { id: side.approvalId, status: r.status }, result: r.result ?? null };
        },
    },
};
