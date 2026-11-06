/// The three app shells (CONTRACT §8). One account can hold several.
enum AppRole {
  parent('parent'),
  teacher('teacher'),
  principal('principal');

  const AppRole(this.code);

  /// Stable code used in prefs and scope keys.
  final String code;

  /// String key of the role name (`role_parent`, ...).
  String get labelKey => 'role_$code';

  static AppRole? fromCode(String? code) {
    for (final r in AppRole.values) {
      if (r.code == code) return r;
    }
    return null;
  }
}
