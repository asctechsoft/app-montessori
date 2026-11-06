import { createHash, randomBytes } from 'node:crypto';
import type { DocumentData } from 'firebase-admin/firestore';
import { db, FieldValue, Timestamp, messaging } from '../core/firebase';
import { denied, fail, invalid } from '../core/errors';
import { computePermsByCampus, Grant, SYSTEM_ROLES, ALL_PERMISSIONS } from '../core/permissions';
import { dayKeyOf, getOr404 } from '../core/store';
import { isValidDay } from '../core/validate';
import type { Ctx } from '../core/types';

/** Chuỗi gọn, bỏ khoảng trắng thừa. */
export function s(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function asObj(v: unknown): Record<string, any> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

export function asArr<T = any>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Chuẩn hóa số điện thoại VN về dạng E.164 (+84...). Trả '' nếu rỗng. */
export function normPhone(p: unknown): string {
  let x = s(p).replace(/[\s.\-()]/g, '');
  if (!x) return '';
  if (x.startsWith('00')) x = '+' + x.slice(2);
  if (x.startsWith('0')) x = '+84' + x.slice(1);
  else if (x.startsWith('84') && !x.startsWith('+')) x = '+' + x;
  if (!/^\+\d{8,15}$/.test(x)) invalid({ phone: 'Số điện thoại không hợp lệ.' });
  return x;
}

export function normEmail(e: unknown): string {
  const x = s(e).toLowerCase();
  if (!x) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) invalid({ email: 'Email không hợp lệ.' });
  return x;
}

export function randomCode(len = 8): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[b[i] % alphabet.length];
  return out;
}

export function shortHash(v: string, n = 20): string {
  return createHash('sha1').update(v).digest('hex').slice(0, n);
}

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export function requireId(v: unknown, field: string): string {
  const x = s(v);
  if (!ID_PATTERN.test(x)) invalid({ [field]: 'Mã không hợp lệ.' });
  return x;
}

export function requireDay(v: unknown, field: string): string {
  if (!isValidDay(v)) invalid({ [field]: 'Ngày không hợp lệ (YYYY-MM-DD).' });
  return v as string;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Danh sách ngày từ -> đến (tối đa 366 ngày). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let d = from;
  while (d <= to && out.length < 367) { out.push(d); d = addDays(d, 1); }
  return out;
}

export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export function tsOf(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === 'string') { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
  return null;
}

/** Parse ISO datetime hoặc dayKey từ client; ném VALIDATION nếu sai. */
export function parseWhen(v: unknown, field: string, endOfDay = false): Date | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') invalid({ [field]: 'Thời điểm không hợp lệ.' });
  if (isValidDay(v)) return new Date(`${v}T${endOfDay ? '23:59:59' : '00:00:00'}+07:00`);
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) invalid({ [field]: 'Thời điểm không hợp lệ.' });
  return d;
}

// ---------------------------------------------------------------- cơ sở / trẻ

export type CampusDoc = DocumentData & { id: string; timezone?: string; mealCutoff?: string };

export async function campusOf(ctx: Ctx, campusId: string): Promise<CampusDoc> {
  const id = requireId(campusId, 'campusId');
  const snap = await ctx.doc(`campuses/${id}`).get();
  if (!snap.exists) denied('Bạn không có quyền truy cập cơ sở này.'); // không lộ tồn tại
  return { id: snap.id, ...(snap.data() as DocumentData) };
}

export function todayOf(ctx: Ctx, campus?: { timezone?: string }): string {
  return dayKeyOf(ctx.now, campus?.timezone || 'Asia/Ho_Chi_Minh');
}

export type ChildDoc = DocumentData & { id: string; campusId: string; classId?: string | null; status: string };

/** Tải trẻ thuộc org hiện tại. Lỗi NOT_FOUND nếu không có. */
export async function childOf(ctx: Ctx, childId: unknown): Promise<ChildDoc> {
  const id = requireId(childId, 'childId');
  return (await getOr404(ctx.doc(`children/${id}`), 'Hồ sơ trẻ')) as ChildDoc;
}

export async function classOf(ctx: Ctx, classId: unknown): Promise<DocumentData & { id: string; campusId: string }> {
  const id = requireId(classId, 'classId');
  return (await getOr404(ctx.doc(`classes/${id}`), 'Lớp học')) as any;
}

/** Phụ huynh: kiểm tra con thuộc childIds. */
export function requireParentOf(ctx: Ctx, childId: string): void {
  if (ctx.member?.kind !== 'parent' || !(ctx.member.childIds ?? []).includes(childId)) denied('Bạn không có quyền với hồ sơ trẻ này.');
}

