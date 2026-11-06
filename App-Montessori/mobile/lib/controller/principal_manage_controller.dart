import 'package:get/get.dart';

import '../models/data_models/principal_models.dart';
import '../repository/firestore_repository.dart';
import '../repository/principal_repository.dart';
import '../utils/date_formatter.dart';
import 'principal_loader.dart';
import 'scope_aware.dart';
import 'session_controller.dart';

typedef PSnap = DataSnapshot<PDoc>;

/// Classes, children, attendance, handovers, class diary and health lists of
/// the active campus (principal "Quản lý" tab and its sub screens).
class PrincipalManageController extends GetxController
    with ScopeAware, PrincipalLoader {
  PrincipalManageController({PrincipalRepository? repo})
    : repo = repo ?? PrincipalRepository();

  final PrincipalRepository repo;

  final PLoad<PSnap> classes = PLoad<PSnap>();
  final PLoad<PSnap> children = PLoad<PSnap>();
  final PLoad<PSnap> attendance = PLoad<PSnap>();
  final PLoad<PSnap> closures = PLoad<PSnap>();
  final PLoad<PSnap> handovers = PLoad<PSnap>();
  final PLoad<PSnap> diary = PLoad<PSnap>();
  final PLoad<PSnap> medication = PLoad<PSnap>();
  final PLoad<PSnap> incidents = PLoad<PSnap>();

  final RxString dayKey = ''.obs;
  final RxString query = ''.obs;
  final RxString classFilter = ''.obs;
  final RxString statusFilter = ''.obs;

  String get today => CampusClock(SessionController.to.timezone).dayKey();

  @override
  void onInit() {
    super.onInit();
    dayKey.value = today;
  }

  @override
  void onScopeChanged() {
    for (final l in [classes, children, attendance, closures, handovers, diary, medication, incidents]) {
      l.reset();
    }
    dayKey.value = today;
    query.value = '';
    classFilter.value = '';
    statusFilter.value = '';
  }

  Future<void> _list(PLoad<PSnap> l, Future<PSnap> Function() f) =>
      runLoad<PSnap>(l, f, isEmpty: (d) => d.items.isEmpty, fromCache: (d) => d.fromCache);

  Future<void> loadClasses() => _list(classes, repo.classes);
  Future<void> loadChildren() => _list(children, repo.children);
  Future<void> loadAttendance() async {
    await _list(attendance, () => repo.attendance(dayKey.value));
    try {
      closures.data.value = await repo.attendanceClosures(dayKey.value);
    } catch (_) {
      closures.data.value = null;
    }
  }

  Future<void> loadHandovers() => _list(handovers, () => repo.handovers(dayKey.value));
  Future<void> loadDiary() => _list(diary, () => repo.dailyLogs(dayKey.value));
  Future<void> loadMedication() => _list(medication, repo.medicationRequests);
  Future<void> loadIncidents() => _list(incidents, repo.incidents);

  void setDay(String key) {
    dayKey.value = key;
  }

  /// Class id -> name.
  String className(String? id) {
    if (id == null || id.isEmpty) return '';
    for (final c in classes.data.value?.items ?? const <PDoc>[]) {
      if (c.id == id) return c.str('name', id);
    }
    return '';
  }

  /// Child id -> full name (falls back to the id; never shows another child).
  String childName(String id) {
    for (final c in children.data.value?.items ?? const <PDoc>[]) {
      if (c.id == id) return c.str('fullName', id);
    }
    return id;
  }

  /// Number of active children of a class.
  int headcount(String classId) => (children.data.value?.items ?? const <PDoc>[])
      .where((c) => c.str('classId') == classId && c.str('status') == 'active')
      .length;

  List<PDoc> filteredChildren() {
    final q = query.value.trim().toLowerCase();
    return (children.data.value?.items ?? const <PDoc>[]).where((c) {
      if (classFilter.value.isNotEmpty && c.str('classId') != classFilter.value) return false;
      if (statusFilter.value.isNotEmpty && c.str('status') != statusFilter.value) return false;
      if (q.isEmpty) return true;
      return c.str('fullName').toLowerCase().contains(q) || c.str('code').toLowerCase().contains(q);
    }).toList()
      ..sort((a, b) => a.str('fullName').compareTo(b.str('fullName')));
  }

  void clearFilters() {
    query.value = '';
    classFilter.value = '';
    statusFilter.value = '';
  }

  bool get hasFilters =>
      query.value.isNotEmpty || classFilter.value.isNotEmpty || statusFilter.value.isNotEmpty;
}
