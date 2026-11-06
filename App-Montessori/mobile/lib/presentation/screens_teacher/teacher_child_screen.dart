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
import '../common_components/screen_scaffold.dart';
import '../common_components/sync_badge.dart';
import 'teacher_widgets.dart';

/// T02 detail: handover record of one child. Drop-off (receive) and absence
/// are queueable offline; pick-up is a separate, online-only screen.
class TeacherChildScreen extends StatefulWidget {
  const TeacherChildScreen({super.key, required this.childId});
  final String childId;

  @override
  State<TeacherChildScreen> createState() => _TeacherChildScreenState();
}

class _TeacherChildScreenState extends State<TeacherChildScreen> {
  late final TeacherClassController c = teacherCtl(() => TeacherClassController());
  final _by = TextEditingController();
  TimeOfDay _time = campusNowOfDay();
  FormErrors _err = FormErrors();
  String? _receiveOpId;

  @override
  void dispose() {
    _by.dispose();
    super.dispose();
  }

  TeacherChild? get child => c.childById(widget.childId);

  Future<void> _receive(TeacherChild k) async {
    if (_by.text.trim().isEmpty) {
      setState(() => _err = FormErrors({'droppedBy': 'field_required'.tr}));
      return;
    }
    setState(() => _err = FormErrors());
    _receiveOpId ??= ApiService.newOpId();
    try {
      final out = await c.receive(
        child: k,
        droppedBy: _by.text.trim(),
        at: campusTimeToInstant(_time),
        opId: _receiveOpId,
      );
      _receiveOpId = null;
      if (!mounted) return;
      teacherToast(
        out == SubmitOutcome.queued ? 't_saved_local'.tr : 't_received_done'.trParams({'args1': k.fullName}),
        tone: out == SubmitOutcome.queued ? AppTone.warning : AppTone.success,
      );
    } catch (e) {
      final ex = toAppException(e);
      if (!ex.isNetwork) _receiveOpId = null;
      if (!mounted) return;
      setState(() => _err = FormErrors.from(ex));
    }
  }

