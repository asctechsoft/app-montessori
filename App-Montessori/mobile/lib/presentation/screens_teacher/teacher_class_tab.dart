import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/teacher_class_controller.dart';
import '../../controller/teacher_common.dart';
import '../../models/data_models/teacher_models.dart';
import '../../models/ui_models/app_tone.dart';
import '../../models/ui_models/status_catalog.dart';
import '../../services/network/api_service.dart';
import '../../services/permission_service.dart';
import '../../services/sync/offline_queue.dart';
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
import '../common_components/app_input.dart';
import '../common_components/confirm_dialog.dart';
import '../common_components/scope_selector.dart';
import '../common_components/screen_scaffold.dart';
import '../common_components/sync_badge.dart';
import '../screen_shell/session_scope_bar.dart';
import 'teacher_widgets.dart';

/// T02 "Lớp học" tab: class selector, children with attendance/hand-over state,
/// class leave requests.
class TeacherClassTab extends StatefulWidget {
  const TeacherClassTab({super.key});

  @override
  State<TeacherClassTab> createState() => _TeacherClassTabState();
}

class _TeacherClassTabState extends State<TeacherClassTab> {
  int _seg = 0;
  late final TeacherClassController c = teacherCtl(() => TeacherClassController());

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      // Rebuild when the offline queue changes ("Chưa đồng bộ" markers).
      if (Get.isRegistered<OfflineQueue>()) OfflineQueue.to.items.length;
      final classes = c.classes;
      return ScreenScaffold(
        title: 'tab_classroom'.tr,
        showBack: false,
        inShell: true,
        contextLabels: teacherContext(),
        onRefresh: c.load,
        children: [
          const SessionScopeBar(),
          if (classes.length > 1) ...[
            ScopeSelector(
              label: 't_class'.tr,
              sheetTitle: 't_pick_class'.tr,
              leadingIcon: AppIcons.classroom,
              options: [for (final k in classes) ScopeOption(id: k.id, title: k.name)],
              selectedId: c.classId.value,
              onSelected: c.selectClass,
            ),
            const SizedBox(height: AppDimens.s3),
          ] else if (classes.length == 1) ...[
            AppCard(
              child: Row(
                children: [
                  const Icon(AppIcons.classroom, color: AppColors.brand),
                  const SizedBox(width: AppDimens.s3),
                  Expanded(child: AppText(classes.first.name, style: AppTypography.heading3)),
                ],
              ),
            ),
            const SizedBox(height: AppDimens.s3),
          ],
          AppText(
            'teacher_day_line'.trParams({'args1': DateFormatter.date(teacherClock().wall(DateTime.now()))}),
            style: AppTypography.bodySmall,
          ),
          const SizedBox(height: AppDimens.s3),
          SegmentBar(
            labels: [
              't_seg_children'.tr,
              't_seg_leaves'.trParams({'args1': '${c.pendingLeaves.length}'}),
            ],
            index: _seg,
            onChanged: (i) => setState(() => _seg = i),
          ),
          const SizedBox(height: AppDimens.s4),
          ...stateChildren(
            state: c.state.value,
            error: c.error.value,
            onRetry: c.load,
            staleSince: c.loadedAt.value,
            emptyTitle: 't_class_empty_title'.tr,
            emptyMessage: 't_class_empty_message'.tr,
            emptyIcon: AppIcons.classroom,
            content: () => _seg == 0 ? _children() : _leaves(),
          ),
        ],
      );
    });
  }

  // ------------------------------------------------------------------ children

  List<Widget> _children() {
    final shown = c.filteredKids;
    final unmarked = c.unmarkedCount;
    return [
      Wrap(
        spacing: AppDimens.s2,
        runSpacing: AppDimens.s2,
        children: [
          _Stat(label: 't_stat_present'.tr, value: c.presentCount, tone: AppTone.success),
          _Stat(label: 't_stat_absent'.tr, value: c.absentCount, tone: AppTone.error),
          _Stat(label: 't_stat_unmarked'.tr, value: c.unmarkedCount, tone: AppTone.warning),
          _Stat(label: 't_stat_at_school'.tr, value: c.stillAtSchoolCount, tone: AppTone.info),
        ],
      ),
      const SizedBox(height: AppDimens.s3),
      AppInput(
        label: 't_search_child'.tr,
        prefixIcon: AppIcons.search,
        onChanged: (v) => c.query.value = v,
      ),
      const SizedBox(height: AppDimens.s3),
      ChoiceChips(
        options: [for (final f in ChildFilter.values) f.name],
        value: c.filter.value.name,
        labelOf: (o) => 't_filter_$o'.tr,
        onChanged: (o) => c.filter.value = ChildFilter.values.firstWhere((f) => f.name == o),
      ),
      if (unmarked > 0 && PermissionService.can(Perm.attendanceWrite)) ...[
        const SizedBox(height: AppDimens.s3),
        AppButton(
          label: 't_bulk_open'.trParams({'args1': '$unmarked'}),
          variant: AppButtonVariant.secondary,
          icon: AppIcons.attendance,
          onPressed: () => Get.toNamed<void>(RouteTeacher.bulkAttendance),
        ),
      ],
      const SizedBox(height: AppDimens.s4),
      if (shown.isEmpty)
        SizedBox(
          height: 320,
          child: c.kids.isEmpty
              ? _emptyKids()
              : StatusViewNoResults(onClear: c.clearFilters),
        )
      else
        for (final k in shown) ...[
          _ChildTile(child: k, c: c),
          const SizedBox(height: AppDimens.s3),
        ],
    ];
  }

  Widget _emptyKids() => Center(
    child: AppBanner(message: 't_class_no_children'.tr, tone: AppTone.info),
  );

  // -------------------------------------------------------------------- leaves

  List<Widget> _leaves() {
    final pending = c.pendingLeaves;
    final done = c.doneLeaves;
    if (pending.isEmpty && done.isEmpty) {
      return [AppBanner(message: 't_leaves_empty'.tr, tone: AppTone.info)];
    }
    return [
      AppBanner(
        tone: AppTone.warning,
        icon: AppIcons.meal,
        title: 't_leave_meal_title'.tr,
        message: 't_leave_meal_policy'.tr,
      ),
      const SizedBox(height: AppDimens.s3),
      TeacherSection('t_leaves_pending'.trParams({'args1': '${pending.length}'})),
      if (pending.isEmpty) AppText('t_leaves_none_pending'.tr, style: AppTypography.bodySmall),
      for (final l in pending) ...[LeaveCard(leave: l, c: c), const SizedBox(height: AppDimens.s3)],
      TeacherSection('t_leaves_done'.tr),
      if (done.isEmpty) AppText('t_leaves_none_done'.tr, style: AppTypography.bodySmall),
      for (final l in done) ...[LeaveCard(leave: l, c: c), const SizedBox(height: AppDimens.s3)],
    ];
  }
}

