'use client';
// Bộ dùng chung cho các màn nhóm A (W05, W08–W20, W48): hook đọc Firestore theo cơ sở, nhãn trạng thái, hộp thoại biểu mẫu.
import { useId, useMemo, type FormEvent, type ReactNode } from 'react';
import { collection, query, where, type QueryConstraint } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import type { ApiError } from '@/lib/api';
import { useFirestoreQuery, type DataStatus, type QueryState } from '@/lib/hooks/useFirestore';
import { useDirtyGuard } from '@/lib/hooks/dirtyStore';
import { useScope } from '@/providers/ScopeProvider';
import { toDate, type DateLike } from '@/lib/format';
import type { Tone } from '@/lib/status';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button, LinkButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/Misc';

/* ------------------------------------------------------------------ đọc giá trị an toàn */

export type Doc = Record<string, unknown>;

export const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : v === null || v === undefined ? d : String(v));
export const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
export const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
export const objs = (v: unknown): Doc[] => (Array.isArray(v) ? v.filter((x): x is Doc => !!x && typeof x === 'object' && !Array.isArray(x)) : []);
export const obj = (v: unknown): Doc => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Doc) : {});
export const dateOf = (v: unknown): Date | null => toDate(v as DateLike);
export const isoOf = (v: unknown): string => dateOf(v)?.toISOString() ?? '';

/** Trẻ đang trong trường (tính sĩ số). */
export const IN_SCHOOL = ['active', 'trial', 'on_leave'];

/* ------------------------------------------------------------------ phạm vi cơ sở */

export function useCampusCtx() {
  const { org, campusId, campus, tz, scopeKey, can, canAnywhere, campuses } = useScope();
  const cid = campusId && campusId !== 'all' ? campusId : null;
  return {
    orgId: org?.orgId ?? '',
    cid,
    campus,
    campuses,
    tz,
    scopeKey,
    can: (perm: string) => !!cid && can(perm, cid),
    canAnywhere,
  };
}

interface ColOpts {
  enabled?: boolean;
  where?: QueryConstraint[];
  keyExtra?: string;
}

/** Đọc realtime một collection dưới orgs/{orgId}, luôn lọc campusId (rules cần điều kiện này). */
export function useCampusCol<T>(name: string, map: (id: string, d: Doc) => T, opts: ColOpts = {}): QueryState<T> {
  const { orgId, cid, scopeKey } = useCampusCtx();
  const enabled = opts.enabled ?? true;
  return useFirestoreQuery<T>(
    enabled && cid && orgId ? `${name}|${scopeKey}|${opts.keyExtra ?? ''}` : null,
    () => query(collection(firebase().db, 'orgs', orgId, name), where('campusId', '==', cid), ...(opts.where ?? [])),
    map,
  );
}

/** Danh sách rỗng sau khi lọc phía client vẫn phải là trạng thái "Chưa có dữ liệu". */
export function statusOf(status: DataStatus, rows: unknown[]): DataStatus {
  return status === 'ready' && rows.length === 0 ? 'empty' : status;
}

/* ------------------------------------------------------------------ mô hình dùng chung */

export interface ChildRow {
  id: string;
  code: string;
  fullName: string;
  nickname: string;
  dob: string;
  gender: string;
  address: string;
  status: string;
  classId: string | null;
  campusId: string;
  photoConsent: boolean;
  missingDocuments: string[];
  notes: string;
  statusReason: string;
  enrolledAt: string;
  version?: number;
  archived: boolean;
}

export const mapChild = (id: string, d: Doc): ChildRow => ({
  id,
  code: str(d.code, id),
  fullName: str(d.fullName, id),
  nickname: str(d.nickname),
  dob: str(d.dob),
  gender: str(d.gender),
  address: str(d.address),
  status: str(d.status, 'pending'),
  classId: str(d.classId) || null,
  campusId: str(d.campusId),
  photoConsent: d.photoConsent === true,
  missingDocuments: strs(d.missingDocuments),
  notes: str(d.notes),
  statusReason: str(d.statusReason),
  enrolledAt: str(d.enrolledAt),
  version: num(d.version),
  archived: d.archived === true,
});

