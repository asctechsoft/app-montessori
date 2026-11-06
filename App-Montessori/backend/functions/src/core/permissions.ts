// Quyền và vai trò hệ thống. Nguồn sự thật: docs/CONTRACT.md §3.
// Bản sao phía web: web/src/lib/permissions.ts, mobile: mobile/lib/values/permissions.dart.

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

export interface Grant {
  id: string;
  roleId: string;
  campusIds: string[]; // ['*'] = toàn org
  classIds?: string[];
  validFrom?: string;
  validTo?: string;
  extraPerms?: string[];
  deniedPerms?: string[];
}

export type PermsByCampus = Record<string, string[]>;

/** Hợp quyền (vai trò + extra - denied) của các grant còn hiệu lực tại `now`. */
export function computePermsByCampus(
  grants: Grant[],
  customRoles: Record<string, string[]>,
  now: Date,
  allCampusIds: string[] = [],
): PermsByCampus {
  const out: Record<string, Set<string>> = {};
  const add = (key: string, perms: string[]) => {
    (out[key] ??= new Set()).forEach(() => undefined);
    for (const p of perms) out[key].add(p);
  };
  for (const g of grants ?? []) {
    if (g.validFrom && new Date(g.validFrom) > now) continue;
    if (g.validTo && new Date(g.validTo) < now) continue;
    const base = SYSTEM_ROLES[g.roleId] ?? customRoles[g.roleId] ?? [];
    const denied = new Set(g.deniedPerms ?? []);
    const perms = [...new Set([...base, ...(g.extraPerms ?? [])])].filter((p) => !denied.has(p));
    for (const c of g.campusIds ?? []) add(c, perms);
  }
  // '*' không được rules hiểu là "mọi cơ sở" khi tra theo campusId; mở rộng sẵn ra từng cơ sở đã biết.
  if (out['*']) for (const c of allCampusIds) add(c, [...out['*']]);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].sort()]));
}

export function hasPerm(permsByCampus: PermsByCampus | undefined, perm: string, campusId?: string | null): boolean {
  if (!permsByCampus) return false;
  if (permsByCampus['*']?.includes(perm)) return true;
  if (campusId && permsByCampus[campusId]?.includes(perm)) return true;
  return false;
}

/** Cơ sở mà người dùng có quyền `perm` (['*'] nếu toàn org). */
export function campusesWithPerm(permsByCampus: PermsByCampus | undefined, perm: string): string[] {
  if (!permsByCampus) return [];
  if (permsByCampus['*']?.includes(perm)) return ['*'];
  return Object.keys(permsByCampus).filter((c) => c !== '*' && permsByCampus[c].includes(perm));
}
