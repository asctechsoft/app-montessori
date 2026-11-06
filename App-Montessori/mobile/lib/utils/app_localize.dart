import 'dart:ui';

import 'package:asc_common/asc_common.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../configs/locale_config.dart';
import '../configs/pref_const.dart';

/// Language policy on top of asc_common [AscLocale]. XML strings are loaded into
/// GetX (`'key'.tr`). The app ships real EN and VI text; the default is
/// Vietnamese unless the user chose English.
class AppLocalize {
  AppLocalize._();

  static const Locale fallbackLocale = AppLocaleConfig.fallbackLocale;
  static const List<Locale> translatedLocales = AppLocaleConfig.supportedLocales;

  static Future<Locale> ensureConfigured() async {
    AppLocaleConfig.configure();
    final prefs = await SharedPreferences.getInstance();
    final saved = _parse(prefs.getString(PrefConst.language));
    final locale = saved != null && translatedLocales.contains(saved)
        ? saved
        : AppLocaleConfig.defaultLocale;
    await AscLocale.setAppLocale(locale);
    return locale;
  }

  static Future<void> loadTranslations() => AscLocale.loadTranslations();

  /// Switch language at runtime and persist it.
  static Future<void> setLocale(Locale locale) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(PrefConst.followSystemLanguage, false);
    await AscLocale.setAppLocale(locale);
  }

  static Locale current() => AscLocale.getAppLocale();

  static Locale? _parse(String? value) {
    if (value == null || value.isEmpty) return null;
    final parts = value.split('_');
    return parts.length == 2 ? Locale(parts[0], parts[1]) : Locale(parts[0]);
  }
}
