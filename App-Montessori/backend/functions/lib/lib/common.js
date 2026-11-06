"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hhmmOf = exports.dayKeyOf = exports.sumBy = exports.tzOf = exports.chunk = exports.ts = exports.asDocs = void 0;
exports.toDate = toDate;
exports.commitOps = commitOps;
exports.resolveCampus = resolveCampus;
exports.getInCampus = getInCampus;
exports.needDay = needDay;
exports.needPeriod = needPeriod;
exports.needStr = needStr;
exports.needVnd = needVnd;
exports.needDecision = needDecision;
exports.separateDuties = separateDuties;
exports.employeeIdOf = employeeIdOf;
exports.syncApproval = syncApproval;
exports.limited = limited;
const firebase_1 = require("../core/firebase");
const errors_1 = require("../core/errors");
const store_1 = require("../core/store");
const validate_1 = require("../core/validate");
const time_1 = require("./time");
const asDocs = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));
exports.asDocs = asDocs;
function toDate(v) {
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
    if (typeof v === 'object' && v && 'seconds' in v)
        return new firebase_1.Timestamp(v.seconds, v.nanoseconds ?? 0).toDate();
    return null;
}
const ts = (d) => firebase_1.Timestamp.fromDate(d);
exports.ts = ts;
const chunk = (a, n) => {
    const out = [];
    for (let i = 0; i < a.length; i += n)
        out.push(a.slice(i, i + n));
    return out;
};
exports.chunk = chunk;
/** Ghi nhiều thao tác theo lô ≤ 400. */
async function commitOps(ops) {
    for (const part of (0, exports.chunk)(ops, 400)) {
        const b = firebase_1.db.batch();
        for (const op of part)
            op(b);
        await b.commit();
    }
}
/** campusId của request (payload.campusId hoặc ctx.campusId), phải thuộc org; kiểm tra quyền tại cơ sở đó. */
async function resolveCampus(ctx, payload, perm) {
    const id = (payload && typeof payload.campusId === 'string' && payload.campusId) || ctx.campusId;
    if (!id)
        (0, errors_1.invalid)({ campusId: 'Bắt buộc chọn cơ sở.' });
    const campus = await (0, store_1.getCampus)(ctx, id);
    if (perm)
        ctx.require(perm, id);
    return { id, campus };
}
const tzOf = (campus) => campus.timezone || 'Asia/Ho_Chi_Minh';
exports.tzOf = tzOf;
/** Đọc doc thuộc ĐÚNG cơ sở (không tin client). Trả doc; NOT_FOUND nếu không có hoặc khác cơ sở. */
async function getInCampus(ctx, path, id, campusId, what = 'Bản ghi') {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id))
        (0, errors_1.invalid)({ id: `${what}: mã không hợp lệ.` });
    const s = await ctx.doc(`${path}/${id}`).get();
    if (!s.exists)
        (0, errors_1.fail)('NOT_FOUND', `${what} không tồn tại.`);
    const d = { id: s.id, ...s.data() };
    if (campusId && d.campusId && d.campusId !== campusId)
        (0, errors_1.fail)('NOT_FOUND', `${what} không tồn tại.`);
    return d;
}
function needDay(v, field) {
    if (!(0, validate_1.isValidDay)(v))
        (0, errors_1.invalid)({ [field]: 'Ngày không hợp lệ (YYYY-MM-DD).' });
    return v;
}
function needPeriod(v, field = 'periodKey') {
    if (typeof v !== 'string' || !time_1.PERIOD_RE.test(v))
        (0, errors_1.invalid)({ [field]: 'Kỳ không hợp lệ (YYYY-MM).' });
    return v;
}
function needStr(v, field, max = 500) {
    if (typeof v !== 'string' || !v.trim())
        (0, errors_1.invalid)({ [field]: 'Bắt buộc nhập.' });
    if (v.length > max)
        (0, errors_1.invalid)({ [field]: `Tối đa ${max} ký tự.` });
    return v.trim();
}
function needVnd(v, field = 'amount', opts = {}) {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || (!opts.allowZero && v === 0)) {
        (0, errors_1.invalid)({ [field]: 'Số tiền phải là số nguyên đồng' + (opts.allowZero ? ' không âm.' : ' lớn hơn 0.') });
    }
    return v;
}
function needDecision(v) {
    if (v !== 'approved' && v !== 'rejected')
        (0, errors_1.invalid)({ decision: 'Quyết định phải là approved hoặc rejected.' });
    return v;
}
/** Tách người lập / người duyệt: không tự duyệt yêu cầu của mình (chủ sở hữu được phép). */
function separateDuties(ctx, requestedBy, what = 'yêu cầu') {
    if (requestedBy && requestedBy === ctx.uid && ctx.member?.kind !== 'owner' && !ctx.platformAdmin) {
        (0, errors_1.fail)('PRECONDITION', `Không thể tự duyệt ${what} do chính mình lập. Cần người có thẩm quyền khác duyệt.`, { reason: 'SELF_APPROVAL' });
    }
}
function employeeIdOf(ctx) {
    const e = ctx.member?.employeeId;
    if (!e)
        (0, errors_1.fail)('PRECONDITION', 'Tài khoản chưa được liên kết với hồ sơ nhân viên.', { reason: 'NO_EMPLOYEE' });
    return e;
}
/** Cập nhật phiếu phê duyệt tập trung (nếu có) khi quyết định được thực hiện trực tiếp qua action nghiệp vụ. */
async function syncApproval(ctx, refCollection, refId, status, note) {
    const s = await ctx.col('approvals').where('refId', '==', refId).where('status', '==', 'pending').get();
    for (const d of s.docs) {
        if (d.data().refCollection !== refCollection)
            continue;
        await d.ref.update({
            status, decidedBy: ctx.uid, decidedAt: firebase_1.Timestamp.now(), decisionNote: note ?? null,
            updatedAt: firebase_1.Timestamp.now(), updatedBy: ctx.uid, version: (d.data().version ?? 0) + 1,
        });
    }
}
/** Một số truy vấn có giới hạn an toàn (tránh đọc không giới hạn). */
async function limited(q, n = 5000) {
    return (0, exports.asDocs)(await q.limit(n).get());
}
const sumBy = (a, f) => a.reduce((s, x) => s + f(x), 0);
exports.sumBy = sumBy;
/** dayKey hôm nay theo múi giờ cơ sở. */
var store_2 = require("../core/store");
Object.defineProperty(exports, "dayKeyOf", { enumerable: true, get: function () { return store_2.dayKeyOf; } });
Object.defineProperty(exports, "hhmmOf", { enumerable: true, get: function () { return store_2.hhmmOf; } });
