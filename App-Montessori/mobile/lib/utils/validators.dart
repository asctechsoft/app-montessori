import 'package:get/get.dart';

import '../configs/app_config.dart';

/// Form validators. Each returns a localized message, or null when valid.
class Validators {
  Validators._();

  static String? required(String? v, {String? message}) =>
      (v == null || v.trim().isEmpty) ? (message ?? 'error_required'.tr) : null;

  static final RegExp _email = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]{2,}$');

  static String? email(String? v) {
    final r = required(v);
    if (r != null) return r;
    return _email.hasMatch(v!.trim()) ? null : 'error_email_invalid'.tr;
  }

  static String? password(String? v) {
    final r = required(v);
    if (r != null) return r;
    return v!.length >= AppConfig.passwordMinLength
        ? null
        : 'error_password_short'.trParams(
            {'args1': '${AppConfig.passwordMinLength}'},
          );
  }

  /// Vietnamese mobile/landline: `0` + 9 digits, or `+84`/`84` + 9 digits.
  static String? phone(String? v) {
    final r = required(v);
    if (r != null) return r;
    return isVnPhone(v!) ? null : 'error_phone_invalid'.tr;
  }

  static bool isVnPhone(String v) {
    final s = v.replaceAll(RegExp(r'[\s.\-]'), '');
    return RegExp(r'^(0\d{9}|(\+?84)\d{9})$').hasMatch(s);
  }

  /// `+84...` E.164 for Firebase phone auth; null when not a VN number.
  static String? toE164(String v) {
    final s = v.replaceAll(RegExp(r'[\s.\-]'), '');
    if (!isVnPhone(s)) return null;
    if (s.startsWith('+')) return s;
    if (s.startsWith('84')) return '+$s';
    return '+84${s.substring(1)}';
  }

  static String? otp(String? v) =>
      (v ?? '').length == AppConfig.otpLength &&
          RegExp(r'^\d+$').hasMatch(v!)
      ? null
      : 'error_otp_invalid'.tr;

  /// End date must not be before the start date (DESIGN_SYSTEM §7).
  static String? dateRange(DateTime? from, DateTime? to) {
    if (from == null || to == null) return null;
    return to.isBefore(from) ? 'error_date_range'.tr : null;
  }
}
