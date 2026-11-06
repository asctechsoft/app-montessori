import 'package:get/get.dart';

import '../models/data_models/principal_models.dart';
import '../models/ui_models/app_tone.dart';
import '../repository/principal_repository.dart';
import '../services/network/api_service.dart';
import '../services/permission_service.dart';
import '../values/permissions.dart';
import 'principal_loader.dart';
import 'scope_aware.dart';
import 'session_controller.dart';

/// Approval centre (W47): pending requests of the active campus that the user
/// may decide, and the decision call.
class PrincipalApprovalsController extends GetxController
    with ScopeAware, PrincipalLoader {
  PrincipalApprovalsController({PrincipalRepository? repo})
    : repo = repo ?? PrincipalRepository();

  final PrincipalRepository repo;
  final PLoad<List<ApprovalItem>> load = PLoad<List<ApprovalItem>>();
  final RxString typeFilter = ''.obs;
  final RxMap<String, String> classNames = <String, String>{}.obs;

  /// One opId per (approval, decision) intent, reused on retry.
  final Map<String, String> _opIds = {};

  @override
  void onInit() {
    super.onInit();
    refreshData();
  }

  @override
  void onScopeChanged() {
    load.reset();
    typeFilter.value = '';
    _opIds.clear();
    refreshData();
  }

  bool get canSee => PermissionService.can(Perm.approvalsRead);

  /// May the user decide this item here (UI only; the server re-checks)?
  bool canDecide(ApprovalItem a) {
    if (a.requiredPerm.isEmpty) return false;
    final campus = a.campusId ?? SessionController.to.campusId;
    return PermissionService.can(a.requiredPerm, campusId: campus);
  }

  /// Own requests cannot be self-approved by non-owners; hide the CTA.
  bool isOwnRequest(ApprovalItem a) => a.requestedBy == SessionController.to.uid.value;

  Future<void> refreshData() async {
    if (!canSee) {
      load.state.value = ViewState.forbidden;
      return;
    }
    await runLoad<List<ApprovalItem>>(
      load,
      () async {
        final snap = await repo.pendingApprovals();
        final items = snap.items
            .map(ApprovalItem.new)
            .where((a) => a.status == 'pending')
            .where(canDecide)
            .toList()
          ..sort((a, b) => (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0)));
        _fromCache = snap.fromCache;
        return items;
      },
      isEmpty: (d) => d.isEmpty,
      fromCache: (_) => _fromCache,
    );
    if (PermissionService.can(Perm.classesRead)) {
      try {
        final cls = await repo.classes();
        classNames.assignAll({for (final k in cls.items) k.id: k.str('name', k.id)});
      } catch (_) {}
    }
  }

  bool _fromCache = false;

  List<ApprovalItem> get items {
    final all = load.data.value ?? const <ApprovalItem>[];
    if (typeFilter.value.isEmpty) return all;
    return all.where((a) => a.type == typeFilter.value).toList();
  }

  /// Types present in the pending list (for the filter chips).
  List<String> get presentTypes {
    final all = load.data.value ?? const <ApprovalItem>[];
    return kApprovalTypes.where((t) => all.any((a) => a.type == t)).toList();
  }

  /// Sends the decision. Throws AppException; on success removes the item.
  /// Never call this offline-queued: approvals need the server.
  Future<void> decide(ApprovalItem a, String decision, String note) async {
    final key = '${a.id}|$decision';
    final opId = _opIds.putIfAbsent(key, ApiService.newOpId);
    await repo.decide(
      id: a.id,
      decision: decision,
      note: note.trim(),
      opId: opId,
      approvalCampusId: a.campusId,
    );
    _opIds.remove(key);
    final cur = load.data.value;
    if (cur != null) {
      load.data.value = cur.where((x) => x.id != a.id).toList();
      if (load.data.value!.isEmpty) load.state.value = ViewState.empty;
    }
  }
}
