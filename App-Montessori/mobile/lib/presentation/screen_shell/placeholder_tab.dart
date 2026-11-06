import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../configs/app_figs.dart';
import '../../controller/session_controller.dart';
import '../../models/ui_models/app_role.dart';
import '../../models/ui_models/app_tone.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../common_components/app_badge.dart';
import '../common_components/app_banner.dart';
import '../common_components/app_card.dart';
import '../common_components/list_row.dart';
import '../common_components/screen_scaffold.dart';
import 'session_scope_bar.dart';

/// A screen the feature agents will fill in. It already has the right header
/// (title, campus/class/child context strip, scope selector) and names the
/// screen codes of BUSINESS.txt §14 it must implement.
///
/// To implement a tab: replace the `builder` in `role_tabs.dart` with the real
/// screen; keep using `ScreenScaffold(inShell: true, showBack: false)`.
class PlaceholderTab extends StatelessWidget {
  const PlaceholderTab({
    super.key,
    required this.titleKey,
    required this.codes,
    this.extra = const [],
  });

  /// String key of the tab title.
  final String titleKey;

  /// `[(code, stringKey)]`: screens that belong to this tab, e.g. `('P01', 'screen_p01')`.
  final List<(String, String)> codes;

  /// Extra content under the list (e.g. the account section in a tab).
  final List<Widget> extra;

  /// Context strip text: campus, then class (teacher) or child (parent).
  static List<String> contextLabels(SessionController s) {
    final role = s.role;
    return [
      s.orgName,
      s.campusName,
      if (role == AppRole.parent && s.child != null) s.child!.fullName,
      if (role == AppRole.parent && s.child?.className != null) s.child!.className!,
    ].where((e) => e.isNotEmpty).toList();
  }

  @override
  Widget build(BuildContext context) {
    final s = SessionController.to;
    return Obx(
      () => ScreenScaffold(
        title: titleKey.tr,
        showBack: false,
        inShell: true,
        contextLabels: contextLabels(s),
        children: [
          const SessionScopeBar(),
          if (s.context.value != null) const SizedBox(height: AppDimens.s4),
          AppBanner(
            tone: AppTone.info,
            title: 'placeholder_title'.tr,
            message: 'placeholder_message'.tr,
          ),
          const SizedBox(height: AppDimens.s4),
          for (final (code, key) in codes) ...[
            AppCard(
              padding: const EdgeInsets.symmetric(horizontal: AppDimens.s4),
              child: ListRow(
                title: key.tr,
                leading: AppBadge(label: code, showIcon: false),
                showChevron: false,
              ),
            ),
            const SizedBox(height: AppDimens.s3),
          ],
          ...extra,
          const SizedBox(height: AppDimens.s2),
          if (AppFigs.isShowTestOption)
            AppText(
              'placeholder_scope_note'.trParams({'args1': s.scopeKey ?? '-'}),
              style: AppTypography.caption.copyWith(color: AppColors.textTertiary),
            ),
        ],
      ),
    );
  }
}
