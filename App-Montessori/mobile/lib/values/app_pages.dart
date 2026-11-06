import 'package:flutter/widgets.dart';
import 'package:get/get.dart';

import '../configs/app_figs.dart';
import '../controller/login_controller.dart';
import '../controller/session_controller.dart';
import '../models/ui_models/app_role.dart';
import '../presentation/screen_auth/forgot_password_screen.dart';
import '../presentation/screen_auth/login_screen.dart';
import '../presentation/screen_auth/phone_otp_screen.dart';
import '../presentation/screen_context/context_picker_screen.dart';
import '../presentation/screen_debug/catalog_screen.dart';
import '../presentation/screen_profile/profile_content.dart';
import '../presentation/screen_shell/role_shell.dart';
import '../presentation/screen_splash/splash_screen.dart';
import 'pages_parent.dart';
import 'pages_principal.dart';
import 'pages_teacher.dart';
import 'route_name.dart';

/// Redirects to the context picker while no role/campus is active, so a shell
/// can never open without a scope (and a deep link cannot skip the picker).
class ContextGuard extends GetMiddleware {
  ContextGuard(this.role);

  final AppRole role;

  @override
  RouteSettings? redirect(String? route) {
    final c = SessionController.to.context.value;
    if (c == null) return const RouteSettings(name: RouteName.contextPicker);
    if (c.role != role) return RouteSettings(name: AppPages.shellFor(c.role));
    return null;
  }
}

/// Route table. Feature agents: add the route name in `route_name.dart`, then a
/// `GetPage` here (with a binding for the screen's controller so it is disposed
/// with the route). Pages that need a scope get `middlewares: [ContextGuard(role)]`.
class AppPages {
  AppPages._();

  static String shellFor(AppRole role) => switch (role) {
    AppRole.parent => RouteName.parentShell,
    AppRole.teacher => RouteName.teacherShell,
    AppRole.principal => RouteName.principalShell,
  };

  static final List<GetPage<dynamic>> pages = [
    ...parentPages,
    ...teacherPages,
    ...principalPages,
    GetPage(name: RouteName.splash, page: () => const SplashScreen()),
    GetPage(
      name: RouteName.login,
      page: () => const LoginScreen(),
      binding: BindingsBuilder(() => Get.lazyPut<LoginController>(() => LoginController())),
    ),
    GetPage(name: RouteName.forgotPassword, page: () => const ForgotPasswordScreen()),
    GetPage(name: RouteName.phoneOtp, page: () => const PhoneOtpScreen()),
    GetPage(name: RouteName.contextPicker, page: () => const ContextPickerScreen()),
    GetPage(
      name: RouteName.parentShell,
      page: () => const RoleShell(role: AppRole.parent),
      middlewares: [ContextGuard(AppRole.parent)],
    ),
    GetPage(
      name: RouteName.teacherShell,
      page: () => const RoleShell(role: AppRole.teacher),
      middlewares: [ContextGuard(AppRole.teacher)],
    ),
    GetPage(
      name: RouteName.principalShell,
      page: () => const RoleShell(role: AppRole.principal),
      middlewares: [ContextGuard(AppRole.principal)],
    ),
    GetPage(name: RouteName.language, page: () => const LanguageScreen()),
    if (AppFigs.isShowTestOption)
      GetPage(name: RouteName.catalog, page: () => const CatalogScreen()),
  ];
}