export interface ClassRow {
  id: string;
  code: string;
  name: string;
  ageGroup: string;
  minAgeMonths?: number;
  maxAgeMonths?: number;
  room: string;
  capacity: number;
  enrolledCount?: number;
  academicYearId: string;
  status: string;
  note: string;
  archived: boolean;
  version?: number;
}

export const mapClass = (id: string, d: Doc): ClassRow => ({
  id,
  code: str(d.code, id),
  name: str(d.name, id),
  ageGroup: str(d.ageGroup),
  minAgeMonths: num(d.minAgeMonths),
  maxAgeMonths: num(d.maxAgeMonths),
  room: str(d.room),
  capacity: num(d.capacity) ?? 0,
  enrolledCount: num(d.enrolledCount),
  academicYearId: str(d.academicYearId),
  status: str(d.status, 'active'),
  note: str(d.note),
  archived: d.archived === true,
  version: num(d.version),
});

export interface YearRow {
  id: string;
  code: string;
  name: string;
  startDate: string;
  endDate: string;
  current: boolean;
  status: string;
  teachingDays: number[];
  note: string;
  archived: boolean;
  version?: number;
}

export const mapYear = (id: string, d: Doc): YearRow => ({
  id,
  code: str(d.code, id),
  name: str(d.name, id),
  startDate: str(d.startDate),
  endDate: str(d.endDate),
  current: d.current === true,
  status: str(d.status, 'draft'),
  teachingDays: Array.isArray(d.teachingDays) ? d.teachingDays.filter((x): x is number => typeof x === 'number') : [],
  note: str(d.note),
  archived: d.archived === true,
  version: num(d.version),
});

export interface GuardianRow {
  id: string;
  childId: string;
  name: string;
  phone: string;
  email: string;
  relation: string;
  status: string;
  uid: string;
  perms: { notify: boolean; viewFees: boolean; pickup: boolean };
}

export const mapGuardian = (id: string, d: Doc): GuardianRow => {
  const p = obj(d.perms);
  return {
    id,
    childId: str(d.childId),
    name: str(d.name),
    phone: str(d.phone),
    email: str(d.email),
    relation: str(d.relation, 'other'),
    status: str(d.status),
    uid: str(d.uid),
    perms: { notify: p.notify === true, viewFees: p.viewFees === true, pickup: p.pickup === true },
  };
};

export interface PickupRow {
  id: string;
  childId: string;
  personName: string;
  phone: string;
  relation: string;
  type: string;
  status: string;
  validFrom: string;
  validTo: string;
  validFromTime: string;
  validToTime: string;
  idNumberLast4: string;
  note: string;
  version?: number;
}

export const mapPickup = (id: string, d: Doc): PickupRow => ({
  id,
  childId: str(d.childId),
  personName: str(d.personName),
  phone: str(d.phone),
  relation: str(d.relation),
  type: str(d.type, 'delegate'),
  status: str(d.status),
  validFrom: str(d.validFrom),
  validTo: str(d.validTo),
  validFromTime: str(d.validFromTime),
  validToTime: str(d.validToTime),
  idNumberLast4: str(d.idNumberLast4),
  note: str(d.note),
  version: num(d.version),
});

export function useChildrenQ(enabled = true) {
  const q = useCampusCol('children', mapChild, { enabled });
  const data = useMemo(() => q.data.filter((c) => !c.archived), [q.data]);
  const byId = useMemo(() => new Map(data.map((c) => [c.id, c])), [data]);
  return { ...q, data, byId, status: statusOf(q.status, data) };
}

export function useClassesQ(enabled = true) {
  const q = useCampusCol('classes', mapClass, { enabled });
  const data = useMemo(() => q.data.filter((c) => !c.archived).sort((a, b) => a.name.localeCompare(b.name, 'vi')), [q.data]);
  const byId = useMemo(() => new Map(data.map((c) => [c.id, c])), [data]);
  return { ...q, data, byId, status: statusOf(q.status, data) };
}

