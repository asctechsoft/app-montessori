import 'package:app_montessori/controller/session_controller.dart';
import 'package:app_montessori/controller/settings_controller.dart';
import 'package:app_montessori/controller/teacher_class_controller.dart';
import 'package:app_montessori/controller/teacher_common.dart';
import 'package:app_montessori/controller/teacher_time_controller.dart';
import 'package:app_montessori/models/data_models/membership.dart';
import 'package:app_montessori/models/data_models/session_context.dart';
import 'package:app_montessori/models/data_models/teacher_models.dart';
import 'package:app_montessori/models/ui_models/app_role.dart';
import 'package:app_montessori/presentation/common_components/app_button.dart';
import 'package:app_montessori/presentation/screens_teacher/teacher_class_tab.dart';
import 'package:app_montessori/presentation/screens_teacher/teacher_pickup_screen.dart';
import 'package:app_montessori/presentation/screens_teacher/teacher_time_tab.dart';
import 'package:app_montessori/repository/firestore_repository.dart';
import 'package:app_montessori/repository/teacher_repository.dart';
import 'package:app_montessori/services/connectivity_service.dart';
import 'package:app_montessori/services/network/app_exception.dart';
import 'package:app_montessori/services/storage/pref_store.dart';
import 'package:app_montessori/services/sync/offline_queue.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_utils.dart';

DataSnapshot<T> _snap<T>(List<T> l) => DataSnapshot<T>(l, receivedAt: DateTime(2026, 1, 1));

/// Repository double: no Firestore, no network. Test data only lives here.
class FakeTeacherRepo extends TeacherRepository {
  FakeTeacherRepo({
    this.handover = 'received',
    this.auths = const [],
    this.punchList = const [],
  });

  String handover;
  List<PickupAuth> auths;
  List<PunchRec> punchList;
  int pickupCalls = 0;
  int receiveCalls = 0;
  AppException? receiveError;

  @override
  Future<DataSnapshot<TeacherClass>> classes() async => _snap([const TeacherClass(id: 'k1', name: 'Lớp Mầm 1')]);

  @override
  Future<DataSnapshot<TeacherChild>> children(String classId) async =>
      _snap([TeacherChild(id: 'c1', fullName: 'Nguyễn Minh An', code: 'MN001', classId: 'k1')]);

  @override
  Future<ChildHealth?> health(String childId) async => const ChildHealth(allergies: ['đậu phộng']);

  @override
  Future<DataSnapshot<AttendanceRec>> attendance(String classId, String dayKey) async => _snap([
    if (handover != 'not_received')
      const AttendanceRec(id: 'a1', childId: 'c1', status: 'present'),
  ]);

  @override
  Future<DataSnapshot<HandoverRec>> handovers(String classId, String dayKey) async =>
      _snap([HandoverRec(id: 'h1', childId: 'c1', state: handover, droppedBy: 'Mẹ')]);

  @override
  Future<DataSnapshot<LeaveReq>> leaves() async => _snap(<LeaveReq>[]);

  @override
  Future<DataSnapshot<PickupAuth>> pickupAuths(String childId) async => _snap(auths);

  @override
  Future<Map<String, dynamic>> receive(Map<String, dynamic> payload, String opId) async {
    receiveCalls++;
    if (receiveError != null) throw receiveError!;
    return {};
  }

  @override
  Future<Map<String, dynamic>> pickup({
    required String childId,
    required String dayKey,
    required String pickupPersonId,
    required String method,
    String? note,
    required String opId,
  }) async {
    pickupCalls++;
    handover = 'picked_up';
    return {};
  }

  @override
  Future<DataSnapshot<PunchRec>> punches(String fromDay, String toDay) async => _snap(punchList);

  @override
  Future<DataSnapshot<RosterEntry>> roster(String fromDay, String toDay) async => _snap(<RosterEntry>[]);

  @override
  Future<DataSnapshot<PunchAdjust>> punchAdjustments() async => _snap(<PunchAdjust>[]);

  @override
  Future<DataSnapshot<StaffLeaveRec>> staffLeaves() async => _snap(<StaffLeaveRec>[]);

