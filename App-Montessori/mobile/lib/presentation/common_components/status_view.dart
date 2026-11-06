import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../models/ui_models/app_tone.dart';
import '../../services/network/app_exception.dart';
import '../../utils/date_formatter.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import 'app_banner.dart';
import 'app_button.dart';
import 'app_icons.dart';
import 'skeleton_loader.dart';

/// One widget for every list/detail data state (DESIGN_SYSTEM §12):
///
/// | state          | shows                                                      |
/// |----------------|------------------------------------------------------------|
/// | loading        | skeleton in the content layout (never an endless spinner)  |
/// | ready          | [child]                                                    |
/// | empty          | icon, explanation, optional action matching permissions    |
/// | noResults      | applied filters + "Xóa bộ lọc"                             |
/// | error          | friendly message, support code, "Thử lại"; no stack trace  |
/// | offlineStale   | [child] under a "Dữ liệu lưu lúc ..." banner               |
/// | offlineEmpty   | how to reconnect; never zeros in place of missing data     |
/// | forbidden      | no detail about the object; back / contact the manager     |
///
/// Message states are scrollable so pull-to-refresh still works.
class StatusView extends StatelessWidget {
  const StatusView({
    super.key,
    required this.state,
    this.child,
    this.skeleton,
    this.emptyTitle,
    this.emptyMessage,
    this.emptyIcon,
    this.emptyActionLabel,
    this.onEmptyAction,
    this.activeFilters = const [],
    this.onClearFilters,
    this.error,
    this.onRetry,
    this.staleSince,
    this.onBack,
  });

  final ViewState state;

  /// Content for `ready` and `offlineStale`.
  final Widget? child;

  /// Custom loading layout (default: row skeleton).
  final Widget? skeleton;

  final String? emptyTitle;
  final String? emptyMessage;
  final IconData? emptyIcon;
  final String? emptyActionLabel;
  final VoidCallback? onEmptyAction;

  /// Names of filters in effect, for `noResults`.
  final List<String> activeFilters;
  final VoidCallback? onClearFilters;

  final AppException? error;
  final VoidCallback? onRetry;

  /// When the cached data was saved (for `offlineStale`).
  final DateTime? staleSince;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    switch (state) {
      case ViewState.loading:
        return Semantics(
          label: 'state_loading'.tr,
          liveRegion: true,
          child: skeleton ?? const SkeletonLoader(),
        );
      case ViewState.ready:
        return child ?? const SizedBox.shrink();
      case ViewState.offlineStale:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AppBanner(
              tone: AppTone.warning,
              icon: AppIcons.offline,
              message: staleSince == null
                  ? 'offline_stale_unknown'.tr
                  : 'offline_stale_at'.trParams({
                      'args1': DateFormatter.dateTime(staleSince!),
                    }),
              actionLabel: onRetry == null ? null : 'action_retry'.tr,
              onAction: onRetry,
            ),
            const SizedBox(height: AppDimens.s3),
            if (child != null) Expanded(child: child!),
          ],
        );
      case ViewState.empty:
        return _Message(
          icon: emptyIcon ?? AppIcons.empty,
          title: emptyTitle ?? 'empty_title'.tr,
          message: emptyMessage ?? 'empty_message'.tr,
          actionLabel: emptyActionLabel,
          onAction: onEmptyAction,
        );
      case ViewState.noResults:
        return _Message(
          icon: AppIcons.search,
          title: 'no_results_title'.tr,
          message: activeFilters.isEmpty
              ? 'no_results_message'.tr
              : 'no_results_filters'.trParams({'args1': activeFilters.join(', ')}),
          actionLabel: onClearFilters == null ? null : 'action_clear_filters'.tr,
          onAction: onClearFilters,
          actionIcon: AppIcons.filter,
        );
      case ViewState.error:
        final e = error;
        return _Message(
          icon: AppIcons.error,
          tone: AppTone.error,
          title: 'error_load_title'.tr,
          message: e?.userMessage ?? 'error_generic'.tr,
          supportCode: e?.requestId,
          actionLabel: onRetry == null ? null : 'action_retry'.tr,
          onAction: onRetry,
          actionIcon: AppIcons.refresh,
        );
      case ViewState.offlineEmpty:
        return _Message(
          icon: AppIcons.offline,
          tone: AppTone.warning,
          title: 'offline_empty_title'.tr,
          message: 'offline_empty_message'.tr,
          actionLabel: onRetry == null ? null : 'action_retry'.tr,
          onAction: onRetry,
          actionIcon: AppIcons.refresh,
        );
      case ViewState.forbidden:
        return _Message(
          icon: AppIcons.forbidden,
          title: 'forbidden_title'.tr,
          message: 'forbidden_message'.tr,
          actionLabel: onBack == null ? null : 'action_back'.tr,
          onAction: onBack,
        );
    }
  }
}

class _Message extends StatelessWidget {
  const _Message({
    required this.icon,
    required this.title,
    required this.message,
    this.tone = AppTone.neutral,
    this.supportCode,
    this.actionLabel,
    this.onAction,
    this.actionIcon,
  });

  final IconData icon;
  final String title;
  final String message;
  final AppTone tone;
  final String? supportCode;
  final String? actionLabel;
  final VoidCallback? onAction;
  final IconData? actionIcon;

  @override
  Widget build(BuildContext context) {
    final iconColor = switch (tone) {
      AppTone.error => AppColors.error,
      AppTone.warning => AppColors.warning,
      _ => AppColors.brand,
    };
    final iconBg = switch (tone) {
      AppTone.error => AppColors.errorSoft,
      AppTone.warning => AppColors.warningSoft,
      _ => AppColors.brandSoft,
    };
    return LayoutBuilder(
      builder: (context, c) => SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: c.hasBoundedHeight ? c.maxHeight : 0),
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(AppDimens.s6),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: AppDimens.avatarXl,
                    height: AppDimens.avatarXl,
                    decoration: BoxDecoration(color: iconBg, shape: BoxShape.circle),
                    child: Icon(icon, size: 36, color: iconColor),
                  ),
                  const SizedBox(height: AppDimens.s4),
                  Semantics(
                    liveRegion: tone != AppTone.neutral,
                    child: AppText(
                      title,
                      style: AppTypography.title,
                      textAlign: TextAlign.center,
                    ),
                  ),
                  const SizedBox(height: AppDimens.s2),
                  AppText(
                    message,
                    style: AppTypography.body.copyWith(color: AppColors.textSecondary),
                    textAlign: TextAlign.center,
                  ),
                  if (supportCode != null) ...[
                    const SizedBox(height: AppDimens.s2),
                    AppText(
                      'support_code'.trParams({'args1': supportCode!}),
                      style: AppTypography.caption,
                      textAlign: TextAlign.center,
                    ),
                  ],
                  if (actionLabel != null && onAction != null) ...[
                    const SizedBox(height: AppDimens.s5),
                    AppButton(
                      label: actionLabel!,
                      icon: actionIcon,
                      variant: AppButtonVariant.secondary,
                      expand: false,
                      onPressed: onAction,
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
