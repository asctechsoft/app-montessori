import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/parent_pickup_controller.dart';
import '../../controller/session_controller.dart';
import '../../models/data_models/parent_models.dart';
import '../../models/ui_models/app_tone.dart';
import '../../services/network/app_exception.dart';
import '../../utils/date_formatter.dart';
import '../../utils/relation_label.dart';
import '../../utils/toast_utils.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../../values/route_parent.dart';
import '../common_components/app_badge.dart';
import '../common_components/app_banner.dart';
import '../common_components/app_button.dart';
import '../common_components/app_card.dart';
import '../common_components/app_icons.dart';
import '../common_components/app_input.dart';
import '../common_components/confirm_dialog.dart';
import '../common_components/screen_scaffold.dart';
import 'parent_form.dart';
import 'parent_widgets.dart';

/// Label + tone of an authorisation; always text + icon, never colour alone.
(String, AppTone, IconData) pickupStatus(PickupAuth a, String today) {
  switch (a.effectiveStatus(today)) {
    case 'approved':
      return ('p04_status_active'.tr, AppTone.success, AppIcons.check);
    case 'pending':
      return ('p04_status_pending'.tr, AppTone.warning, AppIcons.refresh);
    case 'scheduled':
      return ('p04_status_scheduled'.tr, AppTone.info, AppIcons.calendar);
    case 'rejected':
      return ('p04_status_rejected'.tr, AppTone.error, AppIcons.close);
    case 'revoked':
      return ('p04_status_revoked'.tr, AppTone.neutral, AppIcons.close);
    case 'expired':
      return ('p04_status_expired'.tr, AppTone.neutral, AppIcons.calendar);
    default:
      return (a.status, AppTone.neutral, AppIcons.error);
  }
}

/// P04: who may pick the child up.
class ParentPickupScreen extends StatelessWidget {
  const ParentPickupScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = Get.put(ParentPickupController());
    return Obx(
      () => ScreenScaffold(
        title: 'screen_p04'.tr,
        contextLabels: parentContextLabels(),
        header: const ParentScopeHeader(),
        footer: AppButton(
          label: 'p04_add'.tr,
          icon: AppIcons.pickup,
          onPressed: () => Get.toNamed<void>(RouteParent.pickupForm),
        ),
        body: ParentStateView(
          controller: c,
          emptyTitle: 'p01_no_child_title'.tr,
          emptyMessage: 'p01_no_child_message'.tr,
          emptyIcon: AppIcons.child,
          builder: () => ParentList(
            onRefresh: c.load,
            children: [
              AppBanner(tone: AppTone.info, message: 'p04_rule'.tr),
              const SizedBox(height: AppDimens.s4),
              ParentSectionHeader(title: 'p04_guardians'.tr),
              if (c.guardians.isEmpty)
                AppCard(child: AppText('p04_no_guardians'.tr, style: AppTypography.bodySmall))
              else
                for (final a in c.guardians) ...[
                  PickupCard(a: a, today: c.today, c: c),
                  const SizedBox(height: AppDimens.s3),
                ],
              const SizedBox(height: AppDimens.s2),
              ParentSectionHeader(title: 'p04_delegates'.tr),
              if (c.delegates.isEmpty)
                AppCard(child: AppText('p04_no_delegates'.tr, style: AppTypography.bodySmall))
              else
                for (final a in c.delegates) ...[
                  PickupCard(a: a, today: c.today, c: c),
                  const SizedBox(height: AppDimens.s3),
                ],
            ],
          ),
        ),
      ),
    );
  }
}

class PickupCard extends StatelessWidget {
  const PickupCard({super.key, required this.a, required this.today, required this.c});

  final PickupAuth a;
  final String today;
  final ParentPickupController c;

  Future<void> _revoke() async {
    final reason = TextEditingController();
    String? err;
    await ConfirmDialog.show(
      title: 'p04_revoke_title'.trParams({'args1': a.personName}),
      message: 'p04_revoke_message'.tr,
      confirmLabel: 'p04_revoke_confirm'.tr,
      cancelLabel: 'scope_unsaved_stay'.tr,
      destructive: true,
      details: StatefulBuilder(
        builder: (context, set) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ImpactList(lines: ['p04_revoke_impact_1'.tr, 'p04_revoke_impact_2'.tr]),
            const SizedBox(height: AppDimens.s3),
            AppInput(
              label: 'p04_revoke_reason'.tr,
              controller: reason,
              required: true,
              maxLength: 200,
              error: err,
              onChanged: (_) {
                if (err != null) set(() => err = null);
              },
            ),
          ],
        ),
      ),
      onConfirm: () async {
        if (reason.text.trim().isEmpty) {
          throw AppException(AppException.validation, 'p04_revoke_reason_required'.tr);
        }
        await c.revoke(a.id, reason.text.trim());
        AppToast.success('p04_revoked'.tr);
      },
    );
    reason.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final (label, tone, icon) = pickupStatus(a, today);
    final canRevoke = !a.isGuardian && (a.status == 'pending' || a.status == 'approved');
    final validity = a.validTo == null
        ? null
        : '${dayText(a.validFrom)}${a.validFrom == null ? '' : ' - '}${dayText(a.validTo)}';
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ToneIcon(icon: AppIcons.person, tone: tone, size: AppDimens.s10),
              const SizedBox(width: AppDimens.s3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    AppText(a.personName, style: AppTypography.title),
                    if (a.relation != null) AppText(relationLabel(a.relation!), style: AppTypography.bodySmall),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppDimens.s2),
          AppBadge(label: label, tone: tone, icon: icon),
          if (validity != null) ...[
            const SizedBox(height: AppDimens.s2),
            AppText(
              'p04_valid'.trParams({'args1': validity}),
              style: AppTypography.bodySmall,
            ),
          ],
          if (a.status == 'pending')
            AppText('p04_pending_note'.tr, style: AppTypography.bodySmall),
          if (a.status == 'rejected' && a.decisionNote != null)
            AppBanner(tone: AppTone.error, message: a.decisionNote!),
          if (canRevoke) ...[
            const SizedBox(height: AppDimens.s2),
            AppButton(
              label: 'p04_revoke'.tr,
              variant: AppButtonVariant.destructiveOutline,
              size: AppButtonSize.sm,
              expand: false,
              onPressed: _revoke,
            ),
          ],
        ],
      ),
    );
  }
}

