import type { DocumentReference, DocumentData } from 'firebase-admin/firestore';
import { Timestamp } from './firebase';
import { fail } from './errors';
import type { Ctx } from './types';

/** Đọc doc, ném NOT_FOUND nếu không có. */
export async function getOr404(ref: DocumentReference, what = 'Bản ghi'): Promise<DocumentData & { id: string }> {
  const s = await ref.get();
  if (!s.exists) fail('NOT_FOUND', `${what} không tồn tại.`);
  return { id: s.id, ...(s.data() as DocumentData) };
}

/** Tạo doc mới (id tự sinh hoặc cho trước). Ném CONFLICT nếu đã tồn tại. */
export async function createDoc(ctx: Ctx, path: string, id: string | undefined, data: DocumentData): Promise<string> {
  const col = ctx.col(path);
  const ref = id ? col.doc(id) : col.doc();
  try {
    await ref.create({ ...data, ...ctx.metaCreate() });
  } catch (e: any) {
    if (e?.code === 6 || /ALREADY_EXISTS/.test(String(e?.message))) fail('CONFLICT', 'Bản ghi đã tồn tại.');
    throw e;
  }
  return ref.id;
}

/** Sửa doc có kiểm tra version (optimistic lock). Trả {before, after}. */
export async function updateDoc(
  ctx: Ctx,
  ref: DocumentReference,
  patch: DocumentData,
  expectedVersion?: number,
): Promise<{ before: DocumentData; after: DocumentData }> {
  return ctx.tx(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) fail('NOT_FOUND', 'Bản ghi không tồn tại.');
    const before = s.data() as DocumentData;
    const prev = (before.version as number | undefined) ?? 0;
    if (expectedVersion !== undefined && expectedVersion !== prev) {
      fail('VERSION_CONFLICT', 'Dữ liệu đã được người khác thay đổi. Vui lòng tải lại để đối chiếu.', { currentVersion: prev });
    }
    const next = { ...patch, ...ctx.metaUpdate(prev) };
    t.update(ref, next);
    return { before, after: { ...before, ...next } };
  });
}

/** Chuyển Timestamp/Date → ISO string, đệ quy (để trả về client). */
export function serialize<T>(v: T): T {
  if (v === null || v === undefined) return v;
  if (v instanceof Timestamp) return v.toDate().toISOString() as unknown as T;
  if (v instanceof Date) return v.toISOString() as unknown as T;
  if (Array.isArray(v)) return v.map((x) => serialize(x)) as unknown as T;
  if (typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = serialize(x);
    return o as T;
  }
  return v;
}

/** Ngày dayKey theo múi giờ (mặc định VN) của một thời điểm. */
export function dayKeyOf(d: Date, tz = 'Asia/Ho_Chi_Minh'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return parts; // en-CA => YYYY-MM-DD
}

/** Giờ HH:mm theo múi giờ. */
export function hhmmOf(d: Date, tz = 'Asia/Ho_Chi_Minh'): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

export async function getCampus(ctx: Ctx, campusId: string) {
  const s = await ctx.doc(`campuses/${campusId}`).get();
  if (!s.exists) fail('NOT_FOUND', 'Cơ sở không tồn tại trong tổ chức này.');
  return { id: s.id, ...(s.data() as DocumentData) } as DocumentData & { id: string; timezone?: string };
}

/** Giá trị hiệu lực theo ngày: [from, to] dạng dayKey, to có thể rỗng. */
export function effectiveOn(day: string, from?: string, to?: string): boolean {
  return (!from || from <= day) && (!to || day <= to);
}
