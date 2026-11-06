import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/principal_approvals_controller.dart';
import '../../controller/session_controller.dart';
import '../../models/data_models/principal_models.dart';
import '../../models/ui_models/app_tone.dart';
import '../../models/ui_models/status_catalog.dart';
import '../../utils/date_formatter.dart';
import '../../utils/toast_utils.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../../values/route_principal.dart';
import '../common_components/app_badge.dart';
import '../common_components/app_banner.dart';
import '../common_components/app_button.dart';
import '../common_components/app_card.dart';
import '../common_components/app_input.dart';
import '../common_components/confirm_dialog.dart';
import 'principal_approval_panels.dart';
import 'principal_widgets.dart';

PrincipalApprovalsController approvalsCtl() => Get.isRegistered<PrincipalApprovalsController>()
    ? Get.find<PrincipalApprovalsController>()
    : Get.put(PrincipalApprovalsController());

/// H07: approval centre. Campus (header switcher) -> pending list the user may
/// decide -> detail. No bulk approve: every decision is made on its own detail.
class PrincipalApprovalsTab extends StatefulWidget {
  const PrincipalApprovalsTab({super.key});

  @override
  State<PrincipalApprovalsTab> createState() => _PrincipalApprovalsTabState();
}

class _PrincipalApprovalsTabState extends State<PrincipalApprovalsTab> {
  final c = approvalsCtl();

  @override
  Widget build(BuildContext context) {
    return PrincipalPage(
      title: 'tab_approvals'.tr,
      isTab: true,
      body: PrincipalStatus<List<ApprovalItem>>(
        load: c.load,
        onRetry: c.refreshData,
        emptyTitle: 'p_ap_empty'.tr,
        emptyMessage: 'p_ap_empty_msg'.tr,
        builder: (_) => Obx(() {
          final items = c.items;
          final types = c.presentTypes;
          return RefreshIndicator(
            onRefresh: c.refreshData,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.symmetric(vertical: AppDimens.s4),
              children: [
                AppText(
                  'p_ap_count'.trParams({'args1': '${c.load.data.value?.length ?? 0}'}),
                  style: AppTypography.bodySmall,
                ),
                if (types.length > 1) ...[
                  const SizedBox(height: AppDimens.s2),
                  Wrap(
                    spacing: AppDimens.s2,
                    runSpacing: AppDimens.s2,
                    children: [
                      _TypeChip(
                        label: 'p_ap_all'.tr,
                        selected: c.typeFilter.value.isEmpty,
                        onTap: () => c.typeFilter.value = '',
                      ),
                      for (final t in types)
                        _TypeChip(
                          label: 'p_ap_type_$t'.tr,
                          selected: c.typeFilter.value == t,
                          onTap: () => c.typeFilter.value = t,
                        ),
                    ],
                  ),
                ],
                const SizedBox(height: AppDimens.s3),
                for (final a in items)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppDimens.s3),
                    child: _ApprovalCard(
                      a: a,
                      onTap: () => Get.toNamed(RoutePrincipal.approvalDetail, arguments: a),
                    ),
                  ),
              ],
            ),
          );
        }),
      ),
    );
  }
}

class _TypeChip extends StatelessWidget {
  const _TypeChip({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: AppDimens.touchMin),
        child: Material(
          color: selected ? AppColors.brandSoft : AppColors.surfaceMuted,
          shape: StadiumBorder(
            side: BorderSide(color: selected ? AppColors.brand : AppColors.borderSubtle),
          ),
          child: InkWell(
            customBorder: const StadiumBorder(),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppDimens.s4, vertical: AppDimens.s3),
              child: AppText(label, style: AppTypography.label),
            ),
          ),
        ),
      ),
    );
  }
}

class _ApprovalCard extends StatelessWidget {
  const _ApprovalCard({required this.a, required this.onTap});

