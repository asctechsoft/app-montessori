import 'package:get/get.dart';

import '../controller/parent_care_controller.dart';
import '../controller/parent_health_controller.dart';
import '../controller/parent_inbox_controller.dart';
import '../controller/parent_pickup_controller.dart';
import '../presentation/screens_parent/parent_care_screens.dart';
import '../presentation/screens_parent/parent_diary_screen.dart';
import '../presentation/screens_parent/parent_health_screens.dart';
import '../presentation/screens_parent/parent_inbox_screens.dart';
import '../presentation/screens_parent/parent_pickup_screens.dart';
import '../presentation/screens_parent/parent_tuition_screen.dart';
import '../presentation/screens_parent/parent_utilities_tab.dart';
import '../models/ui_models/app_role.dart';
import 'app_pages.dart';
import 'route_parent.dart';

GetPage<dynamic> _page(
  String name,
  GetPageBuilder page, {
  Bindings? binding,
}) => GetPage(
  name: name,
  page: page,
  binding: binding,
  middlewares: [ContextGuard(AppRole.parent)],
);

Bindings _b(void Function() f) => BindingsBuilder(f);

/// Parent routes. Feature controllers are bound to the route so they are
/// disposed with it; forms reuse the list controller of their screen.
final List<GetPage<dynamic>> parentPages = <GetPage<dynamic>>[
  _page(RouteParent.diary, () => const ParentDiaryScreen(inShell: false)),
  _page(RouteParent.tuition, () => const ParentTuitionScreen(inShell: false)),
  _page(RouteParent.proof, () => const ParentProofScreen()),
  _page(
    RouteParent.leave,
    () => const ParentCareScreen(),
    binding: _b(() => Get.lazyPut<ParentCareController>(() => ParentCareController(), fenix: true)),
  ),
  _page(RouteParent.leaveForm, () => const ParentLeaveFormScreen()),
  _page(RouteParent.medicationForm, () => const ParentMedicationFormScreen()),
  _page(
    RouteParent.noteForm,
    () => const ParentNoteFormScreen(),
    binding: _b(() => Get.lazyPut<ParentCareController>(() => ParentCareController(), fenix: true)),
  ),
  _page(
    RouteParent.pickup,
    () => const ParentPickupScreen(),
    binding: _b(() => Get.lazyPut<ParentPickupController>(() => ParentPickupController(), fenix: true)),
  ),
  _page(RouteParent.pickupForm, () => const ParentPickupFormScreen()),
  _page(
    RouteParent.health,
    () => const ParentHealthScreen(),
    binding: _b(() => Get.lazyPut<ParentHealthController>(() => ParentHealthController(), fenix: true)),
  ),
  _page(RouteParent.profileRequest, () => const ParentProfileRequestScreen()),
  _page(
    RouteParent.inbox,
    () => const ParentInboxScreen(),
    binding: _b(() => Get.lazyPut<ParentInboxController>(() => ParentInboxController(), fenix: true)),
  ),
  _page(RouteParent.notification, () => const ParentNotificationScreen()),
  _page(RouteParent.thread, () => const ParentThreadScreen()),
  _page(RouteParent.threadForm, () => const ParentThreadFormScreen()),
  _page(RouteParent.account, () => const ParentAccountScreen()),
];

