// ignore_for_file: prefer_initializing_formals
import 'dart:io';

import 'package:get/get.dart';

import '../models/data_models/teacher_models.dart';
import '../models/ui_models/app_tone.dart';
import '../repository/teacher_repository.dart';
import '../services/network/api_service.dart';
import '../services/network/app_exception.dart';
import '../utils/date_formatter.dart';
import '../values/permissions.dart';
import 'scope_aware.dart';
import 'session_controller.dart';
import 'teacher_class_controller.dart';
import 'teacher_common.dart';

/// Editable content of one child's diary (T03).
class DailyLogDraft {
  DailyLogDraft({
    Map<String, String>? meals,
    this.sleepFrom = '',
    this.sleepTo = '',
    this.toilet,
    this.mood,
    this.activities = '',
    this.note = '',
    List<String>? photoPaths,
  }) : meals = meals ?? {},
       photoPaths = photoPaths ?? [];

  /// `breakfast|lunch|snack` -> `good|some|little|none`
  Map<String, String> meals;
  String sleepFrom;
  String sleepTo;
  String? toilet;
  String? mood;
  String activities;
  String note;
  List<String> photoPaths;

  static const mealTypes = ['breakfast', 'lunch', 'snack'];
  static const mealLevels = ['all', 'most', 'half', 'little', 'none'];
  static const toiletOptions = ['independent', 'assisted', 'accident'];
  static const moods = ['happy', 'calm', 'tired', 'upset'];

  factory DailyLogDraft.from(DailyLog? l) {
    if (l == null) return DailyLogDraft();
    final sleep = l.sleep.isEmpty ? const <String, dynamic>{} : l.sleep.first;
    return DailyLogDraft(
      meals: {
        for (final m in l.meals)
          if ((m['slot'] ?? m['type']) != null && (m['amount'] ?? m['level']) != null) (m['slot'] ?? m['type']).toString(): (m['amount'] ?? m['level']).toString(),
      },
      sleepFrom: (sleep['from'] ?? '').toString(),
      sleepTo: (sleep['to'] ?? '').toString(),
      toilet: l.hygiene['toilet']?.toString(),
      mood: l.mood,
      activities: l.activities.join('\n'),
      note: l.note ?? '',
      photoPaths: List.of(l.photoPaths),
    );
  }

  DailyLogDraft copy() => DailyLogDraft(
    meals: Map.of(meals),
    sleepFrom: sleepFrom,
    sleepTo: sleepTo,
    toilet: toilet,
    mood: mood,
    activities: activities,
    note: note,
    photoPaths: List.of(photoPaths),
  );

  bool get isEmpty =>
      meals.isEmpty &&
      sleepFrom.isEmpty &&
      sleepTo.isEmpty &&
      toilet == null &&
      mood == null &&
      activities.trim().isEmpty &&
      note.trim().isEmpty &&
      photoPaths.isEmpty;

  /// `dailyLog.save` fields (without ids).
  Map<String, dynamic> toPayload() => {
    'meals': [
      for (final e in meals.entries) {'slot': e.key, 'amount': e.value},
    ],
    'sleep': [
      if (sleepFrom.isNotEmpty || sleepTo.isNotEmpty)
        {'from': sleepFrom, 'to': sleepTo},
    ],
    'hygiene': {'toilet': ?toilet},
    'mood': mood ?? '',
    'activities': [
      for (final a in activities.split('\n'))
        if (a.trim().isNotEmpty) a.trim(),
    ],
    'note': note.trim(),
    'photoPaths': photoPaths,
  };
}

/// T03 class diary: logs of the selected class and day.
class TeacherDiaryController extends GetxController with ScopeAware {
  TeacherDiaryController({TeacherClassController? classCtl, TeacherRepository? repo})
    : _cls = classCtl,
      _repo = repo;

  final TeacherClassController? _cls;
  final TeacherRepository? _repo;
  TeacherClassController get cls => _cls ?? teacherCtl(() => TeacherClassController());
  TeacherRepository get repo => _repo ?? teacherRepo();

  final Rx<ViewState> state = ViewState.loading.obs;
  final Rxn<AppException> error = Rxn<AppException>();
  final RxMap<String, DailyLog> logs = <String, DailyLog>{}.obs;
  final RxString day = ''.obs;
  final RxBool stale = false.obs;
  final Rxn<DateTime> loadedAt = Rxn<DateTime>();
  int _epoch = 0;

