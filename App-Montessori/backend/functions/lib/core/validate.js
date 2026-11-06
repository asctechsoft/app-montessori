"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vnd = exports.TIME_RE = exports.DAY_RE = void 0;
exports.isValidDay = isValidDay;
exports.validate = validate;
exports.requireRange = requireRange;
const errors_1 = require("./errors");
exports.DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
exports.TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
function isValidDay(s) {
    if (typeof s !== 'string' || !exports.DAY_RE.test(s))
        return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function check(rule, v) {
    if (v === undefined || v === null || v === '')
        return rule.req ? 'Bắt buộc nhập.' : null;
    switch (rule.t) {
        case 'string':
            if (typeof v !== 'string')
                return 'Phải là chuỗi.';
            if (rule.min && v.trim().length < rule.min)
                return `Tối thiểu ${rule.min} ký tự.`;
            if (rule.max && v.length > rule.max)
                return `Tối đa ${rule.max} ký tự.`;
            if (rule.pattern && !rule.pattern.test(v))
                return 'Định dạng không đúng.';
            if (rule.oneOf && !rule.oneOf.includes(v))
                return 'Giá trị không hợp lệ.';
            return null;
        case 'int':
            if (typeof v !== 'number' || !Number.isSafeInteger(v))
                return 'Phải là số nguyên.';
            if (rule.min !== undefined && v < rule.min)
                return `Không nhỏ hơn ${rule.min}.`;
            if (rule.max !== undefined && v > rule.max)
                return `Không lớn hơn ${rule.max}.`;
            return null;
        case 'number':
            if (typeof v !== 'number' || !Number.isFinite(v))
                return 'Phải là số.';
            if (rule.min !== undefined && v < rule.min)
                return `Không nhỏ hơn ${rule.min}.`;
            if (rule.max !== undefined && v > rule.max)
                return `Không lớn hơn ${rule.max}.`;
            return null;
        case 'bool':
            return typeof v === 'boolean' ? null : 'Phải là đúng/sai.';
        case 'day':
            return isValidDay(v) ? null : 'Ngày không hợp lệ (YYYY-MM-DD).';
        case 'time':
            return typeof v === 'string' && exports.TIME_RE.test(v) ? null : 'Giờ không hợp lệ (HH:mm).';
        case 'array':
            if (!Array.isArray(v))
                return 'Phải là danh sách.';
            if (rule.max && v.length > rule.max)
                return `Tối đa ${rule.max} phần tử.`;
            if (rule.of)
                for (const x of v) {
                    const e = check(rule.of, x);
                    if (e)
                        return e;
                }
            return null;
        case 'object':
            return typeof v === 'object' && !Array.isArray(v) ? null : 'Phải là đối tượng.';
        default:
            return null;
    }
}
/** Kiểm tra dữ liệu theo schema; ném VALIDATION kèm fieldErrors. Chỉ giữ các field có trong schema. */
function validate(data, schema, opts = {}) {
    const src = (data && typeof data === 'object' ? data : {});
    const errors = {};
    const out = {};
    for (const [k, rule] of Object.entries(schema)) {
        if (opts.partial && !(k in src))
            continue;
        const e = check(rule, src[k]);
        if (e)
            errors[k] = e;
        else if (src[k] !== undefined)
            out[k] = src[k];
    }
    if (Object.keys(errors).length)
        (0, errors_1.invalid)(errors);
    return out;
}
function requireRange(from, to, fromKey = 'fromDay', toKey = 'toDay') {
    if (from > to)
        (0, errors_1.invalid)({ [toKey]: 'Ngày kết thúc phải từ ngày bắt đầu trở đi.' });
    void fromKey;
}
const vnd = (v, field = 'amount') => {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)
        (0, errors_1.invalid)({ [field]: 'Số tiền phải là số nguyên đồng không âm.' });
    return v;
};
exports.vnd = vnd;
