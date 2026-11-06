import 'dart:math' as math;

import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import 'app_icons.dart';

/// Standard page frame (DESIGN_SYSTEM §2, §10):
///
/// * App bar >= 56 (grows with text size), title 20/28, back button 48x48.
/// * [contextLabels]: the "where am I" strip right under the bar - campus,
///   class, child ("Cầu Giấy · Lớp Mầm 1 · Minh An"), always visible.
/// * Content is centred and limited to 600 wide with 24 side padding (16 below
///   360). Provide [children] (becomes a scrolling list, with optional
///   [onRefresh]) or a custom [body].
/// * [footer] (the primary CTA) lives OUTSIDE the scroll area, above the safe
///   area and the keyboard, so it never covers the content or the nav bar.
/// * [inShell]: set when the page sits above a bottom nav that already handles
///   the bottom inset.
class ScreenScaffold extends StatelessWidget {
  const ScreenScaffold({
    super.key,
    this.title,
    this.titleWidget,
    this.contextLabels = const [],
    this.children,
    this.body,
    this.footer,
    this.actions,
    this.showBack,
    this.onBack,
    this.onRefresh,
    this.padding,
    this.showAppBar = true,
    this.inShell = false,
    this.header,
    this.backgroundColor = AppColors.background,
  }) : assert(children != null || body != null, 'Provide children or body');

  final String? title;
  final Widget? titleWidget;
  final List<String> contextLabels;
  final List<Widget>? children;
  final Widget? body;
  final Widget? footer;
  final List<Widget>? actions;

  /// Default: shown when the route can pop.
  final bool? showBack;
  final VoidCallback? onBack;
  final Future<void> Function()? onRefresh;
  final EdgeInsetsGeometry? padding;
  final bool showAppBar;
  final bool inShell;

  /// Fixed widget between the context strip and the content (filters, tabs).
  final Widget? header;
  final Color backgroundColor;

  @override
  Widget build(BuildContext context) {
    final gutter = AppDimens.pageGutter(context);
    final scaler = MediaQuery.textScalerOf(context);
    final barHeight = math.max(AppDimens.appBarMin, scaler.scale(28) + AppDimens.s4);
    final canPop = Navigator.of(context).canPop();
    final back = showBack ?? canPop;

    Widget content;
    if (children != null) {
      final list = ListView(
        physics: onRefresh != null ? const AlwaysScrollableScrollPhysics() : null,
        padding: padding ?? EdgeInsets.fromLTRB(gutter, AppDimens.s4, gutter, AppDimens.s6),
        children: children!,
      );
      content = onRefresh == null
          ? list
          : RefreshIndicator(onRefresh: onRefresh!, child: list);
    } else {
      content = Padding(
        padding: padding ?? EdgeInsets.symmetric(horizontal: gutter),
        child: body,
      );
    }

    final bar = showAppBar
        ? AppBar(
            toolbarHeight: barHeight,
            automaticallyImplyLeading: false,
            leadingWidth: back ? AppDimens.touchMin + AppDimens.s2 : gutter,
            leading: back
                ? Padding(
                    padding: const EdgeInsets.only(left: AppDimens.s2),
                    child: IconButton(
                      tooltip: 'action_back'.tr,
                      constraints: const BoxConstraints(
                        minWidth: AppDimens.touchMin,
                        minHeight: AppDimens.touchMin,
                      ),
                      icon: const Icon(AppIcons.back, size: AppDimens.iconMd),
                      onPressed: onBack ?? () => Navigator.of(context).maybePop(),
                    ),
                  )
                : const SizedBox.shrink(),
            title: titleWidget ??
                (title == null
                    ? null
                    : Semantics(
                        header: true,
                        child: AppText(
                          title!,
                          style: AppTypography.heading3,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      )),
            actions: actions,
          )
        : null;

    final footerWidget = footer == null
        ? null
        : Container(
            decoration: const BoxDecoration(
              color: AppColors.surface,
              border: Border(top: BorderSide(color: AppColors.borderSubtle)),
            ),
            child: SafeArea(
              top: false,
              bottom: !inShell,
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: AppDimens.maxContentWidth),
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(gutter, AppDimens.s3, gutter, AppDimens.s3),
                    child: footer,
                  ),
                ),
              ),
            ),
          );

    return Scaffold(
      backgroundColor: backgroundColor,
      appBar: bar == null
          ? null
          : PreferredSize(
              preferredSize: Size.fromHeight(barHeight),
              child: bar,
            ),
      body: SafeArea(
        top: !showAppBar,
        bottom: footer == null && !inShell,
        child: Column(
          children: [
            if (contextLabels.isNotEmpty) _ContextStrip(labels: contextLabels),
            if (header != null)
              Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: AppDimens.maxContentWidth),
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(gutter, AppDimens.s3, gutter, 0),
                    child: header,
                  ),
                ),
              ),
            Expanded(
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: AppDimens.maxContentWidth),
                  child: content,
                ),
              ),
            ),
            ?footerWidget,
          ],
        ),
      ),
    );
  }
}

class _ContextStrip extends StatelessWidget {
  const _ContextStrip({required this.labels});

  final List<String> labels;

  @override
  Widget build(BuildContext context) {
    final text = labels.where((l) => l.isNotEmpty).join(' · ');
    return Semantics(
      container: true,
      label: text,
      excludeSemantics: true,
      child: Container(
        width: double.infinity,
        color: AppColors.brandSoft,
        padding: EdgeInsets.symmetric(
          horizontal: AppDimens.pageGutter(context),
          vertical: AppDimens.s2,
        ),
        child: Row(
          children: [
            const Icon(AppIcons.school, size: AppDimens.iconMd, color: AppColors.action),
            const SizedBox(width: AppDimens.s2),
            Expanded(
              child: AppText(
                text,
                style: AppTypography.label.copyWith(color: AppColors.action),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
