import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';

class BottomNavItem {
  const BottomNavItem({
    required this.label,
    required this.icon,
    this.activeIcon,
    this.badgeCount = 0,
  });

  /// Already translated; may be two words ("Công cá nhân" wraps to 2 lines).
  final String label;
  final IconData icon;
  final IconData? activeIcon;

  /// 0 = no badge; shown as number (99+ cap) and announced to screen readers.
  final int badgeCount;
}

/// Bottom navigation, 5 items (DESIGN_SYSTEM §10): min height 64 + safe area,
/// icon 24, label 12/18, active = action colour + brandSoft indicator.
/// Labels wrap to two lines and the bar grows with the text scale; the font is
/// never shrunk below 12.
class BottomNav extends StatelessWidget {
  const BottomNav({
    super.key,
    required this.items,
    required this.currentIndex,
    required this.onTap,
  });

  final List<BottomNavItem> items;
  final int currentIndex;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.borderSubtle)),
      ),
      child: SafeArea(
        top: false,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: AppDimens.bottomNavMin),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var i = 0; i < items.length; i++)
                  Expanded(
                    child: _NavCell(
                      item: items[i],
                      selected: i == currentIndex,
                      onTap: () => onTap(i),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _NavCell extends StatelessWidget {
  const _NavCell({required this.item, required this.selected, required this.onTap});

  final BottomNavItem item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected ? AppColors.action : AppColors.textSecondary;
    final badge = item.badgeCount;
    final semantics = badge > 0
        ? '${item.label}, ${'nav_badge_count'.trParams({'args1': '$badge'})}'
        : item.label;
    return Semantics(
      button: true,
      selected: selected,
      label: semantics,
      excludeSemantics: true,
      onTap: onTap,
      child: AppTouchable(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppDimens.radiusMd),
        pressedScale: 1,
        splashColor: AppColors.brandSoft,
        highlightColor: AppColors.brandSoft.withValues(alpha: 0.6),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: AppDimens.s2, horizontal: 2),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Stack(
                clipBehavior: Clip.none,
                alignment: Alignment.center,
                children: [
                  AnimatedContainer(
                    duration: AppDimens.fadeMs,
                    width: 56,
                    height: 28,
                    decoration: BoxDecoration(
                      color: selected ? AppColors.brandSoft : Colors.transparent,
                      borderRadius: BorderRadius.circular(AppDimens.radiusPill),
                    ),
                    alignment: Alignment.center,
                    child: Icon(
                      selected ? (item.activeIcon ?? item.icon) : item.icon,
                      size: AppDimens.iconLg,
                      color: color,
                    ),
                  ),
                  if (badge > 0)
                    Positioned(
                      top: -4,
                      right: 2,
                      child: Container(
                        constraints: const BoxConstraints(minWidth: 18, minHeight: 18),
                        padding: const EdgeInsets.symmetric(horizontal: 5),
                        decoration: BoxDecoration(
                          color: AppColors.error,
                          borderRadius: BorderRadius.circular(AppDimens.radiusPill),
                        ),
                        alignment: Alignment.center,
                        child: Text(
                          badge > 99 ? '99+' : '$badge',
                          style: AppTypography.caption.copyWith(
                            color: AppColors.textOnAction,
                            fontWeight: FontWeight.w600,
                            height: 1.2,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: AppDimens.s1),
              AppText(
                item.label,
                style: AppTypography.caption.copyWith(
                  color: color,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                ),
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
