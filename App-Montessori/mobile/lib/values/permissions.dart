/// Dart copy of `backend/functions/src/core/permissions.ts` (docs/CONTRACT.md §3).
/// Source of truth is the backend; the server re-checks every request, this is
/// only used to hide UI the user cannot use. Keep in sync when the contract changes.
class Perm {
  Perm._();

  static const String orgManage = 'org.manage';
  static const String campusRead = 'campus.read';
  static const String campusManage = 'campus.manage';
  static const String membersRead = 'members.read';
  static const String membersManage = 'members.manage';
  static const String rolesManage = 'roles.manage';
  static const String leadsRead = 'leads.read';
  static const String leadsWrite = 'leads.write';
  static const String childrenRead = 'children.read';
  static const String childrenWrite = 'children.write';
  static const String childrenHealthRead = 'children.health.read';
  static const String childrenTransfer = 'children.transfer';
  static const String classesRead = 'classes.read';
  static const String classesWrite = 'classes.write';
  static const String attendanceRead = 'attendance.read';
  static const String attendanceWrite = 'attendance.write';
  static const String handoverWrite = 'handover.write';
  static const String leaveDecide = 'leave.decide';
  static const String careRead = 'care.read';
  static const String careWrite = 'care.write';
  static const String carePublish = 'care.publish';
  static const String medicationRead = 'medication.read';
  static const String medicationWrite = 'medication.write';
  static const String incidentRead = 'incident.read';
  static const String incidentWrite = 'incident.write';
  static const String staffRead = 'staff.read';
  static const String staffWrite = 'staff.write';
  static const String rosterWrite = 'roster.write';
  static const String timekeepingRead = 'timekeeping.read';
  static const String timekeepingApprove = 'timekeeping.approve';
  static const String timekeepingLock = 'timekeeping.lock';
  static const String timekeepingReopen = 'timekeeping.reopen';
  static const String leaveStaffDecide = 'leave_staff.decide';
  static const String payrollRead = 'payroll.read';
  static const String payrollWrite = 'payroll.write';
  static const String payrollApprove = 'payroll.approve';
  static const String feesRead = 'fees.read';
  static const String feesWrite = 'fees.write';
  static const String billingWrite = 'billing.write';
  static const String billingApprove = 'billing.approve';
  static const String paymentsRead = 'payments.read';
  static const String paymentsWrite = 'payments.write';
  static const String paymentsReconcile = 'payments.reconcile';
  static const String refundsApprove = 'refunds.approve';
  static const String expensesRead = 'expenses.read';
  static const String expensesWrite = 'expenses.write';
  static const String expensesApprove = 'expenses.approve';
  static const String kitchenRead = 'kitchen.read';
  static const String kitchenWrite = 'kitchen.write';
  static const String stockRead = 'stock.read';
  static const String stockWrite = 'stock.write';
  static const String assetsRead = 'assets.read';
  static const String assetsWrite = 'assets.write';
  static const String transportRead = 'transport.read';
  static const String transportWrite = 'transport.write';
  static const String notifyRead = 'notify.read';
  static const String notifySend = 'notify.send';
  static const String notifyApprove = 'notify.approve';
  static const String inboxHandle = 'inbox.handle';
  static const String reportsRead = 'reports.read';
  static const String reportsExport = 'reports.export';
  static const String auditRead = 'audit.read';
  static const String importWrite = 'import.write';
  static const String backupManage = 'backup.manage';
  static const String approvalsRead = 'approvals.read';

  static const List<String> all = [
    orgManage, campusRead, campusManage, membersRead, membersManage, rolesManage,
    leadsRead, leadsWrite,
    childrenRead, childrenWrite, childrenHealthRead, childrenTransfer,
    classesRead, classesWrite,
    attendanceRead, attendanceWrite, handoverWrite, leaveDecide,
    careRead, careWrite, carePublish,
    medicationRead, medicationWrite, incidentRead, incidentWrite,
    staffRead, staffWrite, rosterWrite,
    timekeepingRead, timekeepingApprove, timekeepingLock, timekeepingReopen,
    leaveStaffDecide,
    payrollRead, payrollWrite, payrollApprove,
    feesRead, feesWrite, billingWrite, billingApprove,
    paymentsRead, paymentsWrite, paymentsReconcile, refundsApprove,
    expensesRead, expensesWrite, expensesApprove,
    kitchenRead, kitchenWrite, stockRead, stockWrite,
    assetsRead, assetsWrite, transportRead, transportWrite,
    notifyRead, notifySend, notifyApprove, inboxHandle,
    reportsRead, reportsExport, auditRead, importWrite, backupManage,
    approvalsRead,
  ];
}

/// System role ids (CONTRACT §3).
class RoleId {
  RoleId._();

  static const String owner = 'owner';
  static const String principal = 'principal';
  static const String teacher = 'teacher';
  static const String hr = 'hr';
  static const String accountant = 'accountant';
  static const String nurse = 'nurse';
  static const String kitchen = 'kitchen';
  static const String transport = 'transport';
  static const String techAdmin = 'tech_admin';
  static const String parent = 'parent';
}

/// Permissions per campus, as computed by the server (`members/{uid}.permsByCampus`).
/// Key `'*'` = whole organisation.
typedef PermsByCampus = Map<String, List<String>>;

/// Same logic as the backend `hasPerm`.
bool hasPerm(PermsByCampus? permsByCampus, String perm, [String? campusId]) {
  if (permsByCampus == null) return false;
  if (permsByCampus['*']?.contains(perm) ?? false) return true;
  if (campusId != null && (permsByCampus[campusId]?.contains(perm) ?? false)) {
    return true;
  }
  return false;
}

/// Campuses where the user has [perm]: `['*']` if organisation-wide.
List<String> campusesWithPerm(PermsByCampus? permsByCampus, String perm) {
  if (permsByCampus == null) return const [];
  if (permsByCampus['*']?.contains(perm) ?? false) return const ['*'];
  return permsByCampus.entries
      .where((e) => e.key != '*' && e.value.contains(perm))
      .map((e) => e.key)
      .toList();
}
