import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:get/get.dart';

import '../configs/pref_const.dart';
import '../configs/pref_defaults.dart';
import '../models/ui_models/app_role.dart';
import '../models/ui_models/app_tone.dart';
import '../services/auth_service.dart';
import '../services/network/api_service.dart';
import '../services/push_service.dart';
import '../services/storage/pref_store.dart';
import '../services/sync/offline_queue.dart';
import '../utils/app_log.dart';
import '../values/app_pages.dart';
import '../values/route_name.dart';
import 'session_controller.dart';

/// Sign-in lifecycle on top of [AuthService] + [SessionController].
///
/// After a successful sign-in: bind the offline queue to the user, call
/// `invite.claimPending` then `org.listMine` (inside
/// `SessionController.loadMemberships`), register the push token. Sign-out
/// unregisters the device first and wipes every scoped cache.
class AuthController extends GetxController {
  static AuthController get to => Get.find<AuthController>();

  final Rxn<User> user = Rxn<User>();
  StreamSubscription<User?>? _sub;
  bool _signingOut = false;

  bool get isSignedIn => user.value != null;

  @override
  void onInit() {
    super.onInit();
    ApiService.to.onUnauthenticated = _onSessionInvalid;
    _sub = AuthService.to.authStateChanges.listen((u) {
      user.value = u;
      if (u == null && !_signingOut && SessionController.to.isSignedIn) {
        // Token revoked remotely (member suspended/revoked).
        _onSessionInvalid();
      }
    });
    user.value = AuthService.to.currentUser;
  }

  @override
  void onClose() {
    _sub?.cancel();
    super.onClose();
  }

  /// Email + password sign-in, then loads the session. Throws `AppException`.
  Future<void> signInWithEmail(String email, String password) async {
    final u = await AuthService.to.signInWithEmail(email, password);
    await PrefStore.setString(PrefConst.lastEmail, email.trim());
    await afterSignIn(u);
  }

  /// Loads the session of [u] (also used for an already signed-in cold start).
  Future<void> afterSignIn(User u) async {
    user.value = u;
    final session = SessionController.to;
    session.setUser(uid: u.uid, name: u.displayName, email: u.email);
    await OfflineQueue.to.bindUser(u.uid);
    await session.loadMemberships();
    if (session.loadState.value == ViewState.ready ||
        session.loadState.value == ViewState.offlineStale) {
      unawaited(PushService.to.register(u.uid, orgId: session.orgId));
      unawaited(OfflineQueue.to.flush());
    }
  }

  /// Where to go after the session is loaded: a shell, the context picker, or
  /// (no membership / error) the picker screen which shows the right state.
  Future<String> routeAfterSession() async {
    final session = SessionController.to;
    final state = session.loadState.value;
    if (state == ViewState.ready || state == ViewState.offlineStale) {
      final has = await session.resolveInitialContext();
      final role = session.role;
      if (has && role != null) return AppPages.shellFor(role);
    }
    return RouteName.contextPicker;
  }

  /// First route of a cold start.
  Future<String> startRoute() async {
    final u = AuthService.to.currentUser;
    if (u == null) return RouteName.login;
    await afterSignIn(u);
    return routeAfterSession();
  }

  /// Remembered email for the login form.
  String get lastEmail =>
      PrefStore.getString(PrefConst.lastEmail, PrefDefaults.lastEmail);

  /// Signs out. Pending offline ops stay on the device for the next sign-in.
  Future<void> signOut() async {
    _signingOut = true;
    try {
      await PushService.to.unregister();
      await OfflineQueue.to.bindUser(null);
      await SessionController.to.clear();
      await AuthService.to.signOut();
    } catch (e, st) {
      AppLog.error('signOut', e, st);
    } finally {
      _signingOut = false;
    }
    await Get.offAllNamed<void>(RouteName.login);
  }

  void _onSessionInvalid() {
    if (_signingOut) return;
    signOut();
  }

  /// Roles this account can use (for the profile "switch role" row).
  Set<AppRole> get roles => SessionController.to.availableRoles;
}
