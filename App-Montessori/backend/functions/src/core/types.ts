import type { Firestore, DocumentReference, Transaction, Timestamp } from 'firebase-admin/firestore';
import type { Grant, PermsByCampus } from './permissions';

export interface Member {
  uid: string;
  displayName: string;
  email?: string;
  phone?: string;
  kind: 'owner' | 'staff' | 'parent';
  status: 'invited' | 'active' | 'suspended' | 'revoked';
  grants: Grant[];
  childIds: string[];
  permsByCampus: PermsByCampus;
  employeeId?: string;
  version: number;
}

export interface AuditEntry {
  action: string;
  collection?: string;
  docId?: string;
  campusId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string;
  result?: 'ok' | 'denied' | 'error';
}

/** Ngữ cảnh một request `api`. Module nghiệp vụ chỉ dùng Ctx, không tự đọc auth. */
export interface Ctx {
  uid: string;
  email?: string;
  phone?: string;
  token: Record<string, unknown>;
  platformAdmin: boolean;
  /** orgId đã xác thực (scope org/campus). */
  orgId: string;
  campusId?: string;
  member?: Member;
  opId?: string;
  requestId: string;
  now: Date;
  db: Firestore;

  /** Tham chiếu tới orgs/{orgId}/{...path} */
  col(path: string): FirebaseFirestore.CollectionReference;
  doc(path: string): DocumentReference;

  /** true nếu có quyền `perm` tại campusId (mặc định campusId của request). Owner/platformAdmin luôn có. */
  can(perm: string, campusId?: string | null): boolean;
  /** Ném PERMISSION_DENIED nếu thiếu quyền. */
  require(perm: string, campusId?: string | null): void;
  /** Cơ sở user có quyền perm (['*'] = tất cả). */
  campusesFor(perm: string): string[];
  /** Giáo viên: lớp được phép ghi (null = không hạn chế lớp). */
  allowedClassIds(): string[] | null;

  /** Ghi audit; luôn gọi cho thao tác thay đổi dữ liệu nhạy cảm. */
  audit(e: AuditEntry): Promise<void>;
  /** Thông tin tăng version/chuẩn hóa field meta khi tạo/sửa. */
  metaCreate(): { createdAt: Timestamp | Date; updatedAt: Timestamp | Date; createdBy: string; updatedBy: string; version: number };
  metaUpdate(prevVersion: number): { updatedAt: Timestamp | Date; updatedBy: string; version: number };
  /** Chạy transaction Firestore. */
  tx<T>(fn: (t: Transaction) => Promise<T>): Promise<T>;
}

export type Scope = 'none' | 'org' | 'campus';

export interface ActionDef<P = any, R = any> {
  /**
   * 'none' : không cần org (org.create, org.listMine, invite.claimPending)
   * 'org'  : cần orgId + member active
   * 'campus': cần orgId + campusId, campusId phải tồn tại trong org (member phải có quyền ở cơ sở)
   */
  scope: Scope;
  /** Quyền bắt buộc (kiểm tra tại campusId nếu scope=campus). Bỏ trống = chỉ cần là member active (handler tự kiểm tra). */
  perm?: string;
  /** Chỉ cho phép loại thành viên này (vd 'parent'). Mặc định staff/owner. */
  kinds?: Array<'owner' | 'staff' | 'parent'>;
  /** Bắt buộc có opId và dùng bộ nhớ idempotency. */
  idempotent?: boolean;
  handler: (ctx: Ctx, payload: P) => Promise<R>;
}

export type ActionMap = Record<string, ActionDef>;
