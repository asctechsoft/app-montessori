import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/principal_staff_controller.dart';
import '../../controller/session_controller.dart';
import '../../models/data_models/principal_models.dart';
import '../../models/ui_models/app_tone.dart';
import '../../utils/date_formatter.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../common_components/app_badge.dart';
import '../common_components/app_input.dart';
import '../common_components/list_row.dart';
import 'principal_widgets.dart';

PrincipalStaffController staffCtl() => Get.isRegistered<PrincipalStaffController>()
    ? Get.find<PrincipalStaffController>()
    : Get.put(PrincipalStaffController());

/// H06: staff list, today's shifts, who has not punched, punch errors, and
/// pending leave / shift swap requests (decided in the approvals tab).
class PrincipalStaffTab extends StatefulWidget {
  const PrincipalStaffTab({super.key, this.today = false});

  /// Pushed from an overview alert (shows a back button).
  final bool today;

  @override
  State<PrincipalStaffTab> createState() => _PrincipalStaffTabState();
}

class _PrincipalStaffTabState extends State<PrincipalStaffTab> {
  final c = staffCtl();

  String _time(DateTime? t) => t == null ? '' : CampusClock(SessionController.to.timezone).time(t);

  (String, AppTone) _badge(StaffRow r) => switch (r.status) {
    'not_punched' => ('p_staff_not_punched'.tr, AppTone.warning),
    'working' => ('p_staff_working'.tr, AppTone.info),
    'done' => ('p_staff_done'.tr, AppTone.success),
    'incomplete' => ('p_staff_incomplete'.tr, AppTone.error),
    'on_leave' => ('p_staff_on_leave'.tr, AppTone.neutral),
    _ => ('p_staff_no_shift'.tr, AppTone.neutral),
  };

  @override
  Widget build(BuildContext context) {
    return PrincipalPage(
      title: 'tab_staff'.tr,
      isTab: !widget.today,
      body: PrincipalStatus<StaffDay>(
        load: c.load,
        onRetry: c.refreshData,
        emptyTitle: 'p_staff_empty'.tr,
        emptyMessage: 'p_staff_empty_msg'.tr,
        builder: (d) => Obx(() {
          final rows = c.rows();
          final timekeeping = c.canTimekeeping;
          return RefreshIndicator(
            onRefresh: c.refreshData,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.symmetric(vertical: AppDimens.s4),
              children: [
                if (timekeeping) ...[
                  MetricGrid(tiles: [
                    MetricTile(
                      label: 'p_staff_not_punched'.tr,
                      value: '${d.missingIn.length}',
                      tone: d.missingIn.isEmpty ? AppTone.neutral : AppTone.warning,
                    ),
                    MetricTile(
                      label: 'p_staff_missing_out'.tr,
                      value: '${d.missingOut.length}',
                      tone: d.missingOut.isEmpty ? AppTone.neutral : AppTone.warning,
                    ),
                    MetricTile(
                      label: 'p_staff_conflicts'.tr,
                      value: '${d.overlapping.length}',
                      tone: d.overlapping.isEmpty ? AppTone.neutral : AppTone.error,
                    ),
                    MetricTile(label: 'p_staff_pending_requests'.tr, value: '${d.leaves.length + d.swaps.length}'),
                  ]),
                  if (d.leaves.isNotEmpty) ...[
                    PSection('p_staff_leaves'.tr),
                    for (final l in d.leaves)
                      ListRow(
                        title: l.str('employeeName', d.employeeName(l.str('employeeId'))),
                        subtitle: [
                          l.str('type'),
                          '${_d(l.str('fromDay'))} - ${_d(l.str('toDay'))}',
                          if (l.intOf('days') != null) 'p_staff_days'.trParams({'args1': '${l.intOf('days')}'}),
                        ].where((e) => e.isNotEmpty).join(' · '),
                        trailing: AppBadge(label: 'p_pending'.tr, tone: AppTone.warning),
                      ),
                  ],
                  if (d.swaps.isNotEmpty) ...[
                    PSection('p_staff_swaps'.tr),
                    for (final w in d.swaps)
                      ListRow(
                        title: '${w.str('fromName')} → ${w.str('toName')}',
                        subtitle: _d(w.str('dayKey')),
                        trailing: AppBadge(label: 'p_pending'.tr, tone: AppTone.warning),
                      ),
                  ],
                  if (d.leaves.isNotEmpty || d.swaps.isNotEmpty)
                    AppText('p_staff_decide_hint'.tr, style: AppTypography.caption),
                ],
                PSection('p_staff_list'.trParams({'args1': '${rows.length}'})),
                AppInput(
                  label: 'p_search_staff'.tr,
                  prefixIcon: Icons.search,
                  onChanged: (v) => c.query.value = v,
                ),
                const SizedBox(height: AppDimens.s2),
                if (rows.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(AppDimens.s4),
                    child: AppText('no_results_title'.tr, style: AppTypography.body),
                  ),
                for (final r in rows)
                  ListRow(
                    title: r.name,
                    subtitle: [
                      if (r.shiftName != null) '${r.shiftName} ${r.shiftTime ?? ''}'.trim(),
                      if (r.inAt != null) 'p_staff_in'.trParams({'args1': _time(r.inAt)}),
                      if (r.outAt != null) 'p_staff_out'.trParams({'args1': _time(r.outAt)}),
                    ].join(' · '),
                    trailing: timekeeping
                        ? AppBadge(label: _badge(r).$1, tone: _badge(r).$2)
                        : null,
                  ),
              ],
            ),
          );
        }),
      ),
    );
  }

  String _d(String v) {
    final x = DateFormatter.parseDayKey(v);
    return x == null ? v : DateFormatter.date(x);
  }
}
