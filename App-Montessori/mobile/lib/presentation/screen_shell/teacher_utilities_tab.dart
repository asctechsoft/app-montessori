import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/session_controller.dart';
import '../../services/permission_service.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../../values/permissions.dart';
import '../../values/route_name.dart';
import '../../values/route_teacher.dart';
import '../common_components/app_card.dart';
import '../common_components/app_icons.dart';
import '../common_components/list_row.dart';
import '../common_components/screen_scaffold.dart';
import '../screen_profile/profile_content.dart';
import '../screens_teacher/teacher_widgets.dart';
import 'session_scope_bar.dart';

/// Teacher "Tiện ích" tab: T04 (medication, incidents) and T07 (notifications,
/// messages), security, then the account section (switch campus/role,
/// language, sign out), since the teacher nav has no profile tab.
class TeacherUtilitiesTab extends StatelessWidget {
  const TeacherUtilitiesTab({super.key});

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      SessionController.to.context.value;
      final rows = <Widget>[
        if (PermissionService.can(Perm.medicationRead))
          ListRow(
            title: 'screen_t04'.tr,
            subtitle: 't_util_med'.tr,
            leading: const Icon(AppIcons.medicine),
            onTap: () => Get.toNamed<void>(RouteTeacher.meds),
            divider: true,
          ),
        if (PermissionService.can(Perm.incidentRead))
          ListRow(
            title: 't_incident_title'.tr,
            subtitle: 't_util_incident'.tr,
            leading: const Icon(AppIcons.health),
            onTap: () => Get.toNamed<void>(RouteTeacher.incidents),
            divider: true,
          ),
        ListRow(
          title: 'screen_t07'.tr,
          subtitle: 't_util_inbox'.tr,
          leading: const Icon(AppIcons.bell),
          onTap: () => Get.toNamed<void>(RouteTeacher.inbox),
          divider: true,
        ),
        ListRow(
          title: 't_util_security'.tr,
          subtitle: 't_util_security_hint'.tr,
          leading: const Icon(AppIcons.lock),
          onTap: () => Get.toNamed<void>(RouteName.forgotPassword),
        ),
      ];
      return ScreenScaffold(
        title: 'tab_utilities'.tr,
        showBack: false,
        inShell: true,
        contextLabels: teacherContext(),
        children: [
          const SessionScopeBar(),
          AppCard(padding: const EdgeInsets.symmetric(horizontal: AppDimens.s4), child: Column(children: rows)),
          const SizedBox(height: AppDimens.s4),
          AppText('profile_section_account'.tr, style: AppTypography.heading3),
          const SizedBox(height: AppDimens.s3),
          const ProfileContent(),
        ],
      );
    });
  }
}
