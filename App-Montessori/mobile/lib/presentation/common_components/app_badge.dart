import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../models/ui_models/app_tone.dart';
import '../../models/ui_models/status_catalog.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import 'tone_colors.dart';

/// Pill badge: text AND icon, colour only supports (DESIGN_SYSTEM §9).
/// Min height 24, padding 4x8; grows with large text (wraps, never clips).
class AppBadge extends StatelessWidget {
  const AppBadge({
    super.key,
    required this.label,
    this.tone = AppTone.neutral,
    this.icon,
    this.showIcon = true,
  });

  final String label;
  final AppTone tone;

  /// Defaults to the tone icon.
  final IconData? icon;
  final bool showIcon;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      container: true,
      excludeSemantics: true,
      child: Container(
        constraints: const BoxConstraints(minHeight: AppDimens.badgeMin),
        padding: const EdgeInsets.symmetric(
          horizontal: AppDimens.s2,
          vertical: AppDimens.s1,
        ),
        decoration: BoxDecoration(
          color: tone.bg,
          borderRadius: BorderRadius.circular(AppDimens.radiusPill),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (showIcon) ...[
              Icon(icon ?? tone.defaultIcon, size: 14, color: tone.fg),
              const SizedBox(width: AppDimens.s1),
            ],
            Flexible(
              child: AppText(
                label,
                style: AppTypography.label.copyWith(color: tone.fg, fontSize: 13, height: 18 / 13),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Badge for a business status code with the Vietnamese label of CONTRACT §9
/// (via strings `status_<kind>_<code>`). Unknown codes show a neutral
/// "Không xác định" instead of the raw code.
///
/// ```dart
/// StatusBadge(StatusKind.payment, 'pending_reconciliation') // "Chờ đối soát"
/// StatusBadge.sync(SyncState.pending)                        // "Chưa đồng bộ"
/// ```
class StatusBadge extends StatelessWidget {
  const StatusBadge(this.kind, this.code, {super.key, this.labelOverride});

  /// Badge of a [SyncState] ("Chưa đồng bộ" for pending).
  StatusBadge.sync(SyncState state, {Key? key})
    : this(StatusKind.sync, state.name, key: key);

  final StatusKind kind;
  final String code;

  /// Use when the label needs detail (e.g. "Quá hạn 3 ngày"); tone/icon stay.
  final String? labelOverride;

  @override
  Widget build(BuildContext context) {
    final spec = StatusCatalog.of(kind, code);
    return AppBadge(
      label: labelOverride ?? spec.labelKey.tr,
      tone: spec.tone,
      icon: spec.icon,
    );
  }
}
