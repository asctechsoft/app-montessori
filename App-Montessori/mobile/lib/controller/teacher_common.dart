import 'package:get/get.dart';

import '../repository/teacher_repository.dart';
import '../services/connectivity_service.dart';
import '../services/network/app_exception.dart';
import '../services/sync/offline_queue.dart';
import '../utils/date_formatter.dart';
import 'session_controller.dart';

/// Repository of the teacher role (replaceable in tests with `Get.put`).
TeacherRepository teacherRepo() {
  if (Get.isRegistered<TeacherRepository>()) return Get.find<TeacherRepository>();
  return Get.put<TeacherRepository>(TeacherRepository(), permanent: true);
}

/// Finds or creates a controller (kept for the session of the screen tree).
T teacherCtl<T extends GetxController>(T Function() make) =>
    Get.isRegistered<T>() ? Get.find<T>() : Get.put<T>(make());

/// Campus wall clock helper.
CampusClock teacherClock() => CampusClock(SessionController.to.timezone);

/// Maps anything thrown to an [AppException].
AppException toAppException(Object e) {
  if (e is AppException) return e;
  final t = e.toString();
  if (t.contains('permission-denied')) return const AppException(AppException.permissionDenied, '');
  if (t.contains('unavailable') || t.contains('SocketException') || t.contains('network')) {
    return const AppException(AppException.network, '');
  }
  return AppException(AppException.unknown, t);
}

enum SubmitOutcome {
  /// The server confirmed the write.
  confirmed,

  /// Saved on the device only: show "Chưa đồng bộ", never "success".
  queued,
}

bool get teacherIsOnline =>
    !Get.isRegistered<ConnectivityService>() || ConnectivityService.to.isOnline.value;

/// Sends a write that is ALLOWED offline (`handover.receive`, `punch.record`,
/// `attendance.mark`). Offline, or when the network fails mid-call, the op goes
/// to the [OfflineQueue] with the SAME opId (the server de-duplicates).
/// Business errors (validation, precondition, ...) are rethrown.
Future<SubmitOutcome> sendOrQueue({
  required String action,
  required Map<String, dynamic> payload,
  required String opId,
  required Future<void> Function() send,
  String? label,
  DateTime? deviceTime,
}) async {
  Future<SubmitOutcome> queue() async {
    final s = SessionController.to;
    await OfflineQueue.to.enqueue(
      action: action,
      orgId: s.orgId!,
      campusId: s.campusId!,
      payload: payload,
      opId: opId,
      label: label,
      deviceTime: deviceTime,
    );
    return SubmitOutcome.queued;
  }

  if (!teacherIsOnline) return queue();
  try {
    await send();
    return SubmitOutcome.confirmed;
  } catch (e) {
    final ex = toAppException(e);
    if (ex.isNetwork) return queue();
    throw ex;
  }
}