/** Sĩ số theo lớp: đếm từ danh sách trẻ (trẻ đang trong trường), nếu chưa có thì dùng enrolledCount do máy chủ đồng bộ. */
export function useOccupancy(children: ChildRow[], ready: boolean) {
  return useMemo(() => {
    const m = new Map<string, number>();
    if (ready) for (const c of children) if (c.classId && IN_SCHOOL.includes(c.status)) m.set(c.classId, (m.get(c.classId) ?? 0) + 1);
    return (cls: ClassRow) => (ready ? m.get(cls.id) ?? 0 : cls.enrolledCount ?? 0);
  }, [children, ready]);
}

export interface StaffOption {
  uid: string;
  name: string;
}

/** Nhân sự có quyền `perm` tại cơ sở (đọc members — cần quyền xem tài khoản). */
export function useStaffWith(perm: string, enabledExtra = true) {
  const { orgId, cid, canAnywhere, scopeKey } = useCampusCtx();
  const allowed = enabledExtra && !!cid && canAnywhere('members.read');
  const q = useFirestoreQueryStaff(allowed ? `staff|${scopeKey}|${perm}` : null, orgId, cid);
  const options = useMemo<StaffOption[]>(
    () => q.data.filter((m) => m.kind !== 'parent' && m.status === 'active' && m.perms.includes(perm)).map((m) => ({ uid: m.uid, name: m.name })).sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    [q.data, perm],
  );
  return { options, available: allowed && q.status !== 'error', status: q.status };
}

function useFirestoreQueryStaff(key: string | null, orgId: string, cid: string | null) {
  return useFirestoreQuery<{ uid: string; name: string; kind: string; status: string; perms: string[] }>(
    key,
    () => collection(firebase().db, 'orgs', orgId, 'members'),
    (id, d) => {
      const pbc = obj(d.permsByCampus);
      return {
        uid: id,
        name: str(d.displayName, id),
        kind: str(d.kind),
        status: str(d.status),
        perms: [...strs(pbc['*']), ...strs(pbc[cid ?? ''])],
      };
    },
  );
}

/* ------------------------------------------------------------------ nhãn trạng thái */

type Meta = Record<string, { label: string; tone: Tone }>;

export const LEAD_STATUS: Meta = {
  new: { label: 'Mới', tone: 'info' },
  contacted: { label: 'Đã liên hệ', tone: 'info' },
  tour_scheduled: { label: 'Hẹn tham quan', tone: 'warning' },
  trial: { label: 'Học thử', tone: 'warning' },
  documents: { label: 'Bổ sung giấy tờ', tone: 'warning' },
  approved: { label: 'Đủ điều kiện nhập học', tone: 'success' },
  enrolled: { label: 'Đã nhập học', tone: 'success' },
  lost: { label: 'Không tiếp tục', tone: 'neutral' },
};
export const LEAD_FLOW = ['new', 'contacted', 'tour_scheduled', 'trial', 'documents', 'approved', 'enrolled'];

export const CHILD_STATUS: Meta = {
  pending: { label: 'Chờ xếp lớp', tone: 'warning' },
  active: { label: 'Đang học', tone: 'success' },
  trial: { label: 'Học thử', tone: 'info' },
  on_leave: { label: 'Bảo lưu', tone: 'warning' },
  withdrawn: { label: 'Đã thôi học', tone: 'neutral' },
  archived: { label: 'Lưu trữ', tone: 'neutral' },
};

export const GUARDIAN_STATUS: Meta = {
  linked: { label: 'Đã liên kết tài khoản', tone: 'success' },
  invited: { label: 'Chưa kích hoạt', tone: 'warning' },
  unlinked: { label: 'Đã gỡ liên kết', tone: 'neutral' },
};

export const PICKUP_STATUS: Meta = {
  approved: { label: 'Đã xác nhận', tone: 'success' },
  pending: { label: 'Chờ xác nhận', tone: 'warning' },
  rejected: { label: 'Từ chối', tone: 'error' },
  revoked: { label: 'Đã thu hồi', tone: 'neutral' },
};

export const MED_STATUS: Meta = {
  pending: { label: 'Chờ nhận', tone: 'warning' },
  received: { label: 'Đã nhận thuốc', tone: 'success' },
  rejected: { label: 'Từ chối', tone: 'error' },
  paused: { label: 'Tạm dừng', tone: 'warning' },
};

