import type { DocumentData } from 'firebase-admin/firestore';
import { fail } from './errors';
import { createDoc } from './store';
import type { Ctx } from './types';

/**
 * Trung tâm phê duyệt (W47). Mỗi `type` có handler RIÊNG (không dùng một modal/handler chung).
 * Module nghiệp vụ gọi `registerApprovalHandler` lúc import; `approval.decide` (modules/approvals.ts) tra theo type.
 */
export interface ApprovalDoc extends DocumentData {
  id: string;
  type: string;
  refCollection?: string;
  refId?: string;
  campusId: string | null;
  requestedBy: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  summary: string;
  impact?: Record<string, unknown>;
  requiredPerm: string;
  payload?: Record<string, unknown>;
}

export interface ApprovalHandler {
  /** Quyền người duyệt phải có (tại campusId của yêu cầu). */
  perm: string;
  /** Cho phép người yêu cầu tự duyệt? Mặc định false (tách người lập/người duyệt); owner có thể tự duyệt nếu true. */
  allowSelfApprove?: boolean;
  onApprove(ctx: Ctx, approval: ApprovalDoc, note?: string): Promise<unknown>;
  onReject?(ctx: Ctx, approval: ApprovalDoc, note?: string): Promise<unknown>;
}

const handlers = new Map<string, ApprovalHandler>();

export function registerApprovalHandler(type: string, h: ApprovalHandler): void {
  handlers.set(type, h);
}

export function getApprovalHandler(type: string): ApprovalHandler {
  const h = handlers.get(type);
  if (!h) fail('NOT_FOUND', `Loại phê duyệt chưa được hỗ trợ: ${type}`);
  return h;
}

export interface NewApproval {
  type: string;
  campusId: string | null;
  summary: string;
  impact?: Record<string, unknown>;
  refCollection?: string;
  refId?: string;
  payload?: Record<string, unknown>;
}

/** Tạo yêu cầu phê duyệt (status=pending). Trả approvalId. requiredPerm lấy từ handler đã đăng ký. */
export async function createApproval(ctx: Ctx, a: NewApproval): Promise<string> {
  const h = getApprovalHandler(a.type);
  return createDoc(ctx, 'approvals', undefined, {
    type: a.type,
    campusId: a.campusId,
    summary: a.summary,
    impact: a.impact ?? {},
    refCollection: a.refCollection ?? null,
    refId: a.refId ?? null,
    payload: a.payload ?? {},
    requestedBy: ctx.uid,
    requestedByName: ctx.member?.displayName ?? ctx.uid,
    status: 'pending',
    requiredPerm: h.perm,
  });
}
