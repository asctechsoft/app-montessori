/// Static app configuration.
class AppConfig {
  AppConfig._();

  static const String appName = 'Mầm non';
  static const String supportEmail = 'contact.support@asctechsoft.com';
  static const String androidPackage = 'com.asc.app_montessori';
  static const String firebaseProjectId = 'app-montessori-36ec6';

  // ---- Backend (docs/CONTRACT.md §4)
  static const String functionsRegion = 'asia-southeast1';
  static const String apiFunctionName = 'api';
  static const Duration apiTimeout = Duration(seconds: 30);

  /// Retry policy: only READ-like actions (`idempotent: true`) or calls that
  /// carry an opId (the server de-duplicates by opId) are retried.
  static const int apiMaxAttempts = 3;
  static const Duration apiRetryBase = Duration(milliseconds: 600);

  // ---- Emulators: `--dart-define=USE_EMULATORS=true [--dart-define=EMULATOR_HOST=10.0.2.2]`
  static const bool useEmulators = bool.fromEnvironment('USE_EMULATORS');
  static const String emulatorHost =
      String.fromEnvironment('EMULATOR_HOST', defaultValue: '10.0.2.2');
  static const int emulatorAuthPort = int.fromEnvironment('EMU_AUTH_PORT', defaultValue: 9099);
  static const int emulatorFirestorePort = int.fromEnvironment('EMU_FIRESTORE_PORT', defaultValue: 8080);
  static const int emulatorFunctionsPort = int.fromEnvironment('EMU_FUNCTIONS_PORT', defaultValue: 5001);
  static const int emulatorStoragePort = int.fromEnvironment('EMU_STORAGE_PORT', defaultValue: 9199);

  // ---- Feature flags
  /// Phone OTP sign-in for parents (`--dart-define=PHONE_OTP=true`). Off until
  /// the Firebase phone provider and SHA fingerprints are configured; email +
  /// password always works.
  static const bool phoneOtpEnabled = bool.fromEnvironment('PHONE_OTP');

  // ---- Business defaults
  static const String defaultTimezone = 'Asia/Ho_Chi_Minh';
  static const String currency = 'VND';

  // ---- Offline queue
  static const int offlineMaxAttempts = 5;
  static const int offlineMaxItems = 200;

  // ---- Cache
  static const Duration cacheStaleAfter = Duration(minutes: 10);

  // ---- Validation
  static const int passwordMinLength = 6;
  static const int otpLength = 6;
}
