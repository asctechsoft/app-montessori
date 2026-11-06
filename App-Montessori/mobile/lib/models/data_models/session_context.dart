import '../ui_models/app_role.dart';

/// The active working scope: organisation + campus + role (+ child for
/// parents). Everything cached or queued is keyed by [scopeKey]
/// (DESIGN_SYSTEM §15 `core/scope`, component-contracts `Scope`).
class SessionContext {
  const SessionContext({
    required this.orgId,
    required this.campusId,
    required this.role,
    this.childId,
  });

  final String orgId;
  final String campusId;
  final AppRole role;
  final String? childId;

  /// `org|campus|role|child` (the user id is added by [scopeKeyFor]).
  String scopeKeyFor(String uid) =>
      '$orgId|$campusId|$uid|${role.code}|${childId ?? '-'}';

  SessionContext copyWith({String? childId, bool clearChild = false}) =>
      SessionContext(
        orgId: orgId,
        campusId: campusId,
        role: role,
        childId: clearChild ? null : (childId ?? this.childId),
      );

  Map<String, dynamic> toMap() => {
    'orgId': orgId,
    'campusId': campusId,
    'role': role.code,
    'childId': childId,
  };

  static SessionContext? fromMap(Map<String, dynamic> m) {
    final role = AppRole.fromCode(m['role']?.toString());
    final org = m['orgId']?.toString();
    final campus = m['campusId']?.toString();
    if (role == null || org == null || campus == null) return null;
    return SessionContext(
      orgId: org,
      campusId: campus,
      role: role,
      childId: m['childId']?.toString(),
    );
  }

  @override
  bool operator ==(Object other) =>
      other is SessionContext &&
      other.orgId == orgId &&
      other.campusId == campusId &&
      other.role == role &&
      other.childId == childId;

  @override
  int get hashCode => Object.hash(orgId, campusId, role, childId);

  @override
  String toString() => 'SessionContext($orgId/$campusId/${role.code}/$childId)';
}
