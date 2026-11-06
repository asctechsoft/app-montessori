import 'package:app_montessori/controller/principal_approvals_controller.dart';
import 'package:app_montessori/controller/principal_manage_controller.dart';
import 'package:app_montessori/controller/principal_overview_controller.dart';
import 'package:app_montessori/controller/principal_staff_controller.dart';
import 'package:app_montessori/controller/session_controller.dart';
import 'package:app_montessori/controller/settings_controller.dart';
import 'package:app_montessori/models/data_models/membership.dart';
import 'package:app_montessori/models/data_models/principal_models.dart';
import 'package:app_montessori/models/data_models/session_context.dart';
import 'package:app_montessori/models/ui_models/app_role.dart';
import 'package:app_montessori/presentation/screens_principal/principal_approval_panels.dart';
import 'package:app_montessori/presentation/screens_principal/principal_approvals_tab.dart';
import 'package:app_montessori/presentation/screens_principal/principal_manage_tab.dart';
import 'package:app_montessori/presentation/screens_principal/principal_overview_tab.dart';
import 'package:app_montessori/presentation/screens_principal/principal_staff_tab.dart';
import 'package:app_montessori/repository/firestore_repository.dart';
import 'package:app_montessori/repository/principal_repository.dart';
import 'package:app_montessori/services/connectivity_service.dart';
import 'package:app_montessori/services/network/api_service.dart';
import 'package:app_montessori/services/storage/pref_store.dart';
import 'package:app_montessori/services/sync/offline_queue.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_utils.dart';

class FakePrincipalRepo extends PrincipalRepository {
  FakePrincipalRepo({this.approvals = const []});

  final List<PDoc> approvals;
  final List<Map<String, dynamic>> decisions = [];

  DataSnapshot<PDoc> _snap(List<PDoc> l) => DataSnapshot<PDoc>(l, receivedAt: DateTime.now());

  @override
  Future<DataSnapshot<PDoc>> pendingApprovals() async => _snap(approvals);
  @override
  Future<DataSnapshot<PDoc>> classes() async =>
      _snap([const PDoc('k1', {'name': 'Lớp Mầm 1', 'capacity': 20})]);
  @override
  Future<DataSnapshot<PDoc>> children() async => _snap([
    const PDoc('c1', {'fullName': 'Nguyễn Minh An', 'code': 'MN001', 'classId': 'k1', 'status': 'active'}),
  ]);
  @override
  Future<DataSnapshot<PDoc>> medicationRequests() async => _snap(const []);
  @override
  Future<DataSnapshot<PDoc>> incidents() async => _snap(const []);
  @override
  Future<CampusSnapshot> dashboard() async => const CampusSnapshot({
    'dayKey': '2026-10-16',
    'enrolled': 20,
    'presentToday': 18,
    'absentToday': 2,
    'stillAtSchool': 3,
    'pendingApprovals': 1,
    'outstanding': 4100000,
    'overdueAmount': 500000,
    'overdueCount': 1,
    'alerts': [],
  });
  @override
  Future<ReportData> report(String type, {required String from, required String to, String? classId}) async =>
      ReportData({
        'type': type,
        'metrics': {'received': 18, 'pickedUp': 15, 'stillAtSchool': 3, 'missingConfirm': 0, 'attendanceRatePct': 90.0},
        'rows': [],
        'definitions': {},
      });
  @override
  Future<StaffDay> staffDay(String dayKey, {required bool canTimekeeping, required bool canLeave}) async =>
      StaffDay(
        dayKey: dayKey,
        employees: const [PDoc('e1', {'fullName': 'Cô Lan', 'status': 'active'})],
        entries: const [
          PDoc('s1', {'employeeId': 'e1', 'shiftSnapshot': {'name': 'Ca sáng', 'startTime': '07:30', 'endTime': '17:00'}}),
        ],
        punches: const [],
        leaves: const [],
        swaps: const [],
      );
  @override
  Future<Map<String, dynamic>> decide({
    required String id,
    required String decision,
    required String note,
    required String opId,
    String? approvalCampusId,
  }) async {
    decisions.add({'id': id, 'decision': decision, 'note': note, 'opId': opId});
    return {};
  }
}

