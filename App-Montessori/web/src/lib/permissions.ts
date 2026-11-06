// Bản sao phía web của backend/functions/src/core/permissions.ts (CONTRACT §3).
// Khi backend đổi quyền/vai trò: cập nhật file này cho khớp. Máy chủ luôn là nơi quyết định cuối cùng.

export const ALL_PERMISSIONS = [
  'org.manage', 'campus.read', 'campus.manage', 'members.read', 'members.manage', 'roles.manage',
  'leads.read', 'leads.write',
  'children.read', 'children.write', 'children.health.read', 'children.transfer',
  'classes.read', 'classes.write',
  'attendance.read', 'attendance.write', 'handover.write', 'leave.decide',
  'care.read', 'care.write', 'care.publish',
  'medication.read', 'medication.write', 'incident.read', 'incident.write',
  'staff.read', 'staff.write', 'roster.write',
  'timekeeping.read', 'timekeeping.approve', 'timekeeping.lock', 'timekeeping.reopen',
  'leave_staff.decide',
  'payroll.read', 'payroll.write', 'payroll.approve',
  'fees.read', 'fees.write', 'billing.write', 'billing.approve',
  'payments.read', 'payments.write', 'payments.reconcile', 'refunds.approve',
  'expenses.read', 'expenses.write', 'expenses.approve',
  'kitchen.read', 'kitchen.write', 'stock.read', 'stock.write',
  'assets.read', 'assets.write', 'transport.read', 'transport.write',
  'notify.read', 'notify.send', 'notify.approve', 'inbox.handle',
  'reports.read', 'reports.export', 'audit.read', 'import.write', 'backup.manage', 'approvals.read',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

const P = (...p: Permission[]): string[] => p;

/** Quyền nhạy cảm KHÔNG mặc định cấp cho hiệu trưởng (phải cấp riêng bằng extraPerms). */
export const PRINCIPAL_EXCLUDED: string[] = [
  'payroll.read', 'payroll.write', 'payroll.approve', 'refunds.approve', 'expenses.approve',
  'timekeeping.reopen', 'billing.approve', 'org.manage', 'roles.manage',
];

export const SYSTEM_ROLES: Record<string, string[]> = {
  owner: [...ALL_PERMISSIONS],
  principal: ALL_PERMISSIONS.filter((p) => !PRINCIPAL_EXCLUDED.includes(p)),
  teacher: P(
    'campus.read', 'children.read', 'children.health.read', 'classes.read', 'attendance.read', 'attendance.write',
    'handover.write', 'leave.decide', 'care.read', 'care.write', 'medication.read', 'medication.write',
    'incident.read', 'incident.write', 'notify.read', 'inbox.handle', 'kitchen.read',
  ),
  hr: P(
    'campus.read', 'members.read', 'staff.read', 'staff.write', 'roster.write', 'timekeeping.read',
    'timekeeping.approve', 'timekeeping.lock', 'leave_staff.decide', 'payroll.read', 'payroll.write',
    'classes.read', 'approvals.read', 'reports.read',
  ),
  accountant: P(
    'campus.read', 'children.read', 'fees.read', 'fees.write', 'billing.write', 'payments.read', 'payments.write',
    'payments.reconcile', 'expenses.read', 'expenses.write', 'reports.read', 'reports.export', 'approvals.read',
    'payroll.read', 'stock.read',
  ),
  nurse: P(
    'campus.read', 'children.read', 'children.health.read', 'medication.read', 'medication.write',
    'incident.read', 'incident.write', 'care.read', 'classes.read',
  ),
  kitchen: P('campus.read', 'kitchen.read', 'kitchen.write', 'stock.read', 'stock.write'),
  transport: P('campus.read', 'transport.read', 'transport.write', 'children.read'),
  tech_admin: P('campus.read', 'members.read', 'members.manage', 'audit.read', 'backup.manage'),
  parent: [],
};

export const SYSTEM_ROLE_LABELS: Record<string, string> = {
  owner: 'Chủ chuỗi',
  principal: 'Hiệu trưởng',
  teacher: 'Giáo viên',
  hr: 'Nhân sự',
  accountant: 'Kế toán',
  nurse: 'Y tế',
  kitchen: 'Bếp và kho',
  transport: 'Phụ trách xe',
  tech_admin: 'Quản trị kỹ thuật',
  parent: 'Phụ huynh',
};

export interface Grant {
  id: string;
  roleId: string;
  campusIds: string[]; // ['*'] = toàn tổ chức
  classIds?: string[];
  validFrom?: string;
  validTo?: string;
  extraPerms?: string[];
  deniedPerms?: string[];
}

export type PermsByCampus = Record<string, string[]>;

/** Khớp quyền ở một cơ sở (hoặc '*' = toàn tổ chức). Khóa '*' có hiệu lực ở mọi cơ sở. */
export function hasPerm(permsByCampus: PermsByCampus | undefined | null, perm: string, campusId?: string | null): boolean {
  if (!permsByCampus) return false;
  if (permsByCampus['*']?.includes(perm)) return true;
  if (campusId && campusId !== '*' && permsByCampus[campusId]?.includes(perm)) return true;
  return false;
}

/** Có quyền ở bất kỳ cơ sở nào (dùng để quyết định hiện mục menu). */
export function hasPermAnywhere(permsByCampus: PermsByCampus | undefined | null, perm: string): boolean {
  if (!permsByCampus) return false;
  return Object.values(permsByCampus).some((list) => list.includes(perm));
}

/** Cơ sở mà người dùng có quyền `perm` (['*'] nếu toàn tổ chức). */
export function campusesWithPerm(permsByCampus: PermsByCampus | undefined | null, perm: string): string[] {
  if (!permsByCampus) return [];
  if (permsByCampus['*']?.includes(perm)) return ['*'];
  return Object.keys(permsByCampus).filter((c) => c !== '*' && permsByCampus[c].includes(perm));
}

/** Nhóm + nhãn tiếng Việt cho ma trận quyền (W06). Quyền không có nhãn sẽ hiện mã gốc. */
export const PERMISSION_GROUPS: { title: string; perms: { id: Permission; label: string }[] }[] = [
  { title: 'Tổ chức và tài khoản', perms: [
    { id: 'org.manage', label: 'Quản lý tổ chức' }, { id: 'campus.read', label: 'Xem cơ sở' }, { id: 'campus.manage', label: 'Quản lý cơ sở' },
    { id: 'members.read', label: 'Xem tài khoản' }, { id: 'members.manage', label: 'Quản lý tài khoản' }, { id: 'roles.manage', label: 'Quản lý vai trò' },
  ] },
  { title: 'Tuyển sinh, trẻ và lớp', perms: [
    { id: 'leads.read', label: 'Xem tuyển sinh' }, { id: 'leads.write', label: 'Sửa tuyển sinh' },
    { id: 'children.read', label: 'Xem hồ sơ trẻ' }, { id: 'children.write', label: 'Sửa hồ sơ trẻ' },
    { id: 'children.health.read', label: 'Xem sức khỏe trẻ' }, { id: 'children.transfer', label: 'Chuyển lớp hoặc cơ sở' },
    { id: 'classes.read', label: 'Xem lớp' }, { id: 'classes.write', label: 'Sửa lớp và phân công' },
  ] },
  { title: 'Điểm danh và chăm sóc', perms: [
    { id: 'attendance.read', label: 'Xem điểm danh' }, { id: 'attendance.write', label: 'Ghi điểm danh' },
    { id: 'handover.write', label: 'Nhận và trả trẻ' }, { id: 'leave.decide', label: 'Duyệt đơn nghỉ của trẻ' },
    { id: 'care.read', label: 'Xem nhật ký chăm sóc' }, { id: 'care.write', label: 'Ghi nhật ký chăm sóc' }, { id: 'care.publish', label: 'Xuất bản nhật ký' },
    { id: 'medication.read', label: 'Xem thuốc' }, { id: 'medication.write', label: 'Quản lý thuốc' },
    { id: 'incident.read', label: 'Xem sự cố' }, { id: 'incident.write', label: 'Ghi sự cố' },
  ] },
  { title: 'Nhân sự, công và lương', perms: [
    { id: 'staff.read', label: 'Xem nhân sự' }, { id: 'staff.write', label: 'Sửa nhân sự' }, { id: 'roster.write', label: 'Lập ca làm việc' },
    { id: 'timekeeping.read', label: 'Xem chấm công' }, { id: 'timekeeping.approve', label: 'Duyệt bổ sung công' },
    { id: 'timekeeping.lock', label: 'Khóa kỳ công' }, { id: 'timekeeping.reopen', label: 'Mở lại kỳ công' },
    { id: 'leave_staff.decide', label: 'Duyệt nghỉ phép nhân viên' },
    { id: 'payroll.read', label: 'Xem bảng lương' }, { id: 'payroll.write', label: 'Lập bảng lương' }, { id: 'payroll.approve', label: 'Duyệt bảng lương' },
  ] },
  { title: 'Học phí, thu tiền và thu chi', perms: [
    { id: 'fees.read', label: 'Xem biểu phí' }, { id: 'fees.write', label: 'Sửa biểu phí' },
    { id: 'billing.write', label: 'Lập kỳ thu' }, { id: 'billing.approve', label: 'Duyệt kỳ thu' },
    { id: 'payments.read', label: 'Xem thu tiền' }, { id: 'payments.write', label: 'Ghi thu tiền' },
    { id: 'payments.reconcile', label: 'Đối soát giao dịch' }, { id: 'refunds.approve', label: 'Duyệt hoàn tiền' },
    { id: 'expenses.read', label: 'Xem khoản chi' }, { id: 'expenses.write', label: 'Lập khoản chi' }, { id: 'expenses.approve', label: 'Duyệt khoản chi' },
  ] },
  { title: 'Vận hành', perms: [
    { id: 'kitchen.read', label: 'Xem thực đơn' }, { id: 'kitchen.write', label: 'Sửa thực đơn và suất ăn' },
    { id: 'stock.read', label: 'Xem kho' }, { id: 'stock.write', label: 'Nhập và xuất kho' },
    { id: 'assets.read', label: 'Xem tài sản' }, { id: 'assets.write', label: 'Sửa tài sản' },
    { id: 'transport.read', label: 'Xem xe đưa đón' }, { id: 'transport.write', label: 'Quản lý xe đưa đón' },
  ] },
  { title: 'Kết nối, báo cáo và hệ thống', perms: [
    { id: 'notify.read', label: 'Xem thông báo' }, { id: 'notify.send', label: 'Gửi thông báo' }, { id: 'notify.approve', label: 'Duyệt thông báo' },
    { id: 'inbox.handle', label: 'Xử lý trao đổi' },
    { id: 'reports.read', label: 'Xem báo cáo' }, { id: 'reports.export', label: 'Xuất báo cáo' },
    { id: 'audit.read', label: 'Xem nhật ký thao tác' }, { id: 'import.write', label: 'Nhập dữ liệu' },
    { id: 'backup.manage', label: 'Quản lý sao lưu' }, { id: 'approvals.read', label: 'Xem trung tâm phê duyệt' },
  ] },
];

const LABELS: Record<string, string> = Object.fromEntries(PERMISSION_GROUPS.flatMap((g) => g.perms.map((p) => [p.id, p.label])));

export function permissionLabel(id: string): string {
  return LABELS[id] ?? id;
}

/** Hợp quyền (vai trò + extra - denied) của các grant còn hiệu lực tại `now`. Dùng để thu hẹp theo "vai trò đang dùng" (chỉ là góc nhìn UI). */
export function computePermsByCampus(
  grants: Grant[],
  customRoles: Record<string, string[]>,
  now: Date = new Date(),
  allCampusIds: string[] = [],
): PermsByCampus {
  const out: Record<string, Set<string>> = {};
  const add = (key: string, perms: string[]) => {
    const set = (out[key] ??= new Set());
    for (const p of perms) set.add(p);
  };
  for (const g of grants ?? []) {
    if (g.validFrom && new Date(g.validFrom) > now) continue;
    if (g.validTo && new Date(g.validTo) < now) continue;
    const base = SYSTEM_ROLES[g.roleId] ?? customRoles[g.roleId] ?? [];
    const denied = new Set(g.deniedPerms ?? []);
    const perms = [...new Set([...base, ...(g.extraPerms ?? [])])].filter((p) => !denied.has(p));
    for (const c of g.campusIds ?? []) add(c, perms);
  }
  if (out['*']) for (const c of allCampusIds) add(c, [...out['*']]);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].sort()]));
}
