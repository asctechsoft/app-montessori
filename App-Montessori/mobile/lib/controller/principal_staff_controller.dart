import 'package:get/get.dart';

import '../models/data_models/principal_models.dart';
import '../repository/principal_repository.dart';
import '../services/permission_service.dart';
import '../utils/date_formatter.dart';
import '../values/permissions.dart';
import 'principal_loader.dart';
import 'scope_aware.dart';
import 'session_controller.dart';

/// One staff row of today.
class StaffRow {
  const StaffRow({
    required this.employeeId,
    required this.name,
    this.shiftName,
    this.shiftTime,
    this.inAt,
    this.outAt,
    this.onLeave = false,
  });

  final String employeeId;
  final String name;
  final String? shiftName;
  final String? shiftTime;
  final DateTime? inAt;
  final DateTime? outAt;
  final bool onLeave;

  /// notPunched | working | done | partial (out without in) | onLeave | noShift
  String get status {
    if (onLeave) return 'on_leave';
    if (shiftName == null && inAt == null) return 'no_shift';
    if (inAt == null && outAt != null) return 'incomplete';
    if (inAt == null) return 'not_punched';
    if (outAt == null) return 'working';
    return 'done';
  }
}

class PrincipalStaffController extends GetxController
    with ScopeAware, PrincipalLoader {
  PrincipalStaffController({PrincipalRepository? repo})
    : repo = repo ?? PrincipalRepository();

  final PrincipalRepository repo;
  final PLoad<StaffDay> load = PLoad<StaffDay>();
  final RxString query = ''.obs;

  String get today => CampusClock(SessionController.to.timezone).dayKey();

  @override
  void onInit() {
    super.onInit();
    refreshData();
  }

  @override
  void onScopeChanged() {
    load.reset();
    query.value = '';
    refreshData();
  }

  bool get canTimekeeping => PermissionService.can(Perm.timekeepingRead);

  Future<void> refreshData() => runLoad<StaffDay>(
    load,
    () => repo.staffDay(today, canTimekeeping: canTimekeeping, canLeave: canTimekeeping),
    isEmpty: (d) => d.employees.isEmpty,
    fromCache: (d) => d.fromCache,
  );

  List<StaffRow> rows() {
    final d = load.data.value;
    if (d == null) return const [];
    final out = <StaffRow>[];
    for (final e in d.employees) {
      final entries = d.entries.where((x) => StaffDay.workerOf(x) == e.id).toList();
      final punches = d.punchesOf(e.id);
      DateTime? firstIn;
      DateTime? lastOut;
      for (final p in punches) {
        final t = p.dt('serverTime') ?? p.dt('deviceTime');
        if (t == null) continue;
        if (p.str('kind') == 'in' && (firstIn == null || t.isBefore(firstIn))) firstIn = t;
        if (p.str('kind') == 'out' && (lastOut == null || t.isAfter(lastOut))) lastOut = t;
      }
      final snap = entries.isEmpty ? <String, dynamic>{} : entries.first.map('shiftSnapshot');
      out.add(StaffRow(
        employeeId: e.id,
        name: e.str('fullName', e.id),
        shiftName: entries.isEmpty ? null : (snap['name']?.toString() ?? snap['code']?.toString() ?? ''),
        shiftTime: snap['startTime'] == null ? null : '${snap['startTime']} - ${snap['endTime']}',
        inAt: firstIn,
        outAt: lastOut,
        onLeave: entries.isNotEmpty && entries.every((x) => x.str('status') == 'on_leave'),
      ));
    }
    final q = query.value.trim().toLowerCase();
    final list = q.isEmpty ? out : out.where((r) => r.name.toLowerCase().contains(q)).toList();
    list.sort((a, b) => a.name.compareTo(b.name));
    return list;
  }
}
