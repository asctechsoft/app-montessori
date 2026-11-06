import 'package:flutter/material.dart';

import '../../models/ui_models/app_tone.dart';
import '../../values/app_colors.dart';

/// Foreground (text, icon) and soft background of each [AppTone] (§9 table).
extension AppToneColors on AppTone {
  Color get fg => switch (this) {
    AppTone.neutral => AppColors.textSecondary,
    AppTone.success => AppColors.success,
    AppTone.warning => AppColors.warning,
    AppTone.error => AppColors.error,
    AppTone.info => AppColors.info,
  };

  Color get bg => switch (this) {
    AppTone.neutral => AppColors.surfaceMuted,
    AppTone.success => AppColors.successSoft,
    AppTone.warning => AppColors.warningSoft,
    AppTone.error => AppColors.errorSoft,
    AppTone.info => AppColors.infoSoft,
  };

  IconData get defaultIcon => switch (this) {
    AppTone.neutral => Icons.info_outline,
    AppTone.success => Icons.check_circle_outline,
    AppTone.warning => Icons.warning_amber_outlined,
    AppTone.error => Icons.error_outline,
    AppTone.info => Icons.info_outline,
  };
}
