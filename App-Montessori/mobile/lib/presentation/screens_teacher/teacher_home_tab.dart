import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/session_controller.dart';
import '../../controller/teacher_care_controller.dart';
import '../../controller/teacher_class_controller.dart';
import '../../controller/teacher_common.dart';
import '../../controller/teacher_time_controller.dart';
import '../../models/data_models/teacher_models.dart';
import '../../models/ui_models/app_tone.dart';
import '../../utils/date_formatter.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../../values/route_teacher.dart';
import '../common_components/app_badge.dart';
import '../common_components/app_banner.dart';
import '../common_components/app_card.dart';
import '../common_components/app_icons.dart';
import '../common_components/screen_scaffold.dart';
import '../screen_shell/session_scope_bar.dart';
import 'teacher_widgets.dart';

/// T01 "Trang chủ": today's shift, class, children that need attention
/// (allergy, medicine due) and work that is due (pending leaves, unmarked).
class TeacherHomeTab extends StatelessWidget {
  const TeacherHomeTab({super.key});

  /// `HH:mm` within +/-30 minutes of [nowMinutes] (campus wall clock).
  static bool isDue(String hhmm, int nowMinutes) {
    final m = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(hhmm);
    if (m == null) return false;
    final t = int.parse(m.group(1)!) * 60 + int.parse(m.group(2)!);
    return (t - nowMinutes).abs() <= 30;
  }

  @override
  Widget build(BuildContext context) {
    final cls = teacherCtl(() => TeacherClassController());
    final care = teacherCtl(() => TeacherCareController());
    final time = teacherCtl(() => TeacherTimeController());
    final s = SessionController.to;
    return Obx(() {
      final clock = teacherClock();
      final wall = clock.wall(DateTime.now());
      final nowMin = wall.hour * 60 + wall.minute;
      final today = clock.dayKey();
      final name = s.displayName.value;
      final alertKids = cls.kids
          .where((k) => (k.health?.hasAlert ?? false) && cls.isPresent(k.id))
          .toList();
      final dueMeds = care.meds
          .where((m) => m.status == 'received' && m.fromDay.compareTo(today) <= 0 && m.toDay.compareTo(today) >= 0)
          .toList();
      final pendingMeds = care.medsWhere({'pending'});
      return ScreenScaffold(
        title: 'tab_home'.tr,
        showBack: false,
        inShell: true,
        contextLabels: teacherContext(),
        onRefresh: () async {
          await cls.load();
          await care.load();
          await time.load();
        },
        children: [
          AppText(
            name.isEmpty ? 't_home_greeting_plain'.tr : 't_home_greeting'.trParams({'args1': name}),
            style: AppTypography.heading2,
          ),
          AppText(DateFormatter.weekdayDate(wall), style: AppTypography.bodySmall),
          const SizedBox(height: AppDimens.s3),
          const SessionScopeBar(),
          // Shift of today (from the roster; may be unavailable).
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AppText('t_time_shift_title'.tr, style: AppTypography.heading3),
                const SizedBox(height: AppDimens.s2),
                if (time.todayShifts.isEmpty)
                  AppText('t_time_no_shift'.tr, style: AppTypography.bodySmall)
                else
                  for (final sh in time.todayShifts)
                    InfoLine(
                      label: sh.shiftName.isEmpty ? 't_time_shift'.tr : sh.shiftName,
                      value: '${sh.start} - ${sh.end}',
                      icon: Icons.schedule,
                    ),
                InfoLine(label: 'scope_campus'.tr, value: s.campusName, icon: AppIcons.school),
                if (cls.selectedClass != null)
                  InfoLine(label: 't_class'.tr, value: cls.selectedClass!.name, icon: AppIcons.classroom),
              ],
            ),
          ),
          const SizedBox(height: AppDimens.s4),
          ...stateChildren(
            state: cls.state.value,
            error: cls.error.value,
            onRetry: cls.load,
            staleSince: cls.loadedAt.value,
            emptyTitle: 't_class_empty_title'.tr,
            emptyMessage: 't_class_empty_message'.tr,
            emptyIcon: AppIcons.classroom,
            content: () => [
              Wrap(
                spacing: AppDimens.s2,
                runSpacing: AppDimens.s2,
                children: [
                  _Tile(label: 't_stat_present'.tr, value: cls.presentCount, tone: AppTone.success),
                  _Tile(label: 't_stat_absent'.tr, value: cls.absentCount, tone: AppTone.error),
                  _Tile(label: 't_stat_unmarked'.tr, value: cls.unmarkedCount, tone: AppTone.warning),
                  _Tile(label: 't_stat_at_school'.tr, value: cls.stillAtSchoolCount, tone: AppTone.info),
                ],
              ),
              TeacherSection('t_home_attention'.tr),
              if (alertKids.isEmpty && dueMeds.isEmpty)
                AppText('t_home_attention_none'.tr, style: AppTypography.bodySmall),
              for (final k in alertKids) ...[
                AppCard(
                  onTap: () => Get.toNamed<void>(RouteTeacher.child, arguments: k.id),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            AppText(k.fullName, style: AppTypography.bodyStrong),
                            const SizedBox(height: AppDimens.s1),
                            HealthAlertBadge(text: k.health!.headline),
                          ],
                        ),
                      ),
                      const Icon(AppIcons.chevronRight, color: AppColors.textSecondary),
                    ],
                  ),
                ),
                const SizedBox(height: AppDimens.s2),
              ],
              for (final m in dueMeds) ...[
                AppCard(
                  onTap: () => Get.toNamed<void>(RouteTeacher.medDetail, arguments: m),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            AppText(care.nameOf(m.childId), style: AppTypography.bodyStrong),
                            AppText('${m.medicineName} - ${m.dose}', style: AppTypography.body),
                            Wrap(
                              spacing: AppDimens.s2,
                              children: [
                                for (final t in m.times)
                                  AppBadge(
                                    label: isDue(t, nowMin) ? 't_home_med_due'.trParams({'args1': t}) : t,
                                    tone: isDue(t, nowMin) ? AppTone.warning : AppTone.neutral,
                                    icon: AppIcons.medicine,
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const Icon(AppIcons.chevronRight, color: AppColors.textSecondary),
                    ],
                  ),
                ),
                const SizedBox(height: AppDimens.s2),
              ],
              TeacherSection('t_home_due'.tr),
              _DueRow(
                icon: AppIcons.attendance,
                text: 't_home_due_unmarked'.trParams({'args1': '${cls.unmarkedCount}'}),
                alert: cls.unmarkedCount > 0,
              ),
              _DueRow(
                icon: AppIcons.calendar,
                text: 't_home_due_leaves'.trParams({'args1': '${cls.pendingLeaves.length}'}),
                alert: cls.pendingLeaves.isNotEmpty,
              ),
              _DueRow(
                icon: AppIcons.medicine,
                text: 't_home_due_meds'.trParams({'args1': '${pendingMeds.length}'}),
                alert: pendingMeds.isNotEmpty,
                onTap: () => Get.toNamed<void>(RouteTeacher.meds),
              ),
              if (care.state.value == ViewState.error)
                Padding(
                  padding: const EdgeInsets.only(top: AppDimens.s2),
                  child: AppBanner(
                    tone: AppTone.warning,
                    message: 't_home_care_error'.tr,
                    actionLabel: 'action_retry'.tr,
                    onAction: care.load,
                  ),
                ),
            ],
          ),
        ],
      );
    });
  }
}

