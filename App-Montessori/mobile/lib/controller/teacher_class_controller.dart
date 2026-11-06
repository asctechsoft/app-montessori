// ignore_for_file: prefer_initializing_formals
import 'dart:async';

import 'package:get/get.dart';

import '../models/data_models/queued_op.dart';
import '../models/data_models/teacher_models.dart';
import '../models/ui_models/app_tone.dart';
import '../repository/firestore_repository.dart';
import '../repository/teacher_repository.dart';
import '../services/network/api_service.dart';
import '../services/network/app_exception.dart';
import '../services/sync/offline_queue.dart';
import '../values/permissions.dart';
import 'scope_aware.dart';
import 'session_controller.dart';
import 'teacher_common.dart';

/// Status filter of the child list (T02).
enum ChildFilter { all, present, absent, unmarked }

/// T01 + T02: assigned classes, children of the selected class, attendance,
/// hand-over state and the class leave requests. Shared by the home tab.
class TeacherClassController extends GetxController with ScopeAware {
  TeacherClassController({TeacherRepository? repo}) : _repo = repo;

  final TeacherRepository? _repo;
  TeacherRepository get repo => _repo ?? teacherRepo();

  final Rx<ViewState> state = ViewState.loading.obs;
  final Rxn<AppException> error = Rxn<AppException>();
  final Rxn<DateTime> loadedAt = Rxn<DateTime>();

  final RxList<TeacherClass> classes = <TeacherClass>[].obs;
  final RxnString classId = RxnString();
  final RxList<TeacherChild> allKids = <TeacherChild>[].obs;
  final RxMap<String, AttendanceRec> attendance = <String, AttendanceRec>{}.obs;
  final RxMap<String, HandoverRec> handovers = <String, HandoverRec>{}.obs;
  final RxList<LeaveReq> leaves = <LeaveReq>[].obs;
  final Rx<ChildFilter> filter = ChildFilter.all.obs;
  final RxString query = ''.obs;

  /// Latest `fromCache` flag of the reads (offline stale banner).
  final RxBool stale = false.obs;
  int _epoch = 0;

  String get dayKey => teacherClock().dayKey();

  TeacherClass? get selectedClass =>
      classes.firstWhereOrNull((c) => c.id == classId.value);

  List<TeacherChild> get kids =>
      allKids.where((c) => c.classId == classId.value).toList();

  TeacherChild? childById(String id) => allKids.firstWhereOrNull((c) => c.id == id);

  @override
  void onInit() {
    super.onInit();
    load();
  }

  @override
  void onScopeChanged() {
    _epoch++;
    classes.clear();
    allKids.clear();
    attendance.clear();
    handovers.clear();
    leaves.clear();
    classId.value = null;
    error.value = null;
    state.value = ViewState.loading;
    load();
  }

  Future<void> load({bool silent = false}) async {
    final epoch = ++_epoch;
    if (!silent && classes.isEmpty) state.value = ViewState.loading;
    try {
      final cs = await repo.classes();
      if (epoch != _epoch) return;
      classes.assignAll(cs.items);
      var cache = cs.fromCache;
      if (classes.isEmpty) {
        stale.value = cache;
        state.value = cache ? ViewState.offlineEmpty : ViewState.empty;
        return;
      }
      if (selectedClass == null) classId.value = classes.first.id;
      final kidLists = await Future.wait(classes.map((c) => repo.children(c.id)));
      if (epoch != _epoch) return;
      final kids = <TeacherChild>[];
      for (final k in kidLists) {
        kids.addAll(k.items);
        cache = cache || k.fromCache;
      }
      allKids.assignAll(kids);
      final cid = classId.value!;
      final day = dayKey;
      final r = await Future.wait<DataSnapshot<dynamic>>([
        repo.attendance(cid, day),
        repo.handovers(cid, day),
        repo.leaves(),
      ]);
      if (epoch != _epoch) return;
      final att = r[0] as DataSnapshot<AttendanceRec>;
      final ho = r[1] as DataSnapshot<HandoverRec>;
      final lv = r[2] as DataSnapshot<LeaveReq>;
      attendance.assignAll({for (final a in att.items) a.childId: a});
      handovers.assignAll({for (final h in ho.items) h.childId: h});
      final ids = allKids.map((c) => c.id).toSet();
      leaves.assignAll(lv.items.where((l) => ids.contains(l.childId)));
      cache = cache || att.fromCache || ho.fromCache || lv.fromCache;
      stale.value = cache;
      loadedAt.value = DateTime.now();
      error.value = null;
      state.value = cache ? ViewState.offlineStale : ViewState.ready;
      unawaited(_loadHealth(epoch));
    } catch (e) {
      if (epoch != _epoch) return;
      final ex = toAppException(e);
      error.value = ex;
      // Never wipe data we already have because the network failed.
      if (classes.isNotEmpty && ex.isNetwork) {
        stale.value = true;
        state.value = ViewState.offlineStale;
      } else if (ex.isForbidden) {
        state.value = ViewState.forbidden;
      } else if (classes.isEmpty && ex.isNetwork) {
        state.value = ViewState.offlineEmpty;
      } else {
        state.value = ViewState.error;
      }
    }
  }

