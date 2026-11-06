import 'package:get/get.dart';

import '../models/ui_models/app_role.dart';
import '../presentation/screens_principal/principal_approvals_tab.dart';
import '../presentation/screens_principal/principal_manage_screens.dart';
import '../presentation/screens_principal/principal_metric_screen.dart';
import '../presentation/screens_principal/principal_staff_tab.dart';
import 'app_pages.dart';
import 'route_principal.dart';

GetPage<dynamic> _page(String name, GetPageBuilder page) =>
    GetPage(name: name, page: page, middlewares: [ContextGuard(AppRole.principal)]);

/// Route principal: names in route_principal.dart, pages here.
final List<GetPage<dynamic>> principalPages = <GetPage<dynamic>>[
  _page(RoutePrincipal.metric, () => const PrincipalMetricScreen()),
  _page(RoutePrincipal.classes, () => const PrincipalClassesScreen()),
  _page(RoutePrincipal.children, () => const PrincipalChildrenScreen()),
  _page(RoutePrincipal.childDetail, () => const PrincipalChildDetailScreen()),
  _page(RoutePrincipal.attendance, () => const PrincipalAttendanceScreen()),
  _page(RoutePrincipal.handovers, () => const PrincipalHandoversScreen()),
  _page(RoutePrincipal.diary, () => const PrincipalDiaryScreen()),
  _page(RoutePrincipal.health, () => const PrincipalHealthScreen()),
  _page(RoutePrincipal.staffToday, () => const PrincipalStaffTab(today: true)),
  _page(RoutePrincipal.approvalDetail, () => const PrincipalApprovalDetailScreen()),
];
