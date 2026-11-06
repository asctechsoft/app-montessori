'use client';
// Bộ dùng chung của nhóm B: hook đọc theo cơ sở, gọi API, hộp thoại thao tác có xem tác động, hiển thị chi tiết lỗi.
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { collection, doc, query, where, type DocumentData, type WhereFilterOp } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import { callApi, type ApiError } from '@/lib/api';
import { useDoc, useFirestoreQuery, type DocState, type QueryState } from '@/lib/hooks/useFirestore';
import { useAsyncAction } from '@/lib/hooks/useAsyncAction';
import { useScope } from '@/providers/ScopeProvider';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { formatDate } from '@/lib/format';

/* ------------------------------------------------------------------ ngữ cảnh cơ sở */

export interface CampusCtx {
  orgId: string;
  campusId: string;
  campusName: string;
  tz: string;
  scopeKey: string;
  can: (perm: string) => boolean;
}

/** Ngữ cảnh cơ sở đang thao tác (ScreenGuard đã bảo đảm đã chọn một cơ sở với màn phạm vi `campus`). */
export function useCampusCtx(): CampusCtx {
  const s = useScope();
  const campusId = s.campusId && s.campusId !== 'all' ? s.campusId : '';
  return useMemo(
    () => ({
      orgId: s.org?.orgId ?? '',
      campusId,
      campusName: s.campus?.name ?? campusId,
      tz: s.tz,
      scopeKey: s.scopeKey,
      can: (perm: string) => s.can(perm, campusId),
    }),
    [s, campusId],
  );
}

type Clause = [field: string, op: WhereFilterOp, value: unknown];

/**
 * Đọc realtime một collection của tổ chức, lọc theo cơ sở đang chọn (+ điều kiện thêm).
 * `enabled=false` (vd. thiếu quyền xem) => không truy vấn (trạng thái loading vĩnh viễn, nên màn phải tự hiện 403/ẩn trước).
 */
export function useCampusDocs<T = DocumentData & { id: string }>(
  name: string,
  map: (id: string, d: DocumentData) => T,
  opts: { enabled?: boolean; where?: Clause[]; campusField?: string; tag?: string } = {},
): QueryState<T> {
  const c = useCampusCtx();
  const ok = !!c.orgId && !!c.campusId && opts.enabled !== false;
  const extra = opts.where ?? [];
  const key = ok ? `${name}|${opts.tag ?? ''}|${c.orgId}|${c.campusId}|${JSON.stringify(extra)}` : null;
  return useFirestoreQuery<T>(
    key,
    () => query(collection(firebase().db, 'orgs', c.orgId, name), where(opts.campusField ?? 'campusId', '==', c.campusId), ...extra.map(([f, o, v]) => where(f, o, v))),
    map,
  );
}

/** Đọc realtime một tài liệu theo đường dẫn tương đối trong tổ chức: ['employees', id] hoặc ['employees', id, 'private', 'bank']. */
export function useOrgDoc<T = DocumentData & { id: string }>(
  path: string[] | null,
  map?: (id: string, d: DocumentData) => T,
): DocState<T> {
  const c = useCampusCtx();
  const key = path && c.orgId ? `doc|${c.orgId}|${path.join('/')}` : null;
  return useDoc<T>(key, () => (path ? doc(firebase().db, 'orgs', c.orgId, ...(path as [string, ...string[]])) : null), map);
}

/** Gọi action `api` kèm orgId + campusId (cả ở khung ngoài lẫn payload để khớp mọi handler). */
export function useCall() {
  const c = useCampusCtx();
  return useCallback(
    <R = unknown,>(action: string, payload: Record<string, unknown>, opId?: string) =>
      callApi<R>(action, { orgId: c.orgId, campusId: c.campusId, opId, payload: { campusId: c.campusId, ...payload } }),
    [c.orgId, c.campusId],
  );
}

/* ------------------------------------------------------------------ dữ liệu nhân viên dùng chung */

