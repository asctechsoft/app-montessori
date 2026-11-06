import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/principal_loader.dart';
import '../../controller/session_controller.dart';
import '../../models/ui_models/app_tone.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../common_components/app_badge.dart';
import '../common_components/app_card.dart';
import '../common_components/screen_scaffold.dart';
import '../common_components/skeleton_loader.dart';
import '../common_components/status_view.dart';
import '../screen_shell/session_scope_bar.dart';

/// Page frame of the principal screens: the active campus is ALWAYS in the
/// context strip; tab roots also show the campus switcher.
class PrincipalPage extends StatelessWidget {
  const PrincipalPage({
    super.key,
    required this.title,
    required this.body,
    this.isTab = false,
    this.actions,
    this.footer,
  });

  final String title;
  final Widget body;
  final bool isTab;
  final List<Widget>? actions;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final s = SessionController.to;
    return Obx(
      () => ScreenScaffold(
        title: title,
        showBack: isTab ? false : null,
        inShell: isTab,
        contextLabels: [s.orgName, s.campusName],
        header: isTab ? const SessionScopeBar() : null,
        actions: actions,
        footer: footer,
        body: body,
      ),
    );
  }
}

/// `StatusView` bound to a [PLoad]: loading skeleton, empty, error + retry,
/// offline stale/empty, forbidden.
class PrincipalStatus<T> extends StatelessWidget {
  const PrincipalStatus({
    super.key,
    required this.load,
    required this.onRetry,
    required this.builder,
    this.emptyTitle,
    this.emptyMessage,
    this.skeletonRows = 5,
    this.noResults = false,
    this.onClearFilters,
    this.activeFilters = const [],
  });

  final PLoad<T> load;
  final VoidCallback onRetry;
  final Widget Function(T data) builder;
  final String? emptyTitle;
  final String? emptyMessage;
  final int skeletonRows;
  final bool noResults;
  final VoidCallback? onClearFilters;
  final List<String> activeFilters;

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      final data = load.data.value;
      var state = load.state.value;
      if (state == ViewState.ready && noResults) state = ViewState.noResults;
      final hasData = data != null;
      return StatusView(
        state: state,
        skeleton: SingleChildScrollView(
          physics: const NeverScrollableScrollPhysics(),
          child: SkeletonLoader(rows: skeletonRows),
        ),
        emptyTitle: emptyTitle,
        emptyMessage: emptyMessage,
        error: load.error.value,
        onRetry: onRetry,
        staleSince: load.staleSince.value,
        activeFilters: activeFilters,
        onClearFilters: onClearFilters,
        child: hasData ? builder(data) : null,
      );
    });
  }
}

/// Tappable figure card. [value] null means "no data": shown as an em dash,
/// never as 0.
class MetricTile extends StatelessWidget {
  const MetricTile({
    super.key,
    required this.label,
    required this.value,
    this.onTap,
    this.tone = AppTone.neutral,
    this.hint,
  });

  final String label;
  final String? value;
  final VoidCallback? onTap;
  final AppTone tone;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    final color = switch (tone) {
      AppTone.error => AppColors.error,
      AppTone.warning => AppColors.warning,
      AppTone.success => AppColors.success,
      _ => AppColors.textPrimary,
    };
    return AppCard(
      onTap: onTap,
      semanticLabel: '$label: ${value ?? '—'}',
      padding: const EdgeInsets.all(AppDimens.s3),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: AppDimens.touchMin),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            AppText(label, style: AppTypography.bodySmall),
            const SizedBox(height: AppDimens.s1),
            AppText(value ?? '—', style: AppTypography.metric.copyWith(color: color)),
            if (hint != null) AppText(hint!, style: AppTypography.caption),
          ],
        ),
      ),
    );
  }
}

/// Two tiles per row (one per row on very narrow or very large text).
class MetricGrid extends StatelessWidget {
  const MetricGrid({super.key, required this.tiles});

  final List<Widget> tiles;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, c) {
        final scale = MediaQuery.textScalerOf(context).scale(1);
        final cols = (c.maxWidth < 300 || scale > 1.6) ? 1 : 2;
        final w = (c.maxWidth - (cols - 1) * AppDimens.s3) / cols;
        return Wrap(
          spacing: AppDimens.s3,
          runSpacing: AppDimens.s3,
          children: [for (final t in tiles) SizedBox(width: w, child: t)],
        );
      },
    );
  }
}

/// Label above value, both wrap (long names and money never get cut).
class KeyValue extends StatelessWidget {
  const KeyValue(this.label, this.value, {super.key, this.valueStyle});

  final String label;
  final String value;
  final TextStyle? valueStyle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppDimens.s2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AppText(label, style: AppTypography.bodySmall),
          AppText(value.isEmpty ? '—' : value, style: valueStyle ?? AppTypography.body),
        ],
      ),
    );
  }
}

/// Section title with optional trailing widget.
class PSection extends StatelessWidget {
  const PSection(this.title, {super.key, this.trailing});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: AppDimens.s4, bottom: AppDimens.s2),
      child: Row(
        children: [
          Expanded(
            child: Semantics(header: true, child: AppText(title, style: AppTypography.heading3)),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// Small tone chip (count of things needing attention).
class CountChip extends StatelessWidget {
  const CountChip(this.label, {super.key, this.tone = AppTone.neutral});

  final String label;
  final AppTone tone;

  @override
  Widget build(BuildContext context) => AppBadge(label: label, tone: tone, showIcon: false);
}
