// ignore_for_file: prefer_initializing_formals
import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';

import '../models/data_models/teacher_models.dart';
import '../models/ui_models/app_tone.dart';
import '../repository/teacher_repository.dart';
import '../services/network/api_service.dart';
import '../services/network/app_exception.dart';
import '../services/sync/offline_queue.dart';
import '../utils/date_formatter.dart';
import 'scope_aware.dart';
import 'session_controller.dart';
import 'teacher_common.dart';

enum LocationStatus { checking, ok, weak, denied, serviceOff, unavailable }

class LocationFix {
  const LocationFix(this.lat, this.lng, this.accuracy);
  final double lat;
  final double lng;
  final double accuracy;
}

class LocationReading {
  const LocationReading(this.status, [this.fix]);
  final LocationStatus status;
  final LocationFix? fix;
}

typedef LocationReader = Future<LocationReading> Function();

/// Accuracy (m) above which the fix is shown as weak.
const double kWeakAccuracyM = 100;

Future<LocationReading> geolocatorReader() async {
  try {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return const LocationReading(LocationStatus.serviceOff);
    }
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
      return const LocationReading(LocationStatus.denied);
    }
    final p = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 12),
      ),
    );
    final fix = LocationFix(p.latitude, p.longitude, p.accuracy);
    return LocationReading(p.accuracy > kWeakAccuracyM ? LocationStatus.weak : LocationStatus.ok, fix);
  } catch (_) {
    return const LocationReading(LocationStatus.unavailable);
  }
}

class PunchOutcome {
  const PunchOutcome({required this.kind, required this.queued, this.result, required this.deviceTime});
  final String kind;
  final bool queued;

  /// Server `result` (ok / outside_radius / no_location) when confirmed.
  final String? result;
  final DateTime deviceTime;
}

/// One row of the personal time table (T06).
class DayRow {
  const DayRow({required this.dayKey, this.firstIn, this.lastOut, required this.complete, this.hasPending = false});
  final String dayKey;
  final DateTime? firstIn;
  final DateTime? lastOut;

  /// Every "in" has its "out". Only then is the day shown as a full pair of
  /// punches; official work days are decided by HR (timesheet), not here.
  final bool complete;
  final bool hasPending;
}

/// T05 clock in/out + the data of T06 (punch history, shifts).
class TeacherTimeController extends GetxController with ScopeAware {
  TeacherTimeController({TeacherRepository? repo, LocationReader? location})
    : _repo = repo,
      _location = location ?? geolocatorReader;

  final TeacherRepository? _repo;
  final LocationReader _location;
  TeacherRepository get repo => _repo ?? teacherRepo();

  final Rx<ViewState> state = ViewState.loading.obs;
  final Rxn<AppException> error = Rxn<AppException>();
  final RxList<PunchRec> punches = <PunchRec>[].obs;
  final RxList<RosterEntry> roster = <RosterEntry>[].obs;
  final Rx<LocationStatus> locStatus = LocationStatus.checking.obs;
  final Rxn<LocationFix> fix = Rxn<LocationFix>();
  final Rxn<PunchOutcome> lastOutcome = Rxn<PunchOutcome>();
  final RxBool stale = false.obs;
  final Rxn<DateTime> loadedAt = Rxn<DateTime>();
  String? _opId;
  int _epoch = 0;

  @override
  void onInit() {
    super.onInit();
    load();
    refreshLocation();
  }

  @override
  void onScopeChanged() {
    punches.clear();
    roster.clear();
    lastOutcome.value = null;
    state.value = ViewState.loading;
    load();
  }

  bool get hasEmployee => (SessionController.to.membership?.employeeId ?? '').isNotEmpty;

  String get fromDay {
    final t = DateFormatter.parseDayKey(teacherClock().dayKey()) ?? DateTime.now();
    return DateFormatter.dayKey(t.subtract(const Duration(days: 35)));
  }

  Future<void> load() async {
    final epoch = ++_epoch;
    if (punches.isEmpty) state.value = ViewState.loading;
    if (!hasEmployee) {
      state.value = ViewState.empty;
      return;
    }
    try {
      final t = DateFormatter.parseDayKey(teacherClock().dayKey())!;
      final r = await repo.punches(fromDay, DateFormatter.dayKey(t.add(const Duration(days: 1))));
      final ro = await repo.roster(
        DateFormatter.dayKey(t.subtract(const Duration(days: 1))),
        DateFormatter.dayKey(t.add(const Duration(days: 14))),
      );
      if (epoch != _epoch) return;
      punches.assignAll(r.items);
      roster.assignAll(ro.items.where((e) => e.status != 'superseded'));
      stale.value = r.fromCache;
      loadedAt.value = r.receivedAt;
      error.value = null;
      state.value = r.fromCache ? ViewState.offlineStale : ViewState.ready;
    } catch (e) {
      if (epoch != _epoch) return;
      final ex = toAppException(e);
      error.value = ex;
      state.value = punches.isNotEmpty && ex.isNetwork
          ? ViewState.offlineStale
          : (ex.isForbidden ? ViewState.forbidden : (ex.isNetwork ? ViewState.offlineEmpty : ViewState.error));
    }
  }