export const MED_RESULT: Record<string, string> = {
  given: 'Đã cho uống đủ liều',
  partial: 'Uống một phần',
  refused: 'Bé từ chối uống',
  vomited: 'Bé nôn sau khi uống',
  missed: 'Quên/không thực hiện',
};

export const SEVERITY: Meta = {
  minor: { label: 'Nhẹ', tone: 'info' },
  moderate: { label: 'Vừa', tone: 'warning' },
  serious: { label: 'Nghiêm trọng', tone: 'error' },
};

export const INCIDENT_STATUS: Meta = {
  open: { label: 'Đang xử lý', tone: 'warning' },
  closed: { label: 'Đã đóng', tone: 'success' },
};

export const TRANSFER_STATUS: Meta = {
  pending: { label: 'Chờ duyệt', tone: 'warning' },
  completed: { label: 'Đã chuyển', tone: 'success' },
  rejected: { label: 'Từ chối', tone: 'error' },
  cancelled: { label: 'Đã hủy', tone: 'neutral' },
};

export const GENDER_LABEL: Record<string, string> = { male: 'Nam', female: 'Nữ', other: 'Khác' };
export const GENDER_OPTIONS = [{ value: 'male', label: 'Nam' }, { value: 'female', label: 'Nữ' }, { value: 'other', label: 'Khác' }];
export const RELATION_OPTIONS = [
  { value: 'mother', label: 'Mẹ' },
  { value: 'father', label: 'Bố' },
  { value: 'grandparent', label: 'Ông bà' },
  { value: 'relative', label: 'Họ hàng' },
  { value: 'guardian', label: 'Người giám hộ khác' },
  { value: 'other', label: 'Khác' },
];
export const relationLabel = (v: string): string => RELATION_OPTIONS.find((o) => o.value === v)?.label ?? (v || '—');
export const ROLE_LABEL: Record<string, string> = { main: 'Giáo viên chính', assistant: 'Giáo viên phụ', substitute: 'Giáo viên thay thế' };
export const SESSION_LABEL: Record<string, string> = { all: 'Cả ngày', am: 'Buổi sáng', pm: 'Buổi chiều' };
export const WEEKDAYS = [
  { value: 1, label: 'Thứ hai' }, { value: 2, label: 'Thứ ba' }, { value: 3, label: 'Thứ tư' }, { value: 4, label: 'Thứ năm' },
  { value: 5, label: 'Thứ sáu' }, { value: 6, label: 'Thứ bảy' }, { value: 7, label: 'Chủ nhật' },
];