export interface EmployeeRow {
  id: string;
  code: string;
  fullName: string;
  phone: string;
  email: string;
  title: string;
  status: string;
  campusId: string;
  campusIds: string[];
  startDate: string;
  endDate: string;
  uid: string;
  annualLeaveDays: number | null;
  note: string;
  version?: number;
}

export const toEmployee = (id: string, d: DocumentData): EmployeeRow => ({
  id,
  code: String(d.code ?? ''),
  fullName: String(d.fullName ?? id),
  phone: String(d.phone ?? ''),
  email: String(d.email ?? ''),
  title: String(d.title ?? ''),
  status: String(d.status ?? 'active'),
  campusId: String(d.campusId ?? ''),
  campusIds: Array.isArray(d.campusIds) ? (d.campusIds as string[]) : [],
  startDate: String(d.startDate ?? ''),
  endDate: String(d.endDate ?? ''),
  uid: String(d.uid ?? ''),
  annualLeaveDays: typeof d.annualLeaveDays === 'number' ? d.annualLeaveDays : null,
  note: String(d.note ?? ''),
  version: typeof d.version === 'number' ? d.version : undefined,
});

/** Nhân viên có cơ sở chính là cơ sở đang chọn + bảng tra tên. */
export function useEmployees(enabled = true) {
  const q = useCampusDocs<EmployeeRow>('employees', toEmployee, { enabled });
  const byId = useMemo(() => new Map(q.data.map((e) => [e.id, e])), [q.data]);
  const nameOf = useCallback((id: string | null | undefined) => (id ? byId.get(id)?.fullName ?? id : '—'), [byId]);
  return { ...q, byId, nameOf };
}

/** Ca làm việc của cơ sở (đang dùng). */
export interface ShiftRow {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  overnight: boolean;
  workUnit: number;
  active: boolean;
  version?: number;
}
export const toShift = (id: string, d: DocumentData): ShiftRow => ({
  id,
  code: String(d.code ?? id),
  name: String(d.name ?? id),
  startTime: String(d.startTime ?? ''),
  endTime: String(d.endTime ?? ''),
  overnight: d.overnight === true,
  workUnit: typeof d.workUnit === 'number' ? d.workUnit : 1,
  active: d.active !== false && d.archived !== true,
  version: typeof d.version === 'number' ? d.version : undefined,
});

/* ------------------------------------------------------------------ lỗi */

type Json = Record<string, unknown>;
const asArr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Dịch `details` của ApiError thành các dòng tiếng Việt dễ đọc (tối đa `max`). */
export function describeErrorDetails(e: ApiError, nameOf?: (id: string) => string, max = 8): string[] {
  const d = e.details as Json;
  const lines: string[] = [];
  for (const s of asArr(d.shortages)) lines.push(`Thiếu giáo viên lớp ${str(s.className) || str(s.classId)} ngày ${formatDate(str(s.dayKey))}: có ${String(s.have)}, cần ${String(s.need)}.`);
  for (const o of asArr(d.overlaps)) lines.push(`${nameOf ? nameOf(str(o.employeeId)) : str(o.employeeId)} trùng ca ngày ${formatDate(str(o.dayKey))} (${str(o.with)}).`);
  for (const x of asArr(d.errors)) {
    const who = str(x.name) || (x.employeeId ? (nameOf ? nameOf(str(x.employeeId)) : str(x.employeeId)) : '');
    const day = str(x.dayKey) ? ` ${formatDate(str(x.dayKey))}` : '';
    const idx = typeof x.index === 'number' ? `Mục ${x.index + 1}: ` : '';
    lines.push(`${idx}${who}${day ? ` —${day}` : ''}${who || day ? ': ' : ''}${str(x.message)}`);
  }
  for (const x of asArr(d.conflicts)) lines.push(`${str(x.childName)}: món "${str(x.dish)}" chứa ${str(x.allergen)}.`);
  if (Array.isArray(d.entries) && d.reason === 'PAST_DAY') lines.push(`${(d.entries as unknown[]).length} mục thuộc ngày đã qua.`);
  return lines.slice(0, max).concat(lines.length > max ? [`… và ${lines.length - max} mục khác.`] : []);
}

