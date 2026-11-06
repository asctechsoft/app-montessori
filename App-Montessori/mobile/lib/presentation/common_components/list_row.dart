import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';

import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import 'app_avatar.dart';
import 'app_icons.dart';

/// List row, min height 64: leading, title (<= 2 lines), subtitle, trailing,
/// chevron when tappable (DESIGN_SYSTEM §9). Title and amounts are never cut to
/// one line at large text sizes.
class ListRow extends StatelessWidget {
  const ListRow({
    super.key,
    required this.title,
    this.subtitle,
    this.leading,
    this.trailing,
    this.onTap,
    this.showChevron = true,
    this.titleStyle,
    this.divider = false,
    this.semanticLabel,
  });

  final String title;
  final String? subtitle;
  final Widget? leading;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool showChevron;
  final TextStyle? titleStyle;
  final bool divider;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final content = Container(
      constraints: const BoxConstraints(minHeight: AppDimens.rowMin),
      padding: const EdgeInsets.symmetric(vertical: AppDimens.s3),
      decoration: divider
          ? const BoxDecoration(
              border: Border(bottom: BorderSide(color: AppColors.divider)),
            )
          : null,
      child: Row(
        children: [
          if (leading != null) ...[leading!, const SizedBox(width: AppDimens.s3)],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                AppText(
                  title,
                  style: titleStyle ?? AppTypography.bodyStrong,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                if (subtitle != null && subtitle!.isNotEmpty)
                  AppText(subtitle!, style: AppTypography.bodySmall),
              ],
            ),
          ),
          if (trailing != null) ...[
            const SizedBox(width: AppDimens.s2),
            trailing!,
          ],
          if (onTap != null && showChevron) ...[
            const SizedBox(width: AppDimens.s1),
            const Icon(AppIcons.chevronRight, size: AppDimens.iconMd, color: AppColors.textSecondary),
          ],
        ],
      ),
    );
    if (onTap == null) return content;
    return Semantics(
      button: true,
      label: semanticLabel,
      child: AppTouchable(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppDimens.radiusSm),
        pressedScale: 1,
        splashColor: AppColors.brandSoft,
        highlightColor: AppColors.brandSoft.withValues(alpha: 0.6),
        child: content,
      ),
    );
  }
}

/// A child in a list or in the child selector: avatar + name + class (+ status
/// badge / trailing). [selected] adds the brandSoft surface and a check.
class ChildRow extends StatelessWidget {
  const ChildRow({
    super.key,
    required this.name,
    this.className,
    this.imageUrl,
    this.selected = false,
    this.trailing,
    this.onTap,
    this.showChevron = false,
    this.compact = false,
  });

  final String name;
  final String? className;
  final String? imageUrl;
  final bool selected;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool showChevron;

  /// Card style (selector chip) instead of a plain row.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final avatar = AppAvatar(
      name: name,
      imageUrl: imageUrl,
      size: compact ? AppDimens.avatarMd : AppDimens.avatarLg,
    );
    final tail = trailing ??
        (selected
            ? const Icon(Icons.check_circle, color: AppColors.brand, size: AppDimens.iconLg)
            : null);
    if (compact) {
      return Container(
        constraints: const BoxConstraints(minHeight: AppDimens.touchMin),
        padding: const EdgeInsets.all(AppDimens.s3),
        decoration: BoxDecoration(
          color: selected ? AppColors.brandSoft : AppColors.surface,
          borderRadius: BorderRadius.circular(AppDimens.radiusLg),
          border: Border.all(
            color: selected ? AppColors.brand : AppColors.borderSubtle,
            width: selected ? 2 : 1,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            avatar,
            const SizedBox(width: AppDimens.s3),
            Flexible(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  AppText(name, style: AppTypography.bodyStrong, maxLines: 2, overflow: TextOverflow.ellipsis),
                  if (className != null) AppText(className!, style: AppTypography.bodySmall),
                ],
              ),
            ),
            if (tail != null) ...[const SizedBox(width: AppDimens.s2), tail],
          ],
        ),
      );
    }
    return ListRow(
      title: name,
      subtitle: className,
      leading: avatar,
      trailing: tail,
      onTap: onTap,
      showChevron: showChevron,
    );
  }
}

/// Section title with an optional "Xem tất cả" action.
class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.title, this.actionLabel, this.onAction});

  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: AppText(title, style: AppTypography.heading3)),
        if (actionLabel != null && onAction != null)
          AppTouchable(
            onTap: onAction,
            borderRadius: BorderRadius.circular(AppDimens.radiusSm),
            pressedScale: 1,
            splashColor: AppColors.brandSoft,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: AppDimens.touchMin),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppDimens.s2),
                child: Center(
                  widthFactor: 1,
                  child: AppText(
                    actionLabel!,
                    style: AppTypography.label.copyWith(color: AppColors.action),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
