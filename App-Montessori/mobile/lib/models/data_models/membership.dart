import '../../values/permissions.dart';
import '../ui_models/app_role.dart';

Map<String, dynamic> _asMap(Object? v) {
  if (v is Map) return v.map((k, val) => MapEntry(k.toString(), val));
  return <String, dynamic>{};
}

List<String> _strings(Object? v) =>
    v is List ? v.map((e) => e.toString()).toList() : <String>[];

/// `orgs/{orgId}/campuses/{campusId}` (the fields the app needs).
class CampusInfo {
  const CampusInfo({
    required this.id,
    required this.name,
    this.code = '',
    this.timezone = 'Asia/Ho_Chi_Minh',
    this.status = 'active',
  });

  final String id;
  final String name;
  final String code;
  final String timezone;
  final String status;

  factory CampusInfo.fromMap(Map<String, dynamic> m) => CampusInfo(
    id: (m['campusId'] ?? m['id'] ?? '').toString(),
    name: (m['name'] ?? '').toString(),
    code: (m['code'] ?? '').toString(),
    timezone: (m['timezone'] ?? 'Asia/Ho_Chi_Minh').toString(),
    status: (m['status'] ?? 'active').toString(),
  );

  Map<String, dynamic> toMap() => {
    'id': id,
    'name': name,
    'code': code,
    'timezone': timezone,
    'status': status,
  };
}

/// A child linked to a parent member (name only here; detail data comes from
/// Firestore reads under the parent's rules).
class ChildRef {
  const ChildRef({
    required this.id,
    required this.fullName,
    this.classId,
    this.className,
    this.campusId,
  });

  final String id;
  final String fullName;
  final String? classId;
  final String? className;
  final String? campusId;

  factory ChildRef.fromMap(Map<String, dynamic> m) => ChildRef(
    id: (m['childId'] ?? m['id'] ?? '').toString(),
    fullName: (m['fullName'] ?? m['name'] ?? '').toString(),
    classId: m['classId']?.toString(),
    className: m['className']?.toString(),
    campusId: m['campusId']?.toString(),
  );

  Map<String, dynamic> toMap() => {
    'id': id,
    'fullName': fullName,
    'classId': classId,
    'className': className,
    'campusId': campusId,
  };
}

/// CONTRACT §3 `Grant`.
class Grant {
  const Grant({
    required this.id,
    required this.roleId,
    this.campusIds = const [],
    this.classIds = const [],
    this.validFrom,
    this.validTo,
    this.extraPerms = const [],
    this.deniedPerms = const [],
  });

  final String id;
  final String roleId;
  final List<String> campusIds;
  final List<String> classIds;
  final DateTime? validFrom;
  final DateTime? validTo;
  final List<String> extraPerms;
  final List<String> deniedPerms;

  factory Grant.fromMap(Map<String, dynamic> m) => Grant(
    id: (m['id'] ?? '').toString(),
    roleId: (m['roleId'] ?? '').toString(),
    campusIds: _strings(m['campusIds']),
    classIds: _strings(m['classIds']),
    validFrom: DateTime.tryParse((m['validFrom'] ?? '').toString()),
    validTo: DateTime.tryParse((m['validTo'] ?? '').toString()),
    extraPerms: _strings(m['extraPerms']),
    deniedPerms: _strings(m['deniedPerms']),
  );

  Map<String, dynamic> toMap() => {
    'id': id,
    'roleId': roleId,
    'campusIds': campusIds,
    'classIds': classIds,
    'validFrom': validFrom?.toIso8601String(),
    'validTo': validTo?.toIso8601String(),
    'extraPerms': extraPerms,
    'deniedPerms': deniedPerms,
  };

  bool isActiveAt(DateTime now) {
    if (validFrom != null && validFrom!.isAfter(now)) return false;
    if (validTo != null && validTo!.isBefore(now)) return false;
    return true;
  }

  /// Which app shell this grant opens. `owner`/`principal` and the back-office
  /// roles (hr, accountant, tech_admin) use the management shell; classroom
  /// and service roles (teacher, nurse, kitchen, transport) use the staff shell.
  AppRole? get appRole => membershipRoleFor(roleId);
}

/// Maps a system `roleId` to the app shell (see [Grant.appRole]).
AppRole? membershipRoleFor(String roleId) {
  switch (roleId) {
    case RoleId.owner:
    case RoleId.principal:
    case RoleId.hr:
    case RoleId.accountant:
    case RoleId.techAdmin:
      return AppRole.principal;
    case RoleId.teacher:
    case RoleId.nurse:
    case RoleId.kitchen:
    case RoleId.transport:
      return AppRole.teacher;
    case RoleId.parent:
      return AppRole.parent;
    default:
      return null;
  }
}