  Future<void> _loadHealth(int epoch) async {
    if (!SessionController.to.can(Perm.childrenHealthRead)) return;
    final mine = kids;
    await Future.wait(mine.map((c) async {
      c.health ??= await repo.health(c.id);
    }));
    if (epoch == _epoch) allKids.refresh();
  }

  Future<void> selectClass(String id) async {
    if (classId.value == id) return;
    classId.value = id;
    attendance.clear();
    handovers.clear();
    filter.value = ChildFilter.all;
    await load(silent: true);
  }

  // ------------------------------------------------------------------- derived

  /// Effective state of a child today, including not-yet-synced local ops.
  String attendanceOf(String childId) =>
      attendance[childId]?.status ?? _queuedAttendance(childId) ?? 'unmarked';

  String handoverOf(String childId) =>
      handovers[childId]?.state ??
      (queuedDeviceTime(childId, 'handover.receive') != null ? 'received' : 'not_received');

  bool isPresent(String childId) => attendanceOf(childId) == 'present';

  String? _queuedAttendance(String childId) {
    for (final op in _queuedOps()) {
      if (op.action == 'attendance.mark') {
        final items = op.payload['items'];
        if (items is List) {
          for (final it in items) {
            if (it is Map && it['childId'] == childId) return it['status']?.toString();
          }
        }
      } else if (op.action == 'handover.receive' && op.payload['childId'] == childId) {
        return 'present';
      }
    }
    return null;
  }

  Iterable<QueuedOp> _queuedOps() {
    if (!Get.isRegistered<OfflineQueue>()) return const [];
    final s = SessionController.to;
    if (s.orgId == null || s.campusId == null) return const [];
    return OfflineQueue.to.forScope(s.orgId!, s.campusId!);
  }

  /// Device time of a not-yet-synced op of this child (shows "Chưa đồng bộ").
  DateTime? queuedDeviceTime(String childId, String action) {
    for (final op in _queuedOps()) {
      if (op.action != action) continue;
      if (op.payload['childId'] == childId) return op.deviceTime;
      final items = op.payload['items'];
      if (items is List && items.any((it) => it is Map && it['childId'] == childId)) {
        return op.deviceTime;
      }
    }
    return null;
  }

  SyncState? syncStateOf(String childId) {
    for (final op in _queuedOps()) {
      final match = op.payload['childId'] == childId ||
          (op.payload['items'] is List &&
              (op.payload['items'] as List).any((it) => it is Map && it['childId'] == childId));
      if (match && (op.action == 'handover.receive' || op.action == 'attendance.mark')) {
        return op.state;
      }
    }
    return null;
  }

  int count(String status) => kids.where((c) => attendanceOf(c.id) == status).length;
  int get presentCount => count('present');
  int get absentCount =>
      kids.where((c) => attendanceOf(c.id).startsWith('absent')).length;
  int get unmarkedCount => kids
      .where((c) => const ['unmarked', 'unconfirmed'].contains(attendanceOf(c.id)))
      .length;

