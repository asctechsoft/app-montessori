import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/principal_manage_controller.dart';
import '../../models/ui_models/app_tone.dart';
import '../../services/permission_service.dart';
import '../../values/app_dimensions.dart';
import '../../values/permissions.dart';
import '../../values/route_principal.dart';
import '../common_components/app_card.dart';
import '../common_components/app_icons.dart';
import '../common_components/list_row.dart';
import '../common_components/status_view.dart';
import 'principal_widgets.dart';

/// Get-or-put the shared manage controller (the tab and its sub screens use one).
PrincipalManageController manageCtl() => Get.isRegistered<PrincipalManageController>()
    ? Get.find<PrincipalManageController>()
    : Get.put(PrincipalManageController());

class _MenuItem {
  const _MenuItem(this.icon, this.titleKey, this.subtitleKey, this.route, this.allowed);

  final IconData icon;
  final String titleKey;
  final String subtitleKey;
  final String route;
  final bool allowed;
}

/// H03-H05, H10: classes, children, attendance, handovers, class diary, health.
class PrincipalManageTab extends StatelessWidget {
  const PrincipalManageTab({super.key});

  @override
  Widget build(BuildContext context) {
    manageCtl();
    final items = [
      _MenuItem(AppIcons.classroom, 'p_manage_classes', 'p_manage_classes_sub',
          RoutePrincipal.classes, PermissionService.can(Perm.classesRead)),
      _MenuItem(AppIcons.child, 'p_manage_children', 'p_manage_children_sub',
          RoutePrincipal.children, PermissionService.can(Perm.childrenRead)),
      _MenuItem(AppIcons.attendance, 'p_manage_attendance', 'p_manage_attendance_sub',
          RoutePrincipal.attendance, PermissionService.can(Perm.attendanceRead)),
      _MenuItem(AppIcons.pickup, 'p_manage_handover', 'p_manage_handover_sub',
          RoutePrincipal.handovers, PermissionService.can(Perm.attendanceRead)),
      _MenuItem(AppIcons.diary, 'p_manage_diary', 'p_manage_diary_sub',
          RoutePrincipal.diary, PermissionService.can(Perm.careRead)),
      _MenuItem(
        AppIcons.health,
        'p_manage_health',
        'p_manage_health_sub',
        RoutePrincipal.health,
        PermissionService.canAny([Perm.medicationRead, Perm.incidentRead]),
      ),
    ].where((i) => i.allowed).toList();
    return PrincipalPage(
      title: 'tab_manage'.tr,
      isTab: true,
      body: items.isEmpty
          ? StatusView(
              state: ViewState.forbidden,
              onBack: null,
            )
          : ListView(
              padding: const EdgeInsets.symmetric(vertical: AppDimens.s4),
              children: [
                for (final i in items)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppDimens.s3),
                    child: AppCard(
                      padding: const EdgeInsets.symmetric(horizontal: AppDimens.s3),
                      child: ListRow(
                        title: i.titleKey.tr,
                        subtitle: i.subtitleKey.tr,
                        leading: Icon(i.icon),
                        onTap: () => Get.toNamed(i.route),
                        divider: false,
                      ),
                    ),
                  ),
              ],
            ),
    );
  }
}
