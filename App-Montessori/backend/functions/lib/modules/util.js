"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.denied = exports.invalid = exports.fail = exports.Timestamp = exports.FieldValue = exports.ID_PATTERN = void 0;
exports.s = s;
exports.asObj = asObj;
exports.asArr = asArr;
exports.normPhone = normPhone;
exports.normEmail = normEmail;
exports.randomCode = randomCode;
exports.shortHash = shortHash;
exports.requireId = requireId;
exports.requireDay = requireDay;
exports.addDays = addDays;
exports.daysBetween = daysBetween;
exports.chunk = chunk;
exports.tsOf = tsOf;
exports.parseWhen = parseWhen;
exports.campusOf = campusOf;
exports.todayOf = todayOf;
exports.childOf = childOf;
exports.classOf = classOf;
exports.requireParentOf = requireParentOf;
exports.classScope = classScope;
exports.requireClassAccess = requireClassAccess;
exports.enrolledOn = enrolledOn;
exports.computeMemberPerms = computeMemberPerms;
exports.assertCanGrant = assertCanGrant;
exports.sanitizeGrants = sanitizeGrants;
exports.pushToUsers = pushToUsers;
exports.parentUidsOfChild = parentUidsOfChild;
const node_crypto_1 = require("node:crypto");
const firebase_1 = require("../core/firebase");
Object.defineProperty(exports, "FieldValue", { enumerable: true, get: function () { return firebase_1.FieldValue; } });
Object.defineProperty(exports, "Timestamp", { enumerable: true, get: function () { return firebase_1.Timestamp; } });
const errors_1 = require("../core/errors");
Object.defineProperty(exports, "denied", { enumerable: true, get: function () { return errors_1.denied; } });
Object.defineProperty(exports, "fail", { enumerable: true, get: function () { return errors_1.fail; } });
Object.defineProperty(exports, "invalid", { enumerable: true, get: function () { return errors_1.invalid; } });
const permissions_1 = require("../core/permissions");
const store_1 = require("../core/store");
const validate_1 = require("../core/validate");
/** Chuỗi gọn, bỏ khoảng trắng thừa. */
function s(v) {
    return typeof v === 'string' ? v.trim() : '';
}
function asObj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}
function asArr(v) {
    return Array.isArray(v) ? v : [];
}
/** Chuẩn hóa số điện thoại VN về dạng E.164 (+84...). Trả '' nếu rỗng. */
function normPhone(p) {
    let x = s(p).replace(/[\s.\-()]/g, '');
    if (!x)
        return '';
    if (x.startsWith('00'))
        x = '+' + x.slice(2);
    if (x.startsWith('0'))
        x = '+84' + x.slice(1);
    else if (x.startsWith('84') && !x.startsWith('+'))
        x = '+' + x;
    if (!/^\+\d{8,15}$/.test(x))
        (0, errors_1.invalid)({ phone: 'Số điện thoại không hợp lệ.' });
    return x;
}
function normEmail(e) {
    const x = s(e).toLowerCase();
    if (!x)
        return '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))
        (0, errors_1.invalid)({ email: 'Email không hợp lệ.' });
    return x;
}
function randomCode(len = 8) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const b = (0, node_crypto_1.randomBytes)(len);
    let out = '';
    for (let i = 0; i < len; i++)
        out += alphabet[b[i] % alphabet.length];
    return out;
}
function shortHash(v, n = 20) {
    return (0, node_crypto_1.createHash)('sha1').update(v).digest('hex').slice(0, n);
}
exports.ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
function requireId(v, field) {
    const x = s(v);
    if (!exports.ID_PATTERN.test(x))
        (0, errors_1.invalid)({ [field]: 'Mã không hợp lệ.' });
    return x;
}
function requireDay(v, field) {
    if (!(0, validate_1.isValidDay)(v))
        (0, errors_1.invalid)({ [field]: 'Ngày không hợp lệ (YYYY-MM-DD).' });
    return v;
}
function addDays(day, n) {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}
/** Danh sách ngày từ -> đến (tối đa 366 ngày). */
function daysBetween(from, to) {
    const out = [];
    let d = from;
    while (d <= to && out.length < 367) {
        out.push(d);
        d = addDays(d, 1);
    }
    return out;
}
function chunk(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n)
        out.push(arr.slice(i, i + n));
    return out;
}
function tsOf(v) {
    if (!v)
        return null;
    if (v instanceof firebase_1.Timestamp)
        return v.toDate();
    if (v instanceof Date)
        return v;
    if (typeof v === 'string') {
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
}
/** Parse ISO datetime hoặc dayKey từ client; ném VALIDATION nếu sai. */
function parseWhen(v, field, endOfDay = false) {
    if (v === undefined || v === null || v === '')
        return null;
    if (typeof v !== 'string')
        (0, errors_1.invalid)({ [field]: 'Thời điểm không hợp lệ.' });
    if ((0, validate_1.isValidDay)(v))
        return new Date(`${v}T${endOfDay ? '23:59:59' : '00:00:00'}+07:00`);
    const d = new Date(v);
    if (Number.isNaN(d.getTime()))
        (0, errors_1.invalid)({ [field]: 'Thời điểm không hợp lệ.' });
    return d;
}
async function campusOf(ctx, campusId) {
    const id = requireId(campusId, 'campusId');
    const snap = await ctx.doc(`campuses/${id}`).get();
    if (!snap.exists)
        (0, errors_1.denied)('Bạn không có quyền truy cập cơ sở này.'); // không lộ tồn tại
    return { id: snap.id, ...snap.data() };
}
function todayOf(ctx, campus) {
    return (0, store_1.dayKeyOf)(ctx.now, campus?.timezone || 'Asia/Ho_Chi_Minh');
}
/** Tải trẻ thuộc org hiện tại. Lỗi NOT_FOUND nếu không có. */
async function childOf(ctx, childId) {
    const id = requireId(childId, 'childId');
    return (await (0, store_1.getOr404)(ctx.doc(`children/${id}`), 'Hồ sơ trẻ'));
}
async function classOf(ctx, classId) {
    const id = requireId(classId, 'classId');
    return (await (0, store_1.getOr404)(ctx.doc(`classes/${id}`), 'Lớp học'));
}
/** Phụ huynh: kiểm tra con thuộc childIds. */
function requireParentOf(ctx, childId) {
    if (ctx.member?.kind !== 'parent' || !(ctx.member.childIds ?? []).includes(childId))
        (0, errors_1.denied)('Bạn không có quyền với hồ sơ trẻ này.');
}
/**
 * Phạm vi lớp của người dùng tại cơ sở. null = không hạn chế theo lớp.
 * Giáo viên có grant classIds => các lớp đó; grant không có classIds => theo assignments đang hiệu lực (CONTRACT §3).
 */
async function classScope(ctx, campusId) {
    if (ctx.platformAdmin || !ctx.member || ctx.member.kind === 'owner')
        return null;
    const now = ctx.now;
    const covering = (ctx.member.grants ?? []).filter((g) => {
        if (g.validFrom && new Date(g.validFrom) > now)
            return false;
        if (g.validTo && new Date(g.validTo) < now)
            return false;
        return g.campusIds.includes('*') || g.campusIds.includes(campusId);
    });
    if (covering.length === 0)
        return null;
    if (covering.some((g) => g.roleId !== 'teacher'))
        return null; // quản lý/nhân sự khác: không bó theo lớp
    const ids = new Set();
    let needAssignments = false;
    for (const g of covering) {
        if (g.classIds && g.classIds.length)
            g.classIds.forEach((c) => ids.add(c));
        else
            needAssignments = true;
    }
    if (needAssignments) {
        const q = await ctx.col('assignments').where('uid', '==', ctx.uid).where('campusId', '==', campusId).get();
        for (const d of q.docs) {
            const a = d.data();
            if (a.status === 'cancelled' || a.archived)
                continue;
            const from = tsOf(a.validFrom);
            const to = tsOf(a.validTo);
            if (from && from > now)
                continue;
            if (to && to < now)
                continue;
            ids.add(a.classId);
        }
    }
    return [...ids];
}
async function requireClassAccess(ctx, campusId, classId) {
    const scope = await classScope(ctx, campusId);
    if (scope === null)
        return;
    if (!classId || !scope.includes(classId))
        (0, errors_1.denied)('Bạn chỉ được thao tác trên lớp được phân công.');
}
/** Trẻ có phân lớp hiệu lực tại lớp vào ngày dayKey? */
async function enrolledOn(ctx, childId, classId, dayKey) {
    const q = await ctx.col('enrollments').where('childId', '==', childId).where('classId', '==', classId).get();
    return q.docs.some((d) => {
        const e = d.data();
        if (e.status === 'cancelled')
            return false;
        return (!e.startDate || e.startDate <= dayKey) && (!e.endDate || dayKey <= e.endDate);
    });
}
// ---------------------------------------------------------------- member / quyền
/** Tính permsByCampus + permsAny (hợp mọi cơ sở) cho member. */
async function computeMemberPerms(ctx, kind, grants) {
    const rolesSnap = await ctx.col('roles').get();
    const custom = {};
    rolesSnap.forEach((r) => { custom[r.id] = r.data().perms ?? []; });
    const campusIds = (await ctx.col('campuses').select().get()).docs.map((d) => d.id);
    const g = kind === 'owner' ? [{ id: 'owner', roleId: 'owner', campusIds: ['*'] }] : grants;
    const permsByCampus = (0, permissions_1.computePermsByCampus)(g, custom, ctx.now, campusIds);
    const permsAny = [...new Set(Object.values(permsByCampus).flat())].sort();
    return { permsByCampus, permsAny };
}
/** Quyền của caller phải là siêu tập của quyền được cấp (chống leo thang đặc quyền). */
async function assertCanGrant(ctx, grants) {
    const rolesSnap = await ctx.col('roles').get();
    const custom = {};
    rolesSnap.forEach((r) => { custom[r.id] = r.data().perms ?? []; });
    const campusIds = (await ctx.col('campuses').select().get()).docs.map((d) => d.id);
    for (const g of grants) {
        if (g.roleId === 'owner')
            (0, errors_1.invalid)({ grants: 'Không thể cấp vai trò chủ chuỗi qua lời mời.' });
        if (!(g.roleId in permissions_1.SYSTEM_ROLES) && !(g.roleId in custom))
            (0, errors_1.invalid)({ grants: `Vai trò không tồn tại: ${g.roleId}` });
        const base = permissions_1.SYSTEM_ROLES[g.roleId] ?? custom[g.roleId] ?? [];
        const perms = [...new Set([...base, ...(g.extraPerms ?? [])])].filter((p) => !(g.deniedPerms ?? []).includes(p));
        const targets = g.campusIds.includes('*') ? ['*'] : g.campusIds;
        for (const c of targets) {
            if (c !== '*' && !campusIds.includes(c))
                (0, errors_1.invalid)({ grants: `Cơ sở không thuộc tổ chức: ${c}` });
            if (!ctx.can('members.manage', c === '*' ? null : c))
                (0, errors_1.denied)('Bạn không có quyền cấp vai trò tại cơ sở này.');
            for (const p of perms) {
                const ok = c === '*' ? ctx.can(p, null) : ctx.can(p, c);
                if (!ok)
                    (0, errors_1.denied)(`Bạn không thể cấp quyền "${p}" vì chính bạn chưa có quyền này tại phạm vi đó.`);
            }
        }
    }
}
/** Kiểm tra và chuẩn hóa danh sách grants từ client. */
function sanitizeGrants(raw) {
    const arr = asArr(raw);
    const out = [];
    arr.forEach((g0, i) => {
        const g = asObj(g0);
        const roleId = s(g.roleId);
        if (!roleId)
            (0, errors_1.invalid)({ [`grants[${i}].roleId`]: 'Chọn vai trò.' });
        const campusIds = asArr(g.campusIds).map(s).filter(Boolean);
        if (campusIds.length === 0)
            (0, errors_1.invalid)({ [`grants[${i}].campusIds`]: 'Chọn ít nhất một cơ sở.' });
        for (const c of campusIds)
            if (c !== '*' && !exports.ID_PATTERN.test(c))
                (0, errors_1.invalid)({ [`grants[${i}].campusIds`]: 'Mã cơ sở không hợp lệ.' });
        const grant = { id: s(g.id) || `g_${(0, node_crypto_1.randomBytes)(4).toString('hex')}`, roleId, campusIds: [...new Set(campusIds)] };
        const classIds = asArr(g.classIds).map(s).filter(Boolean);
        if (classIds.length)
            grant.classIds = classIds;
        if (g.validFrom) {
            const d = tsOf(g.validFrom);
            if (!d)
                (0, errors_1.invalid)({ [`grants[${i}].validFrom`]: 'Thời điểm không hợp lệ.' });
            grant.validFrom = d.toISOString();
        }
        if (g.validTo) {
            const d = tsOf(g.validTo);
            if (!d)
                (0, errors_1.invalid)({ [`grants[${i}].validTo`]: 'Thời điểm không hợp lệ.' });
            grant.validTo = d.toISOString();
        }
        if (grant.validFrom && grant.validTo && grant.validFrom > grant.validTo)
            (0, errors_1.invalid)({ [`grants[${i}].validTo`]: 'Ngày kết thúc phải sau ngày bắt đầu.' });
        for (const k of ['extraPerms', 'deniedPerms']) {
            const list = asArr(g[k]).map(s).filter(Boolean);
            for (const p of list)
                if (!permissions_1.ALL_PERMISSIONS.includes(p))
                    (0, errors_1.invalid)({ [`grants[${i}].${k}`]: `Quyền không tồn tại: ${p}` });
            if (list.length)
                grant[k] = list;
        }
        out.push(grant);
    });
    return out;
}
// ---------------------------------------------------------------- push FCM (best-effort)
/** Gửi push chung chung tới các uid. KHÔNG đưa nội dung sức khỏe/công nợ vào payload. */
async function pushToUsers(orgId, uids, data = {}) {
    try {
        const tokens = [];
        for (const group of chunk([...new Set(uids)], 20)) {
            const snaps = await Promise.all(group.map((u) => firebase_1.db.collection(`users/${u}/devices`).get()));
            for (const sn of snaps)
                sn.forEach((d) => { const t = d.data().fcmToken; if (t)
                    tokens.push(t); });
        }
        if (!tokens.length)
            return 0;
        let sent = 0;
        for (const part of chunk([...new Set(tokens)], 500)) {
            const res = await (0, firebase_1.messaging)().sendEachForMulticast({
                tokens: part,
                notification: { title: 'Mầm non', body: 'Có cập nhật mới từ nhà trường' },
                data: { orgId, ...data },
            });
            sent += res.successCount;
        }
        return sent;
    }
    catch (e) {
        console.warn('push failed (best-effort)', String(e?.message ?? e));
        return 0;
    }
}
/** uid các phụ huynh được liên kết với trẻ (tùy chọn chỉ người có quyền notify). */
async function parentUidsOfChild(ctx, childId, perm) {
    const q = await ctx.col('guardianLinks').where('childId', '==', childId).get();
    return q.docs
        .map((d) => d.data())
        .filter((g) => g.status === 'linked' && g.uid && (!perm || g.perms?.[perm] !== false))
        .map((g) => g.uid);
}
