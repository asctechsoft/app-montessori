'use client';
// Tiện ích dùng chung cho các màn nhóm C (học phí/thu tiền, thông báo, phê duyệt, báo cáo, hệ thống).
import { useMemo, useState, type ReactNode } from 'react';
import { collection, query, where, type DocumentData, type QueryConstraint } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import { hasPerm } from '@/lib/permissions';
import { useScope } from '@/providers/ScopeProvider';
import { useFirestoreQuery, type QueryState } from '@/lib/hooks/useFirestore';
import { useAsyncAction } from '@/lib/hooks/useAsyncAction';
import { dayKey, toDate, type DateLike } from '@/lib/format';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import type { Tone } from '@/lib/status';

export type Rec = Record<string, unknown>;
export const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : v === null || v === undefined ? d : String(v));
export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
export const arr = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]) : []);
export const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
export const obj = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
export const tsMs = (v: unknown): number => toDate(v as DateLike)?.getTime() ?? 0;

/**
 * Đọc realtime một collection của tổ chức, luôn kèm điều kiện campusId (rules chỉ cho phép truy vấn có ràng buộc cơ sở).
 * Đang chọn một cơ sở → `==`; đang ở "Tất cả cơ sở" → `in` các cơ sở người dùng có quyền.
 */
export function useScopedQuery<T>(
  coll: string,
  perm: string | string[],
  map: (id: string, d: DocumentData) => T,
  opts: { includeOrgWide?: boolean; extra?: QueryConstraint[]; tag?: string } = {},
): QueryState<T> {
  const { org, campusId, campuses, perms, canOrg } = useScope();
  const permKey = Array.isArray(perm) ? perm.join(',') : perm;
  const permList = useMemo(() => permKey.split(','), [permKey]);
  const all = !campusId || campusId === 'all';
  const ids = useMemo(() => {
    if (!all) return permList.some((p) => hasPerm(perms, p, campusId)) ? [campusId as string] : [];
    return campuses.filter((c) => permList.some((p) => hasPerm(perms, p, c.id))).map((c) => c.id).slice(0, 29);
  }, [all, campusId, campuses, perms, permList]);
  const withNull = !!opts.includeOrgWide && all && permList.some((p) => canOrg(p));
  const key = org && ids.length > 0 ? `${coll}|${org.orgId}|${ids.join(',')}|${withNull}|${opts.tag ?? ''}` : null;
  const q = useFirestoreQuery<T>(
    key,
    () => {
      const base = collection(firebase().db, 'orgs', org!.orgId, coll);
      const cond = ids.length === 1 && !withNull ? where('campusId', '==', ids[0]) : where('campusId', 'in', withNull ? [...ids, null] : ids);
      return query(base, cond, ...(opts.extra ?? []));
    },
    map,
  );
  if (org && ids.length === 0) return { ...q, status: 'empty', data: [], error: null };
  return q;
}

/** Cơ sở đang thao tác (màn campus-scope: ScreenGuard đã chặn "Tất cả cơ sở"). */
export function useCampus(): { orgId: string; campusId: string; tz: string } | null {
  const { org, campusId, tz } = useScope();
  if (!org || !campusId || campusId === 'all') return null;
  return { orgId: org.orgId, campusId, tz };
}

export const currentPeriod = (tz: string): string => dayKey(new Date(), tz).slice(0, 7);
export const periodLabel = (k: string): string => (/^\d{4}-\d{2}$/.test(k) ? `Tháng ${k.slice(5)}/${k.slice(0, 4)}` : k);
export function periodOptions(tz: string, back = 11, ahead = 2): { value: string; label: string }[] {
  const cur = currentPeriod(tz);
  const [y, m] = cur.split('-').map(Number);
  const out: { value: string; label: string }[] = [];
  for (let i = ahead; i >= -back; i--) {
    const d = new Date(y, m - 1 + i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ value: k, label: periodLabel(k) });
  }
  return out;
}