  @override
  Future<DataSnapshot<ShiftSwapRec>> shiftSwaps() async => _snap(<ShiftSwapRec>[]);

  @override
  Future<DataSnapshot<ShiftSwapRec>> swapsForMe() async => _snap(<ShiftSwapRec>[]);

  @override
  Future<DataSnapshot<Payslip>> payslips() async => _snap(<Payslip>[]);

  @override
  Future<Map<String, dynamic>> punch({required Map<String, dynamic> payload, required String opId}) async =>
      {'result': 'ok'};
}

Widget _app(Widget home) => GetMaterialApp(
  translations: TestTranslations(),
  locale: const Locale('vi', 'VN'),
  fallbackLocale: const Locale('en', 'US'),
  home: home,
);

Future<void> _size(WidgetTester t, double w, double scale) async {
  t.view.devicePixelRatio = 2;
  t.view.physicalSize = Size(w * 2, 900 * 2);
  t.platformDispatcher.textScaleFactorTestValue = scale;
  addTearDown(t.view.reset);
  addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
}

PickupAuth _auth(String status, {String? validTo}) => PickupAuth(
  id: 'pa1',
  childId: 'c1',
  personName: 'Nguyễn Thùy Linh',
  relation: 'Mẹ',
  phone: '0912346688',
  status: status,
  validTo: validTo ?? '2999-12-31',
);

AppButton _button(WidgetTester t, String label) =>
    t.widget<AppButton>(find.widgetWithText(AppButton, label).first);

