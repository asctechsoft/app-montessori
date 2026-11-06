import 'package:get/get.dart';

import '../models/data_models/principal_models.dart';
import '../models/ui_models/app_tone.dart';
import '../repository/principal_repository.dart';
import '../services/permission_service.dart';
import '../utils/date_formatter.dart';
import '../values/permissions.dart';
import '../values/route_principal.dart';
import 'principal_loader.dart';
import 'scope_aware.dart';
import 'session_controller.dart';

/// A warning with someone to act on it (principal overview).
class OverviewAlert {
  const OverviewAlert({
    required this.id,
    required this.tone,
    required this.title,
    required this.message,
    this.route,
    this.ctaKey,
  });

  final String id;
  final AppTone tone;
  final String title;
  final String message;
  final String? route;
  final String? ctaKey;
}

/// Metric that opens its constituent data (report rows + definition).
class MetricSpec {
  const MetricSpec({
    required this.key,
    required this.labelKey,
    required this.reportType,
    required this.definitionKey,
    required this.rowFilter,
  });

  final String key;
  final String labelKey;
  final String reportType;
  final String definitionKey;
  final bool Function(Map<String, dynamic> row) rowFilter;
}

bool _n(Object? v) => (asInt(v) ?? 0) > 0;

final Map<String, MetricSpec> kMetricSpecs = {
  'enrolled': MetricSpec(
    key: 'enrolled',
    labelKey: 'p_metric_enrolled',
    reportType: 'enrollment',
    definitionKey: 'enrolled',
    rowFilter: (r) => r['classSummary'] != true,
  ),
  'present': MetricSpec(
    key: 'present',
    labelKey: 'p_metric_present',
    reportType: 'attendance',
    definitionKey: 'required',
    rowFilter: (r) => _n(r['present']),
  ),
  'absent': MetricSpec(
    key: 'absent',
    labelKey: 'p_metric_absent',
    reportType: 'attendance',
    definitionKey: 'required',
    rowFilter: (r) => _n(r['excused']) || _n(r['unexcused']),
  ),
  'attendanceRatePct': MetricSpec(
    key: 'attendanceRatePct',
    labelKey: 'p_metric_rate',
    reportType: 'attendance',
    definitionKey: 'attendanceRatePct',
    rowFilter: (r) => true,
  ),
  'received': MetricSpec(
    key: 'received',
    labelKey: 'p_metric_received',
    reportType: 'handover',
    definitionKey: 'received',
    rowFilter: (r) => r['state'] != 'missing_handover',
  ),
  'pickedUp': MetricSpec(
    key: 'pickedUp',
    labelKey: 'p_metric_picked',
    reportType: 'handover',
    definitionKey: 'pickedUp',
    rowFilter: (r) => r['state'] == 'picked_up',
  ),
  'stillAtSchool': MetricSpec(
    key: 'stillAtSchool',
    labelKey: 'p_metric_still',
    reportType: 'handover',
    definitionKey: 'stillAtSchool',
    rowFilter: (r) => r['state'] == 'received',
  ),
  'missingConfirm': MetricSpec(
    key: 'missingConfirm',
    labelKey: 'p_metric_missing_handover',
    reportType: 'handover',
    definitionKey: 'missingConfirm',
    rowFilter: (r) => r['state'] == 'missing_handover',
  ),
  'outstanding': MetricSpec(
    key: 'outstanding',
    labelKey: 'p_metric_outstanding',
    reportType: 'tuition',
    definitionKey: 'outstanding',
    rowFilter: (r) => (asInt(r['balance']) ?? 0) > 0,
  ),
  'overdue': MetricSpec(
    key: 'overdue',
    labelKey: 'p_metric_overdue',
    reportType: 'tuition',
    definitionKey: 'overdue',
    rowFilter: (r) => r['status'] == 'overdue',
  ),
  'incompleteDays': MetricSpec(
    key: 'incompleteDays',
    labelKey: 'p_metric_incomplete',
    reportType: 'hr',
    definitionKey: 'incompleteDays',
    rowFilter: (r) => _n(r['incompleteDays']),
  ),
};

