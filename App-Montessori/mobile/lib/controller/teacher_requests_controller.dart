// ignore_for_file: prefer_initializing_formals
import 'package:get/get.dart';

import '../models/data_models/teacher_models.dart';
import '../models/ui_models/app_tone.dart';
import '../repository/firestore_repository.dart';
import '../repository/teacher_repository.dart';
import '../services/network/api_service.dart';
import '../services/network/app_exception.dart';
import 'scope_aware.dart';
import 'teacher_common.dart';
import 'teacher_time_controller.dart';

/// T06: my requests (punch adjustment, leave, shift swap) and payslips.
class TeacherRequestsController extends GetxController with ScopeAware {
  TeacherRequestsController({TeacherRepository? repo, TeacherTimeController? time})
    : _repo = repo,
      _time = time;

  final TeacherRepository? _repo;
  final TeacherTimeController? _time;
  TeacherRepository get repo => _repo ?? teacherRepo();
  TeacherTimeController get time => _time ?? teacherCtl(() => TeacherTimeController());

  final Rx<ViewState> state = ViewState.loading.obs;
  final Rxn<AppException> error = Rxn<AppException>();
  final RxList<PunchAdjust> adjusts = <PunchAdjust>[].obs;
  final RxList<StaffLeaveRec> leaves = <StaffLeaveRec>[].obs;
  final RxList<ShiftSwapRec> swaps = <ShiftSwapRec>[].obs;
  final RxList<ShiftSwapRec> swapsToMe = <ShiftSwapRec>[].obs;
  final RxList<Payslip> payslips = <Payslip>[].obs;
  final RxBool stale = false.obs;
  int _epoch = 0;

  @override
  void onInit() {
    super.onInit();
    load();
  }

  @override
  void onScopeChanged() {
    adjusts.clear();
    leaves.clear();
    swaps.clear();
    swapsToMe.clear();
    payslips.clear();
    state.value = ViewState.loading;
    load();
  }

  bool get isEmpty => adjusts.isEmpty && leaves.isEmpty && swaps.isEmpty && swapsToMe.isEmpty && payslips.isEmpty;

  Future<void> load() async {
    final epoch = ++_epoch;
    if (isEmpty) state.value = ViewState.loading;
    try {
      final r = await Future.wait<DataSnapshot<dynamic>>([
        repo.punchAdjustments(),
        repo.staffLeaves(),
        repo.shiftSwaps(),
        repo.swapsForMe(),
        repo.payslips(),
      ]);
      if (epoch != _epoch) return;
      adjusts.assignAll((r[0] as DataSnapshot<PunchAdjust>).items);
      leaves.assignAll((r[1] as DataSnapshot<StaffLeaveRec>).items);
      swaps.assignAll((r[2] as DataSnapshot<ShiftSwapRec>).items);
      swapsToMe.assignAll(
        (r[3] as DataSnapshot<ShiftSwapRec>).items.where((s) => s.status == 'awaiting_peer'),
      );
      payslips.assignAll((r[4] as DataSnapshot<Payslip>).items);
      stale.value = r.any((x) => x.fromCache);
      error.value = null;
      state.value = isEmpty
          ? (stale.value ? ViewState.offlineEmpty : ViewState.empty)
          : (stale.value ? ViewState.offlineStale : ViewState.ready);
    } catch (e) {
      if (epoch != _epoch) return;
      final ex = toAppException(e);
      error.value = ex;
      state.value = !isEmpty && ex.isNetwork
          ? ViewState.offlineStale
          : (ex.isForbidden ? ViewState.forbidden : ViewState.error);
    }
  }

  Future<void> _send(String action, Map<String, dynamic> payload, String? opId) async {
    await repo.request(action, payload, opId ?? ApiService.newOpId());
    await load();
  }

  /// `punchAdjust.request` (never edits the original punch).
  Future<void> requestAdjust({
    required String dayKey,
    required String kind,
    required String time,
    required bool nextDay,
    required String reason,
    String? opId,
  }) => _send('punchAdjust.request', {
    'dayKey': dayKey,
    'kind': kind,
    'requestedTime': time,
    if (nextDay) 'nextDay': true,
    'reason': reason,
  }, opId);

  Future<void> requestLeave({
    required String type,
    required String fromDay,
    required String toDay,
    required String reason,
    String? opId,
  }) => _send('staffLeave.request', {
    'type': type,
    'fromDay': fromDay,
    'toDay': toDay,
    'reason': reason,
  }, opId);

  Future<void> requestSwap({
    required String entryId,
    required String toEmployeeId,
    String? reason,
    String? opId,
  }) => _send('shiftSwap.request', {
    'entryId': entryId,
    'toEmployeeId': toEmployeeId,
    'reason': ?reason,
  }, opId);

  Future<void> respondSwap(ShiftSwapRec s, bool accept, {String? note, String? opId}) =>
      _send('shiftSwap.respond', {'id': s.id, 'accept': accept, 'note': ?note}, opId);
}
