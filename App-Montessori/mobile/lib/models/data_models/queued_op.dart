import '../ui_models/app_tone.dart';

/// One write waiting to be sent when the device is back online.
/// Only actions in `OfflineQueue.allowedActions` can be queued.
class QueuedOp {
  QueuedOp({
    required this.opId,
    required this.action,
    required this.orgId,
    required this.campusId,
    required this.payload,
    required this.deviceTime,
    this.state = SyncState.pending,
    this.attempts = 0,
    this.lastError,
    this.lastErrorCode,
    this.label,
  });

  /// Idempotency key (CONTRACT §2): resending returns the first result.
  final String opId;
  final String action;
  final String orgId;
  final String campusId;
  final Map<String, dynamic> payload;

  /// Device clock when the user tapped; shown as "Chưa đồng bộ" time.
  final DateTime deviceTime;

  /// pending = waiting/retrying (network); failed = server rejected, needs the
  /// user to retry or discard; synced = confirmed by the server.
  SyncState state;
  int attempts;
  String? lastError;
  String? lastErrorCode;

  /// Optional short description for the UI (child name, "Chấm vào"...).
  final String? label;

  Map<String, dynamic> toJson() => {
    'opId': opId,
    'action': action,
    'orgId': orgId,
    'campusId': campusId,
    'payload': payload,
    'deviceTime': deviceTime.toIso8601String(),
    'state': state.name,
    'attempts': attempts,
    'lastError': lastError,
    'lastErrorCode': lastErrorCode,
    'label': label,
  };

  factory QueuedOp.fromJson(Map<String, dynamic> j) => QueuedOp(
    opId: j['opId'].toString(),
    action: j['action'].toString(),
    orgId: j['orgId'].toString(),
    campusId: j['campusId'].toString(),
    payload: (j['payload'] is Map)
        ? (j['payload'] as Map).map((k, v) => MapEntry(k.toString(), v))
        : <String, dynamic>{},
    deviceTime:
        DateTime.tryParse(j['deviceTime']?.toString() ?? '') ?? DateTime.now(),
    state: SyncState.values.firstWhere(
      (s) => s.name == j['state'],
      orElse: () => SyncState.pending,
    ),
    attempts: (j['attempts'] as num?)?.toInt() ?? 0,
    lastError: j['lastError']?.toString(),
    lastErrorCode: j['lastErrorCode']?.toString(),
    label: j['label']?.toString(),
  );
}
