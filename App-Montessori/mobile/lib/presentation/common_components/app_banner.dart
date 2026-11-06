import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';

import '../../models/ui_models/app_tone.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import 'app_button.dart';
import 'tone_colors.dart';

/// Inline status banner: soft background, icon + text in the semantic colour,
/// 1-3 short sentences, optional action (DESIGN_SYSTEM §9).
class AppBanner extends StatelessWidget {
  const AppBanner({
    super.key,
    required this.message,
    this.title,
    this.tone = AppTone.info,
    this.icon,
    this.actionLabel,
    this.onAction,
  });

  final String message;
  final String? title;
  final AppTone tone;
  final IconData? icon;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      liveRegion: tone == AppTone.error || tone == AppTone.warning,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppDimens.s3),
        decoration: BoxDecoration(
          color: tone.bg,
          borderRadius: BorderRadius.circular(AppDimens.radiusMd),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon ?? tone.defaultIcon, size: AppDimens.iconMd, color: tone.fg),
                const SizedBox(width: AppDimens.s2),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (title != null)
                        AppText(
                          title!,
                          style: AppTypography.label.copyWith(color: tone.fg),
                        ),
                      AppText(
                        message,
                        style: AppTypography.bodySmall.copyWith(color: tone.fg),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            if (actionLabel != null && onAction != null)
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: AppButton(
                  label: actionLabel!,
                  onPressed: onAction,
                  variant: AppButtonVariant.tertiary,
                  size: AppButtonSize.sm,
                  expand: false,
                ),
              ),
          ],
        ),
      ),
    );
  }
}
