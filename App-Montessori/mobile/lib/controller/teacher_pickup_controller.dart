// ignore_for_file: prefer_initializing_formals
import 'package:get/get.dart';

import '../models/data_models/teacher_models.dart';
import '../models/ui_models/app_tone.dart';
import '../repository/teacher_repository.dart';
import '../services/network/api_service.dart';
import '../services/network/app_exception.dart';
import 'teacher_class_controller.dart';
import 'teacher_common.dart';

/// Pick-up of one child (T02): hand-over record -> valid pick-up people ->
/// verification -> confirm. `handover.pickup` is ONLINE ONLY (never queued).
class TeacherPickupController extends GetxController {
  TeacherPickupController(this.child, {TeacherClassController? classCtl, TeacherRepository? repo})
    : _cls = classCtl,
      _repo = repo;

  final TeacherChild child;
  final TeacherClassController? _cls;
  final TeacherRepository? _repo;

  TeacherClassController get cls => _cls ?? teacherCtl(() => TeacherClassController());
  TeacherRepository get repo => _repo ?? teacherRepo();

  final Rx<ViewState> state = ViewState.loading.obs;
  final Rxn<AppException> error = Rxn<AppException>();
  final RxList<PickupAuth> auths = <PickupAuth>[].obs;
  final RxnString selectedId = RxnString();
  final RxString method = 'id_check'.obs;
  final RxBool checklistDone = false.obs;
  final RxnString lastBlockReason = RxnString();

  String? _opId;

  HandoverRec? get handover => cls.handovers[child.id];

  /// `received` | `picked_up` | `not_received`
  String get handoverState => handover?.state ?? 'not_received';

  String get dayKey => cls.dayKey;

  @override
  void onInit() {
    super.onInit();
    load();
  }

  Future<void> load() async {
    state.value = ViewState.loading;
    try {
      final r = await repo.pickupAuths(child.id);
      auths.assignAll(r.items);
      error.value = null;
      if (auths.isEmpty) {
        state.value = r.fromCache ? ViewState.offlineEmpty : ViewState.empty;
      } else {
        state.value = r.fromCache ? ViewState.offlineStale : ViewState.ready;
      }
    } catch (e) {
      final ex = toAppException(e);
      error.value = ex;
      state.value = ex.isForbidden
          ? ViewState.forbidden
          : (ex.isNetwork ? ViewState.offlineEmpty : ViewState.error);
    }
  }

  PickupAuth? get selected => auths.firstWhereOrNull((a) => a.id == selectedId.value);

  /// Reason the confirm button stays disabled (null = may confirm).
  /// Codes match the server `details.reason`.
  String? blockFor(PickupAuth? auth) {
    if (handoverState == 'picked_up') return 'already_picked_up';
    if (handoverState != 'received') return 'not_received';
    if (auth == null) return null;
    final now = teacherClock().wall(DateTime.now());
    final hhmm =
        '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
    return auth.blockAt(dayKey, hhmm)?.reason;
  }

  bool get canConfirm =>
      selected != null && blockFor(selected) == null && checklistDone.value && teacherIsOnline;

  void select(PickupAuth a) {
    if (selectedId.value != a.id) _opId = null;
    selectedId.value = a.id;
    lastBlockReason.value = null;
  }

  /// Calls `handover.pickup`. Throws [AppException]; `details['reason']` holds
  /// the server block reason.
  Future<void> confirm({String? note}) async {
    final a = selected;
    if (a == null) return;
    _opId ??= ApiService.newOpId();
    try {
      await repo.pickup(
        childId: child.id,
        dayKey: dayKey,
        pickupPersonId: a.id,
        method: method.value,
        note: note,
        opId: _opId!,
      );
      _opId = null;
      await cls.load(silent: true);
    } catch (e) {
      final ex = toAppException(e);
      lastBlockReason.value = ex.details['reason']?.toString();
      // A business rejection ends this intent: next attempt is a new one.
      if (!ex.isNetwork) _opId = null;
      throw ex;
    }
  }
}
