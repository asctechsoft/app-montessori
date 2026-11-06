import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/session_controller.dart';
import '../../models/data_models/principal_models.dart';
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
import 'principal_widgets.dart';

/// Lookup data panels may need (kept out of the approval doc).
class ApprovalLookup {
  const ApprovalLookup({this.classNames = const {}});

  final Map<String, String> classNames;

  String cls(Object? id) {
    final k = id?.toString() ?? '';
    return classNames[k] ?? (k.isEmpty ? '' : 'p_class_unknown'.tr);
  }
}

String _money(Object? v) {
  final n = asInt(v);
  return n == null ? '—' : MoneyFormatter.format(n);
}

String _day(Object? v) {
  final x = DateFormatter.parseDayKey(v?.toString()) ?? DateTime.tryParse(v?.toString() ?? '');
  return x == null ? (v?.toString() ?? '') : DateFormatter.date(x);
}

String _dateTime(Object? v) {
  final t = toDate(v);
  return t == null ? '' : CampusClock(SessionController.to.timezone).dateTime(t);
}

String _minutes(Object? v) {
  final m = asInt(v);
  if (m == null) return '—';
  final h = m ~/ 60;
  final r = m % 60;
  return h == 0 ? '$r ${'p_unit_min'.tr}' : '$h ${'p_unit_hour'.tr} $r ${'p_unit_min'.tr}';
}

String _n(Object? v) => asInt(v)?.toString() ?? '—';

// ---------------------------------------------------------------- building blocks

/// "Trước" / "Sau" side by side (stacked on narrow screens or large text).
class BeforeAfterCard extends StatelessWidget {
  const BeforeAfterCard({super.key, required this.before, required this.after});

  final Widget before;
  final Widget after;

  Widget _side(String label, Widget child, Color bg) => Container(
    padding: const EdgeInsets.all(AppDimens.s3),
    decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(AppDimens.radiusMd)),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AppText(label, style: AppTypography.label),
        const SizedBox(height: AppDimens.s1),
        child,
      ],
    ),
  );

  @override
  Widget build(BuildContext context) {
    final b = _side('p_ap_before'.tr, before, AppColors.surfaceMuted);
    final a = _side('p_ap_after'.tr, after, AppColors.brandSoft);
    return LayoutBuilder(
      builder: (context, c) {
        final stack = c.maxWidth < 340 || MediaQuery.textScalerOf(context).scale(1) > 1.3;
        if (stack) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [b, const SizedBox(height: AppDimens.s2), a],
          );
        }
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: b),
            const SizedBox(width: AppDimens.s2),
            Expanded(child: a),
          ],
        );
      },
    );
  }
}

Widget _val(String text) => AppText(text.isEmpty ? '—' : text, style: AppTypography.bodyStrong);

/// Facts about the request, one label/value per row.
class _Facts extends StatelessWidget {
  const _Facts(this.rows);

  final List<(String, String)> rows;

  @override
  Widget build(BuildContext context) {
    final shown = rows.where((r) => r.$2.isNotEmpty).toList();
    if (shown.isEmpty) return const SizedBox.shrink();
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [for (final r in shown) KeyValue(r.$1, r.$2)],
      ),
    );
  }
}

class _Impact extends StatelessWidget {
  const _Impact(this.message, {this.tone = AppTone.warning});

  final String message;
  final AppTone tone;

  @override
  Widget build(BuildContext context) {
    if (message.isEmpty) return const SizedBox.shrink();
    return AppBanner(tone: tone, title: 'p_ap_impact'.tr, message: message);
  }
}

class _PanelFrame extends StatelessWidget {
  const _PanelFrame({required this.approval, required this.children});

  final ApprovalItem approval;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final by = approval.requestedByName;
    final at = approval.createdAt == null ? '' : _dateTime(approval.createdAt);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: AppText('p_ap_type_${approval.type}'.tr, style: AppTypography.label)),
                  const StatusBadge(StatusKind.approval, 'pending'),
                ],
              ),
              const SizedBox(height: AppDimens.s2),
              AppText(approval.summary, style: AppTypography.bodyStrong),
              if (by.isNotEmpty || at.isNotEmpty) ...[
                const SizedBox(height: AppDimens.s2),
                AppText(
                  'p_ap_requested'.trParams({'args1': by.isEmpty ? '—' : by, 'args2': at}),
                  style: AppTypography.bodySmall,
                ),
              ],
            ],
          ),
        ),
        for (final w in children) ...[const SizedBox(height: AppDimens.s3), w],
      ],
    );
  }
}

