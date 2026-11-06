import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/route_parent.dart';
import '../common_components/app_card.dart';
import '../common_components/app_icons.dart';
import '../common_components/list_row.dart';
import '../common_components/screen_scaffold.dart';
import '../screen_profile/profile_content.dart';
import 'parent_widgets.dart';

/// "Tiện ích" tab of the parent: entry points of P03, P04, P06, P07 + account.
class ParentUtilitiesTab extends StatelessWidget {
  const ParentUtilitiesTab({super.key});

  @override
  Widget build(BuildContext context) {
    Widget row(IconData icon, String titleKey, String subKey, String route, {bool last = false}) =>
        ListRow(
          title: titleKey.tr,
          subtitle: subKey.tr,
          leading: Icon(icon, color: AppColors.action),
          divider: !last,
          onTap: () => Get.toNamed<void>(route),
        );
    return Obx(
      () => ScreenScaffold(
        title: 'tab_utilities'.tr,
        showBack: false,
        inShell: true,
        contextLabels: parentContextLabels(),
        header: const ParentScopeHeader(),
        children: [
          AppCard(
            padding: const EdgeInsets.symmetric(horizontal: AppDimens.s4),
            child: Column(
              children: [
                row(AppIcons.calendar, 'screen_p03', 'p03_hub_sub', RouteParent.leave),
                row(AppIcons.pickup, 'screen_p04', 'p04_hub_sub', RouteParent.pickup),
                row(AppIcons.health, 'screen_p06', 'p06_hub_sub', RouteParent.health),
                row(AppIcons.bell, 'screen_p07', 'p07_hub_sub', RouteParent.inbox),
                row(AppIcons.person, 'p07_account', 'p07_account_sub', RouteParent.account, last: true),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Account and settings (reuses the shared profile section).
class ParentAccountScreen extends StatelessWidget {
  const ParentAccountScreen({super.key});

  @override
  Widget build(BuildContext context) => ScreenScaffold(
    title: 'p07_account'.tr,
    children: const [ProfileContent()],
  );
}