/**
 * Phạm vi lớp của người dùng tại cơ sở. null = không hạn chế theo lớp.
 * Giáo viên có grant classIds => các lớp đó; grant không có classIds => theo assignments đang hiệu lực (CONTRACT §3).
 */
export async function classScope(ctx: Ctx, campusId: string): Promise<string[] | null> {
  if (ctx.platformAdmin || !ctx.member || ctx.member.kind === 'owner') return null;
  const now = ctx.now;
  const covering = (ctx.member.grants ?? []).filter((g) => {
    if (g.validFrom && new Date(g.validFrom) > now) return false;
    if (g.validTo && new Date(g.validTo) < now) return false;
    return g.campusIds.includes('*') || g.campusIds.includes(campusId);
  });
  if (covering.length === 0) return null;
  if (covering.some((g) => g.roleId !== 'teacher')) return null; // quản lý/nhân sự khác: không bó theo lớp
  const ids = new Set<string>();
  let needAssignments = false;
  for (const g of covering) {
    if (g.classIds && g.classIds.length) g.classIds.forEach((c) => ids.add(c));
    else needAssignments = true;
  }
  if (needAssignments) {
    const q = await ctx.col('assignments').where('uid', '==', ctx.uid).where('campusId', '==', campusId).get();
    for (const d of q.docs) {
      const a = d.data();
      if (a.status === 'cancelled' || a.archived) continue;
      const from = tsOf(a.validFrom);
      const to = tsOf(a.validTo);
      if (from && from > now) continue;
      if (to && to < now) continue;
      ids.add(a.classId);
    }
  }
  return [...ids];
}

export async function requireClassAccess(ctx: Ctx, campusId: string, classId: string | null | undefined): Promise<void> {
  const scope = await classScope(ctx, campusId);
  if (scope === null) return;
  if (!classId || !scope.includes(classId)) denied('Bạn chỉ được thao tác trên lớp được phân công.');
}

/** Trẻ có phân lớp hiệu lực tại lớp vào ngày dayKey? */
export async function enrolledOn(ctx: Ctx, childId: string, classId: string, dayKey: string): Promise<boolean> {
  const q = await ctx.col('enrollments').where('childId', '==', childId).where('classId', '==', classId).get();
  return q.docs.some((d) => {
    const e = d.data();
    if (e.status === 'cancelled') return false;
    return (!e.startDate || e.startDate <= dayKey) && (!e.endDate || dayKey <= e.endDate);
  });
}

// ---------------------------------------------------------------- member / quyền

/** Tính permsByCampus + permsAny (hợp mọi cơ sở) cho member. */
export async function computeMemberPerms(ctx: Ctx, kind: string, grants: Grant[]): Promise<{ permsByCampus: Record<string, string[]>; permsAny: string[] }> {
  const rolesSnap = await ctx.col('roles').get();
  const custom: Record<string, string[]> = {};
  rolesSnap.forEach((r) => { custom[r.id] = (r.data().perms as string[]) ?? []; });
  const campusIds = (await ctx.col('campuses').select().get()).docs.map((d) => d.id);
  const g = kind === 'owner' ? [{ id: 'owner', roleId: 'owner', campusIds: ['*'] } as Grant] : grants;
  const permsByCampus = computePermsByCampus(g, custom, ctx.now, campusIds);
  const permsAny = [...new Set(Object.values(permsByCampus).flat())].sort();
  return { permsByCampus, permsAny };
}

/** Quyền của caller phải là siêu tập của quyền được cấp (chống leo thang đặc quyền). */
export async function assertCanGrant(ctx: Ctx, grants: Grant[]): Promise<void> {
  const rolesSnap = await ctx.col('roles').get();
  const custom: Record<string, string[]> = {};
  rolesSnap.forEach((r) => { custom[r.id] = (r.data().perms as string[]) ?? []; });
  const campusIds = (await ctx.col('campuses').select().get()).docs.map((d) => d.id);
  for (const g of grants) {
    if (g.roleId === 'owner') invalid({ grants: 'Không thể cấp vai trò chủ chuỗi qua lời mời.' });
    if (!(g.roleId in SYSTEM_ROLES) && !(g.roleId in custom)) invalid({ grants: `Vai trò không tồn tại: ${g.roleId}` });
    const base = SYSTEM_ROLES[g.roleId] ?? custom[g.roleId] ?? [];
    const perms = [...new Set([...base, ...(g.extraPerms ?? [])])].filter((p) => !(g.deniedPerms ?? []).includes(p));
    const targets = g.campusIds.includes('*') ? ['*'] : g.campusIds;
    for (const c of targets) {
      if (c !== '*' && !campusIds.includes(c)) invalid({ grants: `Cơ sở không thuộc tổ chức: ${c}` });
      if (!ctx.can('members.manage', c === '*' ? null : c)) denied('Bạn không có quyền cấp vai trò tại cơ sở này.');
      for (const p of perms) {
        const ok = c === '*' ? ctx.can(p, null) : ctx.can(p, c);
        if (!ok) denied(`Bạn không thể cấp quyền "${p}" vì chính bạn chưa có quyền này tại phạm vi đó.`);
      }
    }
  }
}