/// The detail panel of one approval. EACH type has its own panel with its own
/// before/after and impact; unknown types get a read-only summary and no CTA
/// is offered for them by the screen.
Widget buildApprovalPanel(ApprovalItem a, {ApprovalLookup lookup = const ApprovalLookup()}) {
  switch (a.type) {
    case 'attendance_correction':
      return AttendanceCorrectionPanel(a);
    case 'punch_adjust':
      return PunchAdjustPanel(a);
    case 'staff_leave':
      return StaffLeavePanel(a);
    case 'shift_swap':
      return ShiftSwapPanel(a);
    case 'overtime':
      return OvertimePanel(a);
    case 'transfer':
      return TransferPanel(a, lookup);
    case 'enrollment_exception':
      return EnrollmentExceptionPanel(a);
    case 'refund':
      return RefundPanel(a);
    case 'receivable_adjust':
      return ReceivableAdjustPanel(a);
    case 'payment_cancel':
      return PaymentCancelPanel(a);
    case 'expense':
      return ExpensePanel(a);
    case 'billing_run':
      return BillingRunPanel(a);
    case 'payroll_run':
      return PayrollRunPanel(a);
    case 'timesheet_reopen':
      return TimesheetReopenPanel(a);
    case 'notification':
      return NotificationPanel(a);
    case 'stock_variance':
      return StockVariancePanel(a);
    case 'menu':
      return MenuPanel(a);
    default:
      return UnknownApprovalPanel(a);
  }
}

// ---------------------------------------------------------------- panels

Widget _attSide(Map<String, dynamic> m) {
  final status = (m['status'] ?? '').toString();
  final at = toDate(m['arrivedAt']);
  return Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      if (status.isEmpty) _val('') else StatusBadge(StatusKind.attendance, status),
      if (at != null) AppText(CampusClock(SessionController.to.timezone).time(at), style: AppTypography.bodySmall),
      if ((m['note'] ?? '').toString().isNotEmpty) AppText('${m['note']}', style: AppTypography.bodySmall),
    ],
  );
}

class AttendanceCorrectionPanel extends StatelessWidget {
  const AttendanceCorrectionPanel(this.a, {super.key});

  final ApprovalItem a;

  @override
  Widget build(BuildContext context) {
    final i = a.impact;
    return _PanelFrame(approval: a, children: [
      _Facts([('p_ap_day'.tr, _day(i['dayKey'])), ('p_ap_reason'.tr, '${i['reason'] ?? ''}')]),
      BeforeAfterCard(before: _attSide(asMap(i['before'])), after: _attSide(asMap(i['after']))),
      _Impact('p_ap_att_impact'.tr, tone: AppTone.info),
    ]);
  }
}

class PunchAdjustPanel extends StatelessWidget {
  const PunchAdjustPanel(this.a, {super.key});

  final ApprovalItem a;

  @override
  Widget build(BuildContext context) {
    final i = a.impact;
    final kind = (i['kind'] ?? '').toString() == 'out' ? 'p_ap_punch_out'.tr : 'p_ap_punch_in'.tr;
    return _PanelFrame(approval: a, children: [
      _Facts([('p_ap_day'.tr, _day(i['dayKey']))]),
      BeforeAfterCard(
        before: _val('p_ap_punch_original'.trParams({'args1': _n(i['originalPunches'])})),
        after: _val('p_ap_punch_added'.trParams({'args1': kind, 'args2': _dateTime(i['requestedAt'])})),
      ),
      _Impact('p_ap_punch_impact'.tr, tone: AppTone.info),
    ]);
  }
}

class StaffLeavePanel extends StatelessWidget {
  const StaffLeavePanel(this.a, {super.key});

  final ApprovalItem a;

