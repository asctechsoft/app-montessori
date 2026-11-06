import { getApprovalHandler, ApprovalDoc } from '../core/approvals';
import { denied, fail } from '../core/errors';
import { Timestamp } from '../core/firebase';
import { getOr404 } from '../core/store';
import type { Ctx } from '../core/types';
import { s } from './util';

const LOCK_MS = 120_000;

type CancelHook = (ctx: Ctx, approval: ApprovalDoc, reason?: string) => Promise<unknown>;
const cancelHooks = new Map<string, CancelHook>();
/** Module nghiệp vụ đăng ký việc cần làm khi yêu cầu bị hủy (vd transfer → hủy bản ghi chuyển). */
export function registerCancelHook(type: string, fn: CancelHook): void {
  cancelHooks.set(type, fn);
}

/**
 * Xử lý quyết định phê duyệt (dùng chung cho approval.decide và các action tắt như transfer.decide).
 * - Kiểm tra quyền tại campus của yêu cầu; chặn tự duyệt (trừ owner khi handler cho phép).
 * - Khóa mềm để handler chỉ chạy một lần; gửi lại cùng quyết định trả kết quả cũ (idempotent).
 */
export async function decideApprovalCore(ctx: Ctx, id: string, decision: string, note?: string) {
  if (decision !== 'approved' && decision !== 'rejected') fail('VALIDATION', 'Quyết định phải là approved hoặc rejected.', { fieldErrors: { decision: 'Giá trị không hợp lệ.' } });
  const ref = ctx.doc(`approvals/${id}`);
  const ap = (await getOr404(ref, 'Yêu cầu phê duyệt')) as ApprovalDoc;
  const h = getApprovalHandler(ap.type);

  // quyền: tại campus của yêu cầu (campusId null → toàn org)
  if (!ctx.can(h.perm, ap.campusId ?? null)) {
    await ctx.audit({ action: 'approval.decide', collection: 'approvals', docId: id, result: 'denied', campusId: ap.campusId, reason: h.perm });
    denied('Bạn không có quyền duyệt yêu cầu này.');
  }
  if (ap.requestedBy === ctx.uid) {
    const ownerOk = h.allowSelfApprove === true && (ctx.member?.kind === 'owner' || ctx.platformAdmin);
    if (!ownerOk) denied('Không được tự duyệt yêu cầu do chính mình lập.');
  }
  if (decision === 'rejected' && !s(note)) fail('VALIDATION', 'Vui lòng nhập lý do từ chối.', { fieldErrors: { note: 'Bắt buộc nhập.' } });

  if (ap.status !== 'pending') {
    if (ap.status === decision) return { ...ap, alreadyDecided: true };
    fail('INVALID_STATE', 'Yêu cầu đã được xử lý trước đó.', { status: ap.status });
  }

  // lấy khóa
  await ctx.tx(async (t) => {
    const sn = await t.get(ref);
    const d = sn.data() as ApprovalDoc & { lock?: { by: string; at: Timestamp } };
    if (d.status !== 'pending') fail('INVALID_STATE', 'Yêu cầu đã được xử lý trước đó.', { status: d.status });
    if (d.lock && ctx.now.getTime() - d.lock.at.toMillis() < LOCK_MS && d.lock.by !== ctx.requestId) {
      fail('CONFLICT', 'Yêu cầu đang được xử lý bởi người khác.');
    }
    t.update(ref, { lock: { by: ctx.requestId, at: Timestamp.fromDate(ctx.now) } });
  });

  let result: unknown;
  try {
    result = decision === 'approved' ? await h.onApprove(ctx, ap, note) : await (h.onReject ? h.onReject(ctx, ap, note) : Promise.resolve(null));
  } catch (e) {
    await ref.update({ lock: null }).catch(() => undefined);
    throw e;
  }
  const patch = {
    status: decision,
    decidedBy: ctx.uid,
    decidedByName: ctx.member?.displayName ?? ctx.uid,
    decidedAt: Timestamp.fromDate(ctx.now),
    decisionNote: s(note) || null,
    lock: null,
    updatedAt: Timestamp.fromDate(ctx.now),
    updatedBy: ctx.uid,
    version: (ap as any).version + 1,
  };
  await ref.update(patch);
  await ctx.audit({
    action: `approval.${decision}`, collection: 'approvals', docId: id, campusId: ap.campusId,
    before: { status: 'pending', type: ap.type, summary: ap.summary }, after: { status: decision }, reason: s(note) || undefined,
  });
  return { ...ap, ...patch, result: result ?? null };
}

export async function cancelApprovalCore(ctx: Ctx, id: string, reason?: string) {
  const ref = ctx.doc(`approvals/${id}`);
  const ap = (await getOr404(ref, 'Yêu cầu phê duyệt')) as ApprovalDoc;
  const h = getApprovalHandler(ap.type);
  const isOwnerOfReq = ap.requestedBy === ctx.uid;
  if (!isOwnerOfReq && !ctx.can(h.perm, ap.campusId ?? null)) denied('Bạn không có quyền hủy yêu cầu này.');
  if (ap.status === 'cancelled') return { ...ap, alreadyDecided: true };
  if (ap.status !== 'pending') fail('INVALID_STATE', 'Chỉ hủy được yêu cầu đang chờ duyệt.', { status: ap.status });
  const hook = cancelHooks.get(ap.type);
  if (hook) await hook(ctx, ap, reason);
  const patch = {
    status: 'cancelled', cancelledBy: ctx.uid, cancelledAt: Timestamp.fromDate(ctx.now), cancelReason: s(reason) || null,
    updatedAt: Timestamp.fromDate(ctx.now), updatedBy: ctx.uid, version: (ap as any).version + 1,
  };
  await ref.update(patch);
  await ctx.audit({ action: 'approval.cancel', collection: 'approvals', docId: id, campusId: ap.campusId, before: { status: 'pending' }, after: { status: 'cancelled' }, reason: s(reason) || undefined });
  return { ...ap, ...patch };
}
