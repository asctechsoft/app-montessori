import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../controller/teacher_class_controller.dart';
import '../../controller/teacher_common.dart';
import '../../controller/teacher_pickup_controller.dart';
import '../../models/data_models/teacher_models.dart';
import '../../models/ui_models/app_tone.dart';
import '../../models/ui_models/status_catalog.dart';
import '../../services/network/app_exception.dart';
import '../../utils/date_formatter.dart';
import '../../utils/relation_label.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../common_components/app_badge.dart';
import '../common_components/app_banner.dart';
import '../common_components/app_button.dart';
import '../common_components/app_card.dart';
import '../common_components/app_icons.dart';
import '../common_components/app_input.dart';
import '../common_components/confirm_dialog.dart';
import '../common_components/screen_scaffold.dart';
import 'teacher_widgets.dart';

/// Pick-up (T02): hand-over record -> valid pick-up people -> verification ->
/// confirmation. ONLINE ONLY: never queued. Calling a person ("Gọi") and
/// choosing them ("Trả") are separate touch areas.
class TeacherPickupScreen extends StatefulWidget {
  const TeacherPickupScreen({super.key, required this.childId, this.controller});
  final String childId;

  /// Injected in tests.
  final TeacherPickupController? controller;

  @override
  State<TeacherPickupScreen> createState() => _TeacherPickupScreenState();
}

class _TeacherPickupScreenState extends State<TeacherPickupScreen> {
  late final TeacherClassController cls = teacherCtl(() => TeacherClassController());
  late final TeacherPickupController p;
  final _note = TextEditingController();

  @override
  void initState() {
    super.initState();
    final k = cls.childById(widget.childId)!;
    p = widget.controller ?? Get.put(TeacherPickupController(k), tag: widget.childId);
  }

  @override
  void dispose() {
    _note.dispose();
    if (widget.controller == null) Get.delete<TeacherPickupController>(tag: widget.childId);
    super.dispose();
  }

  String _blockText(String reason) => 't_pickup_block_$reason'.tr;

  Future<void> _call(PickupAuth a) async {
    final phone = a.phone;
    if (phone == null) return;
    await launchUrl(Uri(scheme: 'tel', path: phone));
  }

  Future<void> _confirm() async {
    final a = p.selected;
    if (a == null) return;
    final clock = teacherClock();
    final hhmm = clock.time(DateTime.now());
    final ok = await ConfirmDialog.show(
      title: 't_pickup_confirm_title'.tr,
      message: 't_pickup_confirm_message'.trParams({
        'args1': p.child.fullName,
        'args2': a.personName,
        'args3': hhmm,
      }),
      confirmLabel: 't_pickup_confirm'.tr,
      onConfirm: () async {
        try {
          await p.confirm(note: _note.text.trim().isEmpty ? null : _note.text.trim());
        } catch (e) {
          final ex = toAppException(e);
          final reason = ex.details['reason']?.toString();
          // Show the exact reason (not received, expired, revoked ...).
          if (reason != null) throw AppException(ex.code, _blockText(reason));
          throw ex;
        }
      },
    );
    if (ok && mounted) {
      teacherToast('t_pickup_done'.trParams({'args1': p.child.fullName}));
      Get.back<void>();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      final online = teacherIsOnline;
      final sel = p.selected;
      final block = p.blockFor(sel);
      final hardBlock = p.handoverState != 'received' ? p.handoverState : null;
      final disabledReason = hardBlock != null
          ? _blockText(hardBlock == 'picked_up' ? 'already_picked_up' : 'not_received')
          : (!online ? 't_pickup_offline'.tr : (block != null ? _blockText(block) : null));
      return ScreenScaffold(
        title: 't_pickup_title'.trParams({'args1': p.child.fullName}),
        contextLabels: teacherContext(),
        onRefresh: p.load,
        footer: AppButton(
          label: 't_pickup_confirm'.tr,
          size: AppButtonSize.lg,
          icon: AppIcons.pickup,
          onPressed: p.canConfirm ? _confirm : null,
        ),
        children: [
          _HandoverCard(p: p),
          const SizedBox(height: AppDimens.s3),
          if (!online) ...[
            AppBanner(message: 't_pickup_offline'.tr, tone: AppTone.warning, icon: AppIcons.offline),
            const SizedBox(height: AppDimens.s3),
          ],
          if (hardBlock != null) ...[
            AppBanner(
              tone: AppTone.error,
              title: 't_pickup_blocked'.tr,
              message: _blockText(hardBlock == 'picked_up' ? 'already_picked_up' : 'not_received'),
            ),
            const SizedBox(height: AppDimens.s3),
          ],
          TeacherSection('t_pickup_people'.tr),
          ...stateChildren(
            state: p.state.value,
            error: p.error.value,
            onRetry: p.load,
            emptyTitle: 't_pickup_none_title'.tr,
            emptyMessage: 't_pickup_none_message'.tr,
            emptyIcon: AppIcons.person,
            content: () => [
              for (final a in p.auths) ...[
                _PersonCard(
                  auth: a,
                  selected: p.selectedId.value == a.id,
                  blockReason: p.blockFor(a) == 'not_received' || p.blockFor(a) == 'already_picked_up'
                      ? null
                      : p.blockFor(a),
                  onSelect: () => p.select(a),
                  onCall: a.phone == null ? null : () => _call(a),
                ),
                const SizedBox(height: AppDimens.s3),
              ],
            ],
          ),
          TeacherSection('t_pickup_verify'.tr),
          AppText('t_pickup_method'.tr, style: AppTypography.bodyStrong),
          const SizedBox(height: AppDimens.s2),
          ChoiceChips(
            options: const ['id_check', 'phone_call', 'qr', 'otp'],
            value: p.method.value,
            labelOf: (o) => 't_verify_$o'.tr,
            onChanged: (o) => p.method.value = o,
          ),
          if (p.method.value == 'qr' || p.method.value == 'otp') ...[
            const SizedBox(height: AppDimens.s2),
            AppText('t_verify_support_only'.tr, style: AppTypography.caption),
          ],
          const SizedBox(height: AppDimens.s3),
          AppCard(
            onTap: () => p.checklistDone.value = !p.checklistDone.value,
            selected: p.checklistDone.value,
            child: Row(
              children: [
                Icon(
                  p.checklistDone.value ? Icons.check_box : Icons.check_box_outline_blank,
                  color: p.checklistDone.value ? AppColors.brand : AppColors.textSecondary,
                ),
                const SizedBox(width: AppDimens.s3),
                Expanded(child: AppText('t_pickup_checklist'.tr, style: AppTypography.body)),
              ],
            ),
          ),
          const SizedBox(height: AppDimens.s3),
          AppInput(label: 't_pickup_note'.tr, controller: _note, kind: AppInputKind.multiline),
          if (disabledReason != null && sel != null) ...[
            const SizedBox(height: AppDimens.s3),
            AppBanner(message: disabledReason, tone: AppTone.warning),
          ],
        ],
      );
    });
  }
}

