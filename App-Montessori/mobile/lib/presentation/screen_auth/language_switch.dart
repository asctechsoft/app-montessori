import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../configs/locale_config.dart';
import '../../controller/settings_controller.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';

/// Compact two-option language toggle (Tiếng Việt | English) for the login page.
class LanguageSwitch extends StatelessWidget {
  const LanguageSwitch({super.key});

  @override
  Widget build(BuildContext context) {
    final s = SettingsController.to;
    return Obx(() {
      final current = s.locale.value;
      Widget chip(Locale l, String label) {
        final on = current.languageCode == l.languageCode;
        return Semantics(
          button: true,
          selected: on,
          label: label,
          excludeSemantics: true,
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => s.setLocale(l),
            child: Container(
              constraints: const BoxConstraints(
                minHeight: AppDimens.touchMin,
                minWidth: AppDimens.touchMin,
              ),
              padding: const EdgeInsets.symmetric(horizontal: AppDimens.s4),
              alignment: Alignment.center,
              child: Text(
                label,
                style: AppTypography.label.copyWith(
                  color: on ? AppColors.action : AppColors.textSecondary,
                  decoration: on ? TextDecoration.underline : TextDecoration.none,
                ),
              ),
            ),
          ),
        );
      }

      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          chip(AppLocaleConfig.supportedLocales[0], 'Tiếng Việt'),
          chip(AppLocaleConfig.supportedLocales[1], 'English'),
        ],
      );
    });
  }
}
