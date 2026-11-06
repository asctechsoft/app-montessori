import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/parent_load.dart';
import '../../controller/session_controller.dart';
import '../../models/ui_models/app_tone.dart';
import '../../repository/parent_repository.dart';
import '../../utils/date_formatter.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../common_components/app_icons.dart';
import '../common_components/list_row.dart';
import '../common_components/skeleton_loader.dart';
import '../common_components/status_view.dart';
import '../screen_shell/placeholder_tab.dart';
import '../screen_shell/session_scope_bar.dart';

/// "Campus / child" strip text under the app bar.
List<String> parentContextLabels() => PlaceholderTab.contextLabels(SessionController.to);

/// Child cards + campus chooser (only the linked children of the member).
class ParentScopeHeader extends StatelessWidget {
  const ParentScopeHeader({super.key});

  @override
  Widget build(BuildContext context) => const CappedHeader(child: SessionScopeBar());
}

/// `StatusView` bound to a [ParentLoad] controller: loading skeleton, empty,
/// error + retry, offline (stale/empty), forbidden. [builder] runs only when
/// there is data to show.
class ParentStateView extends StatelessWidget {
  const ParentStateView({
    super.key,
    required this.controller,
    required this.builder,
    this.emptyTitle,
    this.emptyMessage,
    this.emptyIcon,
    this.skeleton,
  });

  final ParentLoad controller;
  final Widget Function() builder;
  final String? emptyTitle;
  final String? emptyMessage;
  final IconData? emptyIcon;
  final Widget? skeleton;

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      final st = controller.state.value;
      final showChild = st == ViewState.ready || st == ViewState.offlineStale;
      return StatusView(
        state: st,
        error: controller.error.value,
        onRetry: controller.load,
        staleSince: controller.staleSince.value,
        emptyTitle: emptyTitle,
        emptyMessage: emptyMessage,
        emptyIcon: emptyIcon,
        skeleton: skeleton ?? const SkeletonLoader(rows: 4, withAvatar: false),
        child: showChild ? builder() : null,
      );
    });
  }
}

/// Pull-to-refresh list with the standard bottom space.
class ParentList extends StatelessWidget {
  const ParentList({super.key, required this.children, required this.onRefresh});

  final List<Widget> children;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: onRefresh,
    child: ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(top: AppDimens.s4, bottom: AppDimens.s8),
      children: children,
    ),
  );
}

/// Icon + label + value row used on detail cards.
class ParentInfoRow extends StatelessWidget {
  const ParentInfoRow({super.key, required this.icon, required this.label, required this.value});

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: AppDimens.s2),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: AppDimens.iconMd, color: AppColors.action),
        const SizedBox(width: AppDimens.s3),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AppText(label, style: AppTypography.bodySmall),
              AppText(value, style: AppTypography.bodyStrong),
            ],
          ),
        ),
      ],
    ),
  );
}

/// Small round icon on a soft tone (quick actions, section marks).
class ToneIcon extends StatelessWidget {
  const ToneIcon({super.key, required this.icon, this.tone = AppTone.success, this.size = 48});

  final IconData icon;
  final AppTone tone;
  final double size;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (tone) {
      AppTone.success => (AppColors.brandSoft, AppColors.action),
      AppTone.warning => (AppColors.warningSoft, AppColors.warning),
      AppTone.error => (AppColors.errorSoft, AppColors.error),
      AppTone.info => (AppColors.infoSoft, AppColors.info),
      AppTone.neutral => (AppColors.surfaceMuted, AppColors.textSecondary),
    };
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
      child: Icon(icon, color: fg, size: AppDimens.iconLg),
    );
  }
}

/// `YYYY-MM-DD` -> `dd/MM/yyyy` (unknown input is returned unchanged).
String dayText(String? key) {
  if (key == null || key.isEmpty) return '';
  final d = DateFormatter.parseDayKey(key);
  return d == null ? key : DateFormatter.date(d);
}