class _Tile extends StatelessWidget {
  const _Tile({required this.label, required this.value, required this.tone});
  final String label;
  final int value;
  final AppTone tone;

  @override
  Widget build(BuildContext context) {
    final w = (MediaQuery.sizeOf(context).width - AppDimens.pageGutter(context) * 2 - AppDimens.s2) / 2;
    return SizedBox(
      width: w.clamp(120, 280),
      child: AppCard(
        padding: const EdgeInsets.all(AppDimens.s3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AppText('$value', style: AppTypography.heading2),
            AppText(label, style: AppTypography.bodySmall),
          ],
        ),
      ),
    );
  }
}

class _DueRow extends StatelessWidget {
  const _DueRow({required this.icon, required this.text, required this.alert, this.onTap});
  final IconData icon;
  final String text;
  final bool alert;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppDimens.s2),
      child: AppCard(
        onTap: onTap,
        padding: const EdgeInsets.all(AppDimens.s3),
        child: Row(
          children: [
            Icon(icon, color: alert ? AppColors.warning : AppColors.brand),
            const SizedBox(width: AppDimens.s3),
            Expanded(child: AppText(text, style: AppTypography.body)),
          ],
        ),
      ),
    );
  }
}

/// Used by tests: children of the class with an alert and present.
List<TeacherChild> attentionChildren(TeacherClassController c) =>
    c.kids.where((k) => (k.health?.hasAlert ?? false) && c.isPresent(k.id)).toList();
