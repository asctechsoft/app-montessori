import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/teacher_class_controller.dart';
import '../../controller/teacher_common.dart';
import '../../controller/teacher_diary_controller.dart';
import '../../models/data_models/teacher_models.dart';
import '../../models/ui_models/app_tone.dart';
import '../../services/network/api_service.dart';
import '../../services/network/app_exception.dart';
import '../../services/permission_service.dart';
import '../../utils/date_formatter.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../../values/permissions.dart';
import '../../values/route_teacher.dart';
import '../common_components/app_avatar.dart';
import '../common_components/app_badge.dart';
import '../common_components/app_banner.dart';
import '../common_components/app_button.dart';
import '../common_components/app_card.dart';
import '../common_components/app_icons.dart';
import '../common_components/confirm_dialog.dart';
import '../common_components/scope_selector.dart';
import '../common_components/screen_scaffold.dart';
import '../screen_shell/session_scope_bar.dart';
import 'teacher_widgets.dart';

/// T03 "Nhật ký" tab: pick day/class, write the class template then edit each
/// child, review and publish.
class TeacherDiaryTab extends StatefulWidget {
  const TeacherDiaryTab({super.key});

  @override
  State<TeacherDiaryTab> createState() => _TeacherDiaryTabState();
}

class _TeacherDiaryTabState extends State<TeacherDiaryTab> {
  late final TeacherClassController cls = teacherCtl(() => TeacherClassController());
  late final TeacherDiaryController d = teacherCtl(() => TeacherDiaryController());
  String? _publishOp;

  Future<void> _publish() async {
    final list = d.publishable;
    if (list.isEmpty) return;
    _publishOp ??= ApiService.newOpId();
    final photos = list.where((k) => (d.logs[k.id]?.photoPaths.isNotEmpty ?? false)).length;
    final ok = await ConfirmDialog.show(
      title: 't_publish_title'.trParams({'args1': '${list.length}'}),
      message: 't_publish_message'.trParams({
        'args1': DateFormatter.date(DateFormatter.parseDayKey(d.day.value) ?? DateTime.now()),
      }),
      confirmLabel: 't_publish'.tr,
      details: ImpactList(lines: [
        for (final k in list) k.fullName,
        if (photos > 0) 't_publish_photos'.trParams({'args1': '$photos'}),
      ]),
      onConfirm: () async {
        final r = await d.publish(list, opId: _publishOp);
        final skipped = (r['skipped'] as List?) ?? const [];
        _publishOp = null;
        if (skipped.isNotEmpty) {
          final first = skipped.first;
          throw AppException(
            'PRECONDITION',
            't_publish_skipped'.trParams({
              'args1': '${skipped.length}',
              'args2': first is Map ? (first['reason'] ?? '').toString() : '',
            }),
          );
        }
        teacherToast('t_publish_done'.trParams({'args1': '${list.length}'}));
      },
    );
    if (!ok) return;
  }

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      final classes = cls.classes;
      final dayDate = DateFormatter.parseDayKey(d.day.value);
      final canWrite = PermissionService.can(Perm.careWrite);
      return ScreenScaffold(
        title: 'tab_diary'.tr,
        showBack: false,
        inShell: true,
        contextLabels: teacherContext(),
        onRefresh: d.load,
        footer: d.state.value == ViewState.ready || d.state.value == ViewState.offlineStale
            ? (d.canPublish
                  ? AppButton(
                      label: 't_publish_btn'.trParams({'args1': '${d.publishable.length}'}),
                      size: AppButtonSize.lg,
                      onPressed: d.publishable.isEmpty ? null : _publish,
                    )
                  : null)
            : null,
        children: [
          const SessionScopeBar(),
          if (classes.length > 1) ...[
            ScopeSelector(
              label: 't_class'.tr,
              sheetTitle: 't_pick_class'.tr,
              leadingIcon: AppIcons.classroom,
              options: [for (final k in classes) ScopeOption(id: k.id, title: k.name)],
              selectedId: cls.classId.value,
              onSelected: cls.selectClass,
            ),
            const SizedBox(height: AppDimens.s3),
          ],
          _DayBar(
            label: dayDate == null ? d.day.value : DateFormatter.date(dayDate),
            isToday: d.isToday,
            onPrev: () => d.shiftDay(-1),
            onNext: d.isToday ? null : () => d.shiftDay(1),
          ),
          const SizedBox(height: AppDimens.s3),
          ...stateChildren(
            state: d.state.value,
            error: d.error.value,
            onRetry: d.load,
            staleSince: d.loadedAt.value,
            emptyTitle: 't_diary_empty_title'.tr,
            emptyMessage: 't_diary_empty_message'.tr,
            emptyIcon: AppIcons.diary,
            content: () => [
              if (!d.canPublish)
                AppBanner(message: 't_diary_draft_note'.tr, tone: AppTone.info, icon: AppIcons.diary),
              if (!d.canPublish) const SizedBox(height: AppDimens.s3),
              if (canWrite)
                AppButton(
                  label: 't_diary_template'.tr,
                  variant: AppButtonVariant.secondary,
                  icon: Icons.copy_all_outlined,
                  onPressed: () => Get.toNamed<void>(
                    RouteTeacher.diaryEdit,
                    arguments: {'childId': null, 'template': true},
                  ),
                ),
              const SizedBox(height: AppDimens.s3),
              for (final k in d.kids) ...[
                _DiaryTile(child: k, status: d.statusOf(k.id), log: d.logs[k.id]),
                const SizedBox(height: AppDimens.s3),
              ],
            ],
          ),
        ],
      );
    });
  }
}

