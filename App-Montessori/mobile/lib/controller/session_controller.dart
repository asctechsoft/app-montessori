import 'dart:convert';

import 'package:get/get.dart';

import '../configs/pref_const.dart';
import '../configs/pref_defaults.dart';
import '../models/data_models/membership.dart';
import '../models/data_models/session_context.dart';
import '../models/ui_models/app_role.dart';
import '../models/ui_models/app_tone.dart';
import '../services/network/api_service.dart';
import '../services/network/app_exception.dart';
import '../services/push_service.dart';
import '../services/storage/pref_store.dart';
import '../services/storage/scoped_cache.dart';
import '../utils/app_log.dart';

/// One selectable (organisation, role) pair with the campuses it may use.
class ContextOption {
  const ContextOption(this.membership, this.role, this.campuses);

  final OrgMembership membership;
  final AppRole role;
  final List<CampusInfo> campuses;
}

/// Who is signed in and what they are working on right now
/// (DESIGN_SYSTEM §15 `core/session` + `core/scope`).
///
/// * `user*` - identity, set by AuthController.
/// * `memberships` - from `invite.claimPending` + `org.listMine`.
/// * `context` - active org + campus + role (+ child for parents).
/// * `scopeEpoch` - bumps on every scope change; see `ScopeAware`.
///
/// Switching role, campus, organisation or child first wipes the scoped cache of
/// the old scope, then publishes the new context. Callers that may hold unsaved
/// input should check [hasUnsavedChanges] and confirm before switching
/// (`ScopeSelector` does this).
class SessionController extends GetxController {
  static SessionController get to => Get.find<SessionController>();

  // ---- identity
  final RxString uid = ''.obs;
  final RxString displayName = ''.obs;
  final RxString email = ''.obs;

  // ---- memberships
  final RxList<OrgMembership> memberships = <OrgMembership>[].obs;

  /// loading | ready | empty (signed in but no membership) | error |
  /// offlineStale (cached memberships) | offlineEmpty
  final Rx<ViewState> loadState = ViewState.loading.obs;
  final Rxn<AppException> loadError = Rxn<AppException>();
  final Rxn<DateTime> membershipsSavedAt = Rxn<DateTime>();

  // ---- scope
  final Rxn<SessionContext> context = Rxn<SessionContext>();
  final RxInt scopeEpoch = 0.obs;

  final Set<bool Function()> _dirtyGuards = {};

  bool get isSignedIn => uid.value.isNotEmpty;

  // ---------------------------------------------------------------- identity

  void setUser({required String uid, String? name, String? email}) {
    this.uid.value = uid;
    displayName.value = name ?? '';
    this.email.value = email ?? '';
  }

  // ------------------------------------------------------------- memberships

  String get _membershipsCacheScope => 'user|${uid.value}';

  /// Claims pending invites, then loads `org.listMine`. Falls back to the
  /// cached copy when offline. Never throws; read [loadState].
  Future<void> loadMemberships() async {
    loadState.value = ViewState.loading;
    loadError.value = null;
    final api = ApiService.to;
    try {
      try {
        await api.call('invite.claimPending', idempotent: true);
      } on AppException catch (e) {
        // A failed claim must not block sign-in (e.g. nothing pending or the
        // backend predates it); network errors surface in listMine below.
        AppLog.info('claimPending: ${e.code}');
        if (e.isNetwork) rethrow;
      }
      final data = await api.call('org.listMine', idempotent: true);
      final orgs = data['orgs'];
      final list = orgs is List
          ? orgs
                .whereType<Map>()
                .map((m) => OrgMembership.fromMap(
                      m.map((k, v) => MapEntry(k.toString(), v)),
                    ))
                .where((m) => m.orgId.isNotEmpty)
                .toList()
          : <OrgMembership>[];
      memberships.assignAll(list);
      membershipsSavedAt.value = DateTime.now();
      await ScopedCache.write(
        _membershipsCacheScope,
        'memberships',
        list.map((m) => m.toMap()).toList(),
      );
      loadState.value = options.isEmpty ? ViewState.empty : ViewState.ready;
    } on AppException catch (e) {
      loadError.value = e;
      if (e.isNetwork && _loadCachedMemberships()) {
        loadState.value = ViewState.offlineStale;
      } else if (e.isNetwork) {
        loadState.value = ViewState.offlineEmpty;
      } else if (e.isForbidden) {
        loadState.value = ViewState.forbidden;
      } else {
        loadState.value = ViewState.error;
      }
    }
    _revalidateContext();
  }

