"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actions = void 0;
const firebase_1 = require("../core/firebase");
const errors_1 = require("../core/errors");
const store_1 = require("../core/store");
const validate_1 = require("../core/validate");
const permissions_1 = require("../core/permissions");
const util_1 = require("./util");
const IN_SCHOOL = ['active', 'trial', 'on_leave'];
const dlId = (childId, dayKey) => `${childId}_${dayKey}`;
function checkPhotoPaths(ctx, child, paths) {
    if (!paths.length)
        return;
    const prefix = `orgs/${ctx.orgId}/campuses/${child.campusId}/`;
    for (const p of paths) {
        if (typeof p !== 'string' || !p.startsWith(prefix) || p.includes('..'))
            (0, errors_1.invalid)({ photoPaths: 'Đường dẫn ảnh không hợp lệ hoặc thuộc cơ sở khác.' });
    }
    if (child.photoConsent !== true)
        (0, errors_1.fail)('PRECONDITION', 'Phụ huynh chưa đồng ý sử dụng hình ảnh của bé nên không thể đính kèm ảnh.', { reason: 'no_photo_consent' });
}
const logSchema = {
    meals: { t: 'array', max: 12, of: { t: 'object' } },
    sleep: { t: 'array', max: 8, of: { t: 'object' } },
    hygiene: { t: 'object' },
    mood: { t: 'string', max: 40 },
    activities: { t: 'array', max: 20, of: { t: 'string', max: 200 } },
    note: { t: 'string', max: 1500 },
    photoPaths: { t: 'array', max: 10, of: { t: 'string', max: 400 } },
};
exports.actions = {
    // ---------------------------------------------------------------- nhật ký
    'dailyLog.save': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const child = await (0, util_1.childOf)(ctx, b.childId);
            ctx.require('care.write', child.campusId);
            await (0, util_1.requireClassAccess)(ctx, child.campusId, child.classId ?? null);
            if (!IN_SCHOOL.includes(child.status) || !child.classId)
                (0, errors_1.fail)('INVALID_STATE', 'Bé không ở trạng thái đang học nên không ghi nhật ký.');
            const campus = await (0, util_1.campusOf)(ctx, child.campusId);
            const dayKey = (0, util_1.requireDay)(b.dayKey, 'dayKey');
            if (dayKey > (0, util_1.todayOf)(ctx, campus))
                (0, errors_1.invalid)({ dayKey: 'Không thể ghi nhật ký cho ngày ở tương lai.' });
            if (!(await (0, util_1.enrolledOn)(ctx, child.id, child.classId, dayKey)))
                (0, errors_1.invalid)({ dayKey: 'Bé không thuộc lớp trong ngày này.' });
            const d = (0, validate_1.validate)(b, logSchema, { partial: true });
            for (const m of (0, util_1.asArr)(d.sleep)) {
                for (const k of ['from', 'to'])
                    if (m?.[k] && !validate_1.TIME_RE.test(String(m[k])))
                        (0, errors_1.invalid)({ sleep: 'Giờ ngủ không hợp lệ (HH:mm).' });
            }
            if (d.photoPaths)
                checkPhotoPaths(ctx, child, d.photoPaths);
            const ref = ctx.doc(`dailyLogs/${dlId(child.id, dayKey)}`);
            const cur = await ref.get();
            if (!cur.exists) {
                const data = { ...d, childId: child.id, classId: child.classId, campusId: child.campusId, dayKey, status: 'draft', revision: 1, authorUid: ctx.uid, authorName: ctx.member?.displayName ?? ctx.uid };
                await (0, store_1.createDoc)(ctx, 'dailyLogs', ref.id, data);
                await ctx.audit({ action: 'dailyLog.save', collection: 'dailyLogs', docId: ref.id, campusId: child.campusId, after: { dayKey, status: 'draft' } });
                return { id: ref.id, ...data, version: 1 };
            }
            const prev = cur.data();
            const patch = { ...d, revision: (prev.revision ?? 1) + 1, lastEditorUid: ctx.uid, ...(prev.status === 'published' ? { editedAfterPublish: true } : {}) };
            const { after } = await (0, store_1.updateDoc)(ctx, ref, patch, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
            await ctx.audit({ action: 'dailyLog.save', collection: 'dailyLogs', docId: ref.id, campusId: child.campusId, before: { status: prev.status, revision: prev.revision }, after: { status: after.status, revision: patch.revision } });
            return { id: ref.id, ...after };
        },
    },
    'dailyLog.publish': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const cls = await (0, util_1.classOf)(ctx, b.classId);
            ctx.require('care.publish', cls.campusId);
            const dayKey = (0, util_1.requireDay)(b.dayKey, 'dayKey');
            const filter = (0, util_1.asArr)(b.childIds).map(util_1.s).filter(Boolean);
            const q = await ctx.col('dailyLogs').where('classId', '==', cls.id).where('dayKey', '==', dayKey).get();
            const published = [];
            const skipped = [];
            let already = 0;
            const targets = q.docs.filter((d) => !filter.length || filter.includes(d.data().childId));
            for (const f of filter)
                if (!targets.some((d) => d.data().childId === f))
                    skipped.push({ childId: f, reason: 'Chưa có nhật ký cho bé trong ngày này.' });
            const nowTs = firebase_1.Timestamp.fromDate(ctx.now);
            const ok = [];
            for (const d of targets) {
                const l = d.data();
                if (l.status === 'published') {
                    already++;
                    continue;
                }
                if (l.dayKey !== dayKey || l.classId !== cls.id) {
                    skipped.push({ childId: l.childId, reason: 'Nhật ký không đúng ngày/lớp.' });
                    continue;
                }
                const cs = await ctx.doc(`children/${l.childId}`).get();
                if (!cs.exists || cs.data().campusId !== cls.campusId) {
                    skipped.push({ childId: l.childId, reason: 'Hồ sơ trẻ không hợp lệ.' });
                    continue;
                }
                if (!(await (0, util_1.enrolledOn)(ctx, l.childId, cls.id, dayKey))) {
                    skipped.push({ childId: l.childId, reason: 'Bé không thuộc lớp trong ngày này.' });
                    continue;
                }
                if ((0, util_1.asArr)(l.photoPaths).length && cs.data().photoConsent !== true) {
                    skipped.push({ childId: l.childId, reason: 'Có ảnh nhưng bé chưa có đồng ý sử dụng hình ảnh.' });
                    continue;
                }
                ok.push(d);
            }
            for (const part of (0, util_1.chunk)(ok, 400)) {
                const batch = firebase_1.db.batch();
                part.forEach((d) => batch.update(d.ref, { status: 'published', publishedAt: nowTs, publishedBy: ctx.uid, updatedAt: nowTs, updatedBy: ctx.uid, version: (d.data().version ?? 1) + 1 }));
                await batch.commit();
            }
            for (const d of ok)
                published.push(d.data().childId);
            await ctx.audit({ action: 'dailyLog.publish', collection: 'dailyLogs', docId: `${cls.id}_${dayKey}`, campusId: cls.campusId, after: { published: published.length, skipped: skipped.length } });
            if (published.length) {
                const uids = [];
                for (const cid of published)
                    uids.push(...(await (0, util_1.parentUidsOfChild)(ctx, cid, 'notify')));
                void (0, util_1.pushToUsers)(ctx.orgId, uids, { type: 'dailyLog' });
            }
            return { classId: cls.id, dayKey, published, skipped, alreadyPublished: already };
        },
    },
    // ---------------------------------------------------------------- sức khỏe
    'health.record': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const child = await (0, util_1.childOf)(ctx, b.childId);
            if (!ctx.can('care.write', child.campusId) && !ctx.can('medication.write', child.campusId))
                (0, errors_1.denied)();
            await (0, util_1.requireClassAccess)(ctx, child.campusId, child.classId ?? null);
            const d = (0, validate_1.validate)(b, {
                heightCm: { t: 'number', req: true, min: 30, max: 200 }, weightKg: { t: 'number', req: true, min: 2, max: 80 },
                measuredOn: { t: 'day', req: true }, note: { t: 'string', max: 500 },
            });
            const campus = await (0, util_1.campusOf)(ctx, child.campusId);
            if (d.measuredOn > (0, util_1.todayOf)(ctx, campus))
                (0, errors_1.invalid)({ measuredOn: 'Ngày đo không được ở tương lai.' });
            const bmi = Math.round((d.weightKg / ((d.heightCm / 100) ** 2)) * 10) / 10;
            const id = await (0, store_1.createDoc)(ctx, 'healthRecords', undefined, { ...d, bmi, childId: child.id, campusId: child.campusId, recordedBy: ctx.uid, recordedByName: ctx.member?.displayName ?? ctx.uid });
            await ctx.audit({ action: 'health.record', collection: 'healthRecords', docId: id, campusId: child.campusId, after: { measuredOn: d.measuredOn } });
            return { id, ...d, bmi, childId: child.id, campusId: child.campusId };
        },
    },
    'medication.request': {
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
            const d = (0, validate_1.validate)(b, {
                medicineName: { t: 'string', req: true, min: 2, max: 120 },
                dose: { t: 'string', req: true, min: 1, max: 60 },
                times: { t: 'array', req: true, max: 8, of: { t: 'time' } },
                fromDay: { t: 'day', req: true },
                toDay: { t: 'day', req: true },
                instructions: { t: 'string', req: true, min: 3, max: 500 },
                reason: { t: 'string', max: 300 },
                storage: { t: 'string', max: 200 },
                photoPath: { t: 'string', max: 400 },
            });
            if (!(0, util_1.asArr)(d.times).length)
                (0, errors_1.invalid)({ times: 'Nhập ít nhất một giờ uống thuốc.' });
            if (d.toDay < d.fromDay)
                (0, errors_1.invalid)({ toDay: 'Ngày kết thúc phải từ ngày bắt đầu trở đi.' });
            if (d.toDay < (0, util_1.todayOf)(ctx, campus))
                (0, errors_1.invalid)({ toDay: 'Ngày kết thúc đã qua.' });
            if (d.photoPath) {
                const prefix = `orgs/${ctx.orgId}/campuses/${child.campusId}/`;
                if (!d.photoPath.startsWith(prefix) || d.photoPath.includes('..'))
                    (0, errors_1.invalid)({ photoPath: 'Đường dẫn ảnh không hợp lệ.' });
            }
            const data = { ...d, childId, classId: child.classId ?? null, campusId: child.campusId, status: 'pending', requestedBy: ctx.uid, requestedByName: ctx.member?.displayName ?? ctx.uid };
            const id = await (0, store_1.createDoc)(ctx, 'medicationRequests', undefined, data);
            await ctx.audit({ action: 'medication.request', collection: 'medicationRequests', docId: id, campusId: child.campusId, after: { childId, fromDay: d.fromDay, toDay: d.toDay } });
            return { id, ...data, version: 1 };
        },
    },
    'medication.decide': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const id = (0, util_1.requireId)(b.id, 'id');
            const rq = await (0, store_1.getOr404)(ctx.doc(`medicationRequests/${id}`), 'Yêu cầu thuốc');
            ctx.require('medication.write', rq.campusId);
            await (0, util_1.requireClassAccess)(ctx, rq.campusId, rq.classId ?? null);
            const decision = (0, util_1.s)(b.decision);
            if (!['received', 'rejected', 'paused'].includes(decision))
                (0, errors_1.invalid)({ decision: 'Quyết định phải là received, rejected hoặc paused.' });
            const reason = (0, util_1.s)(b.reason);
            if ((decision === 'rejected' || decision === 'paused') && !reason)
                (0, errors_1.invalid)({ reason: 'Vui lòng nhập lý do.' });
            if (rq.status === decision)
                return { id, status: decision, unchanged: true };
            const allowed = { pending: ['received', 'rejected'], received: ['paused'], paused: ['received'] };
            if (!(allowed[rq.status] ?? []).includes(decision))
                (0, errors_1.fail)('INVALID_STATE', `Không thể chuyển từ "${rq.status}" sang "${decision}".`, { status: rq.status });
            const patch = { status: decision, decisionReason: reason || null, decidedBy: ctx.uid, decidedByName: ctx.member?.displayName ?? ctx.uid, decidedAt: firebase_1.Timestamp.fromDate(ctx.now) };
            if (decision === 'received' && rq.status === 'pending') {
                patch.receivedAt = firebase_1.Timestamp.fromDate(ctx.now);
                patch.receivedBy = ctx.uid;
            }
            if ((0, util_1.s)(b.assigneeUid)) {
                const au = await ctx.doc(`members/${(0, util_1.s)(b.assigneeUid)}`).get();
                if (!au.exists || au.data().status !== 'active' || !(0, permissions_1.hasPerm)(au.data().permsByCampus, 'medication.write', rq.campusId))
                    (0, errors_1.invalid)({ assigneeUid: 'Người được giao không có quyền thực hiện thuốc tại cơ sở này.' });
                patch.assigneeUid = (0, util_1.s)(b.assigneeUid);
                patch.assigneeName = au.data().displayName;
            }
            const { after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`medicationRequests/${id}`), patch, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
            await ctx.audit({ action: 'medication.decide', collection: 'medicationRequests', docId: id, campusId: rq.campusId, before: { status: rq.status }, after: { status: decision }, reason: reason || undefined });
            if (rq.requestedBy)
                void (0, util_1.pushToUsers)(ctx.orgId, [rq.requestedBy], { type: 'medication', id });
            return { id, status: decision, version: after.version };
        },
    },
    'medication.administer': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const requestId = (0, util_1.requireId)(b.requestId, 'requestId');
            const rq = await (0, store_1.getOr404)(ctx.doc(`medicationRequests/${requestId}`), 'Yêu cầu thuốc');
            ctx.require('medication.write', rq.campusId);
            await (0, util_1.requireClassAccess)(ctx, rq.campusId, rq.classId ?? null);
            if (rq.status !== 'received')
                (0, errors_1.fail)('INVALID_STATE', 'Chỉ ghi nhận cho yêu cầu thuốc đã được nhận (không bị từ chối/tạm dừng).', { status: rq.status });
            const dose = (0, util_1.s)(b.dose);
            if (!dose)
                (0, errors_1.invalid)({ dose: 'Bắt buộc nhập liều thực tế đã cho dùng (không suy đoán).' });
            const result = (0, util_1.s)(b.result);
            if (!['given', 'partial', 'refused', 'vomited', 'missed'].includes(result))
                (0, errors_1.invalid)({ result: 'Kết quả phải là given, partial, refused, vomited hoặc missed.' });
            const at = (0, util_1.parseWhen)(b.at, 'at') ?? ctx.now;
            if (at.getTime() - ctx.now.getTime() > 5 * 60_000)
                (0, errors_1.invalid)({ at: 'Giờ dùng thuốc không được ở tương lai.' });
            const campus = await (0, util_1.campusOf)(ctx, rq.campusId);
            const dayAt = new Intl.DateTimeFormat('en-CA', { timeZone: campus.timezone || 'Asia/Ho_Chi_Minh' }).format(at);
            if (dayAt < rq.fromDay || dayAt > rq.toDay)
                (0, errors_1.fail)('PRECONDITION', 'Ngày dùng thuốc nằm ngoài thời gian phụ huynh yêu cầu.', { fromDay: rq.fromDay, toDay: rq.toDay });
            const doseDiffers = dose.replace(/\s+/g, '').toLowerCase() !== String(rq.dose).replace(/\s+/g, '').toLowerCase();
            if (doseDiffers && !(0, util_1.s)(b.note))
                (0, errors_1.invalid)({ note: 'Liều khác với yêu cầu của phụ huynh, vui lòng ghi chú lý do.' });
            const dup = (await ctx.col('medicationAdmins').where('requestId', '==', requestId).get()).docs
                .find((d) => Math.abs(d.data().at.toMillis() - at.getTime()) < 60_000);
            if (dup)
                (0, errors_1.fail)('CONFLICT', 'Lần dùng thuốc này đã được ghi nhận.', { id: dup.id });
            const data = {
                requestId, childId: rq.childId, campusId: rq.campusId, classId: rq.classId ?? null, medicineName: rq.medicineName, requestedDose: rq.dose, dose, doseDiffers,
                at: firebase_1.Timestamp.fromDate(at), result, note: (0, util_1.s)(b.note).slice(0, 500) || null, administeredBy: ctx.uid, administeredByName: ctx.member?.displayName ?? ctx.uid,
            };
            const id = await (0, store_1.createDoc)(ctx, 'medicationAdmins', undefined, data);
            await ctx.audit({ action: 'medication.administer', collection: 'medicationAdmins', docId: id, campusId: rq.campusId, after: { requestId, dose, result } });
            return { id, ...data, version: 1 };
        },
    },
    // ---------------------------------------------------------------- sự cố
    'incident.save': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const id = (0, util_1.s)(b.id);
            let existing = null;
            if (id)
                existing = await (0, store_1.getOr404)(ctx.doc(`incidents/${id}`), 'Sự cố');
            let child = null;
            const childId = (0, util_1.s)(b.childId ?? existing?.childId);
            if (childId)
                child = await (0, util_1.childOf)(ctx, childId);
            const campusId = existing ? existing.campusId : child ? child.campusId : (await (0, util_1.campusOf)(ctx, (0, util_1.s)(b.campusId) || (0, util_1.s)(ctx.campusId))).id;
            ctx.require('incident.write', campusId);
            if (child) {
                if (child.campusId !== campusId)
                    (0, errors_1.invalid)({ childId: 'Trẻ không thuộc cơ sở này.' });
                await (0, util_1.requireClassAccess)(ctx, campusId, child.classId ?? null);
            }
            if (existing?.status === 'closed')
                (0, errors_1.fail)('INVALID_STATE', 'Sự cố đã đóng, không thể sửa.');
            const d = (0, validate_1.validate)(b, {
                occurredAt: { t: 'string', req: true, max: 40 }, type: { t: 'string', req: true, max: 60 },
                severity: { t: 'string', req: true, oneOf: ['minor', 'moderate', 'serious'] }, location: { t: 'string', max: 120 },
                description: { t: 'string', req: true, min: 5, max: 3000 }, firstAid: { t: 'string', max: 2000 },
                contactedPersons: { t: 'array', max: 20, of: { t: 'object' } }, ownerUid: { t: 'string', max: 128 }, outcome: { t: 'string', max: 2000 },
                shareWithParent: { t: 'bool' }, restricted: { t: 'bool' }, viewerUids: { t: 'array', max: 50, of: { t: 'string', max: 128 } },
            }, { partial: !!existing });
            if (d.occurredAt) {
                const w = (0, util_1.parseWhen)(d.occurredAt, 'occurredAt');
                if (w.getTime() - ctx.now.getTime() > 5 * 60_000)
                    (0, errors_1.invalid)({ occurredAt: 'Thời điểm xảy ra không được ở tương lai.' });
                d.occurredAt = firebase_1.Timestamp.fromDate(w);
            }
            if (d.shareWithParent === true && !ctx.can('children.write', campusId))
                (0, errors_1.denied)('Chỉ quản lý mới được chia sẻ hồ sơ sự cố cho phụ huynh.');
            if (d.ownerUid) {
                const om = await ctx.doc(`members/${d.ownerUid}`).get();
                if (!om.exists || om.data().kind === 'parent')
                    (0, errors_1.invalid)({ ownerUid: 'Người phụ trách không hợp lệ.' });
            }
            const viewers = new Set([...(d.viewerUids ?? existing?.viewerUids ?? []), existing?.createdBy ?? ctx.uid, ctx.uid]);
            if (d.ownerUid ?? existing?.ownerUid)
                viewers.add(d.ownerUid ?? existing?.ownerUid);
            if (!existing) {
                const data = { ...d, viewerUids: [...viewers], restricted: d.restricted ?? true, shareWithParent: d.shareWithParent ?? false, childId: child?.id ?? null, classId: child?.classId ?? null, campusId, status: 'open', reportedBy: ctx.uid, reportedByName: ctx.member?.displayName ?? ctx.uid };
                const nid = await (0, store_1.createDoc)(ctx, 'incidents', undefined, data);
                await ctx.audit({ action: 'incident.save', collection: 'incidents', docId: nid, campusId, after: { type: d.type, severity: d.severity, childId: child?.id ?? null } });
                return { id: nid, ...data, version: 1 };
            }
            const { before, after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`incidents/${id}`), { ...d, viewerUids: [...viewers] }, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
            await ctx.audit({ action: 'incident.save', collection: 'incidents', docId: id, campusId, before: { severity: before.severity, shareWithParent: before.shareWithParent }, after: { severity: after.severity, shareWithParent: after.shareWithParent } });
            return { id, ...after };
        },
    },
    'incident.close': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const id = (0, util_1.requireId)(b.id, 'id');
            const inc = await (0, store_1.getOr404)(ctx.doc(`incidents/${id}`), 'Sự cố');
            ctx.require('incident.write', inc.campusId);
            if (inc.childId) {
                const c = await (0, util_1.childOf)(ctx, inc.childId);
                await (0, util_1.requireClassAccess)(ctx, inc.campusId, c.classId ?? null);
            }
            if (inc.status === 'closed')
                return { id, status: 'closed', unchanged: true };
            const outcome = (0, util_1.s)(b.outcome) || inc.outcome || '';
            if (!outcome)
                (0, errors_1.invalid)({ outcome: 'Vui lòng ghi kết quả xử lý trước khi đóng.' });
            const { after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`incidents/${id}`), {
                status: 'closed', outcome, closeNote: (0, util_1.s)(b.note) || null, closedBy: ctx.uid, closedByName: ctx.member?.displayName ?? ctx.uid, closedAt: firebase_1.Timestamp.fromDate(ctx.now),
            }, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
            await ctx.audit({ action: 'incident.close', collection: 'incidents', docId: id, campusId: inc.campusId, before: { status: inc.status }, after: { status: 'closed', outcome } });
            return { id, status: 'closed', version: after.version };
        },
    },
};