  /// Present and not yet picked up.
  int get stillAtSchoolCount =>
      kids.where((c) => isPresent(c.id) && handoverOf(c.id) != 'picked_up').length;

  List<TeacherChild> get filteredKids {
    final q = query.value.trim().toLowerCase();
    return kids.where((c) {
      if (q.isNotEmpty && !c.fullName.toLowerCase().contains(q) && !c.code.toLowerCase().contains(q)) {
        return false;
      }
      final st = attendanceOf(c.id);
      return switch (filter.value) {
        ChildFilter.all => true,
        ChildFilter.present => st == 'present',
        ChildFilter.absent => st.startsWith('absent'),
        ChildFilter.unmarked => st == 'unmarked' || st == 'unconfirmed',
      };
    }).toList();
  }

  List<LeaveReq> get pendingLeaves => leaves.where((l) => l.isPending).toList();
  List<LeaveReq> get doneLeaves => leaves.where((l) => !l.isPending).toList();

  void clearFilters() {
    filter.value = ChildFilter.all;
    query.value = '';
  }

  // ------------------------------------------------------------------- actions

  /// Drop-off (`handover.receive`): confirms present with who brought the child
  /// and the time. Offline -> queued ("Chưa đồng bộ").
  Future<SubmitOutcome> receive({
    required TeacherChild child,
    required String droppedBy,
    DateTime? at,
    String? opId,
  }) async {
    final time = at ?? DateTime.now();
    final payload = repo.receivePayload(
      childId: child.id,
      dayKey: dayKey,
      droppedBy: droppedBy,
      at: time,
    );
    final id = opId ?? ApiService.newOpId();
    final out = await sendOrQueue(
      action: 'handover.receive',
      payload: payload,
      opId: id,
      deviceTime: time,
      label: child.fullName,
      send: () async {
        await repo.receive(payload, id);
      },
    );
    if (out == SubmitOutcome.confirmed) await load(silent: true);
    attendance.refresh();
    return out;
  }

  /// `attendance.mark` for [childIds] with [status] (bulk is reviewed by the UI
  /// before calling this).
  Future<SubmitOutcome> mark({
    required List<TeacherChild> children,
    required String status,
    String? note,
    String? opId,
  }) async {
    final cid = classId.value!;
    final now = DateTime.now();
    final items = [
      for (final c in children)
        {
          'childId': c.id,
          'status': status,
          if (status == 'present') 'arrivedAt': now.toUtc().toIso8601String(),
          if (note != null && note.isNotEmpty) 'note': note,
        },
    ];
    final id = opId ?? ApiService.newOpId();
    final payload = {'classId': cid, 'dayKey': dayKey, 'session': 'all', 'items': items};
    final out = await sendOrQueue(
      action: 'attendance.mark',
      payload: payload,
      opId: id,
      deviceTime: now,
      label: children.length == 1 ? children.first.fullName : '${children.length}',
      send: () async {
        final r = await repo.markAttendance(classId: cid, dayKey: dayKey, items: items, opId: id);
        final rejected = r['rejected'];
        if (rejected is List && rejected.isNotEmpty) {
          final first = rejected.first;
          throw AppException(
            AppException.precondition,
            first is Map ? (first['reason'] ?? '').toString() : '',
          );
        }
      },
    );
    if (out == SubmitOutcome.confirmed) await load(silent: true);
    attendance.refresh();
    return out;
  }

  Future<void> decideLeave(LeaveReq l, String decision, {String? note, String? opId}) async {
    await repo.decideLeave(
      id: l.id,
      decision: decision,
      note: note,
      opId: opId ?? ApiService.newOpId(),
    );
    await load(silent: true);
  }
}

/// Friendly title for "a child + class" lines.
String childNameOf(TeacherClassController c, String childId) =>
    c.childById(childId)?.fullName ?? '';

/// Re-exported so screens need no repository import.
typedef TeacherSnapshot<T> = DataSnapshot<T>;
