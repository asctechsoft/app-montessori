// Helper dùng chung cho các module BE-2 (hr, payroll, finance, ops, reports, admin). Có phụ thuộc Firestore.
import type { DocumentData, Query, QuerySnapshot, WriteBatch } from 'firebase-admin/firestore';
import { db, Timestamp } from '../core/firebase';
import { fail, invalid } from '../core/errors';
import { getCampus } from '../core/store';
import type { Ctx } from '../core/types';
import { isValidDay } from '../core/validate';
import { PERIOD_RE } from './time';

export type Doc = DocumentData & { id: string };

export const asDocs = (s: QuerySnapshot): Doc[] => s.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) }));

export function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === 'string') { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
  if (typeof v === 'object' && v && 'seconds' in (v as any)) return new Timestamp((v as any).seconds, (v as any).nanoseconds ?? 0).toDate();
  return null;
}

export const ts = (d: Date): Timestamp => Timestamp.fromDate(d);

export const chunk = <T>(a: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

/** Ghi nhiều thao tác theo lô ≤ 400. */
export async function commitOps(ops: Array<(b: WriteBatch) => void>): Promise<void> {
  for (const part of chunk(ops, 400)) {
    const b = db.batch();
    for (const op of part) op(b);
    await b.commit();
  }
}

/** campusId của request (payload.campusId hoặc ctx.campusId), phải thuộc org; kiểm tra quyền tại cơ sở đó. */
export async function resolveCampus(ctx: Ctx, payload: any, perm?: string): Promise<{ id: string; campus: DocumentData & { id: string; timezone?: string } }> {
  const id = (payload && typeof payload.campusId === 'string' && payload.campusId) || ctx.campusId;
  if (!id) invalid({ campusId: 'Bắt buộc chọn cơ sở.' });
  const campus = await getCampus(ctx, id);
  if (perm) ctx.require(perm, id);
  return { id, campus };
}

export const tzOf = (campus: DocumentData): string => (campus.timezone as string | undefined) || 'Asia/Ho_Chi_Minh';

/** Đọc doc thuộc ĐÚNG cơ sở (không tin client). Trả doc; NOT_FOUND nếu không có hoặc khác cơ sở. */
export async function getInCampus(ctx: Ctx, path: string, id: unknown, campusId?: string | null, what = 'Bản ghi'): Promise<Doc> {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) invalid({ id: `${what}: mã không hợp lệ.` });
  const s = await ctx.doc(`${path}/${id}`).get();
  if (!s.exists) fail('NOT_FOUND', `${what} không tồn tại.`);
  const d = { id: s.id, ...(s.data() as DocumentData) } as Doc;
  if (campusId && d.campusId && d.campusId !== campusId) fail('NOT_FOUND', `${what} không tồn tại.`);
  return d;
}

export function needDay(v: unknown, field: string): string {
  if (!isValidDay(v)) invalid({ [field]: 'Ngày không hợp lệ (YYYY-MM-DD).' });
  return v as string;
}

export function needPeriod(v: unknown, field = 'periodKey'): string {
  if (typeof v !== 'string' || !PERIOD_RE.test(v)) invalid({ [field]: 'Kỳ không hợp lệ (YYYY-MM).' });
  return v as string;
}

export function needStr(v: unknown, field: string, max = 500): string {
  if (typeof v !== 'string' || !v.trim()) invalid({ [field]: 'Bắt buộc nhập.' });
  if ((v as string).length > max) invalid({ [field]: `Tối đa ${max} ký tự.` });
  return (v as string).trim();
}

export function needVnd(v: unknown, field = 'amount', opts: { allowZero?: boolean } = {}): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || (!opts.allowZero && v === 0)) {
    invalid({ [field]: 'Số tiền phải là số nguyên đồng' + (opts.allowZero ? ' không âm.' : ' lớn hơn 0.') });
  }
  return v as number;
}

export function needDecision(v: unknown): 'approved' | 'rejected' {
  if (v !== 'approved' && v !== 'rejected') invalid({ decision: 'Quyết định phải là approved hoặc rejected.' });
  return v as 'approved' | 'rejected';
}

/** Tách người lập / người duyệt: không tự duyệt yêu cầu của mình (chủ sở hữu được phép). */
export function separateDuties(ctx: Ctx, requestedBy: string | undefined, what = 'yêu cầu'): void {
  if (requestedBy && requestedBy === ctx.uid && ctx.member?.kind !== 'owner' && !ctx.platformAdmin) {
    fail('PRECONDITION', `Không thể tự duyệt ${what} do chính mình lập. Cần người có thẩm quyền khác duyệt.`, { reason: 'SELF_APPROVAL' });
  }
}

export function employeeIdOf(ctx: Ctx): string {
  const e = ctx.member?.employeeId;
  if (!e) fail('PRECONDITION', 'Tài khoản chưa được liên kết với hồ sơ nhân viên.', { reason: 'NO_EMPLOYEE' });
  return e;
}

/** Cập nhật phiếu phê duyệt tập trung (nếu có) khi quyết định được thực hiện trực tiếp qua action nghiệp vụ. */
export async function syncApproval(ctx: Ctx, refCollection: string, refId: string, status: 'approved' | 'rejected' | 'cancelled', note?: string): Promise<void> {
  const s = await ctx.col('approvals').where('refId', '==', refId).where('status', '==', 'pending').get();
  for (const d of s.docs) {
    if (d.data().refCollection !== refCollection) continue;
    await d.ref.update({
      status, decidedBy: ctx.uid, decidedAt: Timestamp.now(), decisionNote: note ?? null,
      updatedAt: Timestamp.now(), updatedBy: ctx.uid, version: ((d.data().version as number) ?? 0) + 1,
    });
  }
}

/** Một số truy vấn có giới hạn an toàn (tránh đọc không giới hạn). */
export async function limited(q: Query, n = 5000): Promise<Doc[]> {
  return asDocs(await q.limit(n).get());
}

export const sumBy = <T>(a: T[], f: (x: T) => number): number => a.reduce((s, x) => s + f(x), 0);

/** dayKey hôm nay theo múi giờ cơ sở. */
export { dayKeyOf, hhmmOf } from '../core/store';
