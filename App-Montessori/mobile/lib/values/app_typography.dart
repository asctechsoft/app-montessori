import 'package:flutter/painting.dart';

import 'app_colors.dart';

/// Typography scale (tokens.json `typography`). System font; weights map to the
/// installed weights only. `height` = lineHeight / size. Tracking 0.
class AppTypography {
  AppTypography._();

  static TextStyle _s(double size, double line, FontWeight w, Color c) =>
      TextStyle(
        fontSize: size,
        height: line / size,
        fontWeight: w,
        color: c,
        letterSpacing: 0,
      );

  static const List<FontFeature> tabular = [FontFeature.tabularFigures()];

  static final TextStyle display =
      _s(32, 40, FontWeight.w700, AppColors.textPrimary);
  static final TextStyle heading1 =
      _s(28, 36, FontWeight.w700, AppColors.textPrimary);
  static final TextStyle heading2 =
      _s(24, 32, FontWeight.w700, AppColors.textPrimary);
  static final TextStyle heading3 =
      _s(20, 28, FontWeight.w600, AppColors.textPrimary);
  static final TextStyle title =
      _s(18, 26, FontWeight.w600, AppColors.textPrimary);
  static final TextStyle body =
      _s(16, 24, FontWeight.w400, AppColors.textPrimary);
  static final TextStyle bodyStrong =
      _s(16, 24, FontWeight.w600, AppColors.textPrimary);
  static final TextStyle bodySmall =
      _s(14, 22, FontWeight.w400, AppColors.textSecondary);
  static final TextStyle label =
      _s(14, 20, FontWeight.w600, AppColors.textPrimary);
  static final TextStyle button =
      _s(16, 24, FontWeight.w600, AppColors.textOnAction);
  static final TextStyle caption =
      _s(12, 18, FontWeight.w400, AppColors.textTertiary);
  static final TextStyle metric = TextStyle(
    fontSize: 32,
    height: 40 / 32,
    fontWeight: FontWeight.w700,
    color: AppColors.textPrimary,
    letterSpacing: 0,
    fontFeatures: tabular,
  );
}
