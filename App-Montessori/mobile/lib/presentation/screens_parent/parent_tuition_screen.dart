import 'dart:io';

import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:image_picker/image_picker.dart';

import '../../controller/parent_tuition_controller.dart';
import '../../controller/session_controller.dart';
import '../../models/data_models/parent_models.dart';
import '../../models/ui_models/app_tone.dart';
import '../../models/ui_models/status_catalog.dart';
import '../../utils/date_formatter.dart';
import '../../utils/money_formatter.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../../values/route_parent.dart';
import '../common_components/app_badge.dart';
import '../common_components/app_banner.dart';
import '../common_components/app_button.dart';
import '../common_components/app_card.dart';
import '../common_components/app_icons.dart';
import '../common_components/app_input.dart';
import '../common_components/list_row.dart';
import '../common_components/screen_scaffold.dart';
import 'parent_form.dart';
import 'parent_home_screen.dart' show periodMonth;
import 'parent_widgets.dart';

/// P05: fees. Child -> total still to pay -> current period and older debt
/// (kept apart) -> line items -> payment method -> receipts sent.
class ParentTuitionScreen extends StatelessWidget {
  const ParentTuitionScreen({super.key, this.inShell = true});

  final bool inShell;

  @override
  Widget build(BuildContext context) {
    final c = Get.put(ParentTuitionController());
    return Obx(() {
      final sum = c.summary;
      return ScreenScaffold(
        title: 'tab_tuition'.tr,
        showBack: !inShell,
        inShell: inShell,
        contextLabels: parentContextLabels(),
        header: const ParentScopeHeader(),
        footer: c.hasData && sum.hasDebt
            ? AppButton(
                label: 'p05_send_proof'.tr,
                icon: AppIcons.money,
                onPressed: () => Get.toNamed<void>(RouteParent.proof),
              )
            : null,
        body: ParentStateView(
          controller: c,
          emptyTitle: 'p01_no_child_title'.tr,
          emptyMessage: 'p01_no_child_message'.tr,
          emptyIcon: AppIcons.child,
          builder: () => ParentList(onRefresh: c.load, children: _content(c, sum)),
        ),
      );
    });
  }

  List<Widget> _content(ParentTuitionController c, TuitionSummary sum) {
    final s = SessionController.to;
    if (c.receivables.isEmpty && c.payments.isEmpty) {
      return [AppCard(child: AppText('p05_no_fees'.tr, style: AppTypography.bodySmall))];
    }
    return [
      AppCard(
        color: sum.hasDebt ? AppColors.warningSoft : AppColors.successSoft,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AppText(
              sum.hasDebt ? 'p05_total_due'.tr : 'p05_nothing_due'.tr,
              style: AppTypography.label,
            ),
            if (sum.hasDebt)
              BigAmount(MoneyFormatter.format(sum.total)),
          ],
        ),
      ),
      const SizedBox(height: AppDimens.s3),
      if (c.pendingProofs.isNotEmpty) ...[
        AppBanner(
          tone: AppTone.warning,
          icon: AppIcons.refresh,
          title: 'status_payment_pending_reconciliation'.tr,
          message: 'p05_pending_note'.tr,
        ),
        const SizedBox(height: AppDimens.s3),
      ],
      if (sum.current != null) ...[
        ParentSectionHeader(title: 'p05_current_period'.tr),
        _ReceivableCard(r: sum.current!),
        const SizedBox(height: AppDimens.s3),
      ],
      if (sum.older.isNotEmpty) ...[
        ParentSectionHeader(title: 'p05_older_debt'.tr),
        AppBanner(
          tone: AppTone.error,
          message: 'p05_older_total'.trParams({'args1': MoneyFormatter.format(sum.olderTotal)}),
        ),
        const SizedBox(height: AppDimens.s2),
        for (final r in sum.older) ...[
          _ReceivableCard(r: r),
          const SizedBox(height: AppDimens.s3),
        ],
      ],
      ParentSectionHeader(title: 'p05_method'.tr),
      _MethodCard(bank: c.bank.value, childName: s.child?.fullName ?? '', period: sum.current?.periodKey),
      if (c.payments.any((p) => p.type == 'proof')) ...[
        const SizedBox(height: AppDimens.s4),
        ParentSectionHeader(title: 'p05_proofs'.tr),
        AppCard(
          padding: const EdgeInsets.symmetric(horizontal: AppDimens.s4),
          child: Column(
            children: [
              for (final p in c.payments.where((p) => p.type == 'proof'))
                ListRow(
                  title: MoneyFormatter.format(p.amount),
                  subtitle: p.submittedAt == null ? null : campusDateTime(p.submittedAt!),
                  showChevron: false,
                  trailing: StatusBadge(StatusKind.payment, p.status),
                  divider: true,
                ),
            ],
          ),
        ),
      ],
      if (c.paid.isNotEmpty) ...[
        const SizedBox(height: AppDimens.s4),
        ParentSectionHeader(title: 'p05_history'.tr),
        AppCard(
          padding: const EdgeInsets.symmetric(horizontal: AppDimens.s4),
          child: Column(
            children: [
              for (final r in c.paid.take(6))
                ListRow(
                  title: 'p05_period_title'.trParams({'args1': periodMonth(r.periodKey)}),
                  subtitle: MoneyFormatter.format(r.amount),
                  showChevron: false,
                  trailing: StatusBadge(StatusKind.payment, r.status),
                  divider: true,
                ),
            ],
          ),
        ),
      ],
    ];
  }
}

