import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/teacher_common.dart';
import '../../controller/teacher_requests_controller.dart';
import '../../controller/teacher_time_controller.dart';
import '../../models/data_models/teacher_models.dart';
import '../../models/ui_models/app_tone.dart';
import '../../services/sync/offline_queue.dart';
import '../../utils/date_formatter.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../../values/route_teacher.dart';
import '../common_components/app_badge.dart';
import '../common_components/app_banner.dart';
import '../common_components/app_button.dart';
import '../common_components/app_card.dart';
import '../common_components/app_icons.dart';
import '../common_components/screen_scaffold.dart';
import '../common_components/sync_badge.dart';
import '../screen_shell/session_scope_bar.dart';
import 'teacher_request_forms.dart';
import 'teacher_widgets.dart';

/// "Công cá nhân" tab: T05 clock in/out and T06 my timesheet and requests.
class TeacherTimeTab extends StatefulWidget {
  const TeacherTimeTab({super.key});

  @override
  State<TeacherTimeTab> createState() => _TeacherTimeTabState();
}

class _TeacherTimeTabState extends State<TeacherTimeTab> {
  int _seg = 0;
  late final TeacherTimeController t = teacherCtl(() => TeacherTimeController());
  late final TeacherRequestsController r = teacherCtl(() => TeacherRequestsController());