class _DayBar extends StatelessWidget {
  const _DayBar({required this.label, required this.isToday, required this.onPrev, required this.onNext});
  final String label;
  final bool isToday;
  final VoidCallback onPrev;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(AppDimens.s2),
      child: Row(
        children: [
          IconButton(
            tooltip: 't_prev_day'.tr,
            constraints: const BoxConstraints(minWidth: AppDimens.touchMin, minHeight: AppDimens.touchMin),
            onPressed: onPrev,
            icon: const Icon(Icons.chevron_left),
          ),
          Expanded(
            child: Column(
              children: [
                AppText(label, style: AppTypography.bodyStrong, textAlign: TextAlign.center),
                if (isToday) AppText('date_today'.tr, style: AppTypography.caption, textAlign: TextAlign.center),
              ],
            ),
          ),
          IconButton(
            tooltip: 't_next_day'.tr,
            constraints: const BoxConstraints(minWidth: AppDimens.touchMin, minHeight: AppDimens.touchMin),
            onPressed: onNext,
            icon: const Icon(Icons.chevron_right),
          ),
        ],
      ),
    );
  }
}

class _DiaryTile extends StatelessWidget {
  const _DiaryTile({required this.child, required this.status, required this.log});
  final TeacherChild child;
  final String status;
  final DailyLog? log;

  @override
  Widget build(BuildContext context) {
    final tone = switch (status) {
      'published' => AppTone.success,
      'draft' => AppTone.warning,
      _ => AppTone.neutral,
    };
    return AppCard(
      onTap: () => Get.toNamed<void>(
        RouteTeacher.diaryEdit,
        arguments: {'childId': child.id, 'template': false},
      ),
      semanticLabel: child.fullName,
      child: Row(
        children: [
          AppAvatar(name: child.fullName, size: AppDimens.avatarMd),
          const SizedBox(width: AppDimens.s3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AppText(child.fullName, style: AppTypography.bodyStrong),
                const SizedBox(height: AppDimens.s1),
                Wrap(
                  spacing: AppDimens.s2,
                  runSpacing: AppDimens.s1,
                  children: [
                    AppBadge(label: 't_diary_status_$status'.tr, tone: tone),
                    if (log != null && log!.photoPaths.isNotEmpty)
                      AppBadge(
                        label: 't_diary_photos'.trParams({'args1': '${log!.photoPaths.length}'}),
                        tone: AppTone.info,
                        icon: Icons.photo_outlined,
                      ),
                  ],
                ),
              ],
            ),
          ),
          const Icon(AppIcons.chevronRight, color: AppColors.textSecondary),
        ],
      ),
    );
  }
}
