/// All SharedPreferences keys. Never use raw key strings elsewhere.
class PrefConst {
  PrefConst._();

  // App flow
  static const String onboardingCompleted = 'onboarding_completed';
  static const String lastEmail = 'last_email';

  // Language (AscLocale): en_US | vi_VN
  static const String language = 'language';
  static const String followSystemLanguage = 'follow_system_language';

  // Device
  static const String deviceId = 'device_id';

  // Session context, stored per uid: `ctx_<uid>` = JSON {orgId, campusId, role}
  static const String contextPrefix = 'ctx_';

  // Offline queue (JSON list), one list per uid: `offline_queue_<uid>`
  static const String offlineQueuePrefix = 'offline_queue_';

  // Scoped cache entries: `cache|<scopeKey>|<name>`
  static const String cachePrefix = 'cache|';
}
