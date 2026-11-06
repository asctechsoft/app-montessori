// Hàm thời gian THUẦN (không phụ thuộc Firebase) — dùng cho tính công, kỳ, hạn.
export const VN_TZ = 'Asia/Ho_Chi_Minh';

export function dayIndex(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0=CN ... 6=T7 */
export function weekday(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Danh sách ngày [from..to] (tối đa 400 ngày để tránh vòng lặp vô hạn do dữ liệu sai). */
export function listDays(from: string, to: string): string[] {
  const out: string[] = [];
  const n = dayIndex(to) - dayIndex(from);
  for (let i = 0; i <= Math.min(n, 400); i++) out.push(addDays(from, i));
  return out;
}

export function timeToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function minToTime(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** periodKey 'YYYY-MM' → {from, to} dayKey. */
export function periodRange(periodKey: string): { from: string; to: string } {
  const [y, m] = periodKey.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${periodKey}-01`, to: `${periodKey}-${String(last).padStart(2, '0')}` };
}

export function prevPeriodKey(periodKey: string): string {
  const [y, m] = periodKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

export function nextPeriodKey(periodKey: string): string {
  const [y, m] = periodKey.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

interface Parts { y: number; m: number; d: number; h: number; mi: number; s: number }
function parts(date: Date, tz: string): Parts {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(date)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour === 24 ? 0 : o.hour, mi: o.minute, s: o.second };
}

/** dayKey + phút trong ngày (theo múi giờ) của một thời điểm. */
export function localDayMinutes(date: Date, tz = VN_TZ): { day: string; minutes: number } {
  const p = parts(date, tz);
  return { day: `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`, minutes: p.h * 60 + p.mi };
}

/** Số phút tính từ 00:00 của `day` (theo múi giờ) tới thời điểm `date`; có thể >1440 (hôm sau) hoặc <0. */
export function minutesSinceDayStart(day: string, date: Date, tz = VN_TZ): number {
  const l = localDayMinutes(date, tz);
  return (dayIndex(l.day) - dayIndex(day)) * 1440 + l.minutes;
}

function tzOffsetMs(date: Date, tz: string): number {
  const p = parts(date, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

/** Giờ địa phương (day + HH:mm theo tz) → Date (UTC instant). */
export function zonedTimeToDate(day: string, hhmm: string, tz = VN_TZ): Date {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const utc = Date.UTC(y, m - 1, d, h, mi);
  let guess = utc - tzOffsetMs(new Date(utc), tz);
  guess = utc - tzOffsetMs(new Date(guess), tz);
  return new Date(guess);
}

/** Hai khoảng [a1,a2) và [b1,b2) có chồng nhau. */
export function overlaps(a1: number, a2: number, b1: number, b2: number): boolean {
  return a1 < b2 && b1 < a2;
}

/** Khoảng cách Haversine (mét). */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1); const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