void main() {
  late FakeTeacherRepo repo;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await PrefStore.init();
    Get.reset();
    Get.put(ConnectivityService());
    final q = Get.put(OfflineQueue(sender: (_) async {}));
    await q.bindUser('u1');
    Get.put(SettingsController());
    final s = Get.put(SessionController());
    s.setUser(uid: 'u1', name: 'Cô Lan', email: 'lan@example.com');
    s.memberships.assignAll(const [
      OrgMembership(
        orgId: 'o1',
        orgName: 'Hệ thống Mầm non Hoa Sen',
        kind: 'staff',
        employeeId: 'e1',
        grants: [
          Grant(id: 'g1', roleId: 'teacher', campusIds: ['cg'], classIds: ['k1']),
        ],
        permsByCampus: {
          'cg': [
            'handover.write',
            'attendance.write',
            'attendance.read',
            'leave.decide',
            'children.health.read',
            'care.write',
            'medication.read',
            'medication.write',
          ],
        },
        campuses: [CampusInfo(id: 'cg', name: 'Trường Mầm non Cầu Giấy')],
      ),
    ]);
    await s.selectContext(const SessionContext(orgId: 'o1', campusId: 'cg', role: AppRole.teacher));
    repo = FakeTeacherRepo();
    Get.put<TeacherRepository>(repo);
  });

  tearDown(Get.reset);

  Future<TeacherClassController> loadClass() async {
    final c = Get.put(TeacherClassController(repo: repo));
    await c.load();
    return c;
  }

  group('pick-up', () {
    testWidgets('blocked and disabled when the child was not received', (t) async {
      await _size(t, 390, 1.0);
      repo.handover = 'not_received';
      repo.auths = [_auth('approved')];
      await loadClass();
      await t.pumpWidget(_app(const TeacherPickupScreen(childId: 'c1')));
      await t.pump(const Duration(milliseconds: 400));
      expect(find.textContaining('chưa được nhận'), findsWidgets);
      expect(_button(t, 'Xác nhận trả trẻ').onPressed, isNull);
      expect(repo.pickupCalls, 0);
    });

    testWidgets('a revoked authorization cannot be chosen and shows why', (t) async {
      await _size(t, 390, 1.0);
      repo.auths = [_auth('revoked')];
      await loadClass();
      await t.pumpWidget(_app(const TeacherPickupScreen(childId: 'c1')));
      await t.pump(const Duration(milliseconds: 400));
      expect(find.textContaining('thu hồi'), findsWidgets);
      await t.tap(find.text('Nguyễn Thùy Linh'), warnIfMissed: false);
      await t.pump(const Duration(milliseconds: 400));
      expect(_button(t, 'Xác nhận trả trẻ').onPressed, isNull);
    });

    testWidgets('an expired authorization is blocked', (t) async {
      await _size(t, 390, 1.0);
      repo.auths = [_auth('approved', validTo: '2020-01-01')];
      await loadClass();
      await t.pumpWidget(_app(const TeacherPickupScreen(childId: 'c1')));
      await t.pump(const Duration(milliseconds: 400));
      expect(find.textContaining('hết hạn'), findsWidgets);
      expect(_button(t, 'Xác nhận trả trẻ').onPressed, isNull);
    });

    testWidgets('valid person + checklist -> confirm dialog names child, person and time', (t) async {
      await _size(t, 390, 1.0);
      repo.auths = [_auth('approved')];
      await loadClass();
      await t.pumpWidget(_app(const TeacherPickupScreen(childId: 'c1')));
      await t.pump(const Duration(milliseconds: 400));
      expect(_button(t, 'Xác nhận trả trẻ').onPressed, isNull); // nothing chosen yet
      await t.tap(find.text('Nguyễn Thùy Linh'));
      await t.pump(const Duration(milliseconds: 400));
      await t.scrollUntilVisible(find.textContaining('Tôi đã đối chiếu'), 200, scrollable: find.byType(Scrollable).first);
      await t.drag(find.byType(Scrollable).first, const Offset(0, -250));
      await t.pump(const Duration(milliseconds: 300));
      await t.tap(find.textContaining('Tôi đã đối chiếu'));
      await t.pump(const Duration(milliseconds: 400));
      expect(_button(t, 'Xác nhận trả trẻ').onPressed, isNotNull);
      await t.tap(find.widgetWithText(AppButton, 'Xác nhận trả trẻ'));
      await t.pump(const Duration(milliseconds: 400));
      expect(find.textContaining('Xác nhận trả Nguyễn Minh An cho Nguyễn Thùy Linh lúc'), findsOneWidget);
      expect(repo.pickupCalls, 0); // nothing sent before the dialog is confirmed
    });

    testWidgets('pick-up is never queued offline', (t) async {
      expect(OfflineQueue.isAllowed('handover.pickup'), isFalse);
      expect(
        () => OfflineQueue.to.enqueue(action: 'handover.pickup', orgId: 'o1', campusId: 'cg', payload: {}),
        throwsA(isA<QueueNotAllowedException>()),
      );
    });

    testWidgets('offline: the confirm button stays disabled with a reason', (t) async {
      await _size(t, 390, 1.0);
      repo.auths = [_auth('approved')];
      ConnectivityService.to.isOnline.value = false;
      await loadClass();
      await t.pumpWidget(_app(const TeacherPickupScreen(childId: 'c1')));
      await t.pump(const Duration(milliseconds: 400));
      await t.tap(find.text('Nguyễn Thùy Linh'));
      await t.pump(const Duration(milliseconds: 400));
      await t.scrollUntilVisible(find.textContaining('Tôi đã đối chiếu'), 200, scrollable: find.byType(Scrollable).first);
      await t.drag(find.byType(Scrollable).first, const Offset(0, -250));
      await t.pump(const Duration(milliseconds: 300));
      await t.tap(find.textContaining('Tôi đã đối chiếu'));
      await t.pump(const Duration(milliseconds: 400));
      expect(_button(t, 'Xác nhận trả trẻ').onPressed, isNull);
      expect(find.textContaining('cần có mạng'), findsWidgets);
    });
  });

  group('drop-off offline', () {
    test('network failure queues with the same opId and device time', () async {
      repo.receiveError = const AppException(AppException.network, '');
      final c = await loadClass();
      final child = c.childById('c1')!;
      final out = await c.receive(child: child, droppedBy: 'Mẹ', opId: 'op-1');
      expect(out, SubmitOutcome.queued);
      final op = OfflineQueue.to.find('op-1')!;
      expect(op.action, 'handover.receive');
      expect(op.payload['droppedBy'], 'Mẹ');
      expect(c.queuedDeviceTime('c1', 'handover.receive'), isNotNull);
    });

    test('a business error is rethrown and nothing is queued', () async {
      repo.receiveError = const AppException(AppException.invalidState, 'Trẻ không đang học');
      final c = await loadClass();
      await expectLater(
        c.receive(child: c.childById('c1')!, droppedBy: 'Mẹ'),
        throwsA(isA<AppException>()),
      );
      expect(OfflineQueue.to.unsyncedCount, 0);
    });
  });

  group('clock', () {
    PunchRec punchIn() => PunchRec(
      id: 'p1',
      kind: 'in',
      effectiveTime: DateTime.now(),
      dayKey: teacherClock().dayKey(),
    );

    Future<void> pumpTab(WidgetTester t) async {
      Get.put(TeacherTimeController(
        repo: repo,
        location: () async => const LocationReading(LocationStatus.ok, LocationFix(21.0, 105.8, 12)),
      ));
      await t.pumpWidget(_app(const TeacherTimeTab()));
      await t.pump(const Duration(milliseconds: 400));
    }

    testWidgets('no punch yet: the only action is Chấm vào', (t) async {
      await _size(t, 390, 1.0);
      await pumpTab(t);
      expect(find.widgetWithText(AppButton, 'Chấm vào'), findsOneWidget);
      expect(find.widgetWithText(AppButton, 'Chấm ra'), findsNothing);
    });

    testWidgets('already clocked in: Chấm ra is the action, Chấm vào is not offered', (t) async {
      await _size(t, 390, 1.0);
      repo.punchList = [punchIn()];
      await pumpTab(t);
      expect(find.widgetWithText(AppButton, 'Chấm ra'), findsOneWidget);
      expect(find.widgetWithText(AppButton, 'Chấm vào'), findsNothing);
    });

    testWidgets('timesheet shows "chưa đủ dữ liệu" when the out punch is missing', (t) async {
      await _size(t, 390, 1.0);
      repo.punchList = [punchIn()];
      await pumpTab(t);
      await t.tap(find.text('Công cá nhân và đơn'));
      await t.pump(const Duration(milliseconds: 400));
      expect(find.text('Chưa đủ dữ liệu'), findsOneWidget);
      expect(find.text('Đủ lượt vào/ra'), findsNothing);
    });

    testWidgets('renders at 320 wide and 200% text without overflow', (t) async {
      await _size(t, 320, 2.0);
      repo.punchList = [punchIn()];
      await pumpTab(t);
      expect(t.takeException(), isNull);
      await t.tap(find.text('Công cá nhân và đơn'));
      await t.pump(const Duration(milliseconds: 400));
      expect(t.takeException(), isNull);
    });

    test('offline punch is queued with device time, never reported as done', () async {
      ConnectivityService.to.isOnline.value = false;
      final c = TeacherTimeController(
        repo: repo,
        location: () async => const LocationReading(LocationStatus.ok, LocationFix(21.0, 105.8, 12)),
      );
      Get.put(c);
      await c.load();
      await c.refreshLocation();
      final o = await c.punch();
      expect(o.queued, isTrue);
      expect(o.kind, 'in');
      expect(OfflineQueue.to.items.single.action, 'punch.record');
      // The queued "in" now makes "out" the next step.
      expect(c.nextKind, 'out');
      expect(c.history.single.pending, isTrue);
    });
  });

  group('class tab', () {
    testWidgets('lists children with health alert and status; 320 x 200%', (t) async {
      await _size(t, 320, 2.0);
      repo.handover = 'received';
      await loadClass();
      await t.pumpWidget(_app(const TeacherClassTab()));
      await t.pump(const Duration(milliseconds: 400));
      await t.scrollUntilVisible(find.text('Nguyễn Minh An'), 200, scrollable: find.byType(Scrollable).first);
      expect(find.text('Nguyễn Minh An'), findsWidgets);
      expect(t.takeException(), isNull);
    });
  });
}
