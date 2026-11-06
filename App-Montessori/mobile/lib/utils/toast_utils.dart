import 'package:flutter/material.dart';

import '../models/ui_models/app_tone.dart';
import '../values/app_colors.dart';
import '../values/app_typography.dart';

/// Messenger key given to `GetMaterialApp.scaffoldMessengerKey`.
final GlobalKey<ScaffoldMessengerState> rootMessengerKey =
    GlobalKey<ScaffoldMessengerState>();

/// Light toast/snackbar (DESIGN_SYSTEM §11): "Đã lưu nháp". Not the only place
/// to report a money/handover error; use a banner or dialog for those.
class AppToast {
  AppToast._();

  /// 4 s for short messages; with an action it stays 8 s.
  static void show(
    String message, {
    AppTone tone = AppTone.neutral,
    String? actionLabel,
    VoidCallback? onAction,
  }) {
    final messenger = rootMessengerKey.currentState;
    if (messenger == null) return;
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          duration: Duration(seconds: actionLabel == null ? 4 : 8),
          content: Row(
            children: [
              Icon(_icon(tone), size: 20, color: AppColors.textOnAction),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  message,
                  style: AppTypography.bodySmall.copyWith(
                    color: AppColors.textOnAction,
                  ),
                ),
              ),
            ],
          ),
          action: actionLabel == null
              ? null
              : SnackBarAction(
                  label: actionLabel,
                  textColor: AppColors.brandSoft,
                  onPressed: onAction ?? () {},
                ),
        ),
      );
  }

  static void success(String message) => show(message, tone: AppTone.success);
  static void error(String message) => show(message, tone: AppTone.error);
  static void info(String message) => show(message, tone: AppTone.info);

  static IconData _icon(AppTone tone) => switch (tone) {
    AppTone.success => Icons.check_circle_outline,
    AppTone.error => Icons.error_outline,
    AppTone.warning => Icons.warning_amber_outlined,
    AppTone.info => Icons.info_outline,
    AppTone.neutral => Icons.info_outline,
  };
}
