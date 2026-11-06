import 'dart:ui';

import 'package:asc_common/asc_common.dart';

import 'pref_const.dart';

/// Language setup for [AscLocale]: one locale per `lib/xml_strings/values*/`
/// folder. Only EN (fallback) and VI are shipped, both with real text.
class AppLocaleConfig {
  AppLocaleConfig._();

  static const Locale fallbackLocale = Locale('en', 'US');
  static const Locale defaultLocale = Locale('vi', 'VN');

  static const List<Locale> supportedLocales = <Locale>[
    Locale('vi', 'VN'),
    Locale('en', 'US'),
  ];

  /// Call once at startup, before any [AscLocale] use.
  static void configure() => AscLocale.configure(
    supportedLocales: supportedLocales,
    languagePrefKey: PrefConst.language,
    followSystemPrefKey: PrefConst.followSystemLanguage,
  );
}