PDoc approval(String id, String type, String perm, {Map<String, dynamic>? impact, String by = 'other'}) => PDoc(id, {
  'type': type,
  'status': 'pending',
  'summary': 'Tóm tắt $type',
  'requiredPerm': perm,
  'campusId': 'cg',
  'requestedBy': by,
  'requestedByName': 'Cô Lan',
  'impact': impact ?? <String, dynamic>{},
});

void main() {
  Future<void> setupSession(List<String> perms) async {
    SharedPreferences.setMockInitialValues({});
    await PrefStore.init();
    Get.reset();
    Get.put(ConnectivityService());
    Get.put(OfflineQueue());
    Get.put(SettingsController());
    final s = Get.put(SessionController());
    s.setUser(uid: 'u1', name: 'Cô Hương');
    s.memberships.assignAll([
      OrgMembership(
        orgId: 'o1',
        orgName: 'Hệ thống Mầm non Hoa Sen',
        kind: 'staff',
        campuses: const [
          CampusInfo(id: 'cg', name: 'Trường Mầm non Cầu Giấy'),
          CampusInfo(id: 'tx', name: 'Trường Mầm non Thanh Xuân'),
        ],
        permsByCampus: {'cg': perms, 'tx': perms},
      ),
    ]);
    await s.selectContext(const SessionContext(orgId: 'o1', campusId: 'cg', role: AppRole.principal));
  }

  tearDown(Get.reset);

  Widget app(Widget home) => GetMaterialApp(
    translations: TestTranslations(),
    locale: const Locale('vi', 'VN'),
    fallbackLocale: const Locale('en', 'US'),
    home: home,
  );

  Future<void> size(WidgetTester t, double w, double scale) async {
    t.view.devicePixelRatio = 2;
    t.view.physicalSize = Size(w * 2, 2400 * 2);
    t.platformDispatcher.textScaleFactorTestValue = scale;
    addTearDown(t.view.reset);
    addTearDown(t.platformDispatcher.clearAllTestValues);
  }

  test('pendingApprovals goes through approval.list (not Firestore)', () async {
    await setupSession(['approvals.read']);
    Map<String, dynamic>? sent;
    final api = ApiService(transport: (req) async {
      sent = req;
      return {
        'ok': true,
        'data': {
          'items': [
            {'id': 'a1', 'type': 'attendance_correction', 'status': 'pending', 'createdAt': '2026-11-05T01:00:00.000Z'},
          ],
        },
      };
    });
    final snap = await PrincipalRepository(api: api).pendingApprovals();
    expect(sent!['action'], 'approval.list');
    expect((sent!['payload'] as Map)['status'], 'pending');
    expect(snap.items.single.id, 'a1');
    expect(snap.items.single.dt('createdAt'), isNotNull);
  });

  testWidgets('approvals list only shows requests whose permission the user has', (t) async {
    await size(t, 390, 1);
    await setupSession(['approvals.read', 'classes.write']);
    final repo = FakePrincipalRepo(approvals: [
      approval('a1', 'attendance_correction', 'classes.write'),
      approval('a2', 'refund', 'refunds.approve'),
    ]);
    Get.put(PrincipalApprovalsController(repo: repo));
    await t.pumpWidget(app(const PrincipalApprovalsTab()));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('Tóm tắt attendance_correction'), findsOneWidget);
    expect(find.text('Tóm tắt refund'), findsNothing);
    expect(t.takeException(), isNull);
  });

  testWidgets('detail hides Approve/Reject without the permission', (t) async {
    await size(t, 390, 1);
    await setupSession(['approvals.read']);
    Get.put(PrincipalApprovalsController(repo: FakePrincipalRepo()));
    final a = ApprovalItem(approval('a2', 'refund', 'refunds.approve', impact: {'amount': 100000, 'creditAvailable': 300000}));
    await t.pumpWidget(app(PrincipalApprovalDetailScreen(approval: a)));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('Duyệt'), findsNothing);
    expect(find.text('Từ chối'), findsNothing);
    expect(find.byType(RefundPanel), findsOneWidget);
    expect(find.textContaining('không có quyền quyết định'), findsOneWidget);
  });

  testWidgets('approve sends one decision with an opId only after confirming', (t) async {
    await size(t, 390, 1);
    await setupSession(['approvals.read', 'refunds.approve']);
    final repo = FakePrincipalRepo();
    Get.put(PrincipalApprovalsController(repo: repo));
    final a = ApprovalItem(approval('a2', 'refund', 'refunds.approve', impact: {'amount': 100000, 'creditAvailable': 300000}));
    await t.pumpWidget(app(PrincipalApprovalDetailScreen(approval: a)));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('Duyệt'), findsOneWidget);
    await t.tap(find.text('Duyệt'));
    await t.pump(const Duration(milliseconds: 400));
    expect(repo.decisions, isEmpty); // nothing before the confirm dialog
    await t.tap(find.text('Duyệt').last);
    await t.pump(const Duration(milliseconds: 400));
    expect(repo.decisions.length, 1);
    expect(repo.decisions.first['decision'], 'approved');
    expect((repo.decisions.first['opId'] as String).isNotEmpty, isTrue);
    await t.pumpAndSettle(const Duration(seconds: 3));
  });

  testWidgets('reject needs a reason', (t) async {
    await size(t, 390, 1);
    await setupSession(['approvals.read', 'classes.write']);
    final repo = FakePrincipalRepo();
    Get.put(PrincipalApprovalsController(repo: repo));
    final a = ApprovalItem(approval('a1', 'attendance_correction', 'classes.write', impact: {
      'dayKey': '2026-10-16',
      'before': {'status': 'absent_excused'},
      'after': {'status': 'present'},
      'reason': 'Nhầm',
    }));
    await t.pumpWidget(app(PrincipalApprovalDetailScreen(approval: a)));
    await t.pump(const Duration(milliseconds: 300));
    await t.tap(find.text('Từ chối'));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('Nhập lý do từ chối.'), findsOneWidget);
    expect(repo.decisions, isEmpty);
  });

  final samples = <String, (Type, Map<String, dynamic>)>{
    'attendance_correction': (AttendanceCorrectionPanel, {'dayKey': '2026-10-16', 'before': {'status': 'present'}, 'after': {'status': 'absent_excused'}}),
    'punch_adjust': (PunchAdjustPanel, {'dayKey': '2026-10-16', 'kind': 'in', 'originalPunches': 0, 'requestedAt': '2026-10-16T01:00:00Z'}),
    'staff_leave': (StaffLeavePanel, {'days': 2, 'balance': {'remaining': 5}, 'affectedShifts': 2, 'teacherShortage': 0}),
    'shift_swap': (ShiftSwapPanel, {'dayKey': '2026-10-16'}),
    'overtime': (OvertimePanel, {'minutes': 90, 'dayKey': '2026-10-16'}),
    'transfer': (TransferPanel, {'fromClassId': 'k1', 'toClassId': 'k2', 'effectiveDate': '2026-10-20', 'debtHandling': 'stay', 'depositHandling': 'move', 'openDebtAmount': 4100000}),
    'enrollment_exception': (EnrollmentExceptionPanel, {'capacity': 20, 'enrolled': 20, 'after': 21, 'reason': 'Anh em'}),
    'refund': (RefundPanel, {'amount': 100000, 'creditAvailable': 300000}),
    'receivable_adjust': (ReceivableAdjustPanel, {'amount': -100000, 'balanceBefore': 4100000, 'balanceAfter': 4000000}),
    'payment_cancel': (PaymentCancelPanel, {'amount': 2000000, 'allocations': [], 'credit': 0}),
    'expense': (ExpensePanel, {'amount': 1500000, 'category': 'Văn phòng phẩm'}),
    'billing_run': (BillingRunPanel, {'periodKey': '2026-10', 'totalNew': 3600000, 'counts': {'ok': 20}}),
    'payroll_run': (PayrollRunPanel, {'periodKey': '2026-09', 'headcount': 10, 'totals': {'net': 78000000}}),
    'timesheet_reopen': (TimesheetReopenPanel, {'periodKey': '2026-09', 'reason': 'Sai công'}),
    'notification': (NotificationPanel, {'recipients': 120, 'scope': {'type': 'campus'}, 'requireAck': true, 'category': 'general'}),
    'stock_variance': (StockVariancePanel, {'varianceCount': 1, 'totalVarianceValue': -50000, 'lines': [{'name': 'Gạo', 'systemQty': 10, 'countedQty': 9, 'varianceValue': -50000}]}),
    'menu': (MenuPanel, {'dayKey': '2026-10-16', 'allergyChildren': 2, 'substitutions': 2}),
  };

  for (final width in [320.0, 430.0]) {
    testWidgets('every approval type has its own panel (width ${width.round()}, text 200%)', (t) async {
      await size(t, width, 2);
      await setupSession(['approvals.read']);
      expect(samples.keys.toSet(), kApprovalTypes.toSet());
      for (final e in samples.entries) {
        final item = ApprovalItem(approval('x', e.key, 'x', impact: e.value.$2));
        await t.pumpWidget(app(SingleChildScrollView(child: buildApprovalPanel(item))));
        await t.pump();
        expect(find.byType(e.value.$1), findsOneWidget, reason: e.key);
        expect(find.text('Trước').evaluate().length + find.text('Tác động').evaluate().length, greaterThan(0), reason: e.key);
        expect(t.takeException(), isNull, reason: e.key);
      }
    });
  }

  testWidgets('overview shows today figures, missing values as a dash, debt only with permission', (t) async {
    await size(t, 360, 1);
    await setupSession(['reports.read']);
    Get.put(PrincipalOverviewController(repo: FakePrincipalRepo()));
    await t.pumpWidget(app(const PrincipalOverviewTab()));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('Sĩ số'), findsOneWidget);
    expect(find.text('20'), findsOneWidget);
    expect(find.text('Còn nợ học phí'), findsNothing); // no payments.read
    expect(find.text('90,0%'), findsOneWidget);
    expect(t.takeException(), isNull);
  });

  testWidgets('overview shows debt with payments.read', (t) async {
    await size(t, 360, 1);
    await setupSession(['reports.read', 'payments.read']);
    Get.put(PrincipalOverviewController(repo: FakePrincipalRepo()));
    await t.pumpWidget(app(const PrincipalOverviewTab()));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('4.100.000 đ'), findsOneWidget);
  });

  testWidgets('staff tab lists who has not clocked in', (t) async {
    await size(t, 390, 1.5);
    await setupSession(['staff.read', 'timekeeping.read']);
    Get.put(PrincipalStaffController(repo: FakePrincipalRepo()));
    await t.pumpWidget(app(const PrincipalStaffTab()));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('Cô Lan'), findsWidgets);
    expect(find.text('Chưa chấm công'), findsWidgets);
    expect(t.takeException(), isNull);
  });

  testWidgets('manage menu only shows what the permissions allow', (t) async {
    await size(t, 390, 1);
    await setupSession(['classes.read']);
    Get.put(PrincipalManageController(repo: FakePrincipalRepo()));
    await t.pumpWidget(app(const PrincipalManageTab()));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('Lớp và sĩ số'), findsOneWidget);
    expect(find.text('Danh sách trẻ'), findsNothing);
  });
}
