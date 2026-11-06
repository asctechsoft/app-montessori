import 'package:get/get.dart';

import '../models/data_models/teacher_models.dart';
import '../models/ui_models/app_role.dart';
import '../presentation/screens_teacher/teacher_bulk_screen.dart';
import '../presentation/screens_teacher/teacher_child_screen.dart';
import '../presentation/screens_teacher/teacher_diary_edit_screen.dart';
import '../presentation/screens_teacher/teacher_inbox_screens.dart';
import '../presentation/screens_teacher/teacher_medication_screens.dart';
import '../presentation/screens_teacher/teacher_pickup_screen.dart';
import '../presentation/screens_teacher/teacher_requests_screens.dart';
import 'app_pages.dart';
import 'route_teacher.dart';

GetPage<dynamic> _page(String name, GetPageBuilder page) =>
    GetPage(name: name, page: page, middlewares: [ContextGuard(AppRole.teacher)]);

/// Route teacher: names in route_teacher.dart, pages here.
final List<GetPage<dynamic>> teacherPages = <GetPage<dynamic>>[
  _page(RouteTeacher.child, () => TeacherChildScreen(childId: Get.arguments as String)),
  _page(RouteTeacher.pickup, () => TeacherPickupScreen(childId: Get.arguments as String)),
  _page(RouteTeacher.bulkAttendance, () => const TeacherBulkScreen()),
  _page(RouteTeacher.diaryEdit, () {
    final a = Get.arguments as Map<String, dynamic>;
    return TeacherDiaryEditScreen(childId: a['childId'] as String?, template: a['template'] == true);
  }),
  _page(RouteTeacher.meds, () => const TeacherMedListScreen()),
  _page(RouteTeacher.medDetail, () => TeacherMedDetailScreen(request: Get.arguments as MedRequest)),
  _page(RouteTeacher.incidents, () => const TeacherIncidentListScreen()),
  _page(RouteTeacher.incidentForm, () => const TeacherIncidentFormScreen()),
  _page(RouteTeacher.requests, () => const TeacherRequestsScreen()),
  _page(RouteTeacher.payslips, () => const TeacherPayslipsScreen()),
  _page(RouteTeacher.inbox, () => const TeacherInboxScreen()),
  _page(RouteTeacher.thread, () => TeacherThreadScreen(thread: Get.arguments as ThreadItem)),
];