  Future<void> _absent(TeacherChild k, String status) async {
    final ok = await ConfirmDialog.show(
      title: 't_absent_confirm_title'.tr,
      message: 't_absent_confirm_message'.trParams({
        'args1': k.fullName,
        'args2': 'status_attendance_$status'.tr,
      }),
      confirmLabel: 't_confirm'.tr,
    );
    if (!ok) return;
    try {
      final out = await c.mark(children: [k], status: status);
      if (!mounted) return;
      teacherToast(
        out == SubmitOutcome.queued ? 't_saved_local'.tr : 't_absent_done'.tr,
        tone: out == SubmitOutcome.queued ? AppTone.warning : AppTone.success,
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _err = FormErrors.from(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      final k = child;
      if (k == null) {
        return ScreenScaffold(
          title: 'screen_t02'.tr,
          children: [AppBanner(message: 'forbidden_message'.tr, tone: AppTone.warning)],
        );
      }
      final att = c.attendanceOf(k.id);
      final ho = c.handoverOf(k.id);
      final rec = c.handovers[k.id];
      final sync = c.syncStateOf(k.id);
      final dev = c.queuedDeviceTime(k.id, 'handover.receive') ?? c.queuedDeviceTime(k.id, 'attendance.mark');
      final clock = teacherClock();
      final health = k.health;
      final canWrite = PermissionService.can(Perm.handoverWrite);
      return ScreenScaffold(
        title: k.fullName,
        contextLabels: teacherContext(),
        onRefresh: c.load,
        children: [
          AppCard(
            child: Row(
              children: [
                AppAvatar(name: k.fullName, size: AppDimens.avatarXl),
                const SizedBox(width: AppDimens.s4),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      AppText(k.fullName, style: AppTypography.heading3),
                      if (k.code.isNotEmpty)
                        AppText('t_child_code'.trParams({'args1': k.code}), style: AppTypography.bodySmall),
                      const SizedBox(height: AppDimens.s2),
                      Wrap(
                        spacing: AppDimens.s2,
                        runSpacing: AppDimens.s2,
                        children: [
                          if (att == 'unmarked')
                            AppBadge(label: 't_att_unmarked'.tr, tone: AppTone.warning)
                          else
                            StatusBadge(StatusKind.attendance, att),
                          StatusBadge(StatusKind.handover, ho),
                        ],
                      ),
                      if (sync != null) ...[
                        const SizedBox(height: AppDimens.s2),
                        SyncBadge(state: sync, deviceTime: dev),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (health != null && (health.hasAlert || health.dietNote != null)) ...[
            const SizedBox(height: AppDimens.s3),
            AppBanner(
              tone: AppTone.error,
              icon: Icons.warning_amber_rounded,
              title: 't_health_notes'.tr,
              message: [
                if (health.allergies.isNotEmpty)
                  't_allergies'.trParams({'args1': health.allergies.join(', ')}),
                if (health.conditions.isNotEmpty)
                  't_conditions'.trParams({'args1': health.conditions.join(', ')}),
                ?health.dietNote,
              ].join('\n'),
            ),
          ],
          const SizedBox(height: AppDimens.s3),
          if (_err.general != null) ...[ErrorBanner(_err.general!), const SizedBox(height: AppDimens.s3)],
          if (ho == 'not_received' && canWrite) ..._receiveForm(k),
          if (ho == 'received') ...[
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AppText('t_handover_record'.tr, style: AppTypography.heading3),
                  const SizedBox(height: AppDimens.s2),
                  if (rec?.receivedAt != null)
                    InfoLine(label: 't_received_at'.tr, value: clock.time(rec!.receivedAt!), icon: Icons.schedule)
                  else if (dev != null)
                    InfoLine(label: 't_received_at'.tr, value: clock.time(dev), icon: Icons.schedule),
                  if ((rec?.droppedBy ?? '').isNotEmpty)
                    InfoLine(label: 't_dropped_by'.tr, value: rec!.droppedBy!, icon: AppIcons.person),
                  if (rec?.receivedByName != null)
                    InfoLine(label: 't_received_by'.tr, value: rec!.receivedByName!),
                ],
              ),
            ),
            const SizedBox(height: AppDimens.s4),
            if (canWrite)
              AppButton(
                label: 't_pickup_open'.tr,
                size: AppButtonSize.lg,
                icon: AppIcons.pickup,
                onPressed: sync != null
                    ? null
                    : () => Get.toNamed<void>(RouteTeacher.pickup, arguments: k.id),
              ),
            if (sync != null) ...[
              const SizedBox(height: AppDimens.s2),
              AppText('t_pickup_wait_sync'.tr, style: AppTypography.bodySmall),
            ],
          ],
          if (ho == 'picked_up')
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AppText('t_pickup_done_title'.tr, style: AppTypography.heading3),
                  if (rec?.pickedAt != null)
                    InfoLine(label: 't_picked_at'.tr, value: clock.time(rec!.pickedAt!), icon: Icons.schedule),
                  if (rec?.pickupPersonName != null)
                    InfoLine(label: 't_picked_by'.tr, value: rec!.pickupPersonName!, icon: AppIcons.person),
                ],
              ),
            ),
          if (ho == 'not_received' && !canWrite)
            AppBanner(message: 'forbidden_message'.tr, tone: AppTone.warning),
        ],
      );
    });
  }

  List<Widget> _receiveForm(TeacherChild k) => [
    AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AppText('t_receive_title'.tr, style: AppTypography.heading3),
          const SizedBox(height: AppDimens.s3),
          AppInput(
            label: 't_dropped_by'.tr,
            hint: 't_dropped_by_hint'.tr,
            controller: _by,
            required: true,
            error: _err.of('droppedBy'),
            prefixIcon: AppIcons.person,
          ),
          const SizedBox(height: AppDimens.s3),
          AppInput(
            label: 't_received_at'.tr,
            kind: AppInputKind.time,
            timeValue: _time,
            error: _err.of('at'),
            onTimePicked: (t) => setState(() => _time = t),
          ),
          const SizedBox(height: AppDimens.s4),
          AppButton(
            label: 't_receive_confirm'.tr,
            loadingLabel: 'state_sending'.tr,
            size: AppButtonSize.lg,
            onPressed: () => _receive(k),
          ),
        ],
      ),
    ),
    const SizedBox(height: AppDimens.s4),
    if (PermissionService.can(Perm.attendanceWrite)) ...[
      AppText('t_absent_title'.tr, style: AppTypography.bodyStrong),
      const SizedBox(height: AppDimens.s2),
      Row(
        children: [
          Expanded(
            child: AppButton(
              label: 'status_attendance_absent_excused'.tr,
              variant: AppButtonVariant.secondary,
              onPressed: () => _absent(k, 'absent_excused'),
            ),
          ),
          const SizedBox(width: AppDimens.s3),
          Expanded(
            child: AppButton(
              label: 'status_attendance_absent_unexcused'.tr,
              variant: AppButtonVariant.secondary,
              onPressed: () => _absent(k, 'absent_unexcused'),
            ),
          ),
        ],
      ),
    ],
    const SizedBox(height: AppDimens.s2),
    AppText('t_offline_note'.tr, style: AppTypography.caption.copyWith(color: AppColors.textSecondary)),
  ];
}