  @override
  Widget build(BuildContext context) {
    final i = a.impact;
    final days = asInt(i['days']);
    final bal = i['balance'];
    final remaining = bal is Map ? asInt(bal['remaining']) : asInt(bal);
    final shortage = asInt(i['teacherShortage']) ?? 0;
    final shifts = asInt(i['affectedShifts']) ?? 0;
    return _PanelFrame(approval: a, children: [
      BeforeAfterCard(
        before: _val(remaining == null ? '' : 'p_ap_leave_remaining'.trParams({'args1': '$remaining'})),
        after: _val(remaining == null || days == null
            ? ''
            : 'p_ap_leave_remaining'.trParams({'args1': '${remaining - days}'})),
      ),
      _Facts([('p_ap_leave_days'.tr, days == null ? '' : '$days')]),
      _Impact(
        'p_ap_leave_impact'.trParams({'args1': '$shifts', 'args2': '$shortage'}),
        tone: shortage > 0 ? AppTone.error : AppTone.warning,
      ),
    ]);
  }
}

class ShiftSwapPanel extends StatelessWidget {
  const ShiftSwapPanel(this.a, {super.key});

  final ApprovalItem a;

  /// Names come from the summary "Đổi ca (ngày): A → B".
  (String, String) _names() {
    final s = a.summary;
    final colon = s.indexOf(': ');
    if (colon >= 0) {
      final parts = s.substring(colon + 2).split('→').map((e) => e.trim()).toList();
      if (parts.length == 2) return (parts[0], parts[1]);
    }
    return ('', '');
  }

  @override
  Widget build(BuildContext context) {
    final i = a.impact;
    final (from, to) = _names();
    return _PanelFrame(approval: a, children: [
      _Facts([('p_ap_day'.tr, _day(i['dayKey']))]),
      BeforeAfterCard(before: _val(from), after: _val(to)),
      _Impact('p_ap_swap_impact'.tr, tone: AppTone.info),
    ]);
  }
}

class OvertimePanel extends StatelessWidget {
  const OvertimePanel(this.a, {super.key});

  final ApprovalItem a;

  @override
  Widget build(BuildContext context) {
    final i = a.impact;
    return _PanelFrame(approval: a, children: [
      _Facts([('p_ap_day'.tr, _day(i['dayKey'])), ('p_ap_ot_minutes'.tr, _minutes(i['minutes']))]),
      BeforeAfterCard(
        before: _val('p_ap_ot_before'.tr),
        after: _val('p_ap_ot_after'.trParams({'args1': _minutes(i['minutes'])})),
      ),
      _Impact('p_ap_ot_impact'.tr, tone: AppTone.info),
    ]);
  }
}

class TransferPanel extends StatelessWidget {
  const TransferPanel(this.a, this.lookup, {super.key});

  final ApprovalItem a;
  final ApprovalLookup lookup;

  @override
  Widget build(BuildContext context) {
    final i = a.impact;
    final cross = i['crossCampus'] == true;
    return _PanelFrame(approval: a, children: [
      BeforeAfterCard(
        before: _val(lookup.cls(i['fromClassId'])),
        after: _val([lookup.cls(i['toClassId']), if (cross) 'p_ap_transfer_cross'.tr].where((e) => e.isNotEmpty).join(' · ')),
      ),
      _Facts([
        ('p_ap_effective'.tr, _day(i['effectiveDate'])),
        ('p_ap_debt_handling'.tr, 'p_ap_handling_${i['debtHandling']}'.tr),
        ('p_ap_deposit_handling'.tr, 'p_ap_handling_${i['depositHandling']}'.tr),
        ('p_ap_open_debt'.tr, '${_n(i['openReceivables'])} · ${_money(i['openDebtAmount'])}'),
        ('p_ap_deposit'.tr, _money(i['depositAmount'])),
      ]),
      _Impact('p_ap_transfer_impact'.tr),
    ]);
  }
}

class EnrollmentExceptionPanel extends StatelessWidget {
  const EnrollmentExceptionPanel(this.a, {super.key});

  final ApprovalItem a;