  bool _loadCachedMemberships() {
    final entry = ScopedCache.read(_membershipsCacheScope, 'memberships');
    if (entry == null || entry.data is! List) return false;
    final list = (entry.data as List)
        .whereType<Map>()
        .map((m) => OrgMembership.fromMap(
              m.map((k, v) => MapEntry(k.toString(), v)),
            ))
        .toList();
    if (list.isEmpty) return false;
    memberships.assignAll(list);
    membershipsSavedAt.value = entry.savedAt;
    return true;
  }

  /// All selectable (org, role) pairs, only for active memberships and roles
  /// with at least one campus.
  List<ContextOption> get options {
    final now = DateTime.now();
    final out = <ContextOption>[];
    for (final m in memberships) {
      final roles = m.rolesAt(now).toList()
        ..sort((a, b) => a.index.compareTo(b.index));
      for (final r in roles) {
        final campuses = m.campusesFor(r, now);
        if (campuses.isNotEmpty) out.add(ContextOption(m, r, campuses));
      }
    }
    return out;
  }

  /// Roles the user can switch to (any org).
  Set<AppRole> get availableRoles => options.map((o) => o.role).toSet();

  // ------------------------------------------------------------------ scope

  OrgMembership? get membership {
    final c = context.value;
    if (c == null) return null;
    return memberships.firstWhereOrNull((m) => m.orgId == c.orgId);
  }

  AppRole? get role => context.value?.role;
  String? get orgId => context.value?.orgId;
  String? get campusId => context.value?.campusId;
  String? get childId => context.value?.childId;
  String get orgName => membership?.orgName ?? '';

  CampusInfo? get campus {
    final c = context.value;
    final m = membership;
    if (c == null || m == null) return null;
    return m.campuses.firstWhereOrNull((x) => x.id == c.campusId);
  }

  String get campusName => campus?.name ?? '';
  String get timezone => campus?.timezone ?? membership?.timezone ?? 'Asia/Ho_Chi_Minh';

  /// Campuses the active role may switch between in the active org.
  List<CampusInfo> get campusChoices {
    final c = context.value;
    final m = membership;
    if (c == null || m == null) return const [];
    return m.campusesFor(c.role, DateTime.now());
  }

  /// Children of a parent in the active campus.
  List<ChildRef> get childChoices {
    final c = context.value;
    final m = membership;
    if (c == null || m == null || c.role != AppRole.parent) return const [];
    return m.childrenIn(c.campusId);
  }

  ChildRef? get child {
    final id = childId;
    if (id == null) return null;
    return childChoices.firstWhereOrNull((c) => c.id == id);
  }

  /// `org|campus|uid|role|child`, the key of every scoped cache entry.
  String? get scopeKey => context.value?.scopeKeyFor(uid.value);

  bool can(String perm, {String? campusId}) {
    final c = context.value;
    final m = membership;
    if (c == null || m == null || c.role == AppRole.parent) return false;
    return hasPermIn(m, perm, campusId ?? c.campusId);
  }

  static bool hasPermIn(OrgMembership m, String perm, String campusId) {
    final p = m.permsByCampus[campusId] ?? const <String>[];
    final all = m.permsByCampus['*'] ?? const <String>[];
    return p.contains(perm) || all.contains(perm);
  }

  // ---- unsaved-changes guard