export function ErrorDetails({ error, nameOf, onReload }: { error: ApiError | null; nameOf?: (id: string) => string; onReload?: () => void }) {
  if (!error) return null;
  const lines = describeErrorDetails(error, nameOf);
  if (error.code === 'VERSION_CONFLICT') {
    return (
      <Banner tone="warning" title="Dữ liệu đã được người khác thay đổi" action={onReload ? <Button size="sm" variant="secondary" onClick={onReload}>Tải lại dữ liệu</Button> : undefined}>
        Màn hình đã nhận bản mới nhất. Hãy đối chiếu lại rồi thực hiện lại thao tác.
      </Banner>
    );
  }
  if (lines.length === 0) return null;
  return (
    <Banner tone="warning" title="Chi tiết cần xử lý">
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </Banner>
  );
}

/* ------------------------------------------------------------------ hộp thoại thao tác */

interface ActionDialogProps {
  title: string;
  subject?: string;
  /** Tác động nêu cụ thể (người dùng phải xem trước khi xác nhận). */
  impact: string[];
  confirmLabel: string;
  tone?: 'primary' | 'destructive';
  /** Gọi máy chủ với opId ổn định; ném ApiError khi lỗi. */
  run: (opId: string) => Promise<unknown>;
  onClose: () => void;
  onDone?: (result: unknown) => void;
  success: string;
  /** Kiểm tra trường nhập trong hộp thoại: trả thông điệp lỗi hoặc null. */
  validate?: () => string | null;
  nameOf?: (id: string) => string;
  onReload?: () => void;
  children?: ReactNode;
}

/** Hộp thoại xem tác động: nút busy + opId, lỗi giữ trong hộp thoại (không đóng), chỉ báo thành công sau khi máy chủ trả. */
export function ActionDialog({ title, subject, impact, confirmLabel, tone, run, onClose, onDone, success, validate, nameOf, onReload, children }: ActionDialogProps) {
  const toast = useToast();
  const [localError, setLocalError] = useState<string | null>(null);
  const action = useAsyncAction(async (opId: string) => ({ data: await run(opId) }));
  return (
    <ConfirmDialog
      open
      title={title}
      subject={subject}
      impact={impact}
      confirmLabel={confirmLabel}
      tone={tone}
      busy={action.busy}
      error={localError ?? action.error?.message ?? null}
      onCancel={onClose}
      onConfirm={async () => {
        const v = validate?.() ?? null;
        setLocalError(v);
        if (v) return;
        const res = await action.run();
        if (res) {
          toast.success(success);
          onDone?.(res.data);
          onClose();
        }
      }}
    >
      {children}
      <ErrorDetails error={action.error} nameOf={nameOf} onReload={onReload} />
    </ConfirmDialog>
  );
}

/* ------------------------------------------------------------------ trình bày nhỏ */

/** Danh sách nhãn: giá trị (2 cột), dùng trong thẻ chi tiết. */
export function KV({ items, cols = 2 }: { items: Array<[string, ReactNode]>; cols?: 2 | 3 }) {
  return (
    <dl className={cols === 3 ? 'grid-3' : 'grid-2'} style={{ margin: 0 }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ minWidth: 0 }}>
          <dt className="text-caption text-secondary">{k}</dt>
          <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{v === null || v === undefined || v === '' ? '—' : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
export const text = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
export const formatNumber = (n: number | null | undefined, digits = 2): string => (n === null || n === undefined ? '—' : n.toLocaleString('vi-VN', { maximumFractionDigits: digits }));

/** Thời điểm Timestamp/ISO → Date hoặc null (dùng với formatDateTime/formatTime). */
export { toDate } from '@/lib/format';