/// The signed-in user's membership of one organisation (`org.listMine` item +
/// `orgs/{orgId}/members/{uid}`). Parsing is tolerant: see CONTRACT_CHANGES.md
/// for the response shape the app assumes.
class OrgMembership {
  const OrgMembership({
    required this.orgId,
    required this.orgName,
    required this.kind,
    this.status = 'active',
    this.timezone = 'Asia/Ho_Chi_Minh',
    this.grants = const [],
    this.childIds = const [],
    this.permsByCampus = const {},
    this.campuses = const [],
    this.children = const [],
    this.employeeId,
  });

  final String orgId;
  final String orgName;

  /// `owner` | `staff` | `parent`
  final String kind;
  final String status;
  final String timezone;
  final List<Grant> grants;
  final List<String> childIds;
  final PermsByCampus permsByCampus;
  final List<CampusInfo> campuses;
  final List<ChildRef> children;
  final String? employeeId;

  bool get isActive => status == 'active';

  factory OrgMembership.fromMap(Map<String, dynamic> raw) {
    final member = _asMap(raw['member']);
    final src = member.isEmpty ? raw : {...raw, ...member};
    final perms = <String, List<String>>{};
    _asMap(src['permsByCampus']).forEach((k, v) => perms[k] = _strings(v));
    final childrenRaw = src['children'];
    final childIds = _strings(src['childIds']);
    final children = childrenRaw is List
        ? childrenRaw.map((e) => ChildRef.fromMap(_asMap(e))).toList()
        : <ChildRef>[];
    return OrgMembership(
      orgId: (raw['orgId'] ?? raw['id'] ?? '').toString(),
      orgName: (raw['orgName'] ?? raw['name'] ?? '').toString(),
      kind: (src['kind'] ?? 'staff').toString(),
      status: (src['status'] ?? 'active').toString(),
      timezone: (raw['timezone'] ?? 'Asia/Ho_Chi_Minh').toString(),
      grants: src['grants'] is List
          ? (src['grants'] as List).map((e) => Grant.fromMap(_asMap(e))).toList()
          : const [],
      childIds: childIds.isNotEmpty
          ? childIds
          : children.map((c) => c.id).toList(),
      permsByCampus: perms,
      campuses: raw['campuses'] is List
          ? (raw['campuses'] as List)
                .map((e) => CampusInfo.fromMap(_asMap(e)))
                .toList()
          : const [],
      children: children,
      employeeId: src['employeeId']?.toString(),
    );
  }

  Map<String, dynamic> toMap() => {
    'orgId': orgId,
    'orgName': orgName,
    'kind': kind,
    'status': status,
    'timezone': timezone,
    'grants': grants.map((g) => g.toMap()).toList(),
    'childIds': childIds,
    'permsByCampus': permsByCampus,
    'campuses': campuses.map((c) => c.toMap()).toList(),
    'children': children.map((c) => c.toMap()).toList(),
    'employeeId': employeeId,
  };

  /// App shells this membership may open (only while the member is active).
  Set<AppRole> rolesAt(DateTime now) {
    if (!isActive) return {};
    final out = <AppRole>{};
    if (kind == 'parent') {
      out.add(AppRole.parent);
    }
    if (kind == 'owner') out.add(AppRole.principal);
    for (final g in grants) {
      if (!g.isActiveAt(now)) continue;
      final r = g.appRole;
      if (r != null && r != AppRole.parent) out.add(r);
    }
    // Staff without readable grants but with server-computed perms.
    if (out.isEmpty && kind != 'parent' && permsByCampus.isNotEmpty) {
      out.add(AppRole.teacher);
    }
    return out;
  }

  /// Campuses usable for [role], restricted to what the member may see.
  List<CampusInfo> campusesFor(AppRole role, DateTime now) {
    if (campuses.isEmpty) return const [];
    if (role == AppRole.parent) {
      final ids = children.map((c) => c.campusId).whereType<String>().toSet();
      if (ids.isEmpty) return campuses;
      return campuses.where((c) => ids.contains(c.id)).toList();
    }
    final ids = <String>{};
    var all = kind == 'owner';
    for (final g in grants) {
      if (!g.isActiveAt(now) || g.appRole != role) continue;
      if (g.campusIds.contains('*')) {
        all = true;
      } else {
        ids.addAll(g.campusIds);
      }
    }
    if (ids.isEmpty && !all) {
      // Fall back to the server-computed permission keys.
      if (permsByCampus.containsKey('*')) {
        all = true;
      } else {
        ids.addAll(permsByCampus.keys);
      }
    }
    if (all) return campuses;
    return campuses.where((c) => ids.contains(c.id)).toList();
  }

  /// Children visible for a parent in [campusId] (all when null).
  List<ChildRef> childrenIn(String? campusId) => campusId == null
      ? children
      : children
            .where((c) => c.campusId == null || c.campusId == campusId)
            .toList();

  /// Class ids the teacher is limited to in [campusId] (empty = by assignment).
  List<String> classIdsFor(String campusId, DateTime now) {
    final out = <String>{};
    for (final g in grants) {
      if (!g.isActiveAt(now)) continue;
      if (g.campusIds.contains('*') || g.campusIds.contains(campusId)) {
        out.addAll(g.classIds);
      }
    }
    return out.toList();
  }
}