/** Kiểm tra và chuẩn hóa danh sách grants từ client. */
export function sanitizeGrants(raw: unknown): Grant[] {
  const arr = asArr(raw);
  const out: Grant[] = [];
  arr.forEach((g0, i) => {
    const g = asObj(g0);
    const roleId = s(g.roleId);
    if (!roleId) invalid({ [`grants[${i}].roleId`]: 'Chọn vai trò.' });
    const campusIds = asArr<string>(g.campusIds).map(s).filter(Boolean);
    if (campusIds.length === 0) invalid({ [`grants[${i}].campusIds`]: 'Chọn ít nhất một cơ sở.' });
    for (const c of campusIds) if (c !== '*' && !ID_PATTERN.test(c)) invalid({ [`grants[${i}].campusIds`]: 'Mã cơ sở không hợp lệ.' });
    const grant: Grant = { id: s(g.id) || `g_${randomBytes(4).toString('hex')}`, roleId, campusIds: [...new Set(campusIds)] };
    const classIds = asArr<string>(g.classIds).map(s).filter(Boolean);
    if (classIds.length) grant.classIds = classIds;
    if (g.validFrom) { const d = tsOf(g.validFrom); if (!d) invalid({ [`grants[${i}].validFrom`]: 'Thời điểm không hợp lệ.' }); grant.validFrom = d!.toISOString(); }
    if (g.validTo) { const d = tsOf(g.validTo); if (!d) invalid({ [`grants[${i}].validTo`]: 'Thời điểm không hợp lệ.' }); grant.validTo = d!.toISOString(); }
    if (grant.validFrom && grant.validTo && grant.validFrom > grant.validTo) invalid({ [`grants[${i}].validTo`]: 'Ngày kết thúc phải sau ngày bắt đầu.' });
    for (const k of ['extraPerms', 'deniedPerms'] as const) {
      const list = asArr<string>(g[k]).map(s).filter(Boolean);
      for (const p of list) if (!(ALL_PERMISSIONS as readonly string[]).includes(p)) invalid({ [`grants[${i}].${k}`]: `Quyền không tồn tại: ${p}` });
      if (list.length) grant[k] = list;
    }
    out.push(grant);
  });
  return out;
}

// ---------------------------------------------------------------- push FCM (best-effort)

/** Gửi push chung chung tới các uid. KHÔNG đưa nội dung sức khỏe/công nợ vào payload. */
export async function pushToUsers(orgId: string, uids: string[], data: Record<string, string> = {}): Promise<number> {
  try {
    const tokens: string[] = [];
    for (const group of chunk([...new Set(uids)], 20)) {
      const snaps = await Promise.all(group.map((u) => db.collection(`users/${u}/devices`).get()));
      for (const sn of snaps) sn.forEach((d) => { const t = d.data().fcmToken; if (t) tokens.push(t as string); });
    }
    if (!tokens.length) return 0;
    let sent = 0;
    for (const part of chunk([...new Set(tokens)], 500)) {
      const res = await messaging().sendEachForMulticast({
        tokens: part,
        notification: { title: 'Mầm non', body: 'Có cập nhật mới từ nhà trường' },
        data: { orgId, ...data },
      });
      sent += res.successCount;
    }
    return sent;
  } catch (e) {
    console.warn('push failed (best-effort)', String((e as Error)?.message ?? e));
    return 0;
  }
}

/** uid các phụ huynh được liên kết với trẻ (tùy chọn chỉ người có quyền notify). */
export async function parentUidsOfChild(ctx: Ctx, childId: string, perm?: 'notify' | 'viewFees' | 'pickup'): Promise<string[]> {
  const q = await ctx.col('guardianLinks').where('childId', '==', childId).get();
  return q.docs
    .map((d) => d.data())
    .filter((g) => g.status === 'linked' && g.uid && (!perm || g.perms?.[perm] !== false))
    .map((g) => g.uid as string);
}

export { FieldValue, Timestamp, fail, invalid, denied };
