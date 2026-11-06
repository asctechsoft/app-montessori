import 'package:get/get.dart';

import 'session_controller.dart';

/// Mixin for feature controllers whose data depends on the active scope
/// (org / campus / role / child). When the user switches scope, the session
/// cleans the scoped cache and bumps `scopeEpoch`; this mixin then calls
/// [onScopeChanged] so the controller drops its data, cancels in-flight
/// requests/streams and reloads for the new scope.
///
/// A late response for the OLD scope must be ignored: capture
/// `final epoch = scopeEpoch;` before the request and check
/// `if (epoch != scopeEpoch) return;` after it (the Firestore repository
/// helpers already do this for streams).
mixin ScopeAware on GetxController {
  Worker? _scopeWorker;

  int get scopeEpoch => SessionController.to.scopeEpoch.value;

  /// Reset state and reload. Called after the cache of the old scope is gone.
  void onScopeChanged();

  @override
  void onInit() {
    super.onInit();
    _scopeWorker = ever<int>(
      SessionController.to.scopeEpoch,
      (_) => onScopeChanged(),
    );
  }

  @override
  void onClose() {
    _scopeWorker?.dispose();
    super.onClose();
  }
}
