import 'package:get/get.dart';

import '../models/ui_models/app_tone.dart';
import '../repository/firestore_repository.dart';
import '../services/network/app_exception.dart';
import '../services/storage/scoped_cache.dart';
import '../utils/app_log.dart';
import 'session_controller.dart';

/// Observable state of one async load (list or detail).
class PLoad<T> {
  final Rx<ViewState> state = ViewState.loading.obs;
  final Rxn<T> data = Rxn<T>();
  final Rxn<AppException> error = Rxn<AppException>();
  final Rxn<DateTime> staleSince = Rxn<DateTime>();

  void reset() {
    state.value = ViewState.loading;
    data.value = null;
    error.value = null;
    staleSince.value = null;
  }
}

AppException toAppException(Object e) {
  if (e is AppException) return e;
  return FirestoreRepository.mapError(e);
}

/// Shared loading logic of the principal controllers.
///
/// * Firestore lists: pass [fromCache]; cache hits show `offlineStale`
///   (or `offlineEmpty` when empty). Firestore keeps its own offline cache.
/// * API data: pass [encode]/[decode] + [cacheName] to keep a scoped JSON copy
///   used when the network is down.
mixin PrincipalLoader on GetxController {
  int get loaderEpoch => SessionController.to.scopeEpoch.value;

  Future<void> runLoad<T>(
    PLoad<T> l,
    Future<T> Function() fetch, {
    bool Function(T d)? isEmpty,
    bool Function(T d)? fromCache,
    String? cacheName,
    Object? Function(T d)? encode,
    T? Function(Object? json)? decode,
    bool silent = false,
  }) async {
    final epoch = loaderEpoch;
    if (!silent || l.data.value == null) l.state.value = ViewState.loading;
    l.error.value = null;
    try {
      final d = await fetch();
      if (epoch != loaderEpoch) return;
      l.data.value = d;
      final cached = fromCache?.call(d) ?? false;
      final empty = isEmpty?.call(d) ?? false;
      if (cached) {
        l.staleSince.value = DateTime.now();
        l.state.value = empty ? ViewState.offlineEmpty : ViewState.offlineStale;
      } else if (empty) {
        l.state.value = ViewState.empty;
      } else {
        l.state.value = ViewState.ready;
        l.staleSince.value = null;
        final key = SessionController.to.scopeKey;
        if (cacheName != null && encode != null && key != null) {
          try {
            await ScopedCache.write(key, cacheName, encode(d));
          } catch (e) {
            AppLog.info('cache write failed');
          }
        }
      }
    } catch (e) {
      if (epoch != loaderEpoch) return;
      final ex = toAppException(e);
      l.error.value = ex;
      if (ex.isNetwork) {
        final key = SessionController.to.scopeKey;
        final entry = (cacheName != null && key != null) ? ScopedCache.read(key, cacheName) : null;
        final restored = entry == null ? null : decode?.call(entry.data);
        if (restored != null) {
          l.data.value = restored;
          l.staleSince.value = entry!.savedAt;
          l.state.value = ViewState.offlineStale;
          return;
        }
        l.state.value = ViewState.offlineEmpty;
      } else if (ex.isForbidden) {
        l.state.value = ViewState.forbidden;
      } else {
        l.state.value = ViewState.error;
      }
    }
  }
}
