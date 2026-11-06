import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart';

import '../configs/app_config.dart';
import '../utils/app_log.dart';
import 'push_service.dart';

/// Initialises Firebase directly (no dsp_base: this app has no ads).
///
/// * Android reads `android/app/google-services.json` through the Gradle plugin
///   (no `firebase_options.dart`). iOS needs `GoogleService-Info.plist`.
/// * `--dart-define=USE_EMULATORS=true` points Auth/Firestore/Functions/Storage at
///   the local emulators (`10.0.2.2` = host machine from the Android emulator).
/// * Crashlytics collects only outside debug mode; uncaught Flutter/platform
///   errors are forwarded to it.
class FirebaseBootstrap {
  FirebaseBootstrap._();

  static bool _done = false;

  static Future<void> init() async {
    if (_done) return;
    if (Firebase.apps.isEmpty) await Firebase.initializeApp();

    if (AppConfig.useEmulators) {
      const host = AppConfig.emulatorHost;
      AppLog.info('Firebase emulators on $host');
      await FirebaseAuth.instance.useAuthEmulator(host, AppConfig.emulatorAuthPort);
      FirebaseFirestore.instance.useFirestoreEmulator(host, AppConfig.emulatorFirestorePort);
      FirebaseFunctions.instanceFor(region: AppConfig.functionsRegion)
          .useFunctionsEmulator(host, AppConfig.emulatorFunctionsPort);
      await FirebaseStorage.instance.useStorageEmulator(host, AppConfig.emulatorStoragePort);
    }

    try {
      await FirebaseCrashlytics.instance.setCrashlyticsCollectionEnabled(!kDebugMode);
      FlutterError.onError = FirebaseCrashlytics.instance.recordFlutterFatalError;
      PlatformDispatcher.instance.onError = (error, stack) {
        FirebaseCrashlytics.instance.recordError(error, stack, fatal: true);
        return true;
      };
      AppLog.crashlyticsReady = true;
    } catch (e) {
      AppLog.info('Crashlytics unavailable: $e');
    }

    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
    _done = true;
  }
}