/* ---------------------------------------------------------------- badge trạng thái */
const RUN: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Bản nháp', tone: 'neutral' },
  submitted: { label: 'Chờ duyệt', tone: 'warning' },
  approved: { label: 'Đã duyệt (chưa phát hành)', tone: 'info' },
  rejected: { label: 'Bị từ chối', tone: 'error' },
  published: { label: 'Đã phát hành', tone: 'success' },
};
export function RunBadge({ value }: { value: string }) {
  const s = RUN[value] ?? { label: value, tone: 'neutral' as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
export function RcvBadge({ value }: { value: string }) {
  return value === 'draft' ? <Badge tone="neutral">Bản nháp</Badge> : <StatusBadge domain="payment" value={value} />;
}
const PAY: Record<string, { label: string; tone: Tone }> = {
  confirmed: { label: 'Đã ghi nhận', tone: 'success' },
  reversed: { label: 'Đã đảo', tone: 'neutral' },
  rejected: { label: 'Từ chối', tone: 'error' },
};
export function PayBadge({ value }: { value: string }) {
  if (value === 'pending_reconciliation') return <StatusBadge domain="payment" value="pending_reconciliation" />;
  const s = PAY[value] ?? { label: value, tone: 'neutral' as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const CHANNEL_LABELS: Record<string, string> = { cash: 'Tiền mặt', bank_transfer: 'Chuyển khoản', gateway: 'Cổng thanh toán' };

/* ---------------------------------------------------------------- hộp thoại xem tác động */
interface ActionDialogProps {
  title: string;
  subject?: string;
  /** Các tác động cụ thể (không trùng nhau). */
  impact: string[];
  confirmLabel: string;
  tone?: 'primary' | 'destructive';
  /** Gọi máy chủ; opId ổn định cho đến khi thành công. */
  run: (opId: string) => Promise<unknown>;
  success: string;
  onClose: () => void;
  onDone?: (result: unknown) => void;
  /** Trả thông điệp lỗi (chặn gửi) hoặc null. */
  validate?: () => string | null;
  children?: ReactNode;
}

/** Hộp thoại xác nhận chung: chỉ mount khi mở. Chỉ báo thành công sau khi máy chủ trả về. */
export function ActionDialog({ title, subject, impact, confirmLabel, tone, run, success, onClose, onDone, validate, children }: ActionDialogProps) {
  const toast = useToast();
  const [localError, setLocalError] = useState<string | null>(null);
  const act = useAsyncAction(async (opId: string) => ({ res: await run(opId) }));
  return (
    <ConfirmDialog
      open
      title={title}
      subject={subject}
      impact={impact}
      confirmLabel={confirmLabel}
      tone={tone}
      busy={act.busy}
      error={localError ?? act.error?.message ?? null}
      onCancel={onClose}
      onConfirm={async () => {
        const m = validate?.() ?? null;
        setLocalError(m);
        if (m) return;
        const r = await act.run();
        if (r) {
          toast.success(success);
          onDone?.(r.res);
          onClose();
        }
      }}
    >
      {children}
    </ConfirmDialog>
  );
}

/** Danh sách nhãn: giá trị. */
export function KV({ items, columns = 2 }: { items: [string, ReactNode][]; columns?: 1 | 2 | 3 }) {
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 'var(--space-3) var(--space-6)', margin: 0 }}>
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-caption">{k}</dt>
          <dd style={{ margin: 0 }}>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export const moneyStyle = { fontVariantNumeric: 'tabular-nums' } as const;

/** Danh sách trẻ để chọn: từ hồ sơ trẻ (nếu có quyền đọc) hợp với tên trên khoản phải thu. */
export function useChildOptions(): { options: { value: string; label: string }[]; names: Map<string, string>; status: 'loading' | 'ready' } {
  const kids = useScopedQuery('children', 'children.read', (id, d) => ({ id, name: str(d.fullName, id), code: str(d.code), status: str(d.status) }));
  const rc = useScopedQuery('receivables', 'payments.read', (id, d) => ({ id, childId: str(d.childId), name: str(d.childName, str(d.childId)) }));
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of kids.data) if (['active', 'trial'].includes(c.status)) m.set(c.id, c.code ? `${c.name} (${c.code})` : c.name);
    for (const r of rc.data) if (r.childId && !m.has(r.childId)) m.set(r.childId, r.name);
    return m;
  }, [kids.data, rc.data]);
  const options = useMemo(() => [...names.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'vi')), [names]);
  return { options, names, status: kids.status === 'loading' && rc.status === 'loading' ? 'loading' : 'ready' };
}
