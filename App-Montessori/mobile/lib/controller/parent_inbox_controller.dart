import 'package:get/get.dart';

import '../models/data_models/parent_models.dart';
import '../services/network/api_service.dart';
import 'parent_load.dart';
import 'scope_aware.dart';

/// P07: notifications (through `notificationReceipts`) and conversations with
/// the school. Read/ack flags change only after the server confirmed.
class ParentInboxController extends GetxController with ScopeAware, ParentLoad {
  final RxList<NotificationItem> notifications = <NotificationItem>[].obs;
  final RxList<ThreadInfo> threads = <ThreadInfo>[].obs;
  final RxBool loaded = false.obs;
  final RxBool unreadOnly = false.obs;

  @override
  bool get needsChild => false;

  @override
  void onInit() {
    super.onInit();
    load();
  }

  @override
  bool get hasData => loaded.value;

  @override
  void onScopeChanged() {
    clearData();
    load();
  }

  @override
  void clearData() {
    notifications.clear();
    threads.clear();
    loaded.value = false;
  }

  int get unread => notifications.where((n) => !n.isRead).length;

  List<NotificationItem> get visibleNotifications {
    final l = notifications.where((n) => !unreadOnly.value || !n.isRead).toList()
      ..sort((a, b) => (b.sentAt ?? DateTime(0)).compareTo(a.sentAt ?? DateTime(0)));
    return l;
  }

  List<ThreadInfo> get sortedThreads => [...threads]
    ..sort((a, b) => (b.lastMessageAt ?? DateTime(0)).compareTo(a.lastMessageAt ?? DateTime(0)));

  @override
  Future<bool> fetch() async {
    final n = await repo.notifications(uid);
    var cached = n.fromCache;
    final campus = session.campusId;
    notifications.assignAll(n.items.where((x) => x.campusId == null || x.campusId == campus));
    try {
      final t = await repo.threads(uid);
      cached = cached || t.fromCache;
      final cid = childId;
      threads.assignAll(t.items.where((x) => cid == null || x.childId == null || x.childId == cid));
    } catch (_) {
      threads.clear();
    }
    loaded.value = true;
    return cached;
  }

  Future<String> body(String id) => repo.notificationBody(id);

  /// `notification.markRead`; the item turns read only after the server says so.
  Future<void> markRead(String id) async {
    final i = notifications.indexWhere((n) => n.id == id);
    if (i < 0 || notifications[i].isRead) return;
    await write('notification.markRead', {'id': id}, opId: ApiService.newOpId());
    notifications[i] = notifications[i].copyWith(readAt: DateTime.now());
  }

  Future<void> ack(String id) async {
    final i = notifications.indexWhere((n) => n.id == id);
    if (i < 0) return;
    await write('notification.ack', {'id': id}, opId: ApiService.newOpId());
    final now = DateTime.now();
    notifications[i] = notifications[i].copyWith(readAt: now, ackAt: now);
  }

  Future<void> openThread({
    required String subject,
    required String text,
    required String opId,
  }) async {
    await write('thread.open', {
      'childId': childId,
      'subject': subject,
      'priority': 'normal',
      'text': text,
    }, opId: opId);
    await load();
  }
}

/// One conversation: messages + sending.
class ParentThreadController extends GetxController with ParentLoad {
  ParentThreadController(this.thread);

  ThreadInfo thread;
  final RxList<ThreadMessage> messages = <ThreadMessage>[].obs;
  final RxBool loaded = false.obs;

  @override
  bool get needsChild => false;

  @override
  void onInit() {
    super.onInit();
    load();
  }

  @override
  bool get hasData => loaded.value;

  @override
  void clearData() {
    messages.clear();
    loaded.value = false;
  }

  @override
  Future<bool> fetch() async {
    final s = await repo.messages(thread.id);
    messages.assignAll(s.items);
    loaded.value = true;
    return s.fromCache;
  }

  /// Sends one message; reuse [opId] when retrying the same text.
  Future<void> send(String text, {required String opId}) async {
    await write('thread.post', {'threadId': thread.id, 'text': text}, opId: opId);
    await load();
  }
}
