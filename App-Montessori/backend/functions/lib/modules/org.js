"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actions = void 0;
const firebase_1 = require("../core/firebase");
const context_1 = require("../core/context");
const errors_1 = require("../core/errors");
const permissions_1 = require("../core/permissions");
const store_1 = require("../core/store");
const validate_1 = require("../core/validate");
const people_1 = require("./people");
const util_1 = require("./util");
// ------------------------------------------------------------------ helpers
function requireOrgWide(ctx, perm) {
    if (!ctx.can(perm, null)) {
        void ctx.audit({ action: 'permission.denied', reason: `${perm} (toàn tổ chức)`, result: 'denied' });
        (0, errors_1.denied)('Thao tác này cần quyền ở phạm vi toàn tổ chức.');
    }
}
function validTz(tz) {
    try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
    }
    catch {
        return false;
    }
}
const CAMPUS_STATUSES = ['preparing', 'active', 'paused', 'closed'];
const campusSchema = {
    code: { t: 'string', req: true, min: 2, max: 20, pattern: /^[A-Za-z0-9_-]+$/ },
    name: { t: 'string', req: true, min: 2, max: 120 },
    address: { t: 'string', max: 300 },
    phone: { t: 'string', max: 30 },
    timezone: { t: 'string', max: 60 },
    openTime: { t: 'time' },
    closeTime: { t: 'time' },
    mealCutoff: { t: 'time' },
};
/** Tạo cơ sở (dùng cho org.create và campus.create). id cơ sở = mã (viết hoa). */
async function createCampusCore(ctx, raw) {
    const d = (0, validate_1.validate)(raw, campusSchema);
    const timezone = d.timezone || 'Asia/Ho_Chi_Minh';
    if (!validTz(timezone))
        (0, errors_1.invalid)({ timezone: 'Múi giờ không hợp lệ.' });
    const openTime = d.openTime ?? '07:00';
    const closeTime = d.closeTime ?? '17:00';
    if (openTime >= closeTime)
        (0, errors_1.invalid)({ closeTime: 'Giờ đóng cửa phải sau giờ mở cửa.' });
    const id = String(d.code).toUpperCase();
    const dup = await ctx.doc(`campuses/${id}`).get();
    if (dup.exists)
        (0, errors_1.invalid)({ code: 'Mã cơ sở đã tồn tại.' });
    const data = {
        code: id, name: d.name, address: d.address ?? '', phone: d.phone ?? '', timezone, openTime, closeTime,
        mealCutoff: d.mealCutoff ?? '08:30', status: 'preparing', archived: false,
    };
    await (0, store_1.createDoc)(ctx, 'campuses', id, data);
    await ctx.audit({ action: 'campus.create', collection: 'campuses', docId: id, campusId: id, after: data });
    return { id, ...data };
}
const COPY_PARTS = {
    classes: 'classes', feePolicies: 'feePolicies', shifts: 'shifts', menus: 'menus', categories: 'categories',
};
const COPY_STRIP = ['id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'version', 'enrolledCount', 'publishedAt', 'publishedBy', 'archivedAt', 'archivedBy', 'archiveReason', 'approvedBy', 'approvedAt'];
/** Sao chép DANH MỤC/cấu hình (không sao chép trẻ, giao dịch). Bản sao ở trạng thái nháp nếu có workflow duyệt. */
async function copyConfig(ctx, fromCampusId, toCampusId, parts) {
    const counts = {};
    for (const part of parts) {
        const col = COPY_PARTS[part];
        if (!col)
            (0, errors_1.invalid)({ copyFrom: `Phần cấu hình không được hỗ trợ: ${part}` });
        const snap = await ctx.col(col).where('campusId', '==', fromCampusId).get();
        let n = 0;
        for (const grp of (0, util_1.chunk)(snap.docs.filter((x) => !x.data().archived), 400)) {
            const batch = firebase_1.db.batch();
            for (const sd of grp) {
                const src = sd.data();
                const copy = { ...src };
                for (const k of COPY_STRIP)
                    delete copy[k];
                copy.campusId = toCampusId;
                copy.copiedFrom = { campusId: fromCampusId, id: sd.id };
                if (part === 'classes') {
                    copy.academicYearId = null;
                    copy.status = 'active';
                    copy.enrolledCount = 0;
                }
                if (part === 'feePolicies' || part === 'menus')
                    copy.status = 'draft';
                batch.create(ctx.col(col).doc(), { ...copy, ...ctx.metaCreate() });
                n++;
            }
            await batch.commit();
        }
        counts[part] = n;
    }
    return counts;
}
// ------------------------------------------------------------------ actions
exports.actions = {
    // ---- tổ chức
    'org.create': {
        scope: 'none',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const name = (0, util_1.s)(b.name);
            if (name.length < 2)
                (0, errors_1.invalid)({ name: 'Tên tổ chức tối thiểu 2 ký tự.' });
            const timezone = (0, util_1.s)(b.timezone) || 'Asia/Ho_Chi_Minh';
            if (!validTz(timezone))
                (0, errors_1.invalid)({ timezone: 'Múi giờ không hợp lệ.' });
            const user = await firebase_1.auth.getUser(ctx.uid).catch(() => undefined);
            const orgRef = firebase_1.db.collection('orgs').doc();
            const orgId = orgRef.id;
            const displayName = user?.displayName || ctx.token.name || user?.email || ctx.uid;
            const email = (user?.email || ctx.email || '').toLowerCase();
            const phone = user?.phoneNumber || ctx.phone || '';
            const member = {
                uid: ctx.uid, displayName, email, phone, kind: 'owner', status: 'active',
                grants: [{ id: 'owner', roleId: 'owner', campusIds: ['*'] }], childIds: [], permsByCampus: {}, version: 1,
            };
            const octx = (0, context_1.buildCtx)({ uid: ctx.uid, token: ctx.token, orgId, opId: ctx.opId, loadMember: false }, member, false);
            await orgRef.create({ name, status: 'active', ownerUid: ctx.uid, plan: 'trial', timezone, currency: 'VND', ...octx.metaCreate() });
            let campus;
            const oc = (0, util_1.asObj)(b.ownerCampus);
            if (Object.keys(oc).length)
                campus = await createCampusCore(octx, oc);
            const { permsByCampus, permsAny } = await (0, util_1.computeMemberPerms)(octx, 'owner', member.grants);
            await firebase_1.db.doc(`orgs/${orgId}/members/${ctx.uid}`).create({
                ...member, permsByCampus, permsAny, childPerms: {}, ...octx.metaCreate(),
            });
            await firebase_1.db.doc(`users/${ctx.uid}`).set({
                uid: ctx.uid, displayName, email, phone, locale: 'vi', updatedAt: firebase_1.Timestamp.fromDate(ctx.now), createdAt: firebase_1.Timestamp.fromDate(ctx.now),
            }, { merge: true });
            await octx.audit({ action: 'org.create', collection: 'orgs', docId: orgId, after: { name, ownerUid: ctx.uid } });
            return { orgId, name, status: 'active', campus: campus ?? null };
        },
    },
    'org.update': {
        scope: 'org',
        perm: 'org.manage',
        handler: async (ctx, p) => {
            requireOrgWide(ctx, 'org.manage');
            const b = (0, util_1.asObj)(p);
            const d = (0, validate_1.validate)(b, {
                name: { t: 'string', min: 2, max: 120 }, timezone: { t: 'string', max: 60 }, logoPath: { t: 'string', max: 300 },
                hotline: { t: 'string', max: 30 }, taxCode: { t: 'string', max: 30 },
            }, { partial: true });
            if (d.timezone && !validTz(d.timezone))
                (0, errors_1.invalid)({ timezone: 'Múi giờ không hợp lệ.' });
            if (!Object.keys(d).length)
                (0, errors_1.invalid)({ name: 'Không có thay đổi để lưu.' });
            const ref = firebase_1.db.doc(`orgs/${ctx.orgId}`);
            const { before, after } = await (0, store_1.updateDoc)(ctx, ref, d, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
            await ctx.audit({ action: 'org.update', collection: 'orgs', docId: ctx.orgId, before: pick(before, d), after: pick(after, d) });
            return { orgId: ctx.orgId, ...pick(after, d), version: after.version };
        },
    },
    'org.listMine': {
        scope: 'none',
        handler: async (ctx) => {
            const snap = await firebase_1.db.collectionGroup('members').where('uid', '==', ctx.uid).get();
            const orgs = [];
            for (const d of snap.docs) {
                const orgRef = d.ref.parent.parent;
                if (!orgRef || orgRef.parent.id !== 'orgs')
                    continue;
                const orgId = orgRef.id;
                const os = await orgRef.get();
                if (!os.exists)
                    continue;
                const m = await (0, context_1.loadMember)(orgId, ctx.uid, ctx.now);
                if (!m || m.status !== 'active')
                    continue; // chỉ trả thành viên đang hoạt động
                const campusSnap = await orgRef.collection('campuses').get();
                let campuses = campusSnap.docs.map((c) => ({ id: c.id, ...c.data() }));
                const children = [];
                if (m.kind === 'parent') {
                    const ids = new Set();
                    for (const cid of (m.childIds ?? []).slice(0, 30)) {
                        const cs = await orgRef.collection('children').doc(cid).get();
                        if (!cs.exists)
                            continue;
                        const c = cs.data();
                        ids.add(c.campusId);
                        let className = null;
                        if (c.classId) {
                            const k = await orgRef.collection('classes').doc(c.classId).get();
                            className = k.exists ? k.data().name : null;
                        }
                        children.push({ childId: cs.id, fullName: c.fullName, code: c.code, campusId: c.campusId, classId: c.classId ?? null, className, status: c.status });
                    }
                    campuses = campuses.filter((c) => ids.has(c.id));
                }
                else if (!m.permsByCampus['*']) {
                    campuses = campuses.filter((c) => (m.permsByCampus[c.id] ?? []).includes('campus.read'));
                }
                const member = {
                    kind: m.kind, status: m.status, displayName: m.displayName, grants: m.grants ?? [], childIds: m.childIds ?? [],
                    permsByCampus: m.permsByCampus, employeeId: m.employeeId ?? null,
                };
                orgs.push({
                    orgId, id: orgId, name: os.data().name, orgName: os.data().name, status: os.data().status, plan: os.data().plan ?? null,
                    timezone: os.data().timezone ?? 'Asia/Ho_Chi_Minh',
                    member, // dạng lồng (mobile) — đồng thời giữ các trường phẳng bên dưới (web)
                    kind: m.kind, memberStatus: m.status, displayName: m.displayName,
                    roles: [...new Set((m.grants ?? []).map((g) => g.roleId))],
                    grants: m.grants ?? [], permsByCampus: m.permsByCampus, childIds: m.childIds ?? [], employeeId: m.employeeId ?? null,
                    campuses: campuses.map((c) => ({ id: c.id, campusId: c.id, code: c.code, name: c.name, status: c.status, timezone: c.timezone })),
                    children,
                });
            }
            return { uid: ctx.uid, platformAdmin: ctx.platformAdmin, orgs };
        },
    },
    // ---- cơ sở
    'campus.create': {
        scope: 'org',
        perm: 'campus.manage',
        handler: async (ctx, p) => {
            requireOrgWide(ctx, 'campus.manage');
            const b = (0, util_1.asObj)(p);
            const copy = (0, util_1.asObj)(b.copyFrom);
            const parts = (0, util_1.asArr)(copy.parts).map(util_1.s);
            let srcId;
            if (Object.keys(copy).length) {
                srcId = (await (0, util_1.campusOf)(ctx, (0, util_1.requireId)(copy.campusId, 'copyFrom.campusId'))).id;
                ctx.require('campus.read', srcId);
                if (!parts.length)
                    (0, errors_1.invalid)({ copyFrom: 'Chọn ít nhất một phần cấu hình cần sao chép.' });
            }
            const pi = (0, util_1.asObj)(b.principalInvite);
            let invite;
            let piEmail = '';
            if (Object.keys(pi).length) {
                piEmail = (0, util_1.normEmail)(pi.email);
                if (!piEmail && !(0, util_1.s)(pi.phone))
                    (0, errors_1.invalid)({ 'principalInvite.email': 'Nhập email hiệu trưởng.' });
                if (!(0, util_1.s)(pi.displayName))
                    (0, errors_1.invalid)({ 'principalInvite.displayName': 'Nhập họ tên hiệu trưởng.' });
            }
            const campus = await createCampusCore(ctx, b);
            let copied = {};
            if (srcId)
                copied = await copyConfig(ctx, srcId, campus.id, parts);
            if (Object.keys(pi).length) {
                const grants = [{ id: `g_principal_${campus.id}`, roleId: 'principal', campusIds: [campus.id] }];
                const r = await (0, people_1.upsertInvite)(ctx, { kind: 'staff', email: piEmail, phone: (0, util_1.s)(pi.phone) ? (0, util_1.normPhone)(pi.phone) : '', displayName: (0, util_1.s)(pi.displayName), grants });
                invite = { id: r.id, code: r.code };
            }
            return { campus, copied, principalInvite: invite ?? null };
        },
    },
    'campus.update': {
        scope: 'campus',
        perm: 'campus.manage',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const d = (0, validate_1.validate)(b, {
                name: { t: 'string', min: 2, max: 120 }, address: { t: 'string', max: 300 }, phone: { t: 'string', max: 30 },
                timezone: { t: 'string', max: 60 }, openTime: { t: 'time' }, closeTime: { t: 'time' }, mealCutoff: { t: 'time' },
                workingDays: { t: 'array', max: 7, of: { t: 'int', min: 1, max: 7 } },
                pickupFrom: { t: 'time' }, pickupTo: { t: 'time' }, dropoffFrom: { t: 'time' }, dropoffTo: { t: 'time' },
                contactEmail: { t: 'string', max: 120 },
            }, { partial: true });
            if (d.timezone && !validTz(d.timezone))
                (0, errors_1.invalid)({ timezone: 'Múi giờ không hợp lệ.' });
            const cur = await (0, util_1.campusOf)(ctx, ctx.campusId);
            const open = d.openTime ?? cur.openTime;
            const close = d.closeTime ?? cur.closeTime;
            if (open && close && open >= close)
                (0, errors_1.invalid)({ closeTime: 'Giờ đóng cửa phải sau giờ mở cửa.' });
            if (!Object.keys(d).length)
                (0, errors_1.invalid)({ name: 'Không có thay đổi để lưu.' });
            const { before, after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`campuses/${cur.id}`), d, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
            await ctx.audit({ action: 'campus.update', collection: 'campuses', docId: cur.id, before: pick(before, d), after: pick(after, d) });
            return { id: cur.id, ...after };
        },
    },
    'campus.setStatus': {
        scope: 'org',
        perm: 'campus.manage',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const campusId = (0, util_1.requireId)(b.campusId, 'campusId');
            const status = (0, util_1.s)(b.status);
            const reason = (0, util_1.s)(b.reason);
            if (!CAMPUS_STATUSES.includes(status))
                (0, errors_1.invalid)({ status: 'Trạng thái không hợp lệ.' });
            if (!reason)
                (0, errors_1.invalid)({ reason: 'Vui lòng nhập lý do.' });
            const campus = await (0, util_1.campusOf)(ctx, campusId);
            ctx.require('campus.manage', campusId);
            if (campus.status === status)
                return { id: campusId, status, unchanged: true };
            if (campus.status === 'closed' && status === 'preparing')
                (0, errors_1.fail)('INVALID_STATE', 'Cơ sở đã đóng không thể quay về trạng thái chuẩn bị.');
            if (status === 'closed') {
                const blockers = await closeBlockers(ctx, campusId);
                if (blockers.children.length || blockers.receivables.length || blockers.deposits.length) {
                    (0, errors_1.fail)('PRECONDITION', 'Chưa thể đóng cơ sở: còn trẻ đang học, công nợ hoặc tiền đặt cọc cần xử lý.', { blockers });
                }
            }
            const { before, after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`campuses/${campusId}`), {
                status, statusReason: reason, statusChangedAt: firebase_1.Timestamp.fromDate(ctx.now), statusChangedBy: ctx.uid,
            }, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
            await ctx.audit({ action: 'campus.setStatus', collection: 'campuses', docId: campusId, campusId, before: { status: before.status }, after: { status }, reason });
            return { id: campusId, status, version: after.version };
        },
    },
    'campus.setupProgress': {
        scope: 'org',
        perm: 'campus.read',
        handler: async (ctx, p) => {
            const campusId = (0, util_1.requireId)((0, util_1.asObj)(p).campusId, 'campusId');
            const campus = await (0, util_1.campusOf)(ctx, campusId);
            ctx.require('campus.read', campusId);
            const q = (c) => ctx.col(c).where('campusId', '==', campusId);
            const [years, classes, fees, shifts, members, calendar] = await Promise.all([
                q('academicYears').get(), q('classes').get(), q('feePolicies').get(), q('shifts').get(),
                ctx.col('members').where('kind', '==', 'staff').get(), q('calendarExceptions').limit(1).get(),
            ]);
            const live = (snap) => snap.docs.filter((d) => !d.data().archived);
            const principals = members.docs.filter((d) => {
                const m = d.data();
                return m.status !== 'revoked' && (m.grants ?? []).some((g) => g.roleId === 'principal' && (g.campusIds.includes(campusId) || g.campusIds.includes('*')));
            });
            const steps = [
                { key: 'info', label: 'Thông tin cơ sở (địa chỉ, giờ mở cửa)', done: !!(campus.address && campus.openTime && campus.closeTime) },
                { key: 'academicYear', label: 'Năm học', done: live(years).length > 0 },
                { key: 'calendar', label: 'Ngày nghỉ / ngoại lệ lịch (tùy chọn)', done: calendar.size > 0, optional: true },
                { key: 'classes', label: 'Lớp học', done: live(classes).length > 0 },
                { key: 'principal', label: 'Hiệu trưởng được mời/gán', done: principals.length > 0 },
                { key: 'fees', label: 'Biểu phí', done: live(fees).length > 0 },
                { key: 'shifts', label: 'Ca làm việc (tùy chọn)', done: live(shifts).length > 0, optional: true },
            ];
            const required = steps.filter((x) => !x.optional);
            const done = required.filter((x) => x.done).length;
            return { campusId, status: campus.status, steps, percent: Math.round((done / required.length) * 100), readyToActivate: done === required.length };
        },
    },
    // ---- thành viên / lời mời
    'member.invite': {
        scope: 'org',
        perm: 'members.manage',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const kind = (0, util_1.s)(b.kind);
            if (kind !== 'staff' && kind !== 'parent')
                (0, errors_1.invalid)({ kind: 'Loại thành viên phải là staff hoặc parent.' });
            const displayName = (0, util_1.s)(b.displayName);
            if (!displayName)
                (0, errors_1.invalid)({ displayName: 'Bắt buộc nhập họ tên.' });
            const email = (0, util_1.normEmail)(b.email);
            const phone = (0, util_1.normPhone)(b.phone);
            if (!email && !phone)
                (0, errors_1.invalid)({ email: 'Nhập email hoặc số điện thoại.', phone: 'Nhập email hoặc số điện thoại.' });
            if (kind === 'staff') {
                const grants = (0, util_1.sanitizeGrants)(b.grants);
                if (!grants.length)
                    (0, errors_1.invalid)({ grants: 'Cần gán ít nhất một vai trò và phạm vi.' });
                await (0, util_1.assertCanGrant)(ctx, grants);
                const existing = await (0, people_1.findMemberByContact)(ctx, phone, email);
                if (existing && existing.status === 'active')
                    (0, errors_1.fail)('CONFLICT', 'Người này đã là thành viên của tổ chức. Hãy cập nhật quyền thay vì mời lại.', { uid: existing.uid });
                const r = await (0, people_1.upsertInvite)(ctx, { kind: 'staff', email, phone, displayName, grants });
                await ctx.audit({ action: 'member.invite', collection: 'invites', docId: r.id, after: { kind, email, phone, grants } });
                return { inviteId: r.id, code: r.code, merged: r.merged, kind };
            }
            const childIds = (0, util_1.asArr)(b.childIds).map(util_1.s).filter(Boolean);
            if (!childIds.length)
                (0, errors_1.invalid)({ childIds: 'Chọn ít nhất một trẻ để liên kết.' });
            const results = [];
            for (const cid of childIds) {
                const child = await (0, util_1.childOf)(ctx, cid);
                ctx.require('children.write', child.campusId);
                results.push(await (0, people_1.linkGuardianCore)(ctx, child, { name: displayName, phone, email, relation: (0, util_1.s)(b.relation) || 'other' }, b.perms));
            }
            return { kind, links: results.map((r) => ({ id: r.id, status: r.status, inviteCode: r.inviteCode ?? null, warning: r.warning })) };
        },
    },
    'invite.claimPending': {
        scope: 'none',
        handler: async (ctx) => {
            const user = await firebase_1.auth.getUser(ctx.uid).catch(() => undefined);
            if (!user)
                (0, errors_1.fail)('UNAUTHENTICATED', 'Không tìm thấy tài khoản đăng nhập.');
            const emails = user.emailVerified && user.email ? [user.email.toLowerCase()] : [];
            const phones = user.phoneNumber ? [user.phoneNumber] : [];
            const found = new Map();
            for (const e of emails)
                (await firebase_1.db.collectionGroup('invites').where('email', '==', e).get()).forEach((d) => found.set(d.ref.path, d));
            for (const ph of phones)
                (await firebase_1.db.collectionGroup('invites').where('phone', '==', ph).get()).forEach((d) => found.set(d.ref.path, d));
            const joined = [];
            const skipped = [];
            const displayNameDefault = user.displayName || user.email || user.phoneNumber || ctx.uid;
            for (const inv of found.values()) {
                const orgRef = inv.ref.parent.parent;
                const orgId = orgRef.id;
                const d = inv.data();
                if (d.status !== 'pending')
                    continue;
                if (d.expiresAt && d.expiresAt.toMillis() < ctx.now.getTime()) {
                    await inv.ref.update({ status: 'expired', updatedAt: firebase_1.Timestamp.fromDate(ctx.now) });
                    skipped.push({ orgId, inviteId: inv.id, reason: 'Lời mời đã hết hạn.' });
                    continue;
                }
                const os = await orgRef.get();
                if (!os.exists || os.data().status === 'suspended') {
                    skipped.push({ orgId, inviteId: inv.id, reason: 'Tổ chức không khả dụng.' });
                    continue;
                }
                const octx = (0, context_1.buildCtx)({ uid: ctx.uid, token: ctx.token, orgId, loadMember: false }, undefined, false);
                const memRef = orgRef.collection('members').doc(ctx.uid);
                const cur = await memRef.get();
                const kind = d.kind;
                if (cur.exists) {
                    const cm = cur.data();
                    if (cm.status === 'revoked' || cm.status === 'suspended') {
                        skipped.push({ orgId, inviteId: inv.id, reason: 'Tài khoản đang bị khóa tại tổ chức này.' });
                        continue;
                    }
                    if (cm.kind !== kind && cm.kind !== 'owner') {
                        skipped.push({ orgId, inviteId: inv.id, reason: 'Tài khoản đã thuộc tổ chức với loại thành viên khác.' });
                        continue;
                    }
                }
                const base = cur.exists ? cur.data() : null;
                let grants = (base?.grants ?? []);
                if (kind === 'staff') {
                    const byId = new Map(grants.map((g) => [g.id, g]));
                    for (const g of (d.grants ?? []))
                        byId.set(g.id, g);
                    grants = [...byId.values()];
                }
                const childIds = [...new Set([...(base?.childIds ?? []), ...(d.childIds ?? [])])];
                const childPerms = { ...(base?.childPerms ?? {}), ...(d.childPerms ?? {}) };
                const effKind = base?.kind ?? kind;
                const { permsByCampus, permsAny } = await (0, util_1.computeMemberPerms)(octx, effKind, grants);
                const memberDoc = {
                    uid: ctx.uid, displayName: base?.displayName || d.displayName || displayNameDefault,
                    email: user.email?.toLowerCase() || d.email || '', phone: user.phoneNumber || d.phone || '',
                    kind: effKind, status: 'active', grants, childIds, childPerms, permsByCampus, permsAny,
                };
                if (cur.exists)
                    await memRef.update({ ...memberDoc, ...octx.metaUpdate(base.version ?? 1) });
                else
                    await memRef.create({ ...memberDoc, ...octx.metaCreate() });
                await inv.ref.update({ status: 'accepted', acceptedBy: ctx.uid, acceptedAt: firebase_1.Timestamp.fromDate(ctx.now), updatedAt: firebase_1.Timestamp.fromDate(ctx.now) });
                for (const lid of (d.guardianLinkIds ?? [])) {
                    await orgRef.collection('guardianLinks').doc(lid).update({
                        uid: ctx.uid, status: 'linked', linkedAt: firebase_1.Timestamp.fromDate(ctx.now), updatedAt: firebase_1.Timestamp.fromDate(ctx.now), version: firebase_1.FieldValue.increment(1),
                    }).catch(() => undefined);
                }
                await octx.audit({ action: 'invite.claim', collection: 'invites', docId: inv.id, after: { kind: effKind, childIds, grants: grants.map((g) => g.roleId) } });
                joined.push({ orgId, orgName: os.data().name, kind: effKind });
            }
            if (joined.length) {
                await firebase_1.db.doc(`users/${ctx.uid}`).set({
                    uid: ctx.uid, displayName: displayNameDefault, email: user.email ?? '', phone: user.phoneNumber ?? '', updatedAt: firebase_1.Timestamp.fromDate(ctx.now),
                }, { merge: true });
            }
            return { joined, skipped };
        },
    },
    'invite.revoke': {
        scope: 'org',
        perm: 'members.manage',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const id = (0, util_1.requireId)(b.id, 'id');
            const ref = ctx.doc(`invites/${id}`);
            const inv = await (0, store_1.getOr404)(ref, 'Lời mời');
            if (inv.status === 'revoked')
                return { id, status: 'revoked', unchanged: true };
            if (inv.status !== 'pending')
                (0, errors_1.fail)('INVALID_STATE', 'Chỉ thu hồi được lời mời đang chờ.', { status: inv.status });
            // người thu hồi phải có quyền quản lý thành viên tại phạm vi của lời mời
            for (const g of (inv.grants ?? []))
                for (const c of g.campusIds)
                    ctx.require('members.manage', c === '*' ? null : c);
            const { before } = await (0, store_1.updateDoc)(ctx, ref, { status: 'revoked', revokedBy: ctx.uid, revokedAt: firebase_1.Timestamp.fromDate(ctx.now), revokeReason: (0, util_1.s)(b.reason) || null });
            await ctx.audit({ action: 'invite.revoke', collection: 'invites', docId: id, before: { status: before.status }, after: { status: 'revoked' }, reason: (0, util_1.s)(b.reason) || undefined });
            return { id, status: 'revoked' };
        },
    },
    'member.updateGrants': {
        scope: 'org',
        perm: 'members.manage',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const uid = (0, util_1.requireId)(b.uid, 'uid');
            if (uid === ctx.uid)
                (0, errors_1.denied)('Không thể tự thay đổi quyền của chính mình.');
            const ref = ctx.doc(`members/${uid}`);
            const cur = await (0, store_1.getOr404)(ref, 'Thành viên');
            if (cur.kind === 'owner')
                (0, errors_1.denied)('Không thể thay đổi quyền của chủ chuỗi.');
            if (cur.kind !== 'staff')
                (0, errors_1.fail)('INVALID_STATE', 'Chỉ gán vai trò cho nhân sự (staff).');
            const grants = (0, util_1.sanitizeGrants)(b.grants);
            // người sửa phải có quyền quản lý ở mọi phạm vi hiện có và mới
            for (const g of (cur.grants ?? []))
                for (const c of g.campusIds)
                    ctx.require('members.manage', c === '*' ? null : c);
            await (0, util_1.assertCanGrant)(ctx, grants);
            const { permsByCampus, permsAny } = await (0, util_1.computeMemberPerms)(ctx, 'staff', grants);
            const { before, after } = await (0, store_1.updateDoc)(ctx, ref, { grants, permsByCampus, permsAny }, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
            await ctx.audit({ action: 'member.updateGrants', collection: 'members', docId: uid, before: { grants: before.grants }, after: { grants }, reason: (0, util_1.s)(b.reason) || undefined });
            return { uid, grants, permsByCampus, version: after.version };
        },
    },
    'member.setStatus': {
        scope: 'org',
        perm: 'members.manage',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const uid = (0, util_1.requireId)(b.uid, 'uid');
            const status = (0, util_1.s)(b.status);
            const reason = (0, util_1.s)(b.reason);
            if (!['active', 'suspended', 'revoked'].includes(status))
                (0, errors_1.invalid)({ status: 'Trạng thái phải là active, suspended hoặc revoked.' });
            if (status !== 'active' && !reason)
                (0, errors_1.invalid)({ reason: 'Vui lòng nhập lý do.' });
            if (uid === ctx.uid)
                (0, errors_1.denied)('Không thể tự khóa tài khoản của chính mình.');
            const ref = ctx.doc(`members/${uid}`);
            const cur = await (0, store_1.getOr404)(ref, 'Thành viên');
            if (cur.kind === 'owner')
                (0, errors_1.denied)('Không thể khóa chủ chuỗi.');
            if (cur.kind === 'staff')
                for (const g of (cur.grants ?? []))
                    for (const c of g.campusIds)
                        ctx.require('members.manage', c === '*' ? null : c);
            if (cur.status === status)
                return { uid, status, unchanged: true };
            const { before } = await (0, store_1.updateDoc)(ctx, ref, { status, statusReason: reason || null, statusChangedAt: firebase_1.Timestamp.fromDate(ctx.now), statusChangedBy: ctx.uid });
            if (status !== 'active')
                await firebase_1.auth.revokeRefreshTokens(uid).catch((e) => console.warn('revokeRefreshTokens', e?.message));
            await ctx.audit({ action: 'member.setStatus', collection: 'members', docId: uid, before: { status: before.status }, after: { status }, reason: reason || undefined });
            return { uid, status, tokensRevoked: status !== 'active' };
        },
    },
    'role.save': {
        scope: 'org',
        perm: 'roles.manage',
        handler: async (ctx, p) => {
            requireOrgWide(ctx, 'roles.manage');
            const b = (0, util_1.asObj)(p);
            const name = (0, util_1.s)(b.name);
            if (name.length < 2)
                (0, errors_1.invalid)({ name: 'Tên vai trò tối thiểu 2 ký tự.' });
            const perms = [...new Set((0, util_1.asArr)(b.perms).map(util_1.s).filter(Boolean))];
            for (const x of perms)
                if (!permissions_1.ALL_PERMISSIONS.includes(x))
                    (0, errors_1.invalid)({ perms: `Quyền không tồn tại: ${x}` });
            for (const x of perms)
                if (!ctx.can(x, null))
                    (0, errors_1.denied)(`Bạn không thể đưa quyền "${x}" vào vai trò vì chính bạn chưa có quyền này.`);
            let id = (0, util_1.s)(b.id);
            const isNew = !id;
            if (isNew)
                id = `role_${(0, util_1.s)(b.key) || Math.random().toString(36).slice(2, 10)}`.toLowerCase();
            if (!util_1.ID_PATTERN.test(id))
                (0, errors_1.invalid)({ id: 'Mã vai trò không hợp lệ.' });
            if (id in permissions_1.SYSTEM_ROLES)
                (0, errors_1.invalid)({ id: 'Không được ghi đè vai trò hệ thống.' });
            const ref = ctx.doc(`roles/${id}`);
            const snap = await ref.get();
            let version;
            if (!snap.exists) {
                if (!isNew && !b.allowCreateWithId)
                    (0, errors_1.fail)('NOT_FOUND', 'Vai trò không tồn tại.');
                await (0, store_1.createDoc)(ctx, 'roles', id, { name, perms, system: false, description: (0, util_1.s)(b.description) });
                version = 1;
                await ctx.audit({ action: 'role.save', collection: 'roles', docId: id, after: { name, perms } });
            }
            else {
                const { before, after } = await (0, store_1.updateDoc)(ctx, ref, { name, perms, description: (0, util_1.s)(b.description) }, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
                version = after.version;
                await ctx.audit({ action: 'role.save', collection: 'roles', docId: id, before: { name: before.name, perms: before.perms }, after: { name, perms } });
                await recomputeMembersWithRole(ctx, id);
            }
            return { id, name, perms, system: false, version };
        },
    },
};
// ------------------------------------------------------------------ nội bộ
function pick(o, like) {
    const out = {};
    for (const k of Object.keys(like))
        out[k] = o[k] ?? null;
    return out;
}
async function recomputeMembersWithRole(ctx, roleId) {
    const snap = await ctx.col('members').where('kind', '==', 'staff').get();
    for (const d of snap.docs) {
        const m = d.data();
        if (!(m.grants ?? []).some((g) => g.roleId === roleId))
            continue;
        const { permsByCampus, permsAny } = await (0, util_1.computeMemberPerms)(ctx, 'staff', m.grants);
        await d.ref.update({ permsByCampus, permsAny, ...ctx.metaUpdate(m.version ?? 1) });
    }
}
/** Danh sách cản trở đóng cơ sở. */
async function closeBlockers(ctx, campusId) {
    const children = await ctx.col('children').where('campusId', '==', campusId).get();
    const active = children.docs.filter((d) => ['active', 'trial', 'on_leave'].includes(d.data().status)).slice(0, 100)
        .map((d) => ({ childId: d.id, code: d.data().code, fullName: d.data().fullName, status: d.data().status }));
    const rcv = await ctx.col('receivables').where('campusId', '==', campusId).get();
    const receivables = rcv.docs.filter((d) => {
        const r = d.data();
        if (r.status === 'paid' || r.status === 'cancelled' || r.status === 'draft')
            return false;
        const bal = typeof r.balance === 'number' ? r.balance : 1;
        return bal > 0;
    }).slice(0, 100).map((d) => ({ id: d.id, childId: d.data().childId, balance: d.data().balance ?? null, status: d.data().status }));
    const dep = await ctx.col('deposits').where('campusId', '==', campusId).get();
    const deposits = dep.docs.filter((d) => d.data().status === 'held').slice(0, 100)
        .map((d) => ({ id: d.id, childId: d.data().childId, amount: d.data().amount ?? null }));
    return { children: active, receivables, deposits };
}
