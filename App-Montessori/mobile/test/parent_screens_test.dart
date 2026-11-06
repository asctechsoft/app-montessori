import 'package:app_montessori/controller/parent_care_controller.dart';
import 'package:app_montessori/controller/parent_pickup_controller.dart';
import 'package:app_montessori/controller/parent_tuition_controller.dart';
import 'package:app_montessori/controller/session_controller.dart';
import 'package:app_montessori/controller/settings_controller.dart';
import 'package:app_montessori/models/data_models/membership.dart';
import 'package:app_montessori/models/data_models/parent_models.dart';
import 'package:app_montessori/models/data_models/session_context.dart';
import 'package:app_montessori/models/ui_models/app_role.dart';
import 'package:app_montessori/presentation/screens_parent/parent_care_screens.dart';
import 'package:app_montessori/presentation/screens_parent/parent_home_screen.dart';
import 'package:app_montessori/presentation/screens_parent/parent_pickup_screens.dart';
import 'package:app_montessori/presentation/screens_parent/parent_tuition_screen.dart';
import 'package:app_montessori/repository/firestore_repository.dart';
import 'package:app_montessori/repository/parent_repository.dart';
import 'package:app_montessori/services/connectivity_service.dart';
import 'package:app_montessori/services/network/app_exception.dart';
import 'package:app_montessori/services/storage/pref_store.dart';
import 'package:app_montessori/services/sync/offline_queue.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_utils.dart';

DataSnapshot<T> _snap<T>(List<T> items, {bool cache = false}) =>
    DataSnapshot<T>(items, fromCache: cache, receivedAt: DateTime(2026, 11, 5));

/// Repository double: no Firebase, results set per test.
class FakeParentRepo extends ParentRepository {
  List<HandoverInfo> handover = [];
  List<DailyLog> logs = [];
  List<Receivable> rcv = [];
  List<PaymentRecord> pays = [];
  List<PickupAuth> auths = [];
  List<LeaveRequest> leaveList = [];
  List<NotificationItem> notices = [];
  AppException? failWith;

  T _check<T>(T v) {
    if (failWith != null) throw failWith!;
    return v;
  }

  @override
  Future<DataSnapshot<HandoverInfo>> handoverOn(String c, String d) async => _check(_snap(handover));
  @override
  Future<DataSnapshot<AttendanceInfo>> attendanceOn(String c, String d) async => _check(_snap([]));
  @override
  Future<DataSnapshot<DailyLog>> publishedLogs(String c, List<String> d) async => _check(_snap(logs));
  @override
  Future<DataSnapshot<Receivable>> receivables(String c) async => _check(_snap(rcv));
  @override
  Future<DataSnapshot<PaymentRecord>> payments(String c) async => _check(_snap(pays));
  @override
  Future<BankInfo> bankInfo() async => const BankInfo();
  @override
  Future<DataSnapshot<PickupAuth>> pickupAuths(String c) async => _check(_snap(auths));
  @override
  Future<DataSnapshot<LeaveRequest>> leaves(String c) async => _check(_snap(leaveList));
  @override
  Future<DataSnapshot<MedicationRequest>> medications(String c) async => _check(_snap([]));
  @override
  Future<DataSnapshot<NotificationItem>> notifications(String u) async => _check(_snap(notices));
}

Receivable _rcv(String id, String period, int balance, {String status = 'unpaid', bool pending = false}) =>
    Receivable(
      id: id,
      periodKey: period,
      status: status,
      balance: balance,
      amount: balance,
      dueDate: '2099-10-31',
      pendingReconciliation: pending,
      lines: [ReceivableLine(description: 'Học phí tháng', amount: balance)],
    );

