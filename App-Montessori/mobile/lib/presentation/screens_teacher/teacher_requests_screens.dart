import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/teacher_common.dart';
import '../../controller/teacher_requests_controller.dart';
import '../../models/ui_models/app_tone.dart';
import '../../models/ui_models/status_catalog.dart';
import '../../utils/date_formatter.dart';
import '../../utils/money_formatter.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../common_components/app_badge.dart';
import '../common_components/app_banner.dart';
import '../common_components/app_card.dart';
import '../common_components/app_icons.dart';
import '../common_components/screen_scaffold.dart';
import 'teacher_widgets.dart';

String _day(String k) {
  final d = DateFormatter.parseDayKey(k);
  return d == null ? k : DateFormatter.date(d);
}

/// My requests: punch adjustments, leave, shift swaps with their status and
/// the reply of the approver.
class TeacherRequestsScreen extends StatelessWidget {
  const TeacherRequestsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final r = teacherCtl(() => TeacherRequestsController());
    return Obx(() {
      final clock = teacherClock();
      return ScreenScaffold(
        title: 't_req_mine'.tr,
        contextLabels: teacherContext(),
        onRefresh: r.load,
        children: stateChildren(
          state: r.state.value,
          error: r.error.value,
          onRetry: r.load,
          emptyTitle: 't_req_empty_title'.tr,
          emptyMessage: 't_req_empty_message'.tr,
          emptyIcon: AppIcons.calendar,
          content: () => [
            TeacherSection('t_req_adjust'.tr),
            if (r.adjusts.isEmpty) AppText('t_req_none'.tr, style: AppTypography.bodySmall),
            for (final a in r.adjusts) ...[
              AppCard(
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          AppText(
                            '${_day(a.dayKey)} - ${a.kind == 'in' ? 't_punch_in'.tr : 't_punch_out'.tr}'
                            '${a.requestedTime == null ? '' : ' ${clock.time(a.requestedTime!)}'}',
                            style: AppTypography.bodyStrong,
                          ),
                          AppText(a.reason, style: AppTypography.bodySmall),
                        ],
                      ),
                    ),
                    StatusBadge(StatusKind.approval, a.status),
                  ],
                ),
              ),
              const SizedBox(height: AppDimens.s2),
            ],
            TeacherSection('t_req_leave'.tr),
            if (r.leaves.isEmpty) AppText('t_req_none'.tr, style: AppTypography.bodySmall),
            for (final l in r.leaves) ...[
              AppCard(
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          AppText(
                            '${_day(l.fromDay)} - ${_day(l.toDay)}',
                            style: AppTypography.bodyStrong,
                          ),
                          AppText('t_leave_type_${l.type}'.tr, style: AppTypography.bodySmall),
                          AppText(l.reason, style: AppTypography.bodySmall),
                        ],
                      ),
                    ),
                    StatusBadge(StatusKind.approval, l.status),
                  ],
                ),
              ),
              const SizedBox(height: AppDimens.s2),
            ],
            TeacherSection('t_req_swap'.tr),
            if (r.swaps.isEmpty) AppText('t_req_none'.tr, style: AppTypography.bodySmall),
            for (final s in r.swaps) ...[
              AppCard(
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          AppText(_day(s.dayKey), style: AppTypography.bodyStrong),
                          AppText(s.toName, style: AppTypography.bodySmall),
                        ],
                      ),
                    ),
                    AppBadge(
                      label: 't_swap_status_${s.status}'.tr,
                      tone: switch (s.status) {
                        'approved' => AppTone.success,
                        'rejected' || 'declined_by_peer' => AppTone.error,
                        _ => AppTone.warning,
                      },
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppDimens.s2),
            ],
          ],
        ),
      );
    });
  }
}

/// My payslips (only those published for me).
class TeacherPayslipsScreen extends StatelessWidget {
  const TeacherPayslipsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final r = teacherCtl(() => TeacherRequestsController());
    return Obx(() {
      return ScreenScaffold(
        title: 't_payslips_title'.tr,
        contextLabels: teacherContext(),
        onRefresh: r.load,
        children: stateChildren(
          state: r.state.value,
          error: r.error.value,
          onRetry: r.load,
          emptyTitle: 't_payslips_empty_title'.tr,
          emptyMessage: 't_payslips_empty_message'.tr,
          emptyIcon: AppIcons.money,
          content: () => [
            if (r.payslips.isEmpty) AppBanner(message: 't_payslips_empty_message'.tr, tone: AppTone.info),
            for (final p in r.payslips) ...[
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: AppText(
                            't_payslip_period'.trParams({'args1': p.periodKey}),
                            style: AppTypography.heading3,
                          ),
                        ),
                        AppBadge(
                          label: 't_payslip_pay_${p.paymentStatus}'.tr,
                          tone: p.paymentStatus == 'paid' ? AppTone.success : AppTone.warning,
                        ),
                      ],
                    ),
                    const SizedBox(height: AppDimens.s2),
                    _Money('t_payslip_base'.tr, p.basePay),
                    if (p.overtimePay != 0) _Money('t_payslip_overtime'.tr, p.overtimePay),
                    if (p.allowances != 0) _Money('t_payslip_allowances'.tr, p.allowances),
                    if (p.deductions != 0) _Money('t_payslip_deductions'.tr, -p.deductions, negative: true),
                    const Divider(color: AppColors.divider),
                    _Money('t_payslip_net'.tr, p.net, strong: true),
                  ],
                ),
              ),
              const SizedBox(height: AppDimens.s3),
            ],
          ],
        ),
      );
    });
  }
}

class _Money extends StatelessWidget {
  const _Money(this.label, this.amount, {this.strong = false, this.negative = false});
  final String label;
  final int amount;
  final bool strong;
  final bool negative;

  @override
  Widget build(BuildContext context) {
    final style = strong ? AppTypography.bodyStrong : AppTypography.body;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppDimens.s1),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: AppText(label, style: style)),
          const SizedBox(width: AppDimens.s2),
          Flexible(
            child: AppText(
              MoneyFormatter.format(amount),
              style: style.copyWith(color: negative ? AppColors.error : null),
              textAlign: TextAlign.right,
            ),
          ),
        ],
      ),
    );
  }
}
