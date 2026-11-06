import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import 'app_icons.dart';

/// Modal bottom sheet shell (DESIGN_SYSTEM §11): top radius 24, drag handle
/// 32x4, title 20/28, content scrolls INSIDE the sheet, the footer (CTA) stays
/// inside the safe area and above the keyboard. Use for short lists/forms; long
/// forms deserve their own screen. A sheet never adds a second nav bar.
///
/// ```dart
/// final picked = await BottomSheetBase.show<String>(
///   title: 'Chọn cơ sở',
///   builder: (ctx) => Column(children: [...]),
/// );
/// ```
class BottomSheetBase extends StatelessWidget {
  const BottomSheetBase({
    super.key,
    required this.title,
    required this.child,
    this.footer,
    this.showClose = true,
  });

  final String title;
  final Widget child;
  final Widget? footer;
  final bool showClose;

  static Future<T?> show<T>({
    required String title,
    required WidgetBuilder builder,
    Widget Function(BuildContext)? footerBuilder,
    bool isDismissible = true,
  }) {
    final context = Get.context!;
    return showModalBottomSheet<T>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      isDismissible: isDismissible,
      enableDrag: isDismissible,
      backgroundColor: AppColors.surface,
      constraints: const BoxConstraints(maxWidth: AppDimens.maxContentWidth),
      builder: (ctx) => BottomSheetBase(
        title: title,
        footer: footerBuilder?.call(ctx),
        child: builder(ctx),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final gutter = MediaQuery.sizeOf(context).width < AppDimens.compactWidth
        ? AppDimens.s4
        : AppDimens.s6;
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: keyboard),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: AppDimens.s3),
            Center(
              child: Container(
                width: 32,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.borderSubtle,
                  borderRadius: BorderRadius.circular(AppDimens.radiusPill),
                ),
              ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(gutter, AppDimens.s3, AppDimens.s2, AppDimens.s2),
              child: Row(
                children: [
                  Expanded(
                    child: Semantics(
                      header: true,
                      child: AppText(title, style: AppTypography.heading3),
                    ),
                  ),
                  if (showClose)
                    IconButton(
                      tooltip: 'action_close'.tr,
                      constraints: const BoxConstraints(
                        minWidth: AppDimens.touchMin,
                        minHeight: AppDimens.touchMin,
                      ),
                      icon: const Icon(AppIcons.close, color: AppColors.textSecondary),
                      onPressed: () => Navigator.of(context).maybePop(),
                    ),
                ],
              ),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: EdgeInsets.symmetric(horizontal: gutter, vertical: AppDimens.s2),
                child: child,
              ),
            ),
            if (footer != null)
              Padding(
                padding: EdgeInsets.fromLTRB(gutter, AppDimens.s3, gutter, AppDimens.s3),
                child: footer,
              ),
          ],
        ),
      ),
    );
  }
}
