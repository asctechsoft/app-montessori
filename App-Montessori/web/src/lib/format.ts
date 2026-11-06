export const DEFAULT_TZ = 'Asia/Ho_Chi_Minh';

/** 4100000 -> "4.100.000 đ" (số nguyên VND). */
export function formatVnd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  const n = Math.round(amount);
  const sign = n < 0 ? '-' : '';
  return `${sign}${Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} đ`;
}

/** "4.100.000" | "4100000 đ" -> 4100000 ; rỗng -> null. */
export function parseVnd(text: string): number | null {
  const digits = text.replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

export type DateLike = Date | string | number | { toDate: () => Date } | null | undefined;

export function toDate(v: DateLike): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'object' && 'toDate' in v) return v.toDate();
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00`);
  const d = new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parts(d: Date, tz: string, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', ...opts }).formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** dd/MM/yyyy theo múi giờ cơ sở. Chuỗi dayKey (YYYY-MM-DD) được đổi trực tiếp, không lệch múi giờ. */
export function formatDate(v: DateLike, tz: string = DEFAULT_TZ): string {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
  const d = toDate(v);
  if (!d) return '—';
  const p = parts(d, tz, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${p.day}/${p.month}/${p.year}`;
}

/** HH:mm theo múi giờ cơ sở. */
export function formatTime(v: DateLike, tz: string = DEFAULT_TZ): string {
  const d = toDate(v);
  if (!d) return '—';
  const p = parts(d, tz, { hour: '2-digit', minute: '2-digit' });
  return `${p.hour}:${p.minute}`;
}

export function formatDateTime(v: DateLike, tz: string = DEFAULT_TZ): string {
  const d = toDate(v);
  if (!d) return '—';
  return `${formatTime(d, tz)} ${formatDate(d, tz)}`;
}

/** dayKey YYYY-MM-DD theo múi giờ cơ sở. */
export function dayKey(v: DateLike = new Date(), tz: string = DEFAULT_TZ): string {
  const d = toDate(v);
  if (!d) return '';
  const p = parts(d, tz, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${p.year}-${p.month}-${p.day}`;
}

/** dd/MM/yyyy -> YYYY-MM-DD (null nếu sai). */
export function parseDisplayDate(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (d.getFullYear() !== Number(yyyy) || d.getMonth() !== Number(mm) - 1 || d.getDate() !== Number(dd)) return null;
  return `${yyyy}-${mm}-${dd}`;
}

export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