void main() {
  late FakeParentRepo repo;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await PrefStore.init();
    Get.reset();
    Get.put(ConnectivityService());
    Get.put(OfflineQueue());
    Get.put(SettingsController());
    final s = Get.put(SessionController());
    s.setUser(uid: 'u1', name: 'Mẹ Linh', email: 'linh@example.com');
    s.memberships.assignAll(const [
      OrgMembership(
        orgId: 'o1',
        orgName: 'Hoa Sen',
        kind: 'parent',
        campuses: [CampusInfo(id: 'cg', name: 'Trường Mầm non Cầu Giấy')],
        children: [
          ChildRef(id: 'c1', fullName: 'Nguyễn Minh An', className: 'Lớp Mầm 1', campusId: 'cg'),
          ChildRef(id: 'c2', fullName: 'Nguyễn Gia Bình', className: 'Lớp Chồi 2', campusId: 'cg'),
        ],
        childIds: ['c1', 'c2'],
      ),
    ]);
    await s.selectContext(
      const SessionContext(orgId: 'o1', campusId: 'cg', role: AppRole.parent, childId: 'c1'),
    );
    repo = Get.put<ParentRepository>(FakeParentRepo()) as FakeParentRepo;
  });

  tearDown(Get.reset);

  Future<void> size(WidgetTester t, double w, double scale) async {
    t.view.devicePixelRatio = 2;
    t.view.physicalSize = Size(w * 2, 900 * 2);
    t.platformDispatcher.textScaleFactorTestValue = scale;
    addTearDown(t.view.reset);
    addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
  }

  Widget app(Widget home) => GetMaterialApp(
    translations: TestTranslations(),
    locale: const Locale('vi', 'VN'),
    fallbackLocale: const Locale('en', 'US'),
    home: home,
  );

  group('P01 home', () {
    testWidgets('shows school status only from real handover data', (t) async {
      await size(t, 390, 1.0);
      repo.handover = [
        HandoverInfo(
          state: 'received',
          receivedAt: DateTime.utc(2026, 11, 5, 0, 35),
          receivedByName: 'cô Lan',
        ),
      ];
      repo.rcv = [_rcv('r1', '2026-10', 4100000)];
      await t.pumpWidget(app(const ParentHomeTab()));
      await t.pumpAndSettle();
      expect(find.text('Bé đang ở trường'), findsOneWidget);
      expect(find.text('Đã được ghi nhận lúc 07:35 bởi cô Lan'), findsOneWidget);
      expect(find.text('4.100.000 đ'), findsOneWidget);
      // No diary published: never invent "ate well / slept well".
      expect(find.text('Nhà trường chưa xuất bản nhật ký hôm nay.'), findsOneWidget);
      expect(find.textContaining('ăn'), findsNothing);
    });

    testWidgets('no handover and no diary: honest empty blocks', (t) async {
      await size(t, 390, 1.0);
      await t.pumpWidget(app(const ParentHomeTab()));
      await t.pumpAndSettle();
      expect(find.text('Bé đang ở trường'), findsNothing);
      expect(find.text('Hôm nay chưa có cập nhật đến trường.'), findsOneWidget);
    });

    testWidgets('server error shows retry, which reloads', (t) async {
      await size(t, 390, 1.0);
      repo.failWith = const AppException(AppException.internal, '');
      await t.pumpWidget(app(const ParentHomeTab()));
      await t.pumpAndSettle();
      expect(find.text('Thử lại'), findsWidgets);
      repo.failWith = null;
      await t.tap(find.text('Thử lại').first);
      await t.pumpAndSettle();
      expect(find.text('Hôm nay chưa có cập nhật đến trường.'), findsOneWidget);
    });

    for (final (w, scale) in [(320.0, 2.0), (430.0, 1.0)]) {
      testWidgets('layout ok at ${w.round()} x $scale', (t) async {
        await size(t, w, scale);
        repo.rcv = [_rcv('r1', '2026-10', 4100000)];
        await t.pumpWidget(app(const ParentHomeTab()));
        await t.pumpAndSettle();
        expect(t.takeException(), isNull);
      });
    }
  });

  group('P05 tuition', () {
    test('summary keeps current period and older debt apart', () {
      final s = TuitionSummary.from([
        _rcv('a', '2026-10', 3000000),
        _rcv('b', '2026-09', 1100000, status: 'overdue'),
        _rcv('c', '2026-08', 0, status: 'paid'),
        _rcv('d', '2026-11', 500000, status: 'draft'),
      ]);
      expect(s.currentTotal, 3000000);
      expect(s.olderTotal, 1100000);
      expect(s.total, 4100000);
    });

    testWidgets('pending proof never reads as paid', (t) async {
      await size(t, 390, 1.0);
      repo.rcv = [_rcv('a', '2026-10', 4100000, pending: true)];
      repo.pays = [
        PaymentRecord(
          id: 'p1',
          type: 'proof',
          status: 'pending_reconciliation',
          amount: 4100000,
          submittedAt: DateTime.utc(2026, 11, 5, 1),
        ),
      ];
      await t.pumpWidget(app(const ParentTuitionScreen(inShell: false)));
      await t.pumpAndSettle();
      expect(find.text('Chờ đối soát'), findsWidgets);
      expect(find.text('Đã thanh toán'), findsNothing);
      expect(find.text('4.100.000 đ'), findsWidgets);
    });

    testWidgets('proof form requires a photo before sending', (t) async {
      await size(t, 390, 1.0);
      repo.rcv = [_rcv('a', '2026-10', 4100000)];
      Get.put(ParentTuitionController());
      await t.pumpWidget(app(const ParentProofScreen()));
      await t.pumpAndSettle();
      await t.tap(find.text('Gửi biên nhận'));
      await t.pumpAndSettle();
      expect(find.text('Vui lòng đính kèm ảnh biên nhận.'), findsOneWidget);
    });
  });

  group('P03 leave', () {
    test('validateLeave checks range, past dates and reason', () {
      final e = ParentCareController.validateLeave(
        from: DateTime(2026, 11, 3),
        to: DateTime(2026, 11, 1),
        reasonId: null,
        todayKey: '2026-11-05',
      );
      expect(e.keys, containsAll(['fromDay', 'toDay', 'reasonId']));
      expect(
        ParentCareController.validateLeave(
          from: DateTime(2026, 11, 6),
          to: DateTime(2026, 11, 7),
          reasonId: 'sick',
          todayKey: '2026-11-05',
        ),
        isEmpty,
      );
    });

    testWidgets('empty form shows field errors and sends nothing', (t) async {
      await size(t, 390, 1.0);
      Get.put(ParentCareController());
      await t.pumpWidget(app(const ParentLeaveFormScreen()));
      await t.pumpAndSettle();
      await t.tap(find.text('Gửi đơn'));
      await t.pumpAndSettle();
      expect(find.text('Vui lòng nhập thông tin này.'), findsWidgets);
    });

    testWidgets('pending request shows "Chờ xác nhận"', (t) async {
      await size(t, 390, 1.0);
      repo.leaveList = [
        LeaveRequest(
          id: 'l1',
          childId: 'c1',
          fromDay: '2099-10-16',
          toDay: '2099-10-16',
          session: 'all',
          status: 'pending',
          reasonId: 'family',
          submittedAt: DateTime.utc(2026, 11, 5, 8),
        ),
      ];
      await t.pumpWidget(app(const ParentCareScreen()));
      await t.pumpAndSettle();
      expect(find.text('Chờ xác nhận'), findsOneWidget);
      expect(find.text('Gia đình có việc'), findsOneWidget);
    });
  });

  group('P04 pickup', () {
    testWidgets('revoke asks for confirmation with the impact', (t) async {
      await size(t, 390, 1.0);
      repo.auths = [
        const PickupAuth(
          id: 'pa1',
          childId: 'c1',
          personName: 'Ông Nam',
          status: 'approved',
          type: 'delegate',
          relation: 'Ông',
          validFrom: '2020-01-01',
          validTo: '2099-12-31',
        ),
      ];
      Get.put(ParentPickupController());
      await t.pumpWidget(app(const ParentPickupScreen()));
      await t.pumpAndSettle();
      expect(find.text('Đang hiệu lực'), findsOneWidget);
      await t.ensureVisible(find.text('Thu hồi'));
      await t.pumpAndSettle();
      await t.tap(find.text('Thu hồi'), warnIfMissed: false);
      await t.pump(const Duration(milliseconds: 500));
      expect(find.text('Thu hồi ủy quyền của Ông Nam?'), findsOneWidget);
      expect(find.text('Người này sẽ không còn được đón bé.'), findsOneWidget);
    });
  });
}