  final ApprovalItem a;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final at = a.createdAt == null ? '' : CampusClock(SessionController.to.timezone).dateTime(a.createdAt!);
    return AppCard(
      onTap: onTap,
      semanticLabel: '${'p_ap_type_${a.type}'.tr}: ${a.summary}',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: AppText('p_ap_type_${a.type}'.tr, style: AppTypography.label)),
              const StatusBadge(StatusKind.approval, 'pending'),
            ],
          ),
          const SizedBox(height: AppDimens.s2),
          AppText(a.summary, style: AppTypography.bodyStrong),
          const SizedBox(height: AppDimens.s1),
          AppText(
            'p_ap_requested'.trParams({'args1': a.requestedByName.isEmpty ? '—' : a.requestedByName, 'args2': at}),
            style: AppTypography.bodySmall,
          ),
        ],
      ),
    );
  }
}

/// H08/H09: detail (before, after, impact), opinion, Reject / Approve.
class PrincipalApprovalDetailScreen extends StatefulWidget {
  const PrincipalApprovalDetailScreen({super.key, this.approval});

  final ApprovalItem? approval;

  @override
  State<PrincipalApprovalDetailScreen> createState() => _DetailState();
}

class _DetailState extends State<PrincipalApprovalDetailScreen> {
  final c = approvalsCtl();
  final note = TextEditingController();
  late final ApprovalItem a = widget.approval ?? (Get.arguments as ApprovalItem);
  String? noteError;

  @override
  void dispose() {
    note.dispose();
    super.dispose();
  }

  bool get _isOwner => SessionController.to.membership?.kind == 'owner';
  bool get _blockedSelf => c.isOwnRequest(a) && !_isOwner;

  Future<void> _decide(String decision) async {
    final approve = decision == 'approved';
    if (!approve && note.text.trim().isEmpty) {
      setState(() => noteError = 'p_ap_note_required'.tr);
      return;
    }
    setState(() => noteError = null);
    final ok = await ConfirmDialog.show(
      title: (approve ? 'p_ap_confirm_approve' : 'p_ap_confirm_reject').tr,
      message: 'p_ap_confirm_msg'.trParams({'args1': 'p_ap_type_${a.type}'.tr, 'args2': a.summary}),
      confirmLabel: (approve ? 'p_ap_approve' : 'p_ap_reject').tr,
      cancelLabel: 'action_cancel'.tr,
      destructive: !approve,
      onConfirm: () => c.decide(a, decision, note.text),
    );
    if (ok) {
      // only after the server confirmed
      AppToast.success((approve ? 'p_ap_done_approved' : 'p_ap_done_rejected').tr);
      Get.back<void>();
    }
  }

  @override
  Widget build(BuildContext context) {
    final can = c.canDecide(a) && approvalTypeSupported(a.type) && !_blockedSelf;
    return PrincipalPage(
      title: 'p_ap_detail'.tr,
      footer: can
          ? Row(
              children: [
                Expanded(
                  child: AppButton(
                    label: 'p_ap_reject'.tr,
                    variant: AppButtonVariant.destructiveOutline,
                    onPressed: () => _decide('rejected'),
                  ),
                ),
                const SizedBox(width: AppDimens.s3),
                Expanded(
                  child: AppButton(label: 'p_ap_approve'.tr, onPressed: () => _decide('approved')),
                ),
              ],
            )
          : null,
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: AppDimens.s4),
        children: [
          buildApprovalPanel(a, lookup: ApprovalLookup(classNames: Map<String, String>.of(c.classNames))),
          const SizedBox(height: AppDimens.s4),
          if (can)
            AppInput(
              label: 'p_ap_note'.tr,
              hint: 'p_ap_note_hint'.tr,
              helper: 'p_ap_note_helper'.tr,
              kind: AppInputKind.multiline,
              controller: note,
              error: noteError,
              maxLength: 500,
            )
          else
            AppBanner(
              tone: AppTone.info,
              message: (_blockedSelf ? 'p_ap_own_request' : 'p_ap_no_permission').tr,
            ),
          if (a.status != 'pending')
            Padding(
              padding: const EdgeInsets.only(top: AppDimens.s3),
              child: AppBadge(label: 'status_approval_${a.status}'.tr, tone: AppTone.neutral),
            ),
        ],
      ),
    );
  }
}
