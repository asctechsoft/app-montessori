import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import 'app_icons.dart';
import 'bottom_sheet_base.dart';
import 'confirm_dialog.dart';
import 'list_row.dart';

/// One choice of a [ScopeSelector] (a child, a class, a campus).
class ScopeOption {
  const ScopeOption({
    required this.id,
    required this.title,
    this.subtitle,
    this.imageUrl,
  });

  final String id;
  final String title;
  final String? subtitle;
  final String? imageUrl;
}

enum ScopeSelectorStyle {
  /// Horizontal cards (children of a parent, top of the home screen).
  cards,

  /// One row that opens a sheet (campus / class).
  dropdown,
}

/// Chooser for the working scope (DESIGN_SYSTEM §10): child, class or campus.
///
/// * Lists ONLY the [options] it is given: pass what the user is entitled to.
/// * Picking another option while [hasUnsavedChanges] is true first asks for
///   confirmation (the draft would be lost).
/// * It does not clear anything itself; [onSelected] must switch the session
///   (`SessionController.selectContext/selectChild`), which wipes the scoped
///   cache of the previous scope and reloads (see `ScopeAware`).
///
/// The widget knows nothing about the session; see `SessionScopeBar` for the
/// wired versions.
class ScopeSelector extends StatelessWidget {
  const ScopeSelector({
    super.key,
    required this.options,
    required this.selectedId,
    required this.onSelected,
    this.label,
    this.sheetTitle,
    this.style = ScopeSelectorStyle.dropdown,
    this.hasUnsavedChanges,
    this.leadingIcon,
  });

  final List<ScopeOption> options;
  final String? selectedId;
  final Future<void> Function(String id) onSelected;

  /// Small caption above the control ("Cơ sở", "Bé").
  final String? label;
  final String? sheetTitle;
  final ScopeSelectorStyle style;
  final bool Function()? hasUnsavedChanges;
  final IconData? leadingIcon;

  Future<void> _select(String id) async {
    if (id == selectedId) return;
    if (hasUnsavedChanges?.call() ?? false) {
      final ok = await ConfirmDialog.show(
        title: 'scope_unsaved_title'.tr,
        message: 'scope_unsaved_message'.tr,
        confirmLabel: 'scope_unsaved_confirm'.tr,
        cancelLabel: 'scope_unsaved_stay'.tr,
        destructive: true,
      );
      if (!ok) return;
    }
    await onSelected(id);
  }

  @override
  Widget build(BuildContext context) {
    if (options.isEmpty) return const SizedBox.shrink();
    final selected = options.firstWhereOrNull((o) => o.id == selectedId);
    if (style == ScopeSelectorStyle.cards) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (label != null)
            Padding(
              padding: const EdgeInsets.only(bottom: AppDimens.s2),
              child: AppText(label!, style: AppTypography.label),
            ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final o in options)
                    Padding(
                      padding: const EdgeInsets.only(right: AppDimens.s3),
                      child: Semantics(
                        button: true,
                        selected: o.id == selectedId,
                        label: o.title,
                        child: AppTouchable(
                          onTap: () => _select(o.id),
                          borderRadius: BorderRadius.circular(AppDimens.radiusLg),
                          pressedScale: 1,
                          splashColor: AppColors.brandSoft,
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 260),
                            child: ChildRow(
                              compact: true,
                              name: o.title,
                              className: o.subtitle,
                              imageUrl: o.imageUrl,
                              selected: o.id == selectedId,
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      );
    }

    // dropdown
    final canChoose = options.length > 1;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label != null)
          Padding(
            padding: const EdgeInsets.only(bottom: AppDimens.s2),
            child: AppText(label!, style: AppTypography.label),
          ),
        Semantics(
          button: canChoose,
          label: '${label ?? ''} ${selected?.title ?? ''}'.trim(),
          child: AppTouchable(
            onTap: canChoose ? () => _openSheet(context) : null,
            borderRadius: BorderRadius.circular(AppDimens.radiusMd),
            pressedScale: 1,
            splashColor: AppColors.brandSoft,
            child: Container(
              constraints: const BoxConstraints(minHeight: AppDimens.inputMin),
              padding: const EdgeInsets.symmetric(
                horizontal: AppDimens.s4,
                vertical: AppDimens.s2,
              ),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(AppDimens.radiusMd),
                border: Border.all(color: AppColors.borderControl),
              ),
              child: Row(
                children: [
                  if (leadingIcon != null) ...[
                    Icon(leadingIcon, size: AppDimens.iconMd, color: AppColors.brand),
                    const SizedBox(width: AppDimens.s2),
                  ],
                  Expanded(
                    child: AppText(
                      selected?.title ?? '',
                      style: AppTypography.bodyStrong,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (canChoose)
                    const Icon(AppIcons.expand, size: AppDimens.iconLg, color: AppColors.textSecondary),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _openSheet(BuildContext context) async {
    final id = await BottomSheetBase.show<String>(
      title: sheetTitle ?? label ?? '',
      builder: (ctx) => Column(
        children: [
          for (final o in options)
            ListRow(
              title: o.title,
              subtitle: o.subtitle,
              showChevron: false,
              trailing: o.id == selectedId
                  ? const Icon(Icons.check_circle, color: AppColors.brand)
                  : null,
              onTap: () => Navigator.of(ctx).pop(o.id),
              divider: true,
            ),
        ],
      ),
    );
    if (id != null) await _select(id);
  }
}