class _ReceivableCard extends StatelessWidget {
  const _ReceivableCard({required this.r});

  final Receivable r;

  @override
  Widget build(BuildContext context) {
    final due = DateFormatter.parseDayKey(r.dueDate);
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: AppDimens.s2,
            runSpacing: AppDimens.s2,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              AppText(
                'p05_period_title'.trParams({'args1': periodMonth(r.periodKey)}),
                style: AppTypography.title,
              ),
              // A receipt sent but not yet reconciled never reads "Paid".
              if (r.pendingReconciliation)
                const StatusBadge(StatusKind.payment, 'pending_reconciliation')
              else
                StatusBadge(StatusKind.payment, r.status),
            ],
          ),
          if (due != null)
            AppText(
              'p05_due_date'.trParams({'args1': DateFormatter.date(due)}),
              style: AppTypography.bodySmall,
            ),
          const SizedBox(height: AppDimens.s2),
          for (final l in r.lines)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppDimens.s1),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: AppText(l.description, style: AppTypography.body)),
                  const SizedBox(width: AppDimens.s3),
                  AppText(MoneyFormatter.format(l.amount), style: AppTypography.body),
                ],
              ),
            ),
          const Divider(color: AppColors.divider),
          Row(
            children: [
              Expanded(child: AppText('p05_remaining'.tr, style: AppTypography.label)),
              AppText(MoneyFormatter.format(r.balance), style: AppTypography.bodyStrong),
            ],
          ),
        ],
      ),
    );
  }
}

class _MethodCard extends StatelessWidget {
  const _MethodCard({required this.bank, required this.childName, required this.period});

  final BankInfo? bank;
  final String childName;
  final String? period;

  @override
  Widget build(BuildContext context) {
    final b = bank;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (b == null || b.isEmpty)
            AppText('p05_no_bank'.tr, style: AppTypography.body)
          else ...[
            if (b.bankName != null) ParentInfoRow(icon: AppIcons.school, label: 'p05_bank'.tr, value: b.bankName!),
            ParentInfoRow(icon: AppIcons.money, label: 'p05_account_no'.tr, value: b.accountNo!),
            if (b.accountName != null)
              ParentInfoRow(icon: AppIcons.person, label: 'p05_account_name'.tr, value: b.accountName!),
            ParentInfoRow(
              icon: AppIcons.email,
              label: 'p05_transfer_content'.tr,
              value: [childName, if (period != null) 'p05_period_title'.trParams({'args1': periodMonth(period!)})]
                  .where((e) => e.isNotEmpty)
                  .join(' '),
            ),
          ],
          const SizedBox(height: AppDimens.s2),
          AppText('p05_method_note'.tr, style: AppTypography.bodySmall),
        ],
      ),
    );
  }
}