  @override
  Widget build(BuildContext context) {
    final i = a.impact;
    String occ(Object? n) => 'p_ap_occupancy'.trParams({'args1': _n(n), 'args2': _n(i['capacity'])});
    return _PanelFrame(approval: a, children: [
      BeforeAfterCard(before: _val(occ(i['enrolled'])), after: _val(occ(i['after']))),
      _Facts([('p_ap_reason'.tr, '${i['reason'] ?? ''}')]),
      _Impact('p_ap_enroll_impact'.tr),
    ]);
  }
}

class RefundPanel extends StatelessWidget {
  const RefundPanel(this.a, {super.key});

  final ApprovalItem a;

  @override
  Widget build(BuildContext context) {
    final i = a.impact;
    final credit = asInt(i['creditAvailable']);
    final amount = asInt(i['amount']);
    return _PanelFrame(approval: a, children: [
      BeforeAfterCard(
        before: _val(_money(credit)),
        after: _val(credit == null || amount == null ? '' : _money(credit - amount)),
      ),
      _Facts([('p_ap_refund_amount'.tr, _money(amount))]),
      _Impact('p_ap_refund_impact'.tr),
    ]);
  }
}

class ReceivableAdjustPanel extends StatelessWidget {
  const ReceivableAdjustPanel(this.a, {super.key});

  final ApprovalItem a;

  @override
  Widget build(BuildContext context) {
    final i = a.impact;
    final amount = asInt(i['amount']);
    return _PanelFrame(approval: a, children: [
      BeforeAfterCard(before: _val(_money(i['balanceBefore'])), after: _val(_money(i['balanceAfter']))),
      _Facts([
        (
          'p_ap_adjust_amount'.tr,
          amount == null ? '' : (amount > 0 ? '+${_money(amount)}' : '-${_money(amount.abs())}'),
        ),
      ]),
      _Impact('p_ap_adjust_impact'.tr),
    ]);
  }
}

class PaymentCancelPanel extends StatelessWidget {
  const PaymentCancelPanel(this.a, {super.key});

  final ApprovalItem a;

  @override
  Widget build(BuildContext context) {
    final i = a.impact;
    final allocations = i['allocations'];
    return _PanelFrame(approval: a, children: [
      _Facts([
        ('p_ap_payment_amount'.tr, _money(i['amount'])),
        ('p_ap_payment_allocs'.tr, allocations is List ? '${allocations.length}' : ''),
        ('p_ap_payment_credit'.tr, _money(i['credit'])),
        ('p_ap_reason'.tr, '${a.payload['reason'] ?? ''}'),
      ]),
      BeforeAfterCard(
        before: _val('p_ap_payment_before'.tr),
        after: _val('p_ap_payment_after'.tr),
      ),
      _Impact('${i['effect'] ?? 'p_ap_payment_impact'.tr}'),
    ]);
  }
}

class ExpensePanel extends StatelessWidget {
  const ExpensePanel(this.a, {super.key});

  final ApprovalItem a;

  @override
  Widget build(BuildContext context) {
    final i = a.impact;
    return _PanelFrame(approval: a, children: [
      _Facts([('p_ap_expense_amount'.tr, _money(i['amount'])), ('p_ap_expense_category'.tr, '${i['category'] ?? ''}')]),
      _Impact('p_ap_expense_impact'.tr),
    ]);
  }
}

class BillingRunPanel extends StatelessWidget {
  const BillingRunPanel(this.a, {super.key});

  final ApprovalItem a;

  @override
  Widget build(BuildContext context) {
    final i = a.impact;
    final counts = asMap(i['counts']);
    return _PanelFrame(approval: a, children: [
      _Facts([
        ('p_ap_period'.tr, '${i['periodKey'] ?? ''}'),
        ('p_ap_billing_total'.tr, _money(i['totalNew'])),
        for (final e in counts.entries) ('p_ap_billing_count_${e.key}'.tr == 'p_ap_billing_count_${e.key}' ? e.key : 'p_ap_billing_count_${e.key}'.tr, '${e.value}'),
      ]),
      _Impact('p_ap_billing_impact'.tr),
    ]);
  }
}

class PayrollRunPanel extends StatelessWidget {
  const PayrollRunPanel(this.a, {super.key});

  final ApprovalItem a;

