import 'package:app_montessori/controller/session_controller.dart';
import 'package:app_montessori/controller/settings_controller.dart';
import 'package:app_montessori/models/data_models/membership.dart';
import 'package:app_montessori/models/data_models/session_context.dart';
import 'package:app_montessori/models/ui_models/app_role.dart';
import 'package:app_montessori/presentation/common_components/bottom_nav.dart';
import 'package:app_montessori/presentation/screen_debug/catalog_screen.dart';
import 'package:app_montessori/presentation/screen_shell/role_shell.dart';
import 'package:app_montessori/services/connectivity_service.dart';
import 'package:app_montessori/services/storage/pref_store.dart';
import 'package:app_montessori/services/sync/offline_queue.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_utils.dart';

/// Renders the shells and the catalog at narrow widths and large text, to catch
/// overflow/layout exceptions (DESIGN_SYSTEM: test 320-430, text 100-200 %).
void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await PrefStore.init();
    Get.reset();
    Get.put(ConnectivityService());
    Get.put(OfflineQueue());
    Get.put(SettingsController());
    final s = Get.put(SessionController());
    s.setUser(uid: 'u1', name: 'Nguyễn Thùy Linh', email: 'linh@example.com');
    s.memberships.assignAll(const [
      OrgMembership(
        orgId: 'o1',
        orgName: 'Hệ thống Mầm non Hoa Sen',
        kind: 'owner',
        campuses: [
          CampusInfo(id: 'cg', name: 'Trường Mầm non Cầu Giấy'),
          CampusInfo(id: 'tx', name: 'Trường Mầm non Thanh Xuân'),
        ],
        children: [
          ChildRef(id: 'c1', fullName: 'Nguyễn Minh An', className: 'Lớp Mầm 1', campusId: 'cg'),
          ChildRef(id: 'c2', fullName: 'Nguyễn Gia Bình', className: 'Lớp Chồi 2', campusId: 'cg'),
        ],
        childIds: ['c1', 'c2'],
      ),
    ]);
  });

  tearDown(Get.reset);

  Future<void> setSize(WidgetTester t, double w, double scale) async {
    t.view.devicePixelRatio = 2;
    t.view.physicalSize = Size(w * 2, 760 * 2);
    t.platformDispatcher.textScaleFactorTestValue = scale;
    addTearDown(t.view.reset);
    addTearDown(t.platformDispatcher.clearAllTestValues);
  }

  Widget app(Widget home) => GetMaterialApp(
    translations: TestTranslations(),
    locale: const Locale('vi', 'VN'),
    fallbackLocale: const Locale('en', 'US'),
    home: home,
  );

  for (final role in AppRole.values) {
    for (final (w, scale) in [(320.0, 1.0), (320.0, 2.0), (430.0, 1.5)]) {
      testWidgets('${role.code} shell at ${w.round()} x $scale: every tab renders', (t) async {
        await setSize(t, w, scale);
        await SessionController.to.selectContext(
          SessionContext(orgId: 'o1', campusId: 'cg', role: role, childId: 'c1'),
        );
        await t.pumpWidget(app(RoleShell(role: role)));
        await t.pump(const Duration(milliseconds: 400));
        expect(t.takeException(), isNull);
        // Tap every nav cell in turn.
        for (var i = 0; i < 5; i++) {
          final cell = find.descendant(
            of: find.byType(BottomNav),
            matching: find.byType(InkWell),
          );
          expect(cell, findsNWidgets(5));
          await t.tap(cell.at(i), warnIfMissed: false);
          await t.pump(const Duration(milliseconds: 300));
          expect(t.takeException(), isNull, reason: 'tab $i of ${role.code}');
        }
      });
    }
  }

  for (final (w, scale) in [(320.0, 1.0), (320.0, 2.0), (430.0, 1.0)]) {
    testWidgets('catalog at ${w.round()} x $scale has no layout exceptions', (t) async {
      await setSize(t, w, scale);
      await t.pumpWidget(app(const CatalogScreen()));
      await t.pump(const Duration(milliseconds: 400));
      expect(t.takeException(), isNull);
      await t.drag(find.byType(ListView).first, const Offset(0, -1500));
      await t.pump(const Duration(milliseconds: 400));
      expect(t.takeException(), isNull);
    });
  }
}
