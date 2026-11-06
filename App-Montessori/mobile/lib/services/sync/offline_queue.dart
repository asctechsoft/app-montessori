import 'dart:convert';

import 'package:get/get.dart';

import '../../configs/app_config.dart';
import '../../configs/pref_const.dart';
import '../../configs/pref_defaults.dart';
import '../../models/data_models/queued_op.dart';
import '../../models/ui_models/app_tone.dart';
import '../../utils/app_log.dart';
import '../connectivity_service.dart';
import '../network/api_service.dart';
import '../network/app_exception.dart';
import '../storage/pref_store.dart';

typedef QueueSender = Future<void> Function(QueuedOp op);

/// Thrown by [OfflineQueue.enqueue] for an action that must never be queued.
class QueueNotAllowedException implements Exception {
  const QueueNotAllowedException(this.action);
  final String action;
  @override
  String toString() => 'QueueNotAllowedException($action)';
}

/// Queue of writes made while offline (DESIGN_SYSTEM §12, CONTRACT §8).
///
/// ALLOWED (whitelist): child drop-off receive (`handover.receive`), staff
/// punch (`punch.record`) and attendance marking (`attendance.mark`).
/// NEVER queued: payments, child pick-up (`handover.pickup`), refund approval,
/// any approval decision. Calling [enqueue] with those throws.
///
/// Every op has an `opId` (server de-duplicates, so a resend after a lost
/// response does not double-write) and the device time. UI must show
/// "Chưa đồng bộ" (`SyncBadge`) for pending/failed ops and must NOT say
/// "success" until the server confirms ([flush] removes the op then).
///
/// Ops are stored per user id in SharedPreferences and survive restarts.
class OfflineQueue extends GetxService {
  OfflineQueue({QueueSender? sender}) : _sender = sender ?? _defaultSender;

  static OfflineQueue get to => Get.find<OfflineQueue>();

  static const Set<String> allowedActions = {
    'handover.receive',
    'punch.record',
    'attendance.mark',
  };

  static bool isAllowed(String action) => allowedActions.contains(action);

  static Future<void> _defaultSender(QueuedOp op) async {
    await ApiService.to.call(
      op.action,
      orgId: op.orgId,
      campusId: op.campusId,
      payload: op.payload,
      opId: op.opId,
    );
  }

  final QueueSender _sender;

  /// Pending and failed ops of the signed-in user (oldest first).
  final RxList<QueuedOp> items = <QueuedOp>[].obs;
  final RxBool isFlushing = false.obs;
  final Rxn<DateTime> lastSyncedAt = Rxn<DateTime>();

  String? _uid;

  /// Number of ops not yet confirmed by the server.
  int get unsyncedCount => items.length;

  String _key(String uid) => '${PrefConst.offlineQueuePrefix}$uid';

  /// Loads the queue of [uid] (null = signed out: memory is cleared, the stored
  /// queue stays for the next sign-in of that user).
  Future<void> bindUser(String? uid) async {
    _uid = uid;
    items.clear();
    if (uid == null) return;
    final raw = PrefStore.getString(_key(uid), PrefDefaults.offlineQueue);
    try {
      final list = jsonDecode(raw) as List<dynamic>;
      items.assignAll(
        list.map((e) => QueuedOp.fromJson(e as Map<String, dynamic>)),
      );
    } catch (e, st) {
      AppLog.error('offline queue load', e, st);
    }
  }

  /// Starts auto-flush when the connection returns.
  void listenConnectivity() {
    if (!Get.isRegistered<ConnectivityService>()) return;
    ever<bool>(ConnectivityService.to.isOnline, (online) {
      if (online) flush();
    });
  }

  /// Adds an op. Throws [QueueNotAllowedException] for forbidden actions and
  /// [StateError] when nobody is signed in or the queue is full.
  Future<QueuedOp> enqueue({
    required String action,
    required String orgId,
    required String campusId,
    required Map<String, dynamic> payload,
    String? opId,
    String? label,
    DateTime? deviceTime,
  }) async {
    if (!isAllowed(action)) throw QueueNotAllowedException(action);
    if (_uid == null) throw StateError('No signed-in user');
    if (items.length >= AppConfig.offlineMaxItems) {
      throw StateError('Offline queue is full');
    }
    final id = opId ?? ApiService.newOpId();
    // Same opId twice (double tap) must not create two entries.
    final existing = items.firstWhereOrNull((o) => o.opId == id);
    if (existing != null) return existing;
    final op = QueuedOp(
      opId: id,
      action: action,
      orgId: orgId,
      campusId: campusId,
      payload: payload,
      deviceTime: deviceTime ?? DateTime.now(),
      label: label,
    );
    items.add(op);
    await _persist();
    return op;
  }

  QueuedOp? find(String opId) => items.firstWhereOrNull((o) => o.opId == opId);

  /// `pending`/`failed` while queued, `synced` once the server confirmed it
  /// (the op is no longer in the list).
  SyncState stateOf(String opId) => find(opId)?.state ?? SyncState.synced;

  /// Ops of the active scope, for a "Chưa đồng bộ" list.
  List<QueuedOp> forScope(String orgId, String campusId) => items
      .where((o) => o.orgId == orgId && o.campusId == campusId)
      .toList();

  /// Sends pending ops in order. A network error stops the run (ops stay
  /// pending); a business rejection marks that op `failed` and continues.
  Future<void> flush() async {
    if (isFlushing.value || _uid == null) return;
    isFlushing.value = true;
    try {
      for (final op in List<QueuedOp>.of(items)) {
        if (op.state != SyncState.pending) continue;
        op.attempts++;
        try {
          await _sender(op);
          items.remove(op);
          lastSyncedAt.value = DateTime.now();
        } on AppException catch (e) {
          if (e.isNetwork) {
            op.attempts--;
            break;
          }
          op.lastError = e.userMessage;
          op.lastErrorCode = e.code;
          if (!e.isRetryable || op.attempts >= AppConfig.offlineMaxAttempts) {
            op.state = SyncState.failed;
          }
          if (e.isUnauthenticated) break;
        } catch (e, st) {
          AppLog.error('offline flush', e, st);
          op.lastError = e.toString();
          if (op.attempts >= AppConfig.offlineMaxAttempts) {
            op.state = SyncState.failed;
          }
        }
        items.refresh();
        await _persist();
      }
    } finally {
      isFlushing.value = false;
      await _persist();
    }
  }

  /// User taps "Thử lại" on a failed op.
  Future<void> retry(String opId) async {
    final op = find(opId);
    if (op == null) return;
    op.state = SyncState.pending;
    op.attempts = 0;
    op.lastError = null;
    op.lastErrorCode = null;
    items.refresh();
    await _persist();
    await flush();
  }

  /// User gives up on an op (it never reached the server).
  Future<void> discard(String opId) async {
    items.removeWhere((o) => o.opId == opId);
    await _persist();
  }

  Future<void> _persist() async {
    final uid = _uid;
    if (uid == null) return;
    await PrefStore.setString(
      _key(uid),
      jsonEncode(items.map((o) => o.toJson()).toList()),
    );
  }
}