/// `Thứ Sáu, 16/10/2026`.
String dayWithWeekday(String key) {
  final d = DateFormatter.parseDayKey(key);
  return d == null ? key : DateFormatter.weekdayDate(d);
}

String sessionLabel(String s) => switch (s) {
  'am' => 'p03_session_am'.tr,
  'pm' => 'p03_session_pm'.tr,
  _ => 'p03_session_all'.tr,
};

String leaveRange(String from, String to) =>
    from == to ? dayText(from) : '${dayText(from)} - ${dayText(to)}';

/// Local time in the campus zone `HH:mm`.
String campusTime(DateTime d) => CampusClock(SessionController.to.timezone).time(d);

String campusDateTime(DateTime d) => CampusClock(SessionController.to.timezone).dateTime(d);

/// A private Storage photo: URL fetched on demand, placeholder if it fails.
class StoragePhoto extends StatefulWidget {
  const StoragePhoto({super.key, required this.path, this.height = 160});

  final String path;
  final double height;

  @override
  State<StoragePhoto> createState() => _StoragePhotoState();
}

class _StoragePhotoState extends State<StoragePhoto> {
  late Future<String> _url = ParentRepository.to.downloadUrl(widget.path);

  @override
  void didUpdateWidget(covariant StoragePhoto old) {
    super.didUpdateWidget(old);
    if (old.path != widget.path) _url = ParentRepository.to.downloadUrl(widget.path);
  }

  @override
  Widget build(BuildContext context) {
    final box = BorderRadius.circular(AppDimens.radiusMd);
    Widget placeholder(IconData i) => Container(
      height: widget.height,
      decoration: BoxDecoration(color: AppColors.surfaceMuted, borderRadius: box),
      child: Icon(i, color: AppColors.textTertiary),
    );
    return FutureBuilder<String>(
      future: _url,
      builder: (context, snap) {
        if (snap.hasError) return placeholder(AppIcons.error);
        if (!snap.hasData) return placeholder(AppIcons.diary);
        return ClipRRect(
          borderRadius: box,
          child: Image.network(
            snap.data!,
            height: widget.height,
            width: double.infinity,
            fit: BoxFit.cover,
            semanticLabel: 'p02_photo'.tr,
            errorBuilder: (_, _, _) => placeholder(AppIcons.error),
          ),
        );
      },
    );
  }
}


/// Fixed header that never takes more than ~25% of the screen: at large text
/// sizes it scrolls inside itself instead of squeezing the content below.
class CappedHeader extends StatelessWidget {
  const CappedHeader({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => ConstrainedBox(
    constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.25),
    child: SingleChildScrollView(child: child),
  );
}

/// Big money figure: shrinks to fit the width instead of overflowing at 200% text.
class BigAmount extends StatelessWidget {
  const BigAmount(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => FittedBox(
    fit: BoxFit.scaleDown,
    alignment: Alignment.centerLeft,
    child: Text(text, style: AppTypography.metric),
  );
}

/// `SectionHeader` that stacks title and action when text is large (200%), so
/// neither is squeezed or overflows.
class ParentSectionHeader extends StatelessWidget {
  const ParentSectionHeader({super.key, required this.title, this.actionLabel, this.onAction});

  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final scale = MediaQuery.textScalerOf(context).scale(16) / 16;
    if (scale <= 1.3 || actionLabel == null) {
      return SectionHeader(title: title, actionLabel: actionLabel, onAction: onAction);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(title: title),
        Align(
          alignment: Alignment.centerLeft,
          child: InkWell(
            onTap: onAction,
            borderRadius: BorderRadius.circular(AppDimens.radiusSm),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: AppDimens.touchMin),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppDimens.s2),
                child: Align(
                  alignment: Alignment.centerLeft,
                  widthFactor: 1,
                  child: AppText(
                    actionLabel!,
                    style: AppTypography.label.copyWith(color: AppColors.action),
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
