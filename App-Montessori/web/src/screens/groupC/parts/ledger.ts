// Mô hình công nợ phía web: khớp công thức máy chủ (CONTRACT §4): balance = openingDebt + billed + adjustUp − discount − allocated.
import type { DocumentData } from 'firebase/firestore';
import { arr, num, str, tsMs } from './common';

export interface BillLine {
  code: string;
  type: string;
  description: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface Rcv {
  id: string;
  childId: string;
  childName: string;
  classId: string;
  periodKey: string;
  type: string;
  status: string;
  billed: number;
  discount: number;
  adjustUp: number;
  openingDebt: number;
  allocated: number;
  balance: number;
  dueDate: string;
  lines: BillLine[];
  billingRunId: string;
  pendingReconciliation: boolean;
  mealMode: string;
  version: number;
}

export const toRcv = (id: string, d: DocumentData): Rcv => ({
  id,
  childId: str(d.childId),
  childName: str(d.childName, str(d.childId)),
  classId: str(d.classId),
  periodKey: str(d.periodKey),
  type: str(d.type, 'monthly'),
  status: str(d.status, 'unpaid'),
  billed: num(d.billed),
  discount: num(d.discount),
  adjustUp: num(d.adjustUp),
  openingDebt: num(d.openingDebt),
  allocated: num(d.allocated),
  balance: num(d.balance),
  dueDate: str(d.dueDate),
  lines: arr(d.lines).map((l) => ({
    code: str(l.code), type: str(l.type), description: str(l.description), qty: num(l.qty) || 1, unitPrice: num(l.unitPrice), amount: num(l.amount),
  })),
  billingRunId: str(d.billingRunId),
  pendingReconciliation: d.pendingReconciliation === true,
  mealMode: str(d.mealMode),
  version: num(d.version),
});

/** Khoản đã phát hành còn nợ (nhận phân bổ). */
export const isOpen = (r: Rcv): boolean => ['unpaid', 'partially_paid', 'overdue'].includes(r.status) && r.balance > 0;
export const isIssued = (r: Rcv): boolean => ['unpaid', 'partially_paid', 'overdue', 'paid'].includes(r.status);
/** Phải thu mới của kỳ = billed + adjustUp − discount (chưa trừ đã thu). */
export const netOf = (r: { billed: number; adjustUp: number; discount: number }): number => r.billed + r.adjustUp - r.discount;

export interface Alloc {
  receivableId: string;
  amount: number;
}

/**
 * Bản sao thuần của allocatePayment ở máy chủ, CHỈ để xem trước tác động. Kết quả thật do máy chủ trả.
 * Thủ công trước, phần còn lại vào nợ cũ trước (kỳ nhỏ → lớn), dư thành số dư có.
 */
export function previewAllocation(
  amount: number,
  open: { id: string; periodKey: string; dueDate: string; balance: number }[],
  manual: Alloc[] = [],
): { ok: true; allocations: Alloc[]; credit: number; allocated: number } | { ok: false; message: string } {
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, message: 'Nhập số tiền lớn hơn 0.' };
  const bal = new Map(open.map((r) => [r.id, r.balance]));
  const out = new Map<string, number>();
  let remaining = amount;
  let manualSum = 0;
  for (const m of manual) {
    if (m.amount <= 0) continue;
    const b = bal.get(m.receivableId);
    if (b === undefined) return { ok: false, message: 'Khoản phải thu không còn nhận phân bổ.' };
    if (m.amount > b) return { ok: false, message: 'Số tiền phân bổ vượt quá số còn nợ của khoản phải thu.' };
    bal.set(m.receivableId, b - m.amount);
    out.set(m.receivableId, (out.get(m.receivableId) ?? 0) + m.amount);
    manualSum += m.amount;
  }
  if (manualSum > amount) return { ok: false, message: 'Tổng phân bổ vượt quá số tiền thực nhận.' };
  remaining -= manualSum;
  const order = [...open].sort((a, b) => a.periodKey.localeCompare(b.periodKey) || a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  for (const r of order) {
    if (remaining <= 0) break;
    const b = bal.get(r.id) ?? 0;
    if (b <= 0) continue;
    const take = Math.min(b, remaining);
    out.set(r.id, (out.get(r.id) ?? 0) + take);
    remaining -= take;
  }
  return { ok: true, allocations: [...out.entries()].map(([receivableId, a]) => ({ receivableId, amount: a })), credit: remaining, allocated: amount - remaining };
}

export interface Pay {
  id: string;
  type: string;
  status: string;
  childId: string;
  childName: string;
  amount: number;
  channel: string;
  reference: string;
  source: string;
  note: string;
  at: number;
  allocations: Alloc[];
  allocatedAmount: number;
  creditAmount: number;
  cancelRequest: string;
  bankTxnId: string;
  imagePath: string;
  version: number;
}

export const toPay = (id: string, d: DocumentData): Pay => ({
  id,
  type: str(d.type, 'receipt'),
  status: str(d.status),
  childId: str(d.childId),
  childName: str(d.childName, str(d.childId)),
  amount: num(d.amount),
  channel: str(d.channel),
  reference: str(d.reference),
  source: str(d.source),
  note: str(d.note),
  at: tsMs(d.receivedAt) || tsMs(d.submittedAt) || tsMs(d.createdAt),
  allocations: arr(d.allocations).map((a) => ({ receivableId: str(a.receivableId), amount: num(a.amount) })),
  allocatedAmount: num(d.allocatedAmount),
  creditAmount: num(d.creditAmount),
  cancelRequest: str((d.cancelRequest as DocumentData | undefined)?.status),
  bankTxnId: str(d.bankTxnId),
  imagePath: str(d.imagePath),
  version: num(d.version),
});

export const PAY_TYPE_LABEL: Record<string, string> = { receipt: 'Phiếu thu', proof: 'Biên nhận chờ đối soát', reversal: 'Chứng từ đảo', refund: 'Chi hoàn' };

export interface Credit {
  id: string;
  childId: string;
  amount: number;
  remaining: number;
  status: string;
}
export const toCredit = (id: string, d: DocumentData): Credit => ({ id, childId: str(d.childId), amount: num(d.amount), remaining: num(d.remaining), status: str(d.status) });
