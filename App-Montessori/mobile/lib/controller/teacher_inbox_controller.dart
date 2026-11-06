// ignore_for_file: prefer_initializing_formals
import 'package:get/get.dart';

import '../models/data_models/teacher_models.dart';
import '../models/ui_models/app_tone.dart';
import '../repository/teacher_repository.dart';
import '../services/network/api_service.dart';
import '../services/network/app_exception.dart';
import 'scope_aware.dart';
import 'session_controller.dart';
import 'teacher_common.dart';

/// T07: notifications and message threads.
class TeacherInboxController extends GetxController with ScopeAware {
  TeacherInboxController({TeacherRepository? repo}) : _repo = repo;

  final TeacherRepository? _repo;
  TeacherRepository get repo => _repo ?? teacherRepo();

  final Rx<ViewState> state = ViewState.loading.obs;
  final Rxn<AppException> error = Rxn<AppException>();
  final RxList<NotificationItem> notifications = <NotificationItem>[].obs;
  final RxList<ThreadItem> threads = <ThreadItem>[].obs;
  final RxBool stale = false.obs;
  final Rxn<DateTime> loadedAt = Rxn<DateTime>();
  int _epoch = 0;

  @override
  void onInit() {
    super.onInit();
    load();
  }

  @override
  void onScopeChanged() {
    notifications.clear();
    threads.clear();
    state.value = ViewState.loading;
    load();
  }

  int get unreadCount => notifications.where((n) => n.unread).length;

  Future<void> load() async {
    final epoch = ++_epoch;
    if (notifications.isEmpty && threads.isEmpty) state.value = ViewState.loading;
    try {
      final n = await repo.notifications();
      final t = await repo.threads();
      if (epoch != _epoch) return;
      notifications.assignAll(n.items);
      threads.assignAll(t.items);
      stale.value = n.fromCache || t.fromCache;
      loadedAt.value = n.receivedAt;
      error.value = null;
      state.value = (notifications.isEmpty && threads.isEmpty)
          ? (stale.value ? ViewState.offlineEmpty : ViewState.empty)
          : (stale.value ? ViewState.offlineStale : ViewState.ready);
    } catch (e) {
      if (epoch != _epoch) return;
      final ex = toAppException(e);
      error.value = ex;
      state.value = (notifications.isNotEmpty || threads.isNotEmpty) && ex.isNetwork
          ? ViewState.offlineStale
          : (ex.isForbidden ? ViewState.forbidden : ViewState.error);
    }
  }

  /// Marks read only after the server confirms.
  Future<void> open(NotificationItem n) async {
    if (!n.unread) return;
    await repo.markRead(n.id);
    _replace(n.withReceipt(readAt: DateTime.now()));
  }

  Future<void> ack(NotificationItem n) async {
    await repo.ack(n.id);
    _replace(n.withReceipt(readAt: n.readAt ?? DateTime.now(), ackAt: DateTime.now()));
  }

  void _replace(NotificationItem n) {
    final i = notifications.indexWhere((x) => x.id == n.id);
    if (i >= 0) notifications[i] = n;
  }

  String get myUid => SessionController.to.uid.value;

  Future<List<MessageItem>> messages(String threadId) async => (await repo.messages(threadId)).items;

  Future<void> post(String threadId, String text, {String? opId}) =>
      repo.postMessage(threadId, text, opId ?? ApiService.newOpId()).then((_) {});

  Future<void> openThread({
    required String subject,
    required String text,
    String? classId,
    String? opId,
  }) async {
    await repo.openThread({
      'subject': subject,
      'text': text,
      'classId': ?classId,
      'priority': 'normal',
    }, opId ?? ApiService.newOpId());
    await load();
  }
}
