import 'package:get/get.dart';

import '../models/data_models/parent_models.dart';
import '../repository/firestore_repository.dart';
import '../services/network/app_exception.dart';
import 'parent_load.dart';
import 'parent_tuition_controller.dart';
import 'scope_aware.dart';

/// P01: home of the selected child. Each block loads on its own so one failing
/// source does not hide the others; [partialFailure] tells the screen.
class ParentHomeController extends GetxController with ScopeAware, ParentLoad {
  final Rxn<HandoverInfo> handover = Rxn<HandoverInfo>();
  final Rxn<AttendanceInfo> attendance = Rxn<AttendanceInfo>();
  final Rxn<DailyLog> todayLog = Rxn<DailyLog>();
  final RxList<Receivable> receivables = <Receivable>[].obs;
  final RxList<NotificationItem> notifications = <NotificationItem>[].obs;
  final RxBool loaded = false.obs;
  final RxBool partialFailure = false.obs;
  final RxBool feesForbidden = false.obs;

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
    handover.value = null;
    attendance.value = null;
    todayLog.value = null;
    receivables.clear();
    notifications.clear();
    loaded.value = false;
    partialFailure.value = false;
    feesForbidden.value = false;
  }

  TuitionSummary get tuition => TuitionSummary.from(receivables);

  int get unread => notifications.where((n) => !n.isRead).length;

  NotificationItem? get latestNotification {
    if (notifications.isEmpty) return null;
    final l = [...notifications]
      ..sort((a, b) => (b.sentAt ?? DateTime(0)).compareTo(a.sentAt ?? DateTime(0)));
    return l.first;
  }

  @override
  Future<bool> fetch() async {
    final cid = childId!;
    final day = today;
    var cached = false;
    var failed = 0;
    AppException? first;
    Future<void> sec<T>(
      Future<DataSnapshot<T>> f,
      void Function(List<T>) apply, {
      bool fees = false,
    }) async {
      try {
        final s = await f;
        cached = cached || s.fromCache;
        apply(s.items);
      } catch (e) {
        final ex = FirestoreRepository.mapError(e);
        if (fees && ex.isForbidden) {
          feesForbidden.value = true;
          return;
        }
        failed++;
        first ??= ex;
      }
    }

    final uidNow = uid;
    await Future.wait([
      sec(repo.handoverOn(cid, day), (l) => handover.value = l.isEmpty ? null : l.first),
      sec(repo.attendanceOn(cid, day), (l) => attendance.value = l.isEmpty ? null : l.first),
      sec(repo.publishedLogs(cid, [day]), (l) => todayLog.value = l.isEmpty ? null : l.first),
      sec(
        repo.receivables(cid),
        (l) => receivables.assignAll(l.where((r) => r.isVisible)),
        fees: true,
      ),
      sec(repo.notifications(uidNow), (l) {
        final campus = session.campusId;
        notifications.assignAll(l.where((n) => n.campusId == null || n.campusId == campus));
      }),
    ]);
    if (failed >= 5) throw first!;
    partialFailure.value = failed > 0;
    loaded.value = true;
    return cached;
  }
}