/// New temporary authorisation. It stays "Chờ nhà trường xác nhận" until the
/// school approves; the form says so before sending.
class ParentPickupFormScreen extends StatefulWidget {
  const ParentPickupFormScreen({super.key});

  @override
  State<ParentPickupFormScreen> createState() => _ParentPickupFormScreenState();
}

class _ParentPickupFormScreenState extends State<ParentPickupFormScreen> with ParentFormState {
  late final ParentPickupController c = Get.find<ParentPickupController>();
  final name = TextEditingController();
  final relation = TextEditingController();
  final phone = TextEditingController();
  final last4 = TextEditingController();
  final note = TextEditingController();
  DateTime? from;
  DateTime? to;

  @override
  bool get isDirty => name.text.isNotEmpty || relation.text.isNotEmpty || to != null;

  @override
  void dispose() {
    for (final t in [name, relation, phone, last4, note]) {
      t.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    final today = DateFormatter.parseDayKey(c.today);
    final start = from ?? today;
    final ok = setLocalErrors({
      if (name.text.trim().length < 2) 'personName': 'error_required',
      if (relation.text.trim().isEmpty) 'relation': 'error_required',
      if (to == null) 'validTo': 'error_required',
      if (to != null && start != null && to!.isBefore(start)) 'validTo': 'error_date_range',
      if (to != null && to!.difference(start ?? to!).inDays > 365) 'validTo': 'p04_error_too_long',
      if (last4.text.isNotEmpty && last4.text.trim().length > 6) 'idNumberLast4': 'p04_error_id',
    });
    if (!ok) return;
    await send(
      () => c.save(
        personName: name.text.trim(),
        relation: relation.text.trim(),
        phone: phone.text.trim(),
        idLast4: last4.text.trim(),
        validFrom: start!,
        validTo: to!,
        note: note.text.trim(),
        opId: opId,
      ),
      onDone: () => done('p04_saved'),
    );
  }

  @override
  Widget build(BuildContext context) {
    final today = DateFormatter.parseDayKey(c.today) ?? DateTime.now();
    final last = DateTime(today.year + 1, today.month, today.day);
    return ScreenScaffold(
      title: 'p04_add'.tr,
      contextLabels: [SessionController.to.child?.fullName ?? ''].where((e) => e.isNotEmpty).toList(),
      footer: AppButton(
        label: 'p04_submit'.tr,
        loadingLabel: 'state_sending'.tr,
        onPressed: _submit,
      ),
      children: [
        AppBanner(tone: AppTone.warning, message: 'p04_form_explain'.tr),
        const SizedBox(height: AppDimens.s3),
        if (formError != null) ...[
          AppBanner(tone: AppTone.error, message: formError!),
          const SizedBox(height: AppDimens.s3),
        ],
        AppInput(
          label: 'p04_name'.tr,
          controller: name,
          required: true,
          maxLength: 80,
          error: fieldErrors['personName'],
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 'p04_relation'.tr,
          controller: relation,
          required: true,
          maxLength: 40,
          error: fieldErrors['relation'],
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 'field_phone'.tr,
          controller: phone,
          kind: AppInputKind.phone,
          error: fieldErrors['phone'],
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 'p04_id_last4'.tr,
          controller: last4,
          maxLength: 6,
          helper: 'p04_id_helper'.tr,
          error: fieldErrors['idNumberLast4'],
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 'p04_valid_from'.tr,
          kind: AppInputKind.date,
          dateValue: from,
          firstDate: today,
          lastDate: last,
          helper: 'p04_valid_from_helper'.tr,
          error: fieldErrors['validFrom'],
          onDatePicked: (d) => setState(() {
            from = d;
            renewOp();
          }),
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 'p04_valid_to'.tr,
          kind: AppInputKind.date,
          required: true,
          dateValue: to,
          firstDate: from ?? today,
          lastDate: last,
          error: fieldErrors['validTo'],
          onDatePicked: (d) => setState(() {
            to = d;
            renewOp();
          }),
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 'p03_note'.tr,
          controller: note,
          kind: AppInputKind.multiline,
          maxLength: 500,
        ),
      ],
    );
  }
}
