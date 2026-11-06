import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app_colors.dart';
import 'app_dimensions.dart';
import 'app_typography.dart';

/// Light theme only (DESIGN_SYSTEM §1: v1 is light mode; no auto-inverted dark).
class AppTheme {
  AppTheme._();

  static ThemeData light() {
    const scheme = ColorScheme(
      brightness: Brightness.light,
      primary: AppColors.action,
      onPrimary: AppColors.textOnAction,
      primaryContainer: AppColors.brandSoft,
      onPrimaryContainer: AppColors.action,
      secondary: AppColors.brand,
      onSecondary: AppColors.textOnAction,
      secondaryContainer: AppColors.brandSoft,
      onSecondaryContainer: AppColors.action,
      tertiary: AppColors.info,
      onTertiary: AppColors.textOnAction,
      error: AppColors.error,
      onError: AppColors.textOnAction,
      errorContainer: AppColors.errorSoft,
      onErrorContainer: AppColors.error,
      surface: AppColors.surface,
      onSurface: AppColors.textPrimary,
      onSurfaceVariant: AppColors.textSecondary,
      surfaceContainerHighest: AppColors.surfaceMuted,
      outline: AppColors.borderControl,
      outlineVariant: AppColors.borderSubtle,
      scrim: AppColors.overlay,
    );

    final text = TextTheme(
      displayLarge: AppTypography.display,
      headlineLarge: AppTypography.heading1,
      headlineMedium: AppTypography.heading2,
      headlineSmall: AppTypography.heading3,
      titleLarge: AppTypography.title,
      titleMedium: AppTypography.bodyStrong,
      titleSmall: AppTypography.label,
      bodyLarge: AppTypography.body,
      bodyMedium: AppTypography.body,
      bodySmall: AppTypography.bodySmall,
      labelLarge: AppTypography.button,
      labelMedium: AppTypography.label,
      labelSmall: AppTypography.caption,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: AppColors.background,
      canvasColor: AppColors.surface,
      textTheme: text,
      dividerColor: AppColors.divider,
      dividerTheme: const DividerThemeData(
        color: AppColors.divider,
        thickness: 1,
        space: 1,
      ),
      splashFactory: InkRipple.splashFactory,
      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        scrolledUnderElevation: 0,
        toolbarHeight: AppDimens.appBarMin,
        centerTitle: false,
        titleTextStyle: AppTypography.heading3,
        systemOverlayStyle: SystemUiOverlayStyle.dark,
      ),
      cardTheme: CardThemeData(
        color: AppColors.surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppDimens.radiusLg),
          side: const BorderSide(color: AppColors.borderSubtle),
        ),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: AppColors.surface,
        modalBackgroundColor: AppColors.surface,
        modalBarrierColor: AppColors.overlay,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(AppDimens.radiusXl),
          ),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: AppColors.surface,
        barrierColor: AppColors.overlay,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppDimens.radiusXl),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: AppColors.textPrimary,
        contentTextStyle: AppTypography.bodySmall.copyWith(
          color: AppColors.textOnAction,
        ),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppDimens.radiusMd),
        ),
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: AppColors.action,
      ),
      textSelectionTheme: const TextSelectionThemeData(
        cursorColor: AppColors.action,
        selectionColor: AppColors.brandSoft,
        selectionHandleColor: AppColors.action,
      ),
    );
  }
}
