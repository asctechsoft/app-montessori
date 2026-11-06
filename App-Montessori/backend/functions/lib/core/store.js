"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOr404 = getOr404;
exports.createDoc = createDoc;
exports.updateDoc = updateDoc;
exports.serialize = serialize;
exports.dayKeyOf = dayKeyOf;
exports.hhmmOf = hhmmOf;
exports.getCampus = getCampus;
exports.effectiveOn = effectiveOn;
const firebase_1 = require("./firebase");
const errors_1 = require("./errors");
/** Đọc doc, ném NOT_FOUND nếu không có. */
async function getOr404(ref, what = 'Bản ghi') {
    const s = await ref.get();
    if (!s.exists)
        (0, errors_1.fail)('NOT_FOUND', `${what} không tồn tại.`);
    return { id: s.id, ...s.data() };
}
/** Tạo doc mới (id tự sinh hoặc cho trước). Ném CONFLICT nếu đã tồn tại. */
async function createDoc(ctx, path, id, data) {
    const col = ctx.col(path);
    const ref = id ? col.doc(id) : col.doc();
    try {
        await ref.create({ ...data, ...ctx.metaCreate() });
    }
    catch (e) {
        if (e?.code === 6 || /ALREADY_EXISTS/.test(String(e?.message)))
            (0, errors_1.fail)('CONFLICT', 'Bản ghi đã tồn tại.');
        throw e;
    }
    return ref.id;
}
/** Sửa doc có kiểm tra version (optimistic lock). Trả {before, after}. */
async function updateDoc(ctx, ref, patch, expectedVersion) {
    return ctx.tx(async (t) => {
        const s = await t.get(ref);
        if (!s.exists)
            (0, errors_1.fail)('NOT_FOUND', 'Bản ghi không tồn tại.');
        const before = s.data();
        const prev = before.version ?? 0;
        if (expectedVersion !== undefined && expectedVersion !== prev) {
            (0, errors_1.fail)('VERSION_CONFLICT', 'Dữ liệu đã được người khác thay đổi. Vui lòng tải lại để đối chiếu.', { currentVersion: prev });
        }
        const next = { ...patch, ...ctx.metaUpdate(prev) };
        t.update(ref, next);
        return { before, after: { ...before, ...next } };
    });
}
/** Chuyển Timestamp/Date → ISO string, đệ quy (để trả về client). */
function serialize(v) {
    if (v === null || v === undefined)
        return v;
    if (v instanceof firebase_1.Timestamp)
        return v.toDate().toISOString();
    if (v instanceof Date)
        return v.toISOString();
    if (Array.isArray(v))
        return v.map((x) => serialize(x));
    if (typeof v === 'object') {
        const o = {};
        for (const [k, x] of Object.entries(v))
            o[k] = serialize(x);
        return o;
    }
    return v;
}
/** Ngày dayKey theo múi giờ (mặc định VN) của một thời điểm. */
function dayKeyOf(d, tz = 'Asia/Ho_Chi_Minh') {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    return parts; // en-CA => YYYY-MM-DD
}
/** Giờ HH:mm theo múi giờ. */
function hhmmOf(d, tz = 'Asia/Ho_Chi_Minh') {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
async function getCampus(ctx, campusId) {
    const s = await ctx.doc(`campuses/${campusId}`).get();
    if (!s.exists)
        (0, errors_1.fail)('NOT_FOUND', 'Cơ sở không tồn tại trong tổ chức này.');
    return { id: s.id, ...s.data() };
}
/** Giá trị hiệu lực theo ngày: [from, to] dạng dayKey, to có thể rỗng. */
function effectiveOn(day, from, to) {
    return (!from || from <= day) && (!to || day <= to);
}
