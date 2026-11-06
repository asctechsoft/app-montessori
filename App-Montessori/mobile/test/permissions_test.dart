import 'dart:io';

import 'package:app_montessori/models/data_models/membership.dart';
import 'package:app_montessori/models/ui_models/app_role.dart';
import 'package:app_montessori/services/permission_service.dart';
import 'package:app_montessori/values/permissions.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final perms = <String, List<String>>{
    'cg': [Perm.attendanceRead, Perm.handoverWrite],
    '*': [Perm.campusRead],
  };

  test('hasPerm follows the backend rules (campus key and wildcard)', () {
    expect(hasPerm(perms, Perm.handoverWrite, 'cg'), isTrue);
    expect(hasPerm(perms, Perm.handoverWrite, 'tx'), isFalse);
    expect(hasPerm(perms, Perm.handoverWrite), isFalse);
    expect(hasPerm(perms, Perm.campusRead, 'tx'), isTrue); // '*' = whole org
    expect(hasPerm(null, Perm.campusRead, 'cg'), isFalse);
    expect(hasPerm(const {}, Perm.campusRead, 'cg'), isFalse);
  });

  test('campusesWithPerm', () {
    expect(campusesWithPerm(perms, Perm.handoverWrite), ['cg']);
    expect(campusesWithPerm(perms, Perm.campusRead), ['*']);
    expect(campusesWithPerm(perms, Perm.payrollRead), isEmpty);
  });

  test('PermissionService.evaluate: parents never get staff permissions', () {
    expect(
      PermissionService.evaluate(
        role: AppRole.parent,
        permsByCampus: {'*': Perm.all},
        perm: Perm.attendanceRead,
        campusId: 'cg',
      ),
      isFalse,
    );
    expect(
      PermissionService.evaluate(
        role: AppRole.teacher,
        permsByCampus: perms,
        perm: Perm.handoverWrite,
        campusId: 'cg',
      ),
      isTrue,
    );
    expect(
      PermissionService.evaluate(
        role: AppRole.teacher,
        permsByCampus: perms,
        perm: Perm.handoverWrite,
        campusId: 'tx',
      ),
      isFalse,
    );
  });

  test('Perm.all has no duplicates', () {
    expect(Perm.all.toSet().length, Perm.all.length);
  });

  test('Perm.all matches backend permissions.ts (when the file is present)', () {
    final f = File('../backend/functions/src/core/permissions.ts');
    if (!f.existsSync()) return;
    final src = f.readAsStringSync();
    final block = RegExp(
      r'ALL_PERMISSIONS = \[(.*?)\] as const',
      dotAll: true,
    ).firstMatch(src)!.group(1)!;
    final backend = RegExp(
      r"'([a-z_.]+)'",
    ).allMatches(block).map((m) => m.group(1)!).toSet();
    expect(Perm.all.toSet(), backend);
  });

  group('role derivation from grants', () {
    final now = DateTime(2026, 10, 16);
    OrgMembership staff(List<Grant> grants, {String kind = 'staff'}) =>
        OrgMembership(
          orgId: 'o1',
          orgName: 'Hoa Sen',
          kind: kind,
          grants: grants,
          campuses: const [
            CampusInfo(id: 'cg', name: 'Cầu Giấy'),
            CampusInfo(id: 'tx', name: 'Thanh Xuân'),
          ],
        );

    test('teacher grant on one campus', () {
      final m = staff([
        const Grant(id: 'g', roleId: RoleId.teacher, campusIds: ['cg']),
      ]);
      expect(m.rolesAt(now), {AppRole.teacher});
      expect(m.campusesFor(AppRole.teacher, now).map((c) => c.id), ['cg']);
    });

    test('principal on * sees every campus; expired grant gives nothing', () {
      final m = staff([
        const Grant(id: 'g', roleId: RoleId.principal, campusIds: ['*']),
      ]);
      expect(m.rolesAt(now), {AppRole.principal});
      expect(m.campusesFor(AppRole.principal, now), hasLength(2));
      final expired = staff([
        Grant(
          id: 'g',
          roleId: RoleId.teacher,
          campusIds: const ['cg'],
          validTo: DateTime(2026, 1, 1),
        ),
      ]);
      expect(expired.rolesAt(now), isEmpty);
    });

    test('parent member gets the parent role; suspended member nothing', () {
      const parent = OrgMembership(orgId: 'o1', orgName: 'x', kind: 'parent');
      expect(parent.rolesAt(now), {AppRole.parent});
      const suspended = OrgMembership(
        orgId: 'o1',
        orgName: 'x',
        kind: 'parent',
        status: 'suspended',
      );
      expect(suspended.rolesAt(now), isEmpty);
    });

    test('parses a tolerant org.listMine item', () {
      final m = OrgMembership.fromMap({
        'orgId': 'o1',
        'name': 'Hoa Sen',
        'member': {
          'kind': 'parent',
          'status': 'active',
          'childIds': ['c1'],
        },
        'campuses': [
          {'campusId': 'cg', 'name': 'Cầu Giấy'},
        ],
        'children': [
          {
            'childId': 'c1',
            'fullName': 'Nguyễn Minh An',
            'campusId': 'cg',
            'className': 'Lớp Mầm 1',
          },
        ],
      });
      expect(m.orgName, 'Hoa Sen');
      expect(m.kind, 'parent');
      expect(m.children.single.fullName, 'Nguyễn Minh An');
      expect(m.campusesFor(AppRole.parent, now).single.id, 'cg');
    });
  });
}
