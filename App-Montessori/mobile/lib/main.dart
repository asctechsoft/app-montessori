import 'dart:async';

import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:get/get.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'configs/app_config.dart';
import 'controller/auth_controller.dart';
import 'controller/session_controller.dart';
import 'controller/settings_controller.dart';
import 'presentation/screen_splash/startup_gate.dart';
import 'services/auth_service.dart';
import 'services/connectivity_service.dart';
import 'services/firebase_bootstrap.dart';
import 'services/network/api_service.dart';
import 'services/push_service.dart';
import 'services/storage/pref_store.dart';
import 'services/sync/offline_queue.dart';
import 'utils/app_localize.dart';
import 'utils/app_log.dart';
import 'utils/toast_utils.dart';
import 'values/app_pages.dart';
import 'values/app_theme.dart';
import 'values/route_name.dart';

/// The first frame is drawn right away by [StartupGate]; the start-up work runs
/// as bounded steps behind a boot screen (see [StartupGate] for why).
///
/// Order: system UI -> prefs -> Firebase -> date formats -> locale + strings ->
/// permanent services/controllers -> app (splash decides login / shell).
Future<void> main() async {
  runZonedGuarded(
    () {
      WidgetsFlutterBinding.ensureInitialized();
      runApp(StartupGate(steps: _steps, builder: (_) => const MontessoriApp()));
    },
    (error, stack) => AppLog.error('uncaught', error, stack),
  );
}

final List<StartupStep> _steps = [
  StartupStep(
    'orientation',
    () => SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]),
    timeout: const Duration(seconds: 2),
  ),
  StartupStep(
    'system ui',
    () => SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge),
    timeout: const Duration(seconds: 2),
  ),
  StartupStep('preferences', PrefStore.init, critical: true),
  StartupStep(
    'firebase',
    FirebaseBootstrap.init,
    critical: true,
    timeout: const Duration(seconds: 10),
  ),
  StartupStep(
    'date formats',
    initializeDateFormatting,
    timeout: const Duration(seconds: 3),
  ),
  StartupStep('language', () async {
    await AppLocalize.ensureConfigured();
    await AppLocalize.loadTranslations();
  }, critical: true),
  // Permanent: survive route changes. Idempotent: a retry re-runs this.
  StartupStep('services', () async {
    if (!Get.isRegistered<ApiService>()) Get.put(ApiService(), permanent: true);
    if (!Get.isRegistered<AuthService>()) Get.put(AuthService(), permanent: true);
    if (!Get.isRegistered<ConnectivityService>()) {
      await Get.put(ConnectivityService(), permanent: true).start();
    }
    if (!Get.isRegistered<OfflineQueue>()) {
      Get.put(OfflineQueue(), permanent: true).listenConnectivity();
    }
    if (!Get.isRegistered<PushService>()) Get.put(PushService(), permanent: true);
    if (!Get.isRegistered<SettingsController>()) {
      Get.put(SettingsController(), permanent: true);
    }
    if (!Get.isRegistered<SessionController>()) {
      Get.put(SessionController(), permanent: true);
    }
    if (!Get.isRegistered<AuthController>()) {
      Get.put(AuthController(), permanent: true);
    }
  }, critical: true),
];

class MontessoriApp extends StatelessWidget {
  const MontessoriApp({super.key});

  @override
  Widget build(BuildContext context) {
    return GetMaterialApp(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      locale: AscLocale.getAppLocale(),
      fallbackLocale: AppLocalize.fallbackLocale,
      supportedLocales: AppLocalize.translatedLocales,
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      theme: AppTheme.light(),
      themeMode: ThemeMode.light,
      scaffoldMessengerKey: rootMessengerKey,
      initialRoute: RouteName.splash,
      getPages: AppPages.pages,
      defaultTransition: Transition.native,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          // Follow the system font size but keep layouts sane: 85 %..200 %
          // (DESIGN_SYSTEM checklist tests 100/150/200 %).
          textScaler: MediaQuery.textScalerOf(context)
              .clamp(minScaleFactor: 0.85, maxScaleFactor: 2.0),
        ),
        child: child!,
      ),
    );
  }
}
