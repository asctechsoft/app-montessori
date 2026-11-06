"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERIOD_RE = exports.VN_TZ = void 0;
exports.dayIndex = dayIndex;
exports.addDays = addDays;
exports.weekday = weekday;
exports.listDays = listDays;
exports.timeToMin = timeToMin;
exports.minToTime = minToTime;
exports.periodRange = periodRange;
exports.prevPeriodKey = prevPeriodKey;
exports.nextPeriodKey = nextPeriodKey;
exports.localDayMinutes = localDayMinutes;
exports.minutesSinceDayStart = minutesSinceDayStart;
exports.zonedTimeToDate = zonedTimeToDate;
exports.overlaps = overlaps;
exports.distanceM = distanceM;
// Hàm thời gian THUẦN (không phụ thuộc Firebase) — dùng cho tính công, kỳ, hạn.
exports.VN_TZ = 'Asia/Ho_Chi_Minh';
function dayIndex(day) {
    const [y, m, d] = day.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}
function addDays(day, n) {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** 0=CN ... 6=T7 */
function weekday(day) {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
/** Danh sách ngày [from..to] (tối đa 400 ngày để tránh vòng lặp vô hạn do dữ liệu sai). */
function listDays(from, to) {
    const out = [];
    const n = dayIndex(to) - dayIndex(from);
    for (let i = 0; i <= Math.min(n, 400); i++)
        out.push(addDays(from, i));
    return out;
}
function timeToMin(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}
function minToTime(min) {
    const m = ((min % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
exports.PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** periodKey 'YYYY-MM' → {from, to} dayKey. */
function periodRange(periodKey) {
    const [y, m] = periodKey.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${periodKey}-01`, to: `${periodKey}-${String(last).padStart(2, '0')}` };
}
function prevPeriodKey(periodKey) {
    const [y, m] = periodKey.split('-').map(Number);
    return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}
function nextPeriodKey(periodKey) {
    const [y, m] = periodKey.split('-').map(Number);
    return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}
function parts(date, tz) {
    const f = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const o = {};
    for (const p of f.formatToParts(date))
        if (p.type !== 'literal')
            o[p.type] = Number(p.value);
    return { y: o.year, m: o.month, d: o.day, h: o.hour === 24 ? 0 : o.hour, mi: o.minute, s: o.second };
}
/** dayKey + phút trong ngày (theo múi giờ) của một thời điểm. */
function localDayMinutes(date, tz = exports.VN_TZ) {
    const p = parts(date, tz);
    return { day: `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`, minutes: p.h * 60 + p.mi };
}
/** Số phút tính từ 00:00 của `day` (theo múi giờ) tới thời điểm `date`; có thể >1440 (hôm sau) hoặc <0. */
function minutesSinceDayStart(day, date, tz = exports.VN_TZ) {
    const l = localDayMinutes(date, tz);
    return (dayIndex(l.day) - dayIndex(day)) * 1440 + l.minutes;
}
function tzOffsetMs(date, tz) {
    const p = parts(date, tz);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}
/** Giờ địa phương (day + HH:mm theo tz) → Date (UTC instant). */
function zonedTimeToDate(day, hhmm, tz = exports.VN_TZ) {
    const [y, m, d] = day.split('-').map(Number);
    const [h, mi] = hhmm.split(':').map(Number);
    const utc = Date.UTC(y, m - 1, d, h, mi);
    let guess = utc - tzOffsetMs(new Date(utc), tz);
    guess = utc - tzOffsetMs(new Date(guess), tz);
    return new Date(guess);
}
/** Hai khoảng [a1,a2) và [b1,b2) có chồng nhau. */
function overlaps(a1, a2, b1, b2) {
    return a1 < b2 && b1 < a2;
}
/** Khoảng cách Haversine (mét). */
function distanceM(lat1, lng1, lat2, lng2) {
    const R = 6_371_000;
    const rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}