  Future<void> refreshLocation() async {
    locStatus.value = LocationStatus.checking;
    final r = await _location();
    locStatus.value = r.status;
    fix.value = r.fix;
  }

  /// Original punches plus the ones still in the offline queue (marked pending).
  List<PunchRec> get history {
    final out = List<PunchRec>.of(punches);
    final s = SessionController.to;
    if (Get.isRegistered<OfflineQueue>() && s.orgId != null && s.campusId != null) {
      for (final op in OfflineQueue.to.forScope(s.orgId!, s.campusId!)) {
        if (op.action != 'punch.record') continue;
        if (out.any((p) => p.id == op.opId)) continue;
        out.add(PunchRec(
          id: op.opId,
          kind: (op.payload['kind'] ?? '').toString(),
          deviceTime: op.deviceTime,
          dayKey: teacherClock().dayKey(op.deviceTime),
          pending: true,
        ));
      }
    }
    out.sort((a, b) => (a.time ?? DateTime(0)).compareTo(b.time ?? DateTime(0)));
    return out;
  }

  /// The ONLY punch step offered: `out` after an open `in`, else `in`.
  String get nextKind {
    final h = history;
    if (h.isEmpty) return 'in';
    final last = h.last;
    final age = DateTime.now().difference(last.time ?? DateTime(0));
    return last.kind == 'in' && age < const Duration(hours: 20) ? 'out' : 'in';
  }

  List<RosterEntry> get todayShifts =>
      roster.where((e) => e.dayKey == teacherClock().dayKey()).toList();

  List<PunchRec> get todayPunches {
    final d = teacherClock().dayKey();
    return history.where((p) {
      final day = p.dayKey.isNotEmpty ? p.dayKey : teacherClock().dayKey(p.time);
      return day == d;
    }).toList();
  }

  /// Rows for the personal table, newest first.
  List<DayRow> get dayRows {
    final byDay = <String, List<PunchRec>>{};
    for (final p in history) {
      final k = p.dayKey.isNotEmpty ? p.dayKey : teacherClock().dayKey(p.time);
      (byDay[k] ??= []).add(p);
    }
    final keys = byDay.keys.toList()..sort((a, b) => b.compareTo(a));
    return [
      for (final k in keys)
        DayRow(
          dayKey: k,
          firstIn: byDay[k]!.where((p) => p.kind == 'in').map((p) => p.time).firstOrNull,
          lastOut: byDay[k]!.where((p) => p.kind == 'out').map((p) => p.time).lastOrNull,
          complete: _paired(byDay[k]!),
          hasPending: byDay[k]!.any((p) => p.pending),
        ),
    ];
  }

  bool _paired(List<PunchRec> list) {
    final ins = list.where((p) => p.kind == 'in').length;
    final outs = list.where((p) => p.kind == 'out').length;
    return ins > 0 && ins == outs;
  }

  /// Records the next punch. [manualNote] is required when location is not
  /// available (manual confirmation flow). Returns the outcome; throws
  /// [AppException] for rejections.
  Future<PunchOutcome> punch({String? manualNote}) async {
    final kind = nextKind;
    final now = DateTime.now();
    final loc = fix.value;
    final payload = <String, dynamic>{
      'kind': kind,
      'deviceTime': now.toUtc().toIso8601String(),
      'source': 'app',
      if (loc != null) 'location': {'lat': loc.lat, 'lng': loc.lng, 'accuracy': loc.accuracy},
      if (manualNote != null && manualNote.isNotEmpty) 'note': manualNote,
    };
    _opId ??= ApiService.newOpId();
    final opId = _opId!;
    Map<String, dynamic> data = const {};
    final SubmitOutcome out;
    try {
      out = await sendOrQueue(
      action: 'punch.record',
      payload: payload,
      opId: opId,
      deviceTime: now,
      label: kind,
      send: () async {
        data = await repo.punch(payload: payload, opId: opId);
      },
    );
    } catch (_) {
      _opId = null;
      rethrow;
    }
    _opId = null;
    final o = PunchOutcome(
      kind: kind,
      queued: out == SubmitOutcome.queued,
      result: data['result']?.toString(),
      deviceTime: now,
    );
    lastOutcome.value = o;
    if (!o.queued) await load();
    punches.refresh();
    return o;
  }

  /// A rejected punch ends the intent so the next tap is a new one.
  void resetIntent() => _opId = null;
}