class PrincipalOverviewController extends GetxController
    with ScopeAware, PrincipalLoader {
  PrincipalOverviewController({PrincipalRepository? repo})
    : repo = repo ?? PrincipalRepository();

  final PrincipalRepository repo;
  final PLoad<OverviewBundle> load = PLoad<OverviewBundle>();

  String get dayKey => CampusClock(SessionController.to.timezone).dayKey();

  @override
  void onInit() {
    super.onInit();
    refreshData();
  }

  @override
  void onScopeChanged() {
    load.reset();
    refreshData();
  }

  Future<T?> _opt<T>(Future<T> Function() f) async {
    try {
      return await f();
    } catch (_) {
      return null;
    }
  }

  Future<void> refreshData() => runLoad<OverviewBundle>(
    load,
    () async {
      final today = dayKey;
      final snap = await repo.dashboard();
      final canHr = PermissionService.can(Perm.timekeepingRead);
      final canMed = PermissionService.can(Perm.medicationRead);
      final canInc = PermissionService.can(Perm.incidentRead);
      final extra = await Future.wait<Object?>([
        _opt(() => repo.report('handover', from: today, to: today)),
        _opt(() => repo.report('attendance', from: today, to: today)),
        canHr
            ? _opt(() => repo.report('hr', from: '${today.substring(0, 7)}-01', to: today))
            : Future<Object?>.value(null),
        canMed ? _opt(() async => (await repo.medicationRequests()).items.length) : Future<Object?>.value(null),
        canInc ? _opt(() async => (await repo.incidents()).items.length) : Future<Object?>.value(null),
        canHr
            ? _opt(() => repo.staffDay(today, canTimekeeping: true, canLeave: false))
            : Future<Object?>.value(null),
      ]);
      final staff = extra[5] as StaffDay?;
      return OverviewBundle(
        snapshot: snap,
        handover: extra[0] as ReportData?,
        attendance: extra[1] as ReportData?,
        hr: extra[2] as ReportData?,
        medicationPending: extra[3] as int?,
        incidentsOpen: extra[4] as int?,
        notPunched: staff?.missingIn.length,
        shiftConflicts: staff?.overlapping.length,
      );
    },
    cacheName: 'principal_overview',
    encode: (d) => d.toJson(),
    decode: OverviewBundle.fromJson,
  );

  /// Warnings that have someone to act on them.
  List<OverviewAlert> get alerts {
    final b = load.data.value;
    if (b == null) return const [];
    final out = <OverviewAlert>[];
    final still = b.handover?.metric('stillAtSchool') ?? b.snapshot.stillAtSchool;
    final serverStill = b.snapshot.alerts.any((a) => (a['type'] ?? '').toString().contains('still'));
    if (still != null && still > 0 && (_afterClosing() || serverStill)) {
      out.add(OverviewAlert(
        id: 'still',
        tone: AppTone.error,
        title: 'p_alert_still_title'.tr,
        message: 'p_alert_still_msg'.trParams({'args1': '$still'}),
        route: RoutePrincipal.handovers,
        ctaKey: 'p_alert_open_handovers',
      ));
    }
    final miss = b.handover?.metric('missingConfirm');
    if (miss != null && miss > 0) {
      out.add(OverviewAlert(
        id: 'missing_handover',
        tone: AppTone.warning,
        title: 'p_alert_missing_title'.tr,
        message: 'p_alert_missing_msg'.trParams({'args1': '$miss'}),
        route: RoutePrincipal.handovers,
        ctaKey: 'p_alert_open_handovers',
      ));
    }
    if ((b.notPunched ?? 0) > 0) {
      out.add(OverviewAlert(
        id: 'not_punched',
        tone: AppTone.warning,
        title: 'p_alert_punch_title'.tr,
        message: 'p_alert_punch_msg'.trParams({'args1': '${b.notPunched}'}),
        route: RoutePrincipal.staffToday,
        ctaKey: 'p_alert_open_staff',
      ));
    }
    if ((b.shiftConflicts ?? 0) > 0) {
      out.add(OverviewAlert(
        id: 'shift_conflict',
        tone: AppTone.warning,
        title: 'p_alert_conflict_title'.tr,
        message: 'p_alert_conflict_msg'.trParams({'args1': '${b.shiftConflicts}'}),
        route: RoutePrincipal.staffToday,
        ctaKey: 'p_alert_open_staff',
      ));
    }
    if ((b.medicationPending ?? 0) > 0 || (b.incidentsOpen ?? 0) > 0) {
      out.add(OverviewAlert(
        id: 'health',
        tone: AppTone.warning,
        title: 'p_alert_health_title'.tr,
        message: 'p_alert_health_msg'.trParams({
          'args1': '${b.medicationPending ?? 0}',
          'args2': '${b.incidentsOpen ?? 0}',
        }),
        route: RoutePrincipal.health,
        ctaKey: 'p_alert_open_health',
      ));
    }
    for (final a in b.snapshot.alerts) {
      final title = (a['title'] ?? '').toString();
      if (title.isEmpty) continue;
      final type = (a['type'] ?? '').toString();
      if (type.contains('still')) continue; // shown above (with the list CTA)
      out.add(OverviewAlert(
        id: 'srv_${a['id']}',
        tone: a['severity'] == 'critical' ? AppTone.error : AppTone.warning,
        title: title,
        message: (a['message'] ?? '').toString(),
      ));
    }
    return out;
  }

  /// After 17:30 campus time (campus closing time is not in the session).
  bool _afterClosing() {
    final w = CampusClock(SessionController.to.timezone).wall(DateTime.now());
    return w.hour > 17 || (w.hour == 17 && w.minute >= 30);
  }
}
