import '../controller/session_controller.dart';
import '../models/ui_models/app_role.dart';
import '../values/permissions.dart';

/// UI-side permission checks (DESIGN_SYSTEM §15 `core/permissions`).
///
/// This only decides what to SHOW. The server re-checks org, campus, role and
/// time validity on every request (CONTRACT §1), so never rely on it for
/// security.
///
/// ```dart
/// if (PermissionService.can(Perm.leaveDecide)) ... // active campus
/// ```
class PermissionService {
  PermissionService._();

  /// Pure evaluation (used by [can] and by tests).
  ///
  /// Parents have no staff permissions (they act through `childIds`).
  static bool evaluate({
    required AppRole role,
    required PermsByCampus? permsByCampus,
    required String perm,
    String? campusId,
  }) {
    if (role == AppRole.parent) return false;
    return hasPerm(permsByCampus, perm, campusId);
  }

  /// Does the active context have [perm] in [campusId] (default: active campus)?
  static bool can(String perm, {String? campusId}) {
    final s = SessionController.to;
    final ctx = s.context.value;
    final m = s.membership;
    if (ctx == null || m == null) return false;
    return evaluate(
      role: ctx.role,
      permsByCampus: m.permsByCampus,
      perm: perm,
      campusId: campusId ?? ctx.campusId,
    );
  }

  static bool canAny(Iterable<String> perms, {String? campusId}) =>
      perms.any((p) => can(p, campusId: campusId));

  static bool canAll(Iterable<String> perms, {String? campusId}) =>
      perms.every((p) => can(p, campusId: campusId));
}