  @override
  void onInit() {
    super.onInit();
    day.value = teacherClock().dayKey();
    ever<String?>(cls.classId, (_) => load());
    ever<ViewState>(cls.state, (s) {
      if (s == ViewState.ready || s == ViewState.offlineStale) load();
    });
    load();
  }

  @override
  void onScopeChanged() {
    logs.clear();
    state.value = ViewState.loading;
    day.value = teacherClock().dayKey();
  }

  bool get isToday => day.value == teacherClock().dayKey();
  bool get canPublish => SessionController.to.can(Perm.carePublish);

  void shiftDay(int delta) {
    final d = DateFormatter.parseDayKey(day.value);
    if (d == null) return;
    final next = DateFormatter.dayKey(d.add(Duration(days: delta)));
    if (next.compareTo(teacherClock().dayKey()) > 0) return;
    day.value = next;
    load();
  }

  Future<void> load() async {
    final cid = cls.classId.value;
    if (cid == null) {
      state.value = switch (cls.state.value) {
        ViewState.loading => ViewState.loading,
        ViewState.error => ViewState.error,
        ViewState.forbidden => ViewState.forbidden,
        _ => ViewState.empty,
      };
      error.value = cls.error.value;
      return;
    }
    final epoch = ++_epoch;
    if (logs.isEmpty) state.value = ViewState.loading;
    try {
      final r = await repo.dailyLogs(cid, day.value);
      if (epoch != _epoch) return;
      logs.assignAll({for (final l in r.items) l.childId: l});
      stale.value = r.fromCache;
      loadedAt.value = r.receivedAt;
      error.value = null;
      state.value = cls.kids.isEmpty
          ? ViewState.empty
          : (r.fromCache ? ViewState.offlineStale : ViewState.ready);
    } catch (e) {
      if (epoch != _epoch) return;
      final ex = toAppException(e);
      error.value = ex;
      state.value = logs.isNotEmpty && ex.isNetwork
          ? ViewState.offlineStale
          : (ex.isForbidden ? ViewState.forbidden : ViewState.error);
    }
  }

  List<TeacherChild> get kids => cls.kids;

  /// `none | draft | published`
  String statusOf(String childId) => logs[childId]?.status ?? 'none';

  int get draftCount => logs.values.where((l) => !l.isPublished).length;

  List<TeacherChild> get publishable => kids
      .where((c) => logs[c.id] != null && !logs[c.id]!.isPublished)
      .toList();

  /// `dailyLog.save` (draft). One opId per child per intent: callers pass it so
  /// a retry reuses it.
  Future<void> save(TeacherChild child, DailyLogDraft draft, {String? opId}) async {
    final existing = logs[child.id];
    await repo.saveDailyLog({
      'childId': child.id,
      'dayKey': day.value,
      ...draft.toPayload(),
      if (existing != null) 'expectedVersion': existing.version,
    }, opId ?? ApiService.newOpId());
  }

  /// Applies [draft] to every child of [targets] (class template, then edit
  /// each child). Returns the children that failed with their error message.
  Future<Map<String, String>> saveTemplate(
    List<TeacherChild> targets,
    DailyLogDraft draft,
  ) async {
    final failed = <String, String>{};
    for (final c in targets) {
      // Keep what was already written for this child: only fill the blanks.
      final cur = DailyLogDraft.from(logs[c.id]);
      final merged = draft.copy()
        ..photoPaths = cur.photoPaths
        ..note = cur.note.isNotEmpty ? cur.note : draft.note;
      try {
        await save(c, merged);
      } catch (e) {
        failed[c.id] = toAppException(e).userMessage;
      }
    }
    await load();
    return failed;
  }

  Future<String> uploadPhoto(TeacherChild child, File f) =>
      repo.uploadDiaryPhoto(childId: child.id, dayKey: day.value, file: f);

  /// `dailyLog.publish` for the reviewed children.
  Future<Map<String, dynamic>> publish(List<TeacherChild> children, {String? opId}) async {
    final r = await repo.publishDailyLogs(
      classId: cls.classId.value!,
      dayKey: day.value,
      childIds: children.map((c) => c.id).toList(),
      opId: opId ?? ApiService.newOpId(),
    );
    await load();
    return r;
  }
}