/// "No results" message inside a bounded box (filters/search matched nobody).
class StatusViewNoResults extends StatelessWidget {
  const StatusViewNoResults({super.key, required this.onClear});
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(AppIcons.search, size: AppDimens.iconLg * 2, color: AppColors.textTertiary),
        const SizedBox(height: AppDimens.s3),
        AppText('no_results_title'.tr, style: AppTypography.heading3, textAlign: TextAlign.center),
        const SizedBox(height: AppDimens.s2),
        AppText('no_results_message'.tr, style: AppTypography.body, textAlign: TextAlign.center),
        const SizedBox(height: AppDimens.s3),
        AppButton(
          label: 'action_clear_filters'.tr,
          expand: false,
          variant: AppButtonVariant.secondary,
          icon: AppIcons.filter,
          onPressed: onClear,
        ),
      ],
    ),
  );
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, required this.tone});
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

class _ChildTile extends StatelessWidget {
  const _ChildTile({required this.child, required this.c});
  final TeacherChild child;
  final TeacherClassController c;

  @override
  Widget build(BuildContext context) {
    final att = c.attendanceOf(child.id);
    final ho = c.handoverOf(child.id);
    final sync = c.syncStateOf(child.id);
    final dev = c.queuedDeviceTime(child.id, 'handover.receive') ??
        c.queuedDeviceTime(child.id, 'attendance.mark');
    final health = child.health;
    return AppCard(
      onTap: () => Get.toNamed<void>(RouteTeacher.child, arguments: child.id),
      semanticLabel: child.fullName,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AppAvatar(name: child.fullName, size: AppDimens.avatarLg),
          const SizedBox(width: AppDimens.s3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AppText(child.fullName, style: AppTypography.bodyStrong),
                if (child.code.isNotEmpty)
                  AppText('t_child_code'.trParams({'args1': child.code}), style: AppTypography.bodySmall),
                const SizedBox(height: AppDimens.s2),
                Wrap(
                  spacing: AppDimens.s2,
                  runSpacing: AppDimens.s2,
                  children: [
                    if (att == 'unmarked')
                      AppBadge(label: 't_att_unmarked'.tr, tone: AppTone.warning)
                    else
                      StatusBadge(StatusKind.attendance, att),
                    if (att == 'present' && ho != 'not_received') StatusBadge(StatusKind.handover, ho),
                    if (health != null && health.hasAlert) HealthAlertBadge(text: health.headline),
                  ],
                ),
                if (sync != null) ...[
                  const SizedBox(height: AppDimens.s2),
                  SyncBadge(state: sync, deviceTime: dev),
                ],
              ],
            ),
          ),
          const Icon(AppIcons.chevronRight, color: AppColors.textSecondary),
        ],
      ),
    );
  }
}

