import 'package:flutter/widgets.dart';

import '../../models/ui_models/app_role.dart';
import '../common_components/app_icons.dart';
import '../screen_profile/profile_content.dart';
import '../screens_parent/parent_diary_screen.dart';
import '../screens_parent/parent_home_screen.dart';
import '../screens_parent/parent_tuition_screen.dart';
import '../screens_parent/parent_utilities_tab.dart';
import '../screens_principal/principal_approvals_tab.dart';
import '../screens_principal/principal_manage_tab.dart';
import '../screens_principal/principal_overview_tab.dart';
import '../screens_principal/principal_staff_tab.dart';
import '../screens_teacher/teacher_class_tab.dart';
import '../screens_teacher/teacher_diary_tab.dart';
import '../screens_teacher/teacher_home_tab.dart';
import '../screens_teacher/teacher_time_tab.dart';
import 'teacher_utilities_tab.dart';

/// One bottom-nav tab of a role shell.
class ShellTab {
  const ShellTab({
    required this.labelKey,
    required this.icon,
    required this.activeIcon,
    required this.builder,
  });

  /// String key of the label (`tab_*`).
  final String labelKey;
  final IconData icon;
  final IconData activeIcon;
  final WidgetBuilder builder;
}

/// The 5 tabs of each role (CONTRACT §8, DESIGN_SYSTEM §10).
///
/// === WHERE FEATURE AGENTS PLUG IN ===
/// Replace the `PlaceholderTab` of a tab with the real screen widget (keep the
/// label/icon). Codes are the screen ids of BUSINESS.txt §14 (`P01..P07`
/// parent, `T01..T07` teacher) and the APP.H* list for the principal.
class RoleTabs {
  RoleTabs._();

  static List<ShellTab> of(AppRole role) => switch (role) {
    AppRole.parent => parent,
    AppRole.teacher => teacher,
    AppRole.principal => principal,
  };

  static final List<ShellTab> parent = [
    ShellTab(
      labelKey: 'tab_home',
      icon: AppIcons.home,
      activeIcon: AppIcons.homeActive,
      builder: (_) => const ParentHomeTab(),
    ),
    ShellTab(
      labelKey: 'tab_diary',
      icon: AppIcons.diary,
      activeIcon: AppIcons.diaryActive,
      builder: (_) => const ParentDiaryScreen(),
    ),
    ShellTab(
      labelKey: 'tab_tuition',
      icon: AppIcons.money,
      activeIcon: AppIcons.moneyActive,
      builder: (_) => const ParentTuitionScreen(),
    ),
    ShellTab(
      labelKey: 'tab_utilities',
      icon: AppIcons.utilities,
      activeIcon: AppIcons.utilitiesActive,
      builder: (_) => const ParentUtilitiesTab(),
    ),
    ShellTab(
      labelKey: 'tab_profile',
      icon: AppIcons.person,
      activeIcon: AppIcons.personActive,
      builder: (_) => const ProfileTab(),
    ),
  ];

  static final List<ShellTab> teacher = [
    ShellTab(
      labelKey: 'tab_home',
      icon: AppIcons.home,
      activeIcon: AppIcons.homeActive,
      builder: (_) => const TeacherHomeTab(),
    ),
    ShellTab(
      labelKey: 'tab_classroom',
      icon: AppIcons.classroom,
      activeIcon: AppIcons.classroomActive,
      builder: (_) => const TeacherClassTab(),
    ),
    ShellTab(
      labelKey: 'tab_diary',
      icon: AppIcons.diary,
      activeIcon: AppIcons.diaryActive,
      builder: (_) => const TeacherDiaryTab(),
    ),
    ShellTab(
      labelKey: 'tab_timeclock',
      icon: AppIcons.timeclock,
      activeIcon: AppIcons.timeclockActive,
      builder: (_) => const TeacherTimeTab(),
    ),
    ShellTab(
      labelKey: 'tab_utilities',
      icon: AppIcons.utilities,
      activeIcon: AppIcons.utilitiesActive,
      builder: (_) => const TeacherUtilitiesTab(),
    ),
  ];

  static final List<ShellTab> principal = [
    ShellTab(
      labelKey: 'tab_overview',
      icon: AppIcons.dashboard,
      activeIcon: AppIcons.dashboardActive,
      builder: (_) => const PrincipalOverviewTab(),
    ),
    ShellTab(
      labelKey: 'tab_manage',
      icon: AppIcons.manage,
      activeIcon: AppIcons.manageActive,
      builder: (_) => const PrincipalManageTab(),
    ),
    ShellTab(
      labelKey: 'tab_staff',
      icon: AppIcons.staff,
      activeIcon: AppIcons.staffActive,
      builder: (_) => const PrincipalStaffTab(),
    ),
    ShellTab(
      labelKey: 'tab_approvals',
      icon: AppIcons.approve,
      activeIcon: AppIcons.approveActive,
      builder: (_) => const PrincipalApprovalsTab(),
    ),
    ShellTab(
      labelKey: 'tab_profile',
      icon: AppIcons.person,
      activeIcon: AppIcons.personActive,
      builder: (_) => const ProfileTab(),
    ),
  ];
}
