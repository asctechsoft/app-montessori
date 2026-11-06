// ignore_for_file: prefer_initializing_formals
import 'package:get/get.dart';

import '../models/data_models/teacher_models.dart';
import '../models/ui_models/app_tone.dart';
import '../repository/firestore_repository.dart';
import '../repository/teacher_repository.dart';
import '../services/network/api_service.dart';
import '../services/network/app_exception.dart';
import 'scope_aware.dart';
import 'teacher_class_controller.dart';
import 'teacher_common.dart';

/// T04 medication requests and incidents.
class TeacherCareController extends GetxController with ScopeAware {
  TeacherCareController({TeacherClassController? classCtl, TeacherRepository? repo})
    : _cls = classCtl,
      _repo = repo;

  final TeacherClassController? _cls;
  final TeacherRepository? _repo;
  TeacherClassController get cls => _cls ?? teacherCtl(() => TeacherClassController());
  TeacherRepository get repo => _repo ?? teacherRepo();

  final Rx<ViewState> state = ViewState.loading.obs;
  final Rxn<AppException> error = Rxn<AppException>();
  final RxList<MedRequest> meds = <MedRequest>[].obs;
  final RxList<IncidentRec> incidents = <IncidentRec>[].obs;
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
    meds.clear();
    incidents.clear();
    state.value = ViewState.loading;
    load();
  }

  Future<void> load() async {
    final epoch = ++_epoch;
    if (meds.isEmpty && incidents.isEmpty) state.value = ViewState.loading;
    try {
      if (cls.state.value == ViewState.loading) await cls.load(silent: true);
      // Medication and incidents have different read rules: one being forbidden must not hide the other.
      final r = await Future.wait<DataSnapshot<dynamic>?>([
        repo.medRequests(),
        repo.incidents().then<DataSnapshot<dynamic>?>((v) => v).catchError((Object e) {
          if (toAppException(e).isForbidden) return null;
          throw e;
        }),
      ]);
      if (epoch != _epoch) return;
      final m = r[0] as DataSnapshot<MedRequest>;
      final i = r[1] as DataSnapshot<IncidentRec>?;
      // Only children of the classes assigned to this teacher.
      final ids = cls.allKids.map((c) => c.id).toSet();
      meds.assignAll(m.items.where((x) => ids.contains(x.childId)));
      incidents.assignAll((i?.items ?? const <IncidentRec>[]).where((x) => x.childId == null || ids.contains(x.childId)));
      stale.value = m.fromCache || (i?.fromCache ?? false);
      loadedAt.value = m.receivedAt;
      error.value = null;
      state.value = (meds.isEmpty && incidents.isEmpty)
          ? (stale.value ? ViewState.offlineEmpty : ViewState.empty)
          : (stale.value ? ViewState.offlineStale : ViewState.ready);
    } catch (e) {
      if (epoch != _epoch) return;
      final ex = toAppException(e);
      error.value = ex;
      state.value = (meds.isNotEmpty || incidents.isNotEmpty) && ex.isNetwork
          ? ViewState.offlineStale
          : (ex.isForbidden ? ViewState.forbidden : ViewState.error);
    }
  }

  List<MedRequest> medsWhere(Set<String> statuses) =>
      meds.where((m) => statuses.contains(m.status)).toList();

  String nameOf(String? childId) =>
      childId == null ? '' : cls.childById(childId)?.fullName ?? '';

  Future<void> decide(MedRequest m, String decision, {String? reason, String? opId}) async {
    await repo.decideMedication(
      id: m.id,
      decision: decision,
      reason: reason,
      opId: opId ?? ApiService.newOpId(),
    );
    await load();
  }

  /// `medication.administer`: [dose] must be typed by the nurse/teacher; it is
  /// never pre-filled from the request (no guessing).
  Future<void> administer({
    required MedRequest request,
    required DateTime at,
    required String dose,
    required String result,
    String? note,
    required String opId,
  }) async {
    await repo.administer(
      requestId: request.id,
      at: at,
      dose: dose,
      result: result,
      note: note,
      opId: opId,
    );
  }

  Future<List<MedAdmin>> history(String requestId) async {
    final r = await repo.medAdmins(requestId);
    final l = r.items.toList()
      ..sort((a, b) => (b.at ?? DateTime(0)).compareTo(a.at ?? DateTime(0)));
    return l;
  }

  Future<void> saveIncident(Map<String, dynamic> payload, String opId) async {
    await repo.saveIncident(payload, opId);
    await load();
  }
}