  Future<void> _punch() async {
    String? manual;
    final loc = t.locStatus.value;
    final located = t.fix.value != null;
    if (!located && loc != LocationStatus.checking) {
      // Lost location: manual confirmation flow with a written reason.
      manual = await askText(
        title: 't_punch_manual_title'.tr,
        label: 't_punch_manual_reason'.tr,
        helper: 't_punch_manual_hint'.tr,
        confirmLabel: 't_punch_manual_send'.tr,
        minLength: 5,
      );
      if (manual == null) return;
    }
    try {
      final o = await t.punch(manualNote: manual);
      if (!mounted) return;
      teacherToast(
        o.queued ? 't_saved_local'.tr : 't_punch_ok_${o.kind}'.tr,
        tone: o.queued ? AppTone.warning : AppTone.success,
      );
    } catch (e) {
      if (!mounted) return;
      teacherToast(toAppException(e).userMessage, tone: AppTone.error);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      if (Get.isRegistered<OfflineQueue>()) OfflineQueue.to.items.length;
      return ScreenScaffold(
        title: 'tab_timeclock'.tr,
        showBack: false,
        inShell: true,
        contextLabels: teacherContext(),
        onRefresh: () async {
          await t.load();
          await r.load();
        },
        children: [
          const SessionScopeBar(),
          SegmentBar(
            labels: ['screen_t05'.tr, 'screen_t06'.tr],
            index: _seg,
            onChanged: (i) => setState(() => _seg = i),
          ),
          const SizedBox(height: AppDimens.s4),
          ...stateChildren(
            state: t.state.value,
            error: t.error.value,
            onRetry: t.load,
            staleSince: t.loadedAt.value,
            emptyTitle: 't_time_no_employee_title'.tr,
            emptyMessage: 't_time_no_employee_message'.tr,
            emptyIcon: AppIcons.timeclock,
            content: () => _seg == 0 ? _clock() : _sheet(),
          ),
        ],
      );
    });
  }

  // ------------------------------------------------------------------- T05

  List<Widget> _clock() {
    final kind = t.nextKind;
    final clock = teacherClock();
    final shifts = t.todayShifts;
    final today = t.todayPunches;
    final out = t.lastOutcome.value;
    final loc = t.locStatus.value;
    final ins = today.where((p) => p.kind == 'in' && p.time != null).toList();
    final lastInText = ins.isEmpty ? '' : clock.time(ins.last.time!);
    return [
      AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AppText('t_time_shift_title'.tr, style: AppTypography.heading3),
            const SizedBox(height: AppDimens.s2),
            if (shifts.isEmpty)
              AppText('t_time_no_shift'.tr, style: AppTypography.bodySmall)
            else
              for (final s in shifts)
                InfoLine(
                  label: s.shiftName.isEmpty ? 't_time_shift'.tr : s.shiftName,
                  value: '${s.start} - ${s.end}',
                  icon: Icons.schedule,
                ),
            InfoLine(label: 'scope_campus'.tr, value: _campusName(), icon: AppIcons.school),
          ],
        ),
      ),
      const SizedBox(height: AppDimens.s3),
      _LocationCard(t: t),
      const SizedBox(height: AppDimens.s4),
      if (out != null && out.queued) ...[
        AppBanner(
          tone: AppTone.warning,
          icon: AppIcons.offline,
          title: 't_punch_queued_title'.tr,
          message: 't_punch_queued_message'.trParams({
            'args1': t.history.isEmpty ? '' : DateFormatter.time(out.deviceTime),
          }),
        ),
        const SizedBox(height: AppDimens.s3),
      ] else if (out != null && out.result != null && out.result != 'ok') ...[
        AppBanner(
          tone: AppTone.warning,
          message: out.result == 'outside_radius'
              ? 't_punch_outside'.tr
              : 't_punch_no_location_result'.tr,
        ),
        const SizedBox(height: AppDimens.s3),
      ],
      AppText(
        kind == 'out'
            ? 't_time_status_in'.trParams({'args1': lastInText})
            : 't_time_status_out'.tr,
        style: AppTypography.bodyStrong,
        textAlign: TextAlign.center,
      ),
      const SizedBox(height: AppDimens.s3),
      // The ONLY punch step: "Chấm vào" or "Chấm ra". Once clocked in, "Chấm
      // vào" is not offered as the primary action.
      AppButton(
        label: kind == 'in' ? 't_punch_in'.tr : 't_punch_out'.tr,
        loadingLabel: 'state_sending'.tr,
        size: AppButtonSize.lg,
        icon: kind == 'in' ? Icons.login : Icons.logout,
        variant: kind == 'in' ? AppButtonVariant.primary : AppButtonVariant.destructive,
        onPressed: loc == LocationStatus.checking ? null : _punch,
      ),
      if (!t.hasEmployee) ...[
        const SizedBox(height: AppDimens.s2),
        AppText('t_time_no_employee_message'.tr, style: AppTypography.caption),
      ],
      TeacherSection('t_time_today_punches'.tr),
      if (today.isEmpty)
        AppText('t_time_no_punch'.tr, style: AppTypography.bodySmall)
      else
        for (final p in today) ...[
          AppCard(
            padding: const EdgeInsets.all(AppDimens.s3),
            child: Row(
              children: [
                Icon(p.kind == 'in' ? Icons.login : Icons.logout, color: AppColors.brand),
                const SizedBox(width: AppDimens.s3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      AppText(
                        '${p.kind == 'in' ? 't_punch_in'.tr : 't_punch_out'.tr}  ${p.time == null ? '' : clock.time(p.time!)}',
                        style: AppTypography.bodyStrong,
                      ),
                      if (p.pending)
                        SyncBadge(state: SyncState.pending, deviceTime: p.time)
                      else if (p.result != 'ok')
                        AppBadge(label: 't_punch_result_${p.result}'.tr, tone: AppTone.warning),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppDimens.s2),
        ],
    ];
  }

  String _campusName() => teacherCampusName();

  // ------------------------------------------------------------------- T06

  List<Widget> _sheet() {
    final rows = t.dayRows.take(31).toList();
    final clock = teacherClock();
    return [
      AppBanner(message: 't_sheet_note'.tr, tone: AppTone.info, icon: AppIcons.timeclock),
      const SizedBox(height: AppDimens.s3),
      if (r.swapsToMe.isNotEmpty) ...[
        for (final s in r.swapsToMe) ...[
          _SwapInvite(swap: s, r: r),
          const SizedBox(height: AppDimens.s3),
        ],
      ],
      TeacherSection('t_sheet_table'.tr),
      if (rows.isEmpty)
        AppText('t_time_no_punch'.tr, style: AppTypography.bodySmall)
      else
        for (final d in rows) ...[
          AppCard(
            padding: const EdgeInsets.all(AppDimens.s3),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      AppText(_day(d.dayKey), style: AppTypography.bodyStrong),
                      AppText(
                        't_sheet_in_out'.trParams({
                          'args1': d.firstIn == null ? '--:--' : clock.time(d.firstIn!),
                          'args2': d.lastOut == null ? '--:--' : clock.time(d.lastOut!),
                        }),
                        style: AppTypography.bodySmall,
                      ),
                      if (d.hasPending) SyncBadge(state: SyncState.pending),
                    ],
                  ),
                ),
                // Missing "out" (or "in") is NOT shown as a full day.
                d.complete
                    ? AppBadge(label: 't_sheet_pairs_ok'.tr, tone: AppTone.success)
                    : AppBadge(label: 't_sheet_incomplete'.tr, tone: AppTone.warning),
              ],
            ),
          ),
          const SizedBox(height: AppDimens.s2),
        ],
      TeacherSection('t_sheet_requests'.tr),
      AppButton(
        label: 't_req_adjust'.tr,
        variant: AppButtonVariant.secondary,
        icon: Icons.edit_calendar_outlined,
        onPressed: () => showAdjustForm(r),
      ),
      const SizedBox(height: AppDimens.s2),
      AppButton(
        label: 't_req_leave'.tr,
        variant: AppButtonVariant.secondary,
        icon: AppIcons.calendar,
        onPressed: () => showLeaveForm(r),
      ),
      const SizedBox(height: AppDimens.s2),
      AppButton(
        label: 't_req_swap'.tr,
        variant: AppButtonVariant.secondary,
        icon: AppIcons.swap,
        onPressed: () => showSwapForm(r, t),
      ),
      const SizedBox(height: AppDimens.s2),
      AppButton(
        label: 't_req_mine'.tr,
        variant: AppButtonVariant.tertiary,
        onPressed: () => Get.toNamed<void>(RouteTeacher.requests),
      ),
      AppButton(
        label: 't_payslips_title'.tr,
        variant: AppButtonVariant.tertiary,
        onPressed: () => Get.toNamed<void>(RouteTeacher.payslips),
      ),
    ];
  }

  String _day(String k) {
    final d = DateFormatter.parseDayKey(k);
    return d == null ? k : DateFormatter.date(d);
  }
}

