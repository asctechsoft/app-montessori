import { invalid } from './errors';

// Bộ kiểm tra dữ liệu tối giản, không phụ thuộc thư viện.
export type Rule =
  | { t: 'string'; req?: boolean; min?: number; max?: number; pattern?: RegExp; oneOf?: readonly string[] }
  | { t: 'int'; req?: boolean; min?: number; max?: number }       // tiền VND và số đếm: số nguyên
  | { t: 'number'; req?: boolean; min?: number; max?: number }
  | { t: 'bool'; req?: boolean }
  | { t: 'day'; req?: boolean }                                    // YYYY-MM-DD hợp lệ
  | { t: 'time'; req?: boolean }                                   // HH:mm
  | { t: 'array'; req?: boolean; max?: number; of?: Rule }
  | { t: 'object'; req?: boolean }
  | { t: 'any'; req?: boolean };

export type Schema = Record<string, Rule>;

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidDay(s: unknown): s is string {
  if (typeof s !== 'string' || !DAY_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function check(rule: Rule, v: unknown): string | null {
  if (v === undefined || v === null || v === '') return rule.req ? 'Bắt buộc nhập.' : null;
  switch (rule.t) {
    case 'string':
      if (typeof v !== 'string') return 'Phải là chuỗi.';
      if (rule.min && v.trim().length < rule.min) return `Tối thiểu ${rule.min} ký tự.`;
      if (rule.max && v.length > rule.max) return `Tối đa ${rule.max} ký tự.`;
      if (rule.pattern && !rule.pattern.test(v)) return 'Định dạng không đúng.';
      if (rule.oneOf && !rule.oneOf.includes(v)) return 'Giá trị không hợp lệ.';
      return null;
    case 'int':
      if (typeof v !== 'number' || !Number.isSafeInteger(v)) return 'Phải là số nguyên.';
      if (rule.min !== undefined && v < rule.min) return `Không nhỏ hơn ${rule.min}.`;
      if (rule.max !== undefined && v > rule.max) return `Không lớn hơn ${rule.max}.`;
      return null;
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'Phải là số.';
      if (rule.min !== undefined && v < rule.min) return `Không nhỏ hơn ${rule.min}.`;
      if (rule.max !== undefined && v > rule.max) return `Không lớn hơn ${rule.max}.`;
      return null;
    case 'bool':
      return typeof v === 'boolean' ? null : 'Phải là đúng/sai.';
    case 'day':
      return isValidDay(v) ? null : 'Ngày không hợp lệ (YYYY-MM-DD).';
    case 'time':
      return typeof v === 'string' && TIME_RE.test(v) ? null : 'Giờ không hợp lệ (HH:mm).';
    case 'array':
      if (!Array.isArray(v)) return 'Phải là danh sách.';
      if (rule.max && v.length > rule.max) return `Tối đa ${rule.max} phần tử.`;
      if (rule.of) for (const x of v) { const e = check(rule.of, x); if (e) return e; }
      return null;
    case 'object':
      return typeof v === 'object' && !Array.isArray(v) ? null : 'Phải là đối tượng.';
    default:
      return null;
  }
}

/** Kiểm tra dữ liệu theo schema; ném VALIDATION kèm fieldErrors. Chỉ giữ các field có trong schema. */
export function validate<T = Record<string, any>>(data: unknown, schema: Schema, opts: { partial?: boolean } = {}): T {
  const src = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const out: Record<string, unknown> = {};
  for (const [k, rule] of Object.entries(schema)) {
    if (opts.partial && !(k in src)) continue;
    const e = check(rule, src[k]);
    if (e) errors[k] = e;
    else if (src[k] !== undefined) out[k] = src[k];
  }
  if (Object.keys(errors).length) invalid(errors);
  return out as T;
}

export function requireRange(from: string, to: string, fromKey = 'fromDay', toKey = 'toDay'): void {
  if (from > to) invalid({ [toKey]: 'Ngày kết thúc phải từ ngày bắt đầu trở đi.' });
  void fromKey;
}

export const vnd = (v: unknown, field = 'amount'): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) invalid({ [field]: 'Số tiền phải là số nguyên đồng không âm.' });
  return v as number;
};
