import 'package:get/get.dart';

import '../models/ui_models/app_tone.dart';
import '../repository/firestore_repository.dart';
import '../repository/parent_repository.dart';
import '../services/network/api_service.dart';
import '../services/network/app_exception.dart';
import '../utils/date_formatter.dart';
import 'session_controller.dart';

/// Shared loading logic of the parent controllers: view state for `StatusView`,
/// stale-offline detection, scope-epoch guard (a late answer of the previous
/// child/campus is dropped), and a helper for confirmed writes.
mixin ParentLoad on GetxController {
  final Rx<ViewState> state = ViewState.loading.obs;
  final Rxn<AppException> error = Rxn<AppException>();
  final Rxn<DateTime> staleSince = Rxn<DateTime>();

  ParentRepository get repo => ParentRepository.to;
  SessionController get session => SessionController.to;
  String? get childId => session.childId;
  String get uid => session.uid.value;

  /// Today's `dayKey` in the campus time zone.
  String get today => CampusClock(session.timezone).dayKey();

  /// True when the controller holds data worth showing (even stale).
  bool get hasData;

  /// Reads everything; returns true when ANY result came from the local cache.
  /// Throws on failure.
  Future<bool> fetch();

  void clearData();

  /// This screen needs a selected child (false: tenant-level screen).
  bool get needsChild => true;

  Future<void> load() async {
    if (session.orgId == null || (needsChild && childId == null)) {
      clearData();
      state.value = ViewState.empty;
      return;
    }
    if (!hasData) state.value = ViewState.loading;
    final epoch = session.scopeEpoch.value;
    try {
      final cached = await fetch();
      if (epoch != session.scopeEpoch.value) return;
      error.value = null;
      staleSince.value = cached ? DateTime.now() : null;
      if (!hasData) {
        state.value = cached ? ViewState.offlineEmpty : ViewState.empty;
      } else {
        state.value = cached ? ViewState.offlineStale : ViewState.ready;
      }
    } catch (e) {
      if (epoch != session.scopeEpoch.value) return;
      final ex = FirestoreRepository.mapError(e);
      error.value = ex;
      if (ex.isForbidden) {
        state.value = ViewState.forbidden;
      } else if (ex.isNetwork) {
        state.value = hasData ? ViewState.offlineStale : ViewState.offlineEmpty;
      } else {
        state.value = hasData ? ViewState.offlineStale : ViewState.error;
      }
    }
  }

  /// Calls a write action in the active org/campus. Throws [AppException];
  /// callers show success ONLY after this returns.
  Future<Map<String, dynamic>> write(
    String action,
    Map<String, dynamic> payload, {
    required String opId,
  }) => ApiService.to.call(
    action,
    orgId: session.orgId,
    campusId: session.campusId,
    payload: payload,
    opId: opId,
  );
}
