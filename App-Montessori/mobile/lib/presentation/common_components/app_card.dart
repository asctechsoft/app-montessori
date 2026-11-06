import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';

import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';

/// Card: surface, radius 16, padding 16, hairline border, no shadow
/// (DESIGN_SYSTEM §9). [selected] = brandSoft + brand 2px border (the child or
/// class currently chosen), always paired with a check/label by the caller.
///
/// A tappable card must not contain buttons with a conflicting action: split
/// the hit areas instead.
class AppCard extends StatelessWidget {
  const AppCard({
    super.key,
    required this.child,
    this.onTap,
    this.selected = false,
    this.padding = const EdgeInsets.all(AppDimens.cardPadding),
    this.color,
    this.semanticLabel,
  });

  final Widget child;
  final VoidCallback? onTap;
  final bool selected;
  final EdgeInsetsGeometry padding;
  final Color? color;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.radiusLg);
    final body = Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: selected ? AppColors.brandSoft : (color ?? AppColors.surface),
        borderRadius: radius,
        border: Border.all(
          color: selected ? AppColors.brand : AppColors.borderSubtle,
          width: selected ? 2 : 1,
        ),
      ),
      child: child,
    );
    if (onTap == null) return body;
    return Semantics(
      button: true,
      selected: selected,
      label: semanticLabel,
      child: AppTouchable(
        onTap: onTap,
        borderRadius: radius,
        pressedScale: 1,
        splashColor: AppColors.brandSoft,
        highlightColor: AppColors.brandSoft.withValues(alpha: 0.6),
        child: body,
      ),
    );
  }
}
