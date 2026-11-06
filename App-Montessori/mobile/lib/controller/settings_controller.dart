import 'dart:ui';

import 'package:get/get.dart';

import '../configs/locale_config.dart';
import '../utils/app_localize.dart';

/// App-level settings: language (EN / VI). Persisted by AppLocalize.
class SettingsController extends GetxController {
  static SettingsController get to => Get.find<SettingsController>();

  final Rx<Locale> locale = AppLocaleConfig.defaultLocale.obs;

  @override
  void onInit() {
    super.onInit();
    locale.value = AppLocalize.current();
  }

  Future<void> setLocale(Locale next) async {
    if (next == locale.value) return;
    await AppLocalize.setLocale(next);
    locale.value = next;
  }
}
