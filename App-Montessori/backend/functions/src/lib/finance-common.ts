// Helper tài chính dùng chung (finance.ts, finance-pay.ts, triggers, reports).
import type { DocumentData } from 'firebase-admin/firestore';
import { Timestamp } from '../core/firebase';
import type { Ctx } from '../core/types';
import { receivableBalance, deriveReceivableStatus, isOverdue } from './calc-fee';

export const OPEN_STATUSES = ['unpaid', 'partially_paid', 'overdue'] as const;
export const ISSUED_STATUSES = ['unpaid', 'partially_paid', 'overdue', 'paid'] as const;

export const childName = (c: DocumentData): string => (c.fullName ?? c.name ?? c.displayName ?? c.id ?? '') as string;

/**
 * Trạng thái + số dư mới của một khoản phải thu sau khi đổi các thành phần.
 * balance = openingDebt + billed + adjustUp − discount − allocated. (Không bao giờ sửa balance trực tiếp.)
 */
export function rcvState(r: DocumentData, change: { allocated?: number; adjustUp?: number; discount?: number }, today: string) {
  const merged = {
    openingDebt: r.openingDebt ?? 0, billed: r.billed ?? 0, adjustUp: change.adjustUp ?? r.adjustUp ?? 0,
    discount: change.discount ?? r.discount ?? 0, allocated: change.allocated ?? r.allocated ?? 0,
  };
  const balance = receivableBalance(merged);
  const status = deriveReceivableStatus({ balance, allocated: merged.allocated, dueDate: r.dueDate, status: undefined }, today);
  return { ...merged, balance, status, isOverdue: isOverdue({ balance, dueDate: r.dueDate }, today) };
}

export function patchOf(ctx: Ctx, prevVersion: number | undefined, p: Record<string, unknown>) {
  return { ...p, updatedAt: Timestamp.now(), updatedBy: ctx.uid, version: (prevVersion ?? 0) + 1 };
}
