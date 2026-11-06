import 'package:shared_preferences/shared_preferences.dart';

/// Typed access to SharedPreferences. Callers always pass a key from PrefConst
/// and a default from PrefDefaults, so missing keys never fall back to an
/// implicit ''/0/false.
class PrefStore {
  PrefStore._();

  static SharedPreferences? _prefs;

  /// Idempotent; tests call it after `SharedPreferences.setMockInitialValues`.
  static Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
  }

  static SharedPreferences get _p {
    final p = _prefs;
    if (p == null) {
      throw StateError('PrefStore.init() must complete before use');
    }
    return p;
  }

  static bool getBool(String key, bool fallback) => _p.getBool(key) ?? fallback;
  static int getInt(String key, int fallback) => _p.getInt(key) ?? fallback;
  static String getString(String key, String fallback) =>
      _p.getString(key) ?? fallback;
  static List<String> getStringList(String key, List<String> fallback) =>
      _p.getStringList(key) ?? fallback;

  static Future<void> setBool(String key, bool value) => _p.setBool(key, value);
  static Future<void> setInt(String key, int value) => _p.setInt(key, value);
  static Future<void> setString(String key, String value) =>
      _p.setString(key, value);
  static Future<void> setStringList(String key, List<String> value) =>
      _p.setStringList(key, value);
  static Future<void> remove(String key) => _p.remove(key);

  /// Keys that start with [prefix] (used to clear scoped caches).
  static List<String> keysWithPrefix(String prefix) =>
      _p.getKeys().where((k) => k.startsWith(prefix)).toList();

  static Future<void> removeWithPrefix(String prefix) async {
    for (final k in keysWithPrefix(prefix)) {
      await _p.remove(k);
    }
  }
}