class _LocationCard extends StatelessWidget {
  const _LocationCard({required this.t});
  final TeacherTimeController t;

  @override
  Widget build(BuildContext context) {
    final s = t.locStatus.value;
    final fix = t.fix.value;
    final tone = switch (s) {
      LocationStatus.ok => AppTone.success,
      LocationStatus.checking => AppTone.info,
      _ => AppTone.warning,
    };
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(AppIcons.location, color: AppColors.brand),
              const SizedBox(width: AppDimens.s2),
              Expanded(child: AppText('t_loc_title'.tr, style: AppTypography.heading3)),
              AppBadge(label: 't_loc_${s.name}'.tr, tone: tone),
            ],
          ),
          if (fix != null) ...[
            const SizedBox(height: AppDimens.s2),
            AppText(
              't_loc_accuracy'.trParams({'args1': fix.accuracy.round().toString()}),
              style: AppTypography.bodySmall,
            ),
          ],
          if (s != LocationStatus.ok && s != LocationStatus.checking) ...[
            const SizedBox(height: AppDimens.s2),
            AppText('t_loc_manual_hint_${s.name}'.tr, style: AppTypography.bodySmall),
          ],
          const SizedBox(height: AppDimens.s2),
          AppButton(
            label: 't_loc_refresh'.tr,
            variant: AppButtonVariant.tertiary,
            expand: false,
            icon: AppIcons.refresh,
            onPressed: t.refreshLocation,
          ),
        ],
      ),
    );
  }
}

class _SwapInvite extends StatelessWidget {
  const _SwapInvite({required this.swap, required this.r});
  final ShiftSwapRec swap;
  final TeacherRequestsController r;

  Future<void> _answer(BuildContext context, bool accept) async {
    try {
      await r.respondSwap(swap, accept);
      teacherToast(accept ? 't_swap_accepted'.tr : 't_swap_declined'.tr);
    } catch (e) {
      teacherToast(toAppException(e).userMessage, tone: AppTone.error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = DateFormatter.parseDayKey(swap.dayKey);
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AppText('t_swap_invite_title'.tr, style: AppTypography.bodyStrong),
          AppText(
            't_swap_invite_message'.trParams({
              'args1': swap.fromName,
              'args2': d == null ? swap.dayKey : DateFormatter.date(d),
            }),
            style: AppTypography.body,
          ),
          const SizedBox(height: AppDimens.s3),
          Row(
            children: [
              Expanded(
                child: AppButton(
                  label: 't_swap_decline'.tr,
                  variant: AppButtonVariant.secondary,
                  onPressed: () => _answer(context, false),
                ),
              ),
              const SizedBox(width: AppDimens.s3),
              Expanded(child: AppButton(label: 't_swap_accept'.tr, onPressed: () => _answer(context, true))),
            ],
          ),
        ],
      ),
    );
  }
}