/// One leave request card (design "Đơn nghỉ học").
class LeaveCard extends StatefulWidget {
  const LeaveCard({super.key, required this.leave, required this.c});
  final LeaveReq leave;
  final TeacherClassController c;

  @override
  State<LeaveCard> createState() => _LeaveCardState();
}

class _LeaveCardState extends State<LeaveCard> {
  String? _opId;

  String _name() => childNameOf(widget.c, widget.leave.childId);

  Future<void> _decide(String decision) async {
    final l = widget.leave;
    String? note;
    if (decision == 'rejected') {
      note = await askText(
        title: 't_leave_reject_title'.tr,
        label: 't_leave_reject_reason'.tr,
        confirmLabel: 't_leave_reject'.tr,
      );
      if (note == null) return;
    } else {
      final ok = await ConfirmDialog.show(
        title: 't_leave_confirm_title'.tr,
        message: 't_leave_confirm_message'.trParams({'args1': _name()}),
        confirmLabel: 't_leave_confirm'.tr,
      );
      if (!ok) return;
    }
    _opId ??= ApiService.newOpId();
    try {
      await widget.c.decideLeave(l, decision, note: note, opId: _opId);
      _opId = null;
      teacherToast(decision == 'approved' ? 't_leave_confirmed'.tr : 't_leave_rejected'.tr);
    } catch (e) {
      final ex = toAppException(e);
      if (!ex.isNetwork) _opId = null;
      if (!mounted) return;
      teacherToast(ex.userMessage, tone: AppTone.error);
    }
  }

  String _days(LeaveReq l) {
    final a = DateFormatter.parseDayKey(l.fromDay);
    final b = DateFormatter.parseDayKey(l.toDay);
    if (a == null) return l.fromDay;
    if (l.fromDay == l.toDay || b == null) return DateFormatter.date(a);
    return '${DateFormatter.date(a)} - ${DateFormatter.date(b)}';
  }

  @override
  Widget build(BuildContext context) {
    final l = widget.leave;
    final clock = teacherClock();
    final canDecide = PermissionService.can(Perm.leaveDecide) && l.isPending;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AppAvatar(name: _name(), size: AppDimens.avatarLg),
              const SizedBox(width: AppDimens.s3),
              Expanded(child: AppText(_name(), style: AppTypography.bodyStrong)),
              const SizedBox(width: AppDimens.s2),
              StatusBadge(StatusKind.approval, l.status),
            ],
          ),
          const Divider(height: AppDimens.s6, color: AppColors.divider),
          InfoLine(
            label: 't_leave_days'.tr,
            value: '${_days(l)} - ${codeLabel('t_session_', l.session)}',
            icon: AppIcons.calendar,
          ),
          InfoLine(
            label: 't_leave_reason'.tr,
            value: (l.reasonText ?? (l.reasonId == null ? null : leaveReasonLabel(l.reasonId!)) ?? '-'),
            icon: Icons.description_outlined,
          ),
          if (l.note != null)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.symmetric(vertical: AppDimens.s2),
              padding: const EdgeInsets.all(AppDimens.s3),
              decoration: BoxDecoration(
                color: AppColors.brandSoft,
                borderRadius: BorderRadius.circular(AppDimens.radiusMd),
              ),
              child: AppText(l.note!, style: AppTypography.body),
            ),
          if (l.submittedByName != null)
            InfoLine(label: 't_leave_sender'.tr, value: l.submittedByName!, icon: AppIcons.person),
          if (l.submittedAt != null)
            InfoLine(
              label: 't_leave_sent_at'.tr,
              value: clock.dateTime(l.submittedAt!),
              icon: Icons.schedule,
            ),
          if (!l.isPending && l.status == 'approved')
            InfoLine(
              label: 't_leave_meal_title'.tr,
              value: l.mealCancelledDays.isEmpty
                  ? 't_leave_meal_kept'.tr
                  : 't_leave_meal_cancelled'.trParams({'args1': '${l.mealCancelledDays.length}'}),
              icon: AppIcons.meal,
            ),
          if (l.decisionNote != null)
            InfoLine(label: 't_leave_decision_note'.tr, value: l.decisionNote!),
          if (l.isPending) ...[
            const SizedBox(height: AppDimens.s2),
            AppBanner(
              tone: AppTone.warning,
              icon: AppIcons.meal,
              title: 't_leave_meal_title'.tr,
              message: 't_leave_meal_policy'.tr,
            ),
          ],
          if (canDecide) ...[
            const SizedBox(height: AppDimens.s3),
            Row(
              children: [
                Expanded(
                  child: AppButton(
                    label: 't_leave_reject'.tr,
                    variant: AppButtonVariant.secondary,
                    onPressed: () => _decide('rejected'),
                  ),
                ),
                const SizedBox(width: AppDimens.s3),
                Expanded(child: AppButton(label: 't_leave_confirm'.tr, onPressed: () => _decide('approved'))),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

