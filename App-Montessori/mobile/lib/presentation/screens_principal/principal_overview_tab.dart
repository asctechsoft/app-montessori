import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/principal_overview_controller.dart';
import '../../controller/session_controller.dart';
import '../../models/data_models/principal_models.dart';
import '../../models/ui_models/app_tone.dart';
import '../../services/permission_service.dart';
import '../../utils/date_formatter.dart';
import '../../utils/money_formatter.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../../values/permissions.dart';
import '../../values/route_principal.dart';
import '../common_components/app_banner.dart';
import 'principal_widgets.dart';

String fmtInt(int? v) => v == null ? '—' : '$v';
String fmtPct(double? v) =>
    v == null ? '—' : '${v.toStringAsFixed(1).replaceAll('.', ',')}%';
String fmtMoney(int? v) => v == null ? '—' : MoneyFormatter.format(v);

/// H01: today's figures of the active campus, warnings with an owner, and
/// each figure opens the data behind it.
class PrincipalOverviewTab extends StatefulWidget {
  const PrincipalOverviewTab({super.key});

  @override
  State<PrincipalOverviewTab> createState() => _PrincipalOverviewTabState();
}

class _PrincipalOverviewTabState extends State<PrincipalOverviewTab> {
  late final PrincipalOverviewController c = Get.isRegistered<PrincipalOverviewController>()
      ? Get.find<PrincipalOverviewController>()
      : Get.put(PrincipalOverviewController());

  @override
  Widget build(BuildContext context) {
    return PrincipalPage(
      title: 'tab_overview'.tr,
      isTab: true,
      body: PrincipalStatus<OverviewBundle>(
        load: c.load,
        onRetry: c.refreshData,
        emptyTitle: 'p_overview_empty'.tr,
        builder: (b) => RefreshIndicator(
          onRefresh: c.refreshData,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.only(top: AppDimens.s4, bottom: AppDimens.s6),
            children: _content(b),
          ),
        ),
      ),
    );
  }

  void _open(String key) => Get.toNamed(RoutePrincipal.metric, arguments: key);

  List<Widget> _content(OverviewBundle b) {
    final s = b.snapshot;
    final day = DateFormatter.parseDayKey(s.dayKey) ?? DateTime.now();
    final canMoney = PermissionService.can(Perm.paymentsRead);
    final alerts = c.alerts;
    Widget tile(String key, String? value, {AppTone tone = AppTone.neutral, String? hint}) =>
        MetricTile(
          label: kMetricSpecs[key]!.labelKey.tr,
          value: value,
          tone: tone,
          hint: hint,
          onTap: () => _open(key),
        );
    final still = b.handover?.metric('stillAtSchool') ?? s.stillAtSchool;
    return [
      AppText(
        'p_overview_today'.trParams({'args1': DateFormatter.weekdayDate(day)}),
        style: AppTypography.bodySmall,
      ),
      if (alerts.isNotEmpty) ...[
        PSection('p_alerts'.tr, trailing: CountChip('${alerts.length}', tone: AppTone.warning)),
        for (final a in alerts)
          Padding(
            padding: const EdgeInsets.only(bottom: AppDimens.s3),
            child: AppBanner(
              tone: a.tone,
              title: a.title,
              message: a.message,
              actionLabel: a.ctaKey?.tr,
              onAction: a.route == null ? null : () => Get.toNamed(a.route!),
            ),
          ),
      ],
      if ((s.pendingApprovals ?? 0) > 0)
        Padding(
          padding: const EdgeInsets.only(bottom: AppDimens.s3),
          child: AppBanner(
            tone: AppTone.info,
            message: 'p_pending_approvals'.trParams({'args1': '${s.pendingApprovals}'}),
          ),
        ),
      PSection('p_section_attendance'.tr),
      MetricGrid(tiles: [
        tile('enrolled', fmtInt(s.enrolled)),
        tile('present', fmtInt(s.presentToday), tone: AppTone.success),
        tile('absent', fmtInt(s.absentToday)),
        tile('attendanceRatePct', fmtPct(b.attendance?.pct('attendanceRatePct'))),
      ]),
      PSection('p_section_handover'.tr),
      MetricGrid(tiles: [
        tile('received', fmtInt(b.handover?.metric('received'))),
        tile('pickedUp', fmtInt(b.handover?.metric('pickedUp'))),
        tile('stillAtSchool', fmtInt(still),
            tone: (still ?? 0) > 0 ? AppTone.warning : AppTone.neutral),
        tile(
          'missingConfirm',
          fmtInt(b.handover?.metric('missingConfirm')),
          tone: (b.handover?.metric('missingConfirm') ?? 0) > 0 ? AppTone.warning : AppTone.neutral,
        ),
      ]),
      if (PermissionService.can(Perm.timekeepingRead) || canMoney) ...[
        PSection('p_section_other'.tr),
        MetricGrid(tiles: [
          if (PermissionService.can(Perm.timekeepingRead))
            tile('incompleteDays', fmtInt(b.hr?.metric('incompleteDays')), hint: 'p_month_hint'.tr),
          if (canMoney) tile('outstanding', fmtMoney(s.outstanding)),
          if (canMoney)
            tile(
              'overdue',
              fmtMoney(s.overdueAmount),
              tone: (s.overdueAmount ?? 0) > 0 ? AppTone.error : AppTone.neutral,
              hint: s.overdueCount == null
                  ? null
                  : 'p_overdue_count'.trParams({'args1': '${s.overdueCount}'}),
            ),
        ]),
      ],
      const SizedBox(height: AppDimens.s2),
      AppText(SessionController.to.campusName, style: AppTypography.caption),
    ];
  }
}
