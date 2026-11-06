// Sổ quỹ: mọi tiền thu/chi thực tế ghi một dòng cashLedger (chỉ thêm, không sửa; đảo bằng dòng mới).
import { Timestamp } from '../core/firebase';
import { dayKeyOf } from '../core/store';
import type { Ctx } from '../core/types';

export type LedgerRef = 'payment' | 'payment_reversal' | 'refund' | 'expense' | 'payroll';

export interface LedgerInput {
  campusId: string; dir: 'in' | 'out'; amount: number; channel: string; refType: LedgerRef; refId: string;
  childId?: string | null; at?: Date; tz?: string; note?: string;
}

/** Dữ liệu dòng sổ quỹ (amount luôn dương; dir quyết định chiều). Dùng làm tham số cho batch/tx.set. */
export function ledgerData(ctx: Ctx, i: LedgerInput): Record<string, unknown> {
  const at = i.at ?? ctx.now;
  return {
    campusId: i.campusId, dir: i.dir, amount: i.amount, channel: i.channel, refType: i.refType, refId: i.refId,
    childId: i.childId ?? null, at: Timestamp.fromDate(at), dayKey: dayKeyOf(at, i.tz), note: i.note ?? null,
    ...ctx.metaCreate(),
  };
}
