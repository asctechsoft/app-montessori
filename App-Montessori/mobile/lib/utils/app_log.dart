import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';

import '../configs/app_figs.dart';

/// Logging: [info] prints only on alpha/dev/claude builds, [error] also records
/// a non-fatal in Crashlytics once Firebase is up. No `print` anywhere.
///
/// Never pass tokens, phone numbers, health or money details in messages.
class AppLog {
  AppLog._();

  /// Set by main once Firebase.initializeApp succeeded.
  static bool crashlyticsReady = false;

  /// Expected or recoverable condition: dev log only.
  static void info(String message) {
    if (kDebugMode || AppFigs.isShowTestOption) debugPrint(message);
  }

  /// Unexpected failure that the app recovered from.
  static void error(String hint, Object error, [StackTrace? stack]) {
    info('$hint: $error${stack == null ? '' : '\n$stack'}');
    if (!crashlyticsReady) return;
    FirebaseCrashlytics.instance
        .recordError(error, stack ?? StackTrace.current, reason: hint)
        .catchError((Object _) {});
  }
}