export function MetaTag({ meta, value }: { meta: Meta; value: string }) {
  const m = meta[value] ?? { label: value || 'Không rõ', tone: 'neutral' as Tone };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export const metaOptions = (meta: Meta) => Object.entries(meta).map(([value, m]) => ({ value, label: m.label }));

/* ------------------------------------------------------------------ ngày giờ */

/** Tuổi dạng "2 tuổi 3 tháng" từ ngày sinh YYYY-MM-DD. */
export function ageText(dob: string, onDay: Date = new Date()): string {
  const d = dateOf(dob);
  if (!d) return '—';
  let months = (onDay.getFullYear() - d.getFullYear()) * 12 + onDay.getMonth() - d.getMonth();
  if (onDay.getDate() < d.getDate()) months -= 1;
  if (months < 0) return '—';
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y > 0 ? `${y} tuổi${m ? ` ${m} tháng` : ''}` : `${m} tháng`;
}

/** Ghép ngày YYYY-MM-DD và giờ HH:mm theo giờ Việt Nam thành ISO (múi giờ +07:00 như CONTRACT_CHANGES #6). */
export function isoVn(day: string, time: string): string {
  return `${day}T${time || '00:00'}:00+07:00`;
}

export function addDaysKey(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^[0-9+\s().-]{8,20}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const digitsOnly = (s: string): string => s.replace(/\D/g, '');
/** So sánh số điện thoại theo 9 chữ số cuối (bỏ +84/0). */
export const phoneKey = (s: string): string => digitsOnly(s).slice(-9);

/* ------------------------------------------------------------------ thành phần giao diện */

/** Danh sách "nhãn: giá trị". */
export function Kv({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(110px, 190px) minmax(0, 1fr)', gap: 'var(--space-2) var(--space-4)' }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt className="text-secondary text-small">{k}</dt>
          <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{v === '' || v === null || v === undefined ? '—' : v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Banner lỗi từ máy chủ; xung đột phiên bản kèm nút tải lại (dữ liệu là realtime nên đóng và mở lại là đủ). */
export function ServerError({ error, message, onReload }: { error?: ApiError | null; message?: string | null; onReload?: () => void }) {
  const text = message ?? error?.message;
  if (!text) return null;
  const conflict = error?.code === 'VERSION_CONFLICT';
  return (
    <Banner
      tone="error"
      title={conflict ? 'Dữ liệu đã bị người khác thay đổi' : undefined}
      action={conflict && onReload ? <Button size="sm" variant="secondary" icon="refresh" onClick={onReload}>Đóng và tải lại dữ liệu mới nhất</Button> : undefined}
    >
      {text}
    </Banner>
  );
}

interface FormLike {
  formError: string | null;
  submitting: boolean;
  apiError: ApiError | null;
}

interface FormDialogProps {
  title: string;
  form: FormLike;
  dirty: boolean;
  onSubmit: (e?: FormEvent) => Promise<unknown>;
  onClose: () => void;
  submitLabel: string;
  children: ReactNode;
  size?: 'md' | 'lg';
  /** Thông tin thêm hiển thị phía dưới nội dung (vd. tác động). */
  footerNote?: ReactNode;
  submitDisabled?: boolean;
}

/** Hộp thoại biểu mẫu: nút gửi busy, lỗi chung gần nút gửi, hỏi bỏ thay đổi khi đóng. */
export function FormDialog({ title, form, dirty, onSubmit, onClose, submitLabel, children, size = 'md', footerNote, submitDisabled }: FormDialogProps) {
  const { confirmDiscard } = useDirtyGuard();
  const formId = useId();
  const close = async () => {
    if (form.submitting) return;
    if (dirty && !(await confirmDiscard('đóng biểu mẫu'))) return;
    onClose();
  };
  return (
    <Modal
      open
      size={size}
      title={title}
      locked={form.submitting}
      onClose={() => void close()}
      footer={
        <>
          <Button variant="secondary" onClick={() => void close()} disabled={form.submitting}>Hủy</Button>
          <Button type="submit" form={formId} loading={form.submitting} disabled={submitDisabled}>{submitLabel}</Button>
        </>
      }
    >
      <form id={formId} className="stack" noValidate onSubmit={(e) => void onSubmit(e)}>
        {children}
        {footerNote}
        <ServerError error={form.apiError} message={form.formError} onReload={() => onClose()} />
      </form>
    </Modal>
  );
}

/** Màn chi tiết: bản ghi không thuộc cơ sở đang chọn hoặc không tồn tại. */
export function NotInCampus({ what, backHref, backLabel }: { what: string; backHref: string; backLabel: string }) {
  return (
    <EmptyState
      title={`Không tìm thấy ${what}`}
      description={`Mục này không tồn tại hoặc không thuộc cơ sở đang chọn. Kiểm tra lại cơ sở ở thanh trên cùng.`}
      action={<LinkButton href={backHref} variant="secondary">{backLabel}</LinkButton>}
    />
  );
}

/** Thanh tiến độ (chữ + thanh, không chỉ màu). */
export function Progress({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const color = pct >= 100 ? 'var(--color-success)' : pct >= 50 ? 'var(--color-warning)' : 'var(--color-error)';
  return (
    <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'nowrap' }}>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Mức hoàn thành'}
        style={{ width: 80, height: 8, borderRadius: 'var(--radius-pill)', background: 'var(--color-surfaceMuted)', overflow: 'hidden', flex: 'none' }}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
      </div>
      <span className="text-small">{pct}%</span>
    </div>
  );
}
