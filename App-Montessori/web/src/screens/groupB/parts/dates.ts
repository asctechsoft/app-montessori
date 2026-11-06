// Tiện ích ngày/kỳ thuần (không phụ thuộc múi giờ máy): dayKey là chuỗi YYYY-MM-DD, periodKey là YYYY-MM.
import { dayKey as dayKeyOf } from '@/lib/format';

export const dayIndex = (day: string): number => {
  const [y, m, d] = day.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
};

export const addDays = (day: string, n: number): string => new Date((dayIndex(day) + n) * 86_400_000).toISOString().slice(0, 10);

export const listDays = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let i = dayIndex(from); i <= dayIndex(to) && out.length < 400; i++) out.push(new Date(i * 86_400_000).toISOString().slice(0, 10));
  return out;
};

/** 0 = Chủ nhật. */
export const weekday = (day: string): number => new Date(dayIndex(day) * 86_400_000).getUTCDay();

export const WEEKDAY_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

export const periodRange = (periodKey: string): { from: string; to: string } => {
  const [y, m] = periodKey.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${periodKey}-01`, to: `${periodKey}-${String(last).padStart(2, '0')}` };
};

export const currentPeriod = (tz?: string): string => dayKeyOf(new Date(), tz).slice(0, 7);

export const periodLabel = (pk: string): string => `Tháng ${pk.slice(5, 7)}/${pk.slice(0, 4)}`;

/** Danh sách kỳ (mới nhất trước), từ tháng hiện tại lùi `past` kỳ, có thể kèm `future` kỳ tương lai. */
export function periodOptions(tz?: string, past = 14, future = 1): { value: string; label: string }[] {
  const cur = currentPeriod(tz);
  const [y, m] = cur.split('-').map(Number);
  const out: { value: string; label: string }[] = [];
  for (let i = -future; i < past; i++) {
    const pk = new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7);
    out.push({ value: pk, label: periodLabel(pk) });
  }
  return out;
}

/** Thứ hai đầu tuần chứa ngày `day`. */
export const mondayOf = (day: string): string => {
  const w = weekday(day);
  return addDays(day, w === 0 ? -6 : 1 - w);
};

export const minutesToHm = (min: number | null | undefined): string => {
  if (min === null || min === undefined) return '—';
  const m = Math.round(min);
  return `${Math.floor(m / 60)} giờ ${String(m % 60).padStart(2, '0')} phút`;
};

/** Số phút từ 00:00 ngày bắt đầu ca → "HH:mm" (qua đêm hiển thị +1 ngày). */
export const minToClock = (min: number | null | undefined): string => {
  if (min === null || min === undefined) return '—';
  const next = min >= 1440;
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}${next ? ' (+1)' : ''}`;
};

export const isDay = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
