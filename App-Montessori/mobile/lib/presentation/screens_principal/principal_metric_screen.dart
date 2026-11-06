import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/principal_loader.dart';
import '../../controller/principal_overview_controller.dart';
import '../../controller/scope_aware.dart';
import '../../controller/session_controller.dart';
import '../../models/data_models/principal_models.dart';
import '../../models/ui_models/status_catalog.dart';
import '../../repository/principal_repository.dart';
import '../../utils/date_formatter.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../common_components/app_badge.dart';
import '../common_components/app_card.dart';
import 'principal_overview_tab.dart';
import 'principal_widgets.dart';

/// Rows behind one overview figure (report rows + the definition text).
class PrincipalMetricController extends GetxController with ScopeAware, PrincipalLoader {
  PrincipalMetricController(this.spec, {PrincipalRepository? repo})
    : repo = repo ?? PrincipalRepository();

  final MetricSpec spec;
  final PrincipalRepository repo;
  final PLoad<ReportData> load = PLoad<ReportData>();
  final RxMap<String, String> names = <String, String>{}.obs;

  @override
  void onInit() {
    super.onInit();
    refreshData();
  }

  @override
  void onScopeChanged() {
    load.reset();
    refreshData();
  }

  Future<void> refreshData() async {
    final today = CampusClock(SessionController.to.timezone).dayKey();
    final from = spec.reportType == 'hr' ? '${today.substring(0, 7)}-01' : today;
    await runLoad<ReportData>(
      load,
      () => repo.report(spec.reportType, from: from, to: today),
      isEmpty: (d) => d.rows.where(spec.rowFilter).isEmpty,
    );
    if (spec.reportType == 'attendance' || spec.reportType == 'handover') {
      try {
        final kids = await repo.children();
        names.assignAll({for (final k in kids.items) k.id: k.str('fullName', k.id)});
      } catch (_) {}
    }
  }

  List<Map<String, dynamic>> get rows =>
      (load.data.value?.rows ?? const <Map<String, dynamic>>[]).where(spec.rowFilter).toList();
}

class PrincipalMetricScreen extends StatefulWidget {
  const PrincipalMetricScreen({super.key, this.metricKey, this.controller});

  final String? metricKey;
  final PrincipalMetricController? controller;

  @override
  State<PrincipalMetricScreen> createState() => _PrincipalMetricScreenState();
}

class _PrincipalMetricScreenState extends State<PrincipalMetricScreen> {
  late final PrincipalMetricController c;
  late final String tag;

  @override
  void initState() {
    super.initState();
    final key = (widget.metricKey ?? Get.arguments ?? 'enrolled').toString();
    tag = key;
    c = widget.controller ??
        (Get.isRegistered<PrincipalMetricController>(tag: tag)
            ? Get.find<PrincipalMetricController>(tag: tag)
            : Get.put(
                PrincipalMetricController(kMetricSpecs[key] ?? kMetricSpecs['enrolled']!),
                tag: tag,
              ));
  }

  @override
  void dispose() {
    if (widget.controller == null) Get.delete<PrincipalMetricController>(tag: tag);
    super.dispose();
  }

  String _title(Map<String, dynamic> r) {
    final id = (r['childId'] ?? '').toString();
    final name = (r['childName'] ?? r['name'] ?? r['className'] ?? r['campusName'] ?? '').toString();
    if (name.isNotEmpty) return name;
    return c.names[id] ?? 'p_row_unknown_child'.tr;
  }

  String _sub(Map<String, dynamic> r) {
    final clock = CampusClock(SessionController.to.timezone);
    switch (c.spec.reportType) {
      case 'enrollment':
        return [r['className'], r['childStatus']].where((e) => e != null && '$e'.isNotEmpty).join(' · ');
      case 'attendance':
        return 'p_row_attendance'.trParams({
          'args1': '${r['present'] ?? 0}',
          'args2': '${r['excused'] ?? 0}',
          'args3': '${r['unexcused'] ?? 0}',
        });
      case 'handover':
        if (r['state'] == 'missing_handover') return 'p_row_missing_handover'.tr;
        final rec = toDate(r['receivedAt']);
        final pk = toDate(r['pickedUpAt']);
        return [
          if (rec != null) 'p_row_received_at'.trParams({'args1': clock.time(rec)}),
          if (pk != null) 'p_row_picked_at'.trParams({'args1': clock.time(pk)}),
          if (r['late'] == true) 'p_row_late'.tr,
        ].join(' · ');
      case 'tuition':
        return [r['periodKey'], r['dueDate']].where((e) => e != null && '$e'.isNotEmpty).join(' · ');
      case 'hr':
        return 'p_row_hr'.trParams({'args1': '${r['incompleteDays'] ?? 0}', 'args2': '${r['periodKey'] ?? ''}'});
      default:
        return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    return PrincipalPage(
      title: c.spec.labelKey.tr,
      body: PrincipalStatus<ReportData>(
        load: c.load,
        onRetry: c.refreshData,
        emptyTitle: 'p_metric_empty'.tr,
        emptyMessage: 'p_metric_empty_msg'.tr,
        builder: (d) => Obx(() {
          final rows = c.rows;
          final names = c.names.length; // rebuild when names arrive
          final def = (d.definitions[c.spec.definitionKey] ?? '').toString();
          return RefreshIndicator(
            key: ValueKey(names),
            onRefresh: c.refreshData,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.symmetric(vertical: AppDimens.s4),
              children: [
                if (def.isNotEmpty)
                  AppCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        AppText('p_definition'.tr, style: AppTypography.label),
                        const SizedBox(height: AppDimens.s1),
                        AppText(def, style: AppTypography.bodySmall),
                      ],
                    ),
                  ),
                PSection('p_rows_title'.trParams({'args1': '${rows.length}'})),
                for (final r in rows)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppDimens.s2),
                    child: AppCard(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                AppText(_title(r), style: AppTypography.bodyStrong),
                                if (_sub(r).isNotEmpty) AppText(_sub(r), style: AppTypography.bodySmall),
                              ],
                            ),
                          ),
                          if (c.spec.reportType == 'tuition')
                            Padding(
                              padding: const EdgeInsets.only(left: AppDimens.s2),
                              child: AppText(fmtMoney(asInt(r['balance'])), style: AppTypography.bodyStrong),
                            ),
                          if (c.spec.reportType == 'handover' && r['state'] == 'picked_up')
                            const Padding(
                              padding: EdgeInsets.only(left: AppDimens.s2),
                              child: StatusBadge(StatusKind.handover, 'picked_up'),
                            ),
                          if (c.spec.reportType == 'handover' && r['state'] == 'received')
                            const Padding(
                              padding: EdgeInsets.only(left: AppDimens.s2),
                              child: StatusBadge(StatusKind.handover, 'received'),
                            ),
                        ],
                      ),
                    ),
                  ),
                if (d.truncated) AppText('p_truncated'.tr, style: AppTypography.caption),
              ],
            ),
          );
        }),
      ),
    );
  }
}
