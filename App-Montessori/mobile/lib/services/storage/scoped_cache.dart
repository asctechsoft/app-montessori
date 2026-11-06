import 'dart:convert';

import '../../configs/pref_const.dart';
import 'pref_store.dart';

/// One cached JSON value and when it was saved.
class CachedEntry {
  const CachedEntry(this.data, this.savedAt);

  final Object? data;
  final DateTime savedAt;
}

/// Local cache keyed by SCOPE (`org|campus|uid|role|child`, see
/// `SessionContext.scopeKeyFor`). Entries of one scope are never readable from
/// another, and [clearScope]/[clearAll] wipe them when the user switches
/// campus, role or child, or signs out (DESIGN_SYSTEM §10, checklist "cache
/// khóa theo scope; dọn khi đổi phiên").
///
/// Only cache what the user may see in that scope. Never cache by a key that is
/// not derived from the active scope. Stored in SharedPreferences (small JSON);
/// feature agents needing large datasets should add a SQLite store behind the
/// same API.
class ScopedCache {
  ScopedCache._();

  static String _prefix(String scopeKey) =>
      '${PrefConst.cachePrefix}$scopeKey#';

  static Future<void> write(String scopeKey, String name, Object? json) async {
    final wrapped = jsonEncode({
      't': DateTime.now().toUtc().toIso8601String(),
      'd': json,
    });
    await PrefStore.setString('${_prefix(scopeKey)}$name', wrapped);
  }

  static CachedEntry? read(String scopeKey, String name) {
    final raw = PrefStore.getString('${_prefix(scopeKey)}$name', '');
    if (raw.isEmpty) return null;
    try {
      final m = jsonDecode(raw) as Map<String, dynamic>;
      final t = DateTime.tryParse(m['t']?.toString() ?? '');
      if (t == null) return null;
      return CachedEntry(m['d'], t.toLocal());
    } catch (_) {
      return null;
    }
  }

  static Future<void> remove(String scopeKey, String name) =>
      PrefStore.remove('${_prefix(scopeKey)}$name');

  /// Removes every entry of one scope.
  static Future<void> clearScope(String scopeKey) =>
      PrefStore.removeWithPrefix(_prefix(scopeKey));

  /// Removes every cached entry of every scope (sign-out, session revoked).
  static Future<void> clearAll() =>
      PrefStore.removeWithPrefix(PrefConst.cachePrefix);

  /// Names cached under [scopeKey] (tests / debug).
  static List<String> names(String scopeKey) {
    final p = _prefix(scopeKey);
    return PrefStore.keysWithPrefix(p).map((k) => k.substring(p.length)).toList();
  }
}