  @override
  Widget build(BuildContext context) {
    final i = a.impact;
    final totals = asMap(i['totals']);
    return _PanelFrame(approval: a, children: [
      _Facts([
        ('p_ap_period'.tr, '${i['periodKey'] ?? ''}'),
        ('p_ap_payroll_headcount'.tr, _n(i['headcount'])),
        ('p_ap_payroll_gross'.tr, totals['gross'] == null ? '' : _money(totals['gross'])),
        ('p_ap_payroll_net'.tr, _money(totals['net'])),
      ]),
      _Impact('p_ap_payroll_impact'.tr),
    ]);
  }
}

class TimesheetReopenPanel extends StatelessWidget {
  const TimesheetReopenPanel(this.a, {super.key});

  final ApprovalItem a;

  @override
  Widget build(BuildContext context) {
    final i = a.impact;
    return _PanelFrame(approval: a, children: [
      _Facts([('p_ap_period'.tr, '${i['periodKey'] ?? ''}'), ('p_ap_reason'.tr, '${i['reason'] ?? ''}')]),
      BeforeAfterCard(before: _val('p_ap_ts_locked'.tr), after: _val('p_ap_ts_open'.tr)),
      _Impact('${i['effect'] ?? 'p_ap_ts_impact'.tr}'),
    ]);
  }
}

class NotificationPanel extends StatelessWidget {
  const NotificationPanel(this.a, {super.key});

  final ApprovalItem a;

  @override
  Widget build(BuildContext context) {
    final i = a.impact;
    final scope = asMap(i['scope']);
    return _PanelFrame(approval: a, children: [
      _Facts([
        ('p_ap_notif_recipients'.tr, _n(i['recipients'])),
        ('p_ap_notif_scope'.tr, '${scope['type'] ?? ''}'),
        ('p_ap_notif_category'.tr, '${i['category'] ?? ''}'),
        ('p_ap_notif_ack'.tr, (i['requireAck'] == true ? 'p_yes' : 'p_no').tr),
      ]),
      _Impact('p_ap_notif_impact'.tr),
    ]);
  }
}

class StockVariancePanel extends StatelessWidget {
  const StockVariancePanel(this.a, {super.key});

  final ApprovalItem a;

  @override
  Widget build(BuildContext context) {
    final i = a.impact;
    final lines = asMapList(i['lines']);
    return _PanelFrame(approval: a, children: [
      _Facts([
        ('p_ap_stock_count'.tr, _n(i['varianceCount'])),
        ('p_ap_stock_value'.tr, _money(i['totalVarianceValue'])),
      ]),
      if (lines.isNotEmpty)
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final l in lines)
                KeyValue(
                  '${l['name'] ?? l['code'] ?? ''}',
                  'p_ap_stock_line'.trParams({
                    'args1': _n(l['systemQty']),
                    'args2': _n(l['countedQty']),
                    'args3': _money(l['varianceValue']),
                  }),
                ),
            ],
          ),
        ),
      _Impact('p_ap_stock_impact'.tr),
    ]);
  }
}

class MenuPanel extends StatelessWidget {
  const MenuPanel(this.a, {super.key});

  final ApprovalItem a;

  @override
  Widget build(BuildContext context) {
    final i = a.impact;
    final allergy = asInt(i['allergyChildren']) ?? 0;
    return _PanelFrame(approval: a, children: [
      _Facts([
        ('p_ap_day'.tr, _day(i['dayKey'])),
        ('p_ap_menu_allergy'.tr, '$allergy'),
        ('p_ap_menu_subs'.tr, _n(i['substitutions'])),
      ]),
      _Impact('p_ap_menu_impact'.tr, tone: allergy > 0 ? AppTone.warning : AppTone.info),
    ]);
  }
}

class UnknownApprovalPanel extends StatelessWidget {
  const UnknownApprovalPanel(this.a, {super.key});

  final ApprovalItem a;

  @override
  Widget build(BuildContext context) => _PanelFrame(
    approval: a,
    children: [AppBanner(tone: AppTone.warning, message: 'p_ap_unknown'.tr)],
  );
}

/// Types the app can show a full panel for.
bool approvalTypeSupported(String type) => kApprovalTypes.contains(type);