  /// A screen with unsaved input registers a callback returning true while dirty.
  /// Returns the disposer; call it in `onClose`/`dispose`.
  void Function() registerDirtyGuard(bool Function() isDirty) {
    _dirtyGuards.add(isDirty);
    return () => _dirtyGuards.remove(isDirty);
  }

  bool get hasUnsavedChanges => _dirtyGuards.any((g) => g());

  // ---- switching

  /// Selects [next]. Wipes the cache of the old scope first. No-op when equal.
  Future<void> selectContext(SessionContext next) async {
    final prev = context.value;
    if (prev == next) return;
    var ctx = next;
    // Parent: make sure a valid child is selected.
    if (ctx.role == AppRole.parent) {
      final m = memberships.firstWhereOrNull((x) => x.orgId == ctx.orgId);
      final kids = m?.childrenIn(ctx.campusId) ?? const <ChildRef>[];
      if (ctx.childId == null || !kids.any((k) => k.id == ctx.childId)) {
        ctx = kids.isEmpty
            ? ctx.copyWith(clearChild: true)
            : ctx.copyWith(childId: kids.first.id);
      }
    }
    await _applyScope(ctx);
  }

  /// Parent switches child: same org/campus, new child scope.
  Future<void> selectChild(String childId) async {
    final c = context.value;
    if (c == null || c.childId == childId) return;
    await _applyScope(c.copyWith(childId: childId));
  }

  Future<void> _applyScope(SessionContext next) async {
    final prevKey = scopeKey;
    if (prevKey != null) await ScopedCache.clearScope(prevKey);
    final prevOrg = context.value?.orgId;
    context.value = next;
    await PrefStore.setString(
      '${PrefConst.contextPrefix}${uid.value}',
      jsonEncode(next.toMap()),
    );
    scopeEpoch.value++;
    if (prevOrg != next.orgId && Get.isRegistered<PushService>()) {
      PushService.to.setOrg(next.orgId);
    }
  }

  /// Restores the last context of this user if still valid, else auto-selects
  /// when there is exactly one choice. Returns true when a context is active.
  Future<bool> resolveInitialContext() async {
    if (context.value != null && _isValid(context.value!)) return true;
    final saved = PrefStore.getString(
      '${PrefConst.contextPrefix}${uid.value}',
      PrefDefaults.contextValue,
    );
    if (saved.isNotEmpty) {
      try {
        final ctx = SessionContext.fromMap(
          jsonDecode(saved) as Map<String, dynamic>,
        );
        if (ctx != null && _isValid(ctx)) {
          await selectContext(ctx);
          return true;
        }
      } catch (_) {}
    }
    final opts = options;
    if (opts.length == 1 && opts.first.campuses.length == 1) {
      final o = opts.first;
      await selectContext(
        SessionContext(
          orgId: o.membership.orgId,
          campusId: o.campuses.first.id,
          role: o.role,
        ),
      );
      return true;
    }
    return false;
  }

  bool _isValid(SessionContext c) {
    return options.any(
      (o) =>
          o.membership.orgId == c.orgId &&
          o.role == c.role &&
          o.campuses.any((x) => x.id == c.campusId),
    );
  }

  /// After a reload: drop the active context if the user lost access (grant
  /// revoked/expired) and wipe its cache.
  void _revalidateContext() {
    final c = context.value;
    if (c != null && !_isValid(c)) {
      final key = scopeKey;
      if (key != null) ScopedCache.clearScope(key);
      context.value = null;
      scopeEpoch.value++;
    }
  }

  /// Sign-out / session revoked: forget everything of this user in memory and
  /// wipe all cached data. The offline queue of the user stays on disk.
  Future<void> clear() async {
    await ScopedCache.clearAll();
    memberships.clear();
    context.value = null;
    uid.value = '';
    displayName.value = '';
    email.value = '';
    loadState.value = ViewState.loading;
    loadError.value = null;
    membershipsSavedAt.value = null;
    _dirtyGuards.clear();
    scopeEpoch.value++;
  }
}