class _HandoverCard extends StatelessWidget {
  const _HandoverCard({required this.p});
  final TeacherPickupController p;

  @override
  Widget build(BuildContext context) {
    final rec = p.handover;
    final clock = teacherClock();
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: AppText('t_handover_record'.tr, style: AppTypography.heading3)),
              StatusBadge(StatusKind.handover, p.handoverState),
            ],
          ),
          if (rec?.receivedAt != null)
            InfoLine(label: 't_received_at'.tr, value: clock.time(rec!.receivedAt!), icon: Icons.schedule),
          if ((rec?.droppedBy ?? '').isNotEmpty)
            InfoLine(label: 't_dropped_by'.tr, value: rec!.droppedBy!, icon: AppIcons.person),
          if (p.child.health?.hasAlert ?? false) ...[
            const SizedBox(height: AppDimens.s2),
            HealthAlertBadge(text: p.child.health!.headline),
          ],
        ],
      ),
    );
  }
}

class _PersonCard extends StatelessWidget {
  const _PersonCard({
    required this.auth,
    required this.selected,
    required this.blockReason,
    required this.onSelect,
    required this.onCall,
  });

  final PickupAuth auth;
  final bool selected;
  final String? blockReason;
  final VoidCallback onSelect;
  final VoidCallback? onCall;

  String _validity() {
    final to = DateFormatter.parseDayKey(auth.validTo);
    if (to == null) return '';
    final time = auth.validToTime != null ? ' ${auth.validToTime}' : '';
    return 't_pickup_valid_to'.trParams({'args1': '${DateFormatter.date(to)}$time'});
  }

  @override
  Widget build(BuildContext context) {
    final blocked = blockReason != null;
    return Container(
      decoration: BoxDecoration(
        color: selected ? AppColors.brandSoft : AppColors.surface,
        borderRadius: BorderRadius.circular(AppDimens.radiusLg),
        border: Border.all(
          color: selected ? AppColors.brand : AppColors.borderSubtle,
          width: selected ? 2 : 1,
        ),
      ),
      child: IntrinsicHeight(
       child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // "Trả" zone: choose this person.
          Expanded(
            child: Semantics(
              button: true,
              selected: selected,
              enabled: !blocked,
              label: auth.personName,
              child: AppTouchable(
                onTap: blocked ? null : onSelect,
                borderRadius: BorderRadius.circular(AppDimens.radiusLg),
                pressedScale: 1,
                child: Padding(
                  padding: const EdgeInsets.all(AppDimens.s3),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      AppText(auth.personName, style: AppTypography.bodyStrong),
                      if (auth.relation.isNotEmpty) AppText(relationLabel(auth.relation), style: AppTypography.bodySmall),
                      if (auth.maskedPhone != null) AppText(auth.maskedPhone!, style: AppTypography.bodySmall),
                      if (_validity().isNotEmpty) AppText(_validity(), style: AppTypography.bodySmall),
                      const SizedBox(height: AppDimens.s2),
                      if (blocked)
                        AppBadge(label: 't_pickup_block_$blockReason'.tr, tone: AppTone.error)
                      else
                        AppBadge(label: 't_pickup_valid'.tr, tone: AppTone.success),
                    ],
                  ),
                ),
              ),
            ),
          ),
          if (onCall != null) ...[
            const VerticalDivider(width: AppDimens.s6, color: AppColors.divider),
            // "Gọi" zone: separate, never selects the person.
            Semantics(
              button: true,
              label: 't_call'.trParams({'args1': auth.personName}),
              child: AppTouchable(
                onTap: onCall,
                borderRadius: BorderRadius.circular(AppDimens.radiusLg),
                pressedScale: 1,
                child: Container(
                  constraints: const BoxConstraints(minWidth: AppDimens.touchMin + AppDimens.s3),
                  alignment: Alignment.center,
                  padding: const EdgeInsets.symmetric(horizontal: AppDimens.s2),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(AppIcons.phone, color: AppColors.action),
                      AppText('t_call_short'.tr, style: AppTypography.caption.copyWith(color: AppColors.action)),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ],
       ),
      ),
    );
  }
}