/// Send a bank-transfer receipt: amount + photo (+ note). The result is
/// "Chờ đối soát"; the receivable is NOT marked paid by this screen.
class ParentProofScreen extends StatefulWidget {
  const ParentProofScreen({super.key, this.pickImage});

  /// Replaced in tests.
  final Future<File?> Function()? pickImage;

  @override
  State<ParentProofScreen> createState() => _ParentProofScreenState();
}

class _ParentProofScreenState extends State<ParentProofScreen> with ParentFormState {
  late final ParentTuitionController c = Get.find<ParentTuitionController>();
  late int? amount = c.summary.total > 0 ? c.summary.total : null;
  final note = TextEditingController();
  File? image;

  @override
  bool get isDirty => image != null || note.text.isNotEmpty;

  @override
  void dispose() {
    note.dispose();
    super.dispose();
  }

  Future<void> _pick() async {
    File? f;
    if (widget.pickImage != null) {
      f = await widget.pickImage!();
    } else {
      final x = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        imageQuality: 80,
        maxWidth: 1800,
      );
      if (x != null) f = File(x.path);
    }
    if (f != null && mounted) {
      setState(() {
        image = f;
        fieldErrors.remove('imagePath');
      });
    }
  }

  Future<void> _submit() async {
    final ok = setLocalErrors({
      if (amount == null || amount! <= 0) 'amount': 'error_required',
      if (image == null) 'imagePath': 'p05_error_image',
    });
    if (!ok) return;
    await send(
      () => c.submitProof(amount: amount!, image: image!, opId: opId, note: note.text.trim()),
      onDone: () => done('p05_proof_sent'),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ScreenScaffold(
      title: 'p05_send_proof'.tr,
      contextLabels: parentContextLabels(),
      footer: AppButton(
        label: 'p05_send_proof_action'.tr,
        loadingLabel: 'state_sending'.tr,
        onPressed: _submit,
      ),
      children: [
        AppBanner(tone: AppTone.info, message: 'p05_proof_explain'.tr),
        const SizedBox(height: AppDimens.s4),
        if (formError != null) ...[
          AppBanner(tone: AppTone.error, message: formError!),
          const SizedBox(height: AppDimens.s3),
        ],
        AppInput(
          label: 'p05_amount'.tr,
          kind: AppInputKind.money,
          amount: amount,
          required: true,
          error: fieldErrors['amount'],
          onAmountChanged: (v) {
            amount = v;
            renewOp();
          },
        ),
        const SizedBox(height: AppDimens.s4),
        AppText('p05_photo'.tr, style: AppTypography.label),
        const SizedBox(height: AppDimens.s2),
        if (image != null)
          ClipRRect(
            borderRadius: BorderRadius.circular(AppDimens.radiusMd),
            child: Image.file(
              image!,
              height: 200,
              width: double.infinity,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => const Icon(AppIcons.error),
            ),
          ),
        const SizedBox(height: AppDimens.s2),
        AppButton(
          label: image == null ? 'p05_pick_photo'.tr : 'p05_change_photo'.tr,
          variant: AppButtonVariant.secondary,
          icon: AppIcons.diary,
          onPressed: _pick,
        ),
        if (fieldErrors['imagePath'] != null) ...[
          const SizedBox(height: AppDimens.s2),
          AppText(fieldErrors['imagePath']!, style: AppTypography.bodySmall.copyWith(color: AppColors.error)),
        ],
        const SizedBox(height: AppDimens.s4),
        AppInput(
          label: 'p05_note'.tr,
          controller: note,
          kind: AppInputKind.multiline,
          maxLength: 500,
          error: fieldErrors['note'],
        ),
        const SizedBox(height: AppDimens.s2),
      ],
    );
  }
}
