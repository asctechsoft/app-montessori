/// All route path constants. Feature agents add their routes here and in
/// `app_pages.dart`.
class RouteName {
  RouteName._();

  static const String splash = '/';
  static const String login = '/login';
  static const String forgotPassword = '/forgot-password';
  static const String phoneOtp = '/phone-otp';

  /// Pick role and campus (after login, or from Profile "Switch role").
  static const String contextPicker = '/context';

  /// Role shells (bottom nav, 5 tabs each).
  static const String parentShell = '/parent';
  static const String teacherShell = '/teacher';
  static const String principalShell = '/principal';

  static const String language = '/language';

  /// Debug-only component gallery (hidden on product flavor).
  static const String catalog = '/catalog';
}
