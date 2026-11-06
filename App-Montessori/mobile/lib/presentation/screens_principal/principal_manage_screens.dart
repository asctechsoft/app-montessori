import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/principal_loader.dart';
import '../../controller/principal_manage_controller.dart';
import '../../controller/session_controller.dart';
import '../../models/data_models/principal_models.dart';
import '../../models/ui_models/app_tone.dart';
import '../../models/ui_models/status_catalog.dart';
import '../../services/permission_service.dart';
import '../../utils/date_formatter.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../../values/permissions.dart';
import '../../values/route_principal.dart';
import '../common_components/app_avatar.dart';
import '../common_components/app_badge.dart';
import '../common_components/app_card.dart';
import '../common_components/app_input.dart';
import '../common_components/list_row.dart';
import '../common_components/scope_selector.dart';
import 'principal_manage_tab.dart';
import 'principal_widgets.dart';

String _dateText(String? v) {
  final d = DateFormatter.parseDayKey(v) ?? DateTime.tryParse(v ?? '');
  return d == null ? '' : DateFormatter.date(d);
}

String _timeText(DateTime? t) =>
    t == null ? '' : CampusClock(SessionController.to.timezone).time(t);

/// Date field that changes the day shown by the screen.
class _DayBar extends StatelessWidget {
  const _DayBar({required this.c, required this.onChanged});

  final PrincipalManageController c;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    return Obx(
      () => AppInput(
        label: 'p_day'.tr,
        kind: AppInputKind.date,
        dateValue: DateFormatter.parseDayKey(c.dayKey.value),
        lastDate: DateTime.now().add(const Duration(days: 1)),
        firstDate: DateTime.now().subtract(const Duration(days: 365)),
        onDatePicked: (d) {
          c.setDay(DateFormatter.dayKey(d));
          onChanged();
        },
      ),
    );
  }
}

ScopeSelector _classSelector(PrincipalManageController c, {VoidCallback? onChanged}) {
  final items = c.classes.data.value?.items ?? const <PDoc>[];
  return ScopeSelector(
    label: 'p_class'.tr,
    sheetTitle: 'p_pick_class'.tr,
    leadingIcon: Icons.groups_outlined,
    options: [
      ScopeOption(id: '', title: 'p_all_classes'.tr),
      for (final k in items) ScopeOption(id: k.id, title: k.str('name', k.id)),
    ],
    selectedId: c.classFilter.value,
    onSelected: (id) async {
      c.classFilter.value = id;
      onChanged?.call();
    },
  );
}

// ------------------------------------------------------------------ classes

class PrincipalClassesScreen extends StatefulWidget {
  const PrincipalClassesScreen({super.key});

  @override
  State<PrincipalClassesScreen> createState() => _ClassesState();
}

class _ClassesState extends State<PrincipalClassesScreen> {
  final c = manageCtl();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    await c.loadClasses();
    if (PermissionService.can(Perm.childrenRead)) await c.loadChildren();
  }

  @override
  Widget build(BuildContext context) {
    return PrincipalPage(
      title: 'p_manage_classes'.tr,
      body: PrincipalStatus<PSnap>(
        load: c.classes,
        onRetry: _load,
        emptyTitle: 'p_classes_empty'.tr,
        builder: (snap) => Obx(() {
          c.children.data.value;
          final hasKids = c.children.data.value != null;
          return RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.symmetric(vertical: AppDimens.s4),
              children: [
                for (final k in snap.items.where((x) => !x.flag('archived')))
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppDimens.s3),
                    child: AppCard(
                      onTap: PermissionService.can(Perm.childrenRead)
                          ? () {
                              c.clearFilters();
                              c.classFilter.value = k.id;
                              Get.toNamed(RoutePrincipal.children);
                            }
                          : null,
                      child: _ClassRow(
                        name: k.str('name', k.id),
                        capacity: k.intOf('capacity'),
                        enrolled: hasKids ? c.headcount(k.id) : null,
                      ),
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

class _ClassRow extends StatelessWidget {
  const _ClassRow({required this.name, required this.capacity, required this.enrolled});

  final String name;
  final int? capacity;
  final int? enrolled;

  @override
  Widget build(BuildContext context) {
    final full = capacity != null && enrolled != null && enrolled! >= capacity!;
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AppText(name, style: AppTypography.bodyStrong),
              AppText(
                enrolled == null
                    ? 'p_headcount_unknown'.tr
                    : 'p_headcount'.trParams({'args1': '$enrolled', 'args2': capacity == null ? '—' : '$capacity'}),
                style: AppTypography.bodySmall,
              ),
            ],
          ),
        ),
        if (full) AppBadge(label: 'p_class_full'.tr, tone: AppTone.warning),
      ],
    );
  }
}

// ----------------------------------------------------------------- children

class PrincipalChildrenScreen extends StatefulWidget {
  const PrincipalChildrenScreen({super.key});

  @override
  State<PrincipalChildrenScreen> createState() => _ChildrenState();
}

class _ChildrenState extends State<PrincipalChildrenScreen> {
  final c = manageCtl();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    await c.loadChildren();
    if (PermissionService.can(Perm.classesRead)) await c.loadClasses();
  }

  @override
  Widget build(BuildContext context) {
    return PrincipalPage(
      title: 'p_manage_children'.tr,
      body: Column(
        children: [
          const SizedBox(height: AppDimens.s3),
          AppInput(
            label: 'p_search_child'.tr,
            prefixIcon: Icons.search,
            onChanged: (v) => c.query.value = v,
          ),
          const SizedBox(height: AppDimens.s3),
          Obx(() => _classSelector(c)),
          const SizedBox(height: AppDimens.s2),
          Expanded(
            child: PrincipalStatus<PSnap>(
              load: c.children,
              onRetry: _load,
              emptyTitle: 'p_children_empty'.tr,
              builder: (_) => Obx(() {
                final list = c.filteredChildren();
                if (list.isEmpty) {
                  return _NoResults(onClear: c.clearFilters);
                }
                return RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.builder(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.only(bottom: AppDimens.s6),
                    itemCount: list.length,
                    itemBuilder: (_, i) {
                      final k = list[i];
                      return Padding(
                        padding: const EdgeInsets.only(bottom: AppDimens.s2),
                        child: ChildRow(
                          name: k.str('fullName'),
                          className: [k.str('code'), c.className(k.str('classId'))]
                              .where((e) => e.isNotEmpty)
                              .join(' · '),
                          showChevron: true,
                          trailing: AppBadge(
                            label: 'p_child_status_${k.str('status')}'.tr == 'p_child_status_${k.str('status')}'
                                ? k.str('status')
                                : 'p_child_status_${k.str('status')}'.tr,
                            tone: k.str('status') == 'active' ? AppTone.success : AppTone.neutral,
                            showIcon: false,
                          ),
                          onTap: () => Get.toNamed(RoutePrincipal.childDetail, arguments: k.id),
                        ),
                      );
                    },
                  ),
                );
              }),
            ),
          ),
        ],
      ),
    );
  }
}

class _NoResults extends StatelessWidget {
  const _NoResults({required this.onClear});

  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          AppText('no_results_title'.tr, style: AppTypography.heading3),
          const SizedBox(height: AppDimens.s2),
          AppText('no_results_message'.tr, style: AppTypography.bodySmall),
          const SizedBox(height: AppDimens.s3),
          AppButtonText(label: 'action_clear_filters'.tr, onTap: onClear),
        ],
      ),
    );
  }
}

/// Minimal text button with a 48 hit area.
class AppButtonText extends StatelessWidget {
  const AppButtonText({super.key, required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => ConstrainedBox(
    constraints: const BoxConstraints(minHeight: AppDimens.touchMin, minWidth: AppDimens.touchMin),
    child: TextButton(onPressed: onTap, child: Text(label)),
  );
}

// ------------------------------------------------------------ child detail

class PrincipalChildDetailScreen extends StatelessWidget {
  const PrincipalChildDetailScreen({super.key, this.childId});

  final String? childId;

  @override
  Widget build(BuildContext context) {
    final c = manageCtl();
    final id = childId ?? Get.arguments?.toString() ?? '';
    return PrincipalPage(
      title: 'p_child_profile'.tr,
      body: Obx(() {
        final k = (c.children.data.value?.items ?? const <PDoc>[]).where((x) => x.id == id).firstOrNull;
        if (k == null) {
          return Center(child: AppText('p_child_not_found'.tr, style: AppTypography.body));
        }
        final missing = k.list('missingDocuments').map((e) => e.toString()).toList();
        final status = k.str('status');
        return ListView(
          padding: const EdgeInsets.symmetric(vertical: AppDimens.s4),
          children: [
            Row(
              children: [
                AppAvatar(name: k.str('fullName'), size: AppDimens.avatarLg),
                const SizedBox(width: AppDimens.s3),
                Expanded(child: AppText(k.str('fullName'), style: AppTypography.heading2)),
              ],
            ),
            const SizedBox(height: AppDimens.s3),
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  KeyValue('p_child_code'.tr, k.str('code')),
                  KeyValue('p_child_dob'.tr, _dateText(k.str('dob'))),
                  KeyValue('p_child_class'.tr, c.className(k.str('classId'))),
                  KeyValue('p_child_status'.tr, 'p_child_status_$status'.tr),
                  KeyValue('p_child_photo_consent'.tr, (k.flag('photoConsent') ? 'p_yes' : 'p_no').tr),
                ],
              ),
            ),
            if (missing.isNotEmpty) ...[
              PSection('p_child_missing_docs'.tr),
              AppCard(child: AppText(missing.join(', '), style: AppTypography.body)),
            ],
          ],
        );
      }),
    );
  }
}

// --------------------------------------------------------------- attendance

class PrincipalAttendanceScreen extends StatefulWidget {
  const PrincipalAttendanceScreen({super.key});

  @override
  State<PrincipalAttendanceScreen> createState() => _AttendanceState();
}

class _AttendanceState extends State<PrincipalAttendanceScreen> {
  final c = manageCtl();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final futures = <Future<void>>[c.loadAttendance()];
    if (PermissionService.can(Perm.childrenRead)) futures.add(c.loadChildren());
    if (PermissionService.can(Perm.classesRead)) futures.add(c.loadClasses());
    await Future.wait(futures);
  }

  @override
  Widget build(BuildContext context) {
    return PrincipalPage(
      title: 'p_manage_attendance'.tr,
      body: Column(
        children: [
          const SizedBox(height: AppDimens.s3),
          _DayBar(c: c, onChanged: _load),
          const SizedBox(height: AppDimens.s3),
          Obx(() => _classSelector(c)),
          const SizedBox(height: AppDimens.s2),
          Expanded(
            child: PrincipalStatus<PSnap>(
              load: c.attendance,
              onRetry: _load,
              emptyTitle: 'p_attendance_empty'.tr,
              emptyMessage: 'p_attendance_empty_msg'.tr,
              builder: (snap) => Obx(() {
                c.children.data.value;
                c.classes.data.value;
                c.closures.data.value;
                return RefreshIndicator(onRefresh: _load, child: _body(snap));
              }),
            ),
          ),
        ],
      ),
    );
  }

  Widget _body(PSnap snap) {
    final classFilter = c.classFilter.value;
    final byChild = {for (final a in snap.items) a.str('childId'): a};
    final closed = {for (final x in c.closures.data.value?.items ?? const <PDoc>[]) x.str('classId')};
    final kids = (c.children.data.value?.items ?? const <PDoc>[]).where((k) => k.str('status') == 'active').toList();
    // class id -> rows
    final groups = <String, List<_AttRow>>{};
    for (final a in snap.items) {
      final cls = a.str('classId');
      if (classFilter.isNotEmpty && cls != classFilter) continue;
      groups.putIfAbsent(cls, () => []).add(_AttRow(c.childName(a.str('childId')), a.str('status'), a.dt('arrivedAt')));
    }
    for (final k in kids) {
      final cls = k.str('classId');
      if (classFilter.isNotEmpty && cls != classFilter) continue;
      if (byChild.containsKey(k.id)) continue;
      groups.putIfAbsent(cls, () => []).add(_AttRow(k.str('fullName'), 'unconfirmed', null));
    }
    if (groups.isEmpty) {
      return ListView(children: [Padding(padding: const EdgeInsets.all(AppDimens.s4), child: AppText('p_attendance_empty'.tr))]);
    }
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(bottom: AppDimens.s6),
      children: [
        for (final e in groups.entries) ...[
          PSection(
            c.className(e.key).isEmpty ? 'p_class_unknown'.tr : c.className(e.key),
            trailing: AppBadge(
              label: (closed.contains(e.key) ? 'p_att_closed' : 'p_att_open').tr,
              tone: closed.contains(e.key) ? AppTone.success : AppTone.warning,
            ),
          ),
          AppText(
            'p_att_summary'.trParams({
              'args1': '${e.value.where((r) => r.status == 'present').length}',
              'args2': '${e.value.length}',
              'args3': '${e.value.where((r) => r.status == 'unconfirmed').length}',
            }),
            style: AppTypography.bodySmall,
          ),
          for (final r in e.value)
            ListRow(
              title: r.name,
              subtitle: r.arrived == null ? null : 'p_row_received_at'.trParams({'args1': _timeText(r.arrived)}),
              trailing: StatusBadge(StatusKind.attendance, r.status),
            ),
        ],
      ],
    );
  }
}

class _AttRow {
  const _AttRow(this.name, this.status, this.arrived);

  final String name;
  final String status;
  final DateTime? arrived;
}

// ---------------------------------------------------------------- handovers

class PrincipalHandoversScreen extends StatefulWidget {
  const PrincipalHandoversScreen({super.key});

  @override
  State<PrincipalHandoversScreen> createState() => _HandoversState();
}

class _HandoversState extends State<PrincipalHandoversScreen> {
  final c = manageCtl();
  final RxBool onlyStill = false.obs;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final futures = <Future<void>>[c.loadHandovers()];
    if (PermissionService.can(Perm.childrenRead)) futures.add(c.loadChildren());
    await Future.wait(futures);
  }

  @override
  Widget build(BuildContext context) {
    return PrincipalPage(
      title: 'p_manage_handover'.tr,
      body: Column(
        children: [
          const SizedBox(height: AppDimens.s3),
          _DayBar(c: c, onChanged: _load),
          const SizedBox(height: AppDimens.s2),
          Expanded(
            child: PrincipalStatus<PSnap>(
              load: c.handovers,
              onRetry: _load,
              emptyTitle: 'p_handover_empty'.tr,
              emptyMessage: 'p_handover_empty_msg'.tr,
              builder: (snap) => Obx(() {
                c.children.data.value;
                final all = snap.items.toList()
                  ..sort((a, b) {
                    final sa = a.str('state') == 'received' ? 0 : 1;
                    final sb = b.str('state') == 'received' ? 0 : 1;
                    if (sa != sb) return sa.compareTo(sb);
                    return (a.dt('receivedAt') ?? DateTime(0)).compareTo(b.dt('receivedAt') ?? DateTime(0));
                  });
                final still = all.where((h) => h.str('state') == 'received').length;
                final list = onlyStill.value ? all.where((h) => h.str('state') == 'received').toList() : all;
                return RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.only(bottom: AppDimens.s6),
                    children: [
                      MetricGrid(tiles: [
                        MetricTile(label: 'p_metric_received'.tr, value: '${all.length}'),
                        MetricTile(
                          label: 'p_metric_still'.tr,
                          value: '$still',
                          tone: still > 0 ? AppTone.warning : AppTone.neutral,
                          onTap: () => onlyStill.value = !onlyStill.value,
                          hint: (onlyStill.value ? 'p_filter_on' : 'p_filter_tap').tr,
                        ),
                      ]),
                      const SizedBox(height: AppDimens.s2),
                      for (final h in list)
                        ListRow(
                          title: c.childName(h.str('childId')),
                          subtitle: [
                            if (h.dt('receivedAt') != null)
                              'p_row_received_at'.trParams({'args1': _timeText(h.dt('receivedAt'))}),
                            if (h.dt('pickedAt') != null || h.dt('pickedUpAt') != null)
                              'p_row_picked_at'.trParams({'args1': _timeText(h.dt('pickedUpAt') ?? h.dt('pickedAt'))}),
                          ].join(' · '),
                          trailing: StatusBadge(
                            StatusKind.handover,
                            h.str('state') == 'picked_up' ? 'picked_up' : 'received',
                          ),
                        ),
                    ],
                  ),
                );
              }),
            ),
          ),
        ],
      ),
    );
  }
}

// -------------------------------------------------------------------- diary

class PrincipalDiaryScreen extends StatefulWidget {
  const PrincipalDiaryScreen({super.key});

  @override
  State<PrincipalDiaryScreen> createState() => _DiaryState();
}

class _DiaryState extends State<PrincipalDiaryScreen> {
  final c = manageCtl();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final futures = <Future<void>>[c.loadDiary()];
    if (PermissionService.can(Perm.childrenRead)) futures.add(c.loadChildren());
    if (PermissionService.can(Perm.classesRead)) futures.add(c.loadClasses());
    await Future.wait(futures);
  }

  @override
  Widget build(BuildContext context) {
    return PrincipalPage(
      title: 'p_manage_diary'.tr,
      body: Column(
        children: [
          const SizedBox(height: AppDimens.s3),
          _DayBar(c: c, onChanged: _load),
          const SizedBox(height: AppDimens.s2),
          Expanded(
            child: PrincipalStatus<PSnap>(
              load: c.diary,
              onRetry: _load,
              emptyTitle: 'p_diary_empty'.tr,
              emptyMessage: 'p_diary_empty_msg'.tr,
              builder: (snap) => Obx(() {
                c.children.data.value;
                c.classes.data.value;
                final byChild = {for (final d in snap.items) d.str('childId'): d};
                final kids = (c.children.data.value?.items ?? const <PDoc>[])
                    .where((k) => k.str('status') == 'active')
                    .toList();
                final groups = <String, List<_DiaryRow>>{};
                for (final d in snap.items) {
                  groups.putIfAbsent(d.str('classId'), () => []).add(
                    _DiaryRow(c.childName(d.str('childId')), d.str('status'), d.str('authorName')),
                  );
                }
                for (final k in kids) {
                  if (byChild.containsKey(k.id)) continue;
                  groups.putIfAbsent(k.str('classId'), () => []).add(_DiaryRow(k.str('fullName'), 'none', ''));
                }
                return RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.only(bottom: AppDimens.s6),
                    children: [
                      for (final e in groups.entries) ...[
                        PSection(
                          c.className(e.key).isEmpty ? 'p_class_unknown'.tr : c.className(e.key),
                          trailing: CountChip(
                            'p_diary_published'.trParams({
                              'args1': '${e.value.where((r) => r.status == 'published').length}',
                              'args2': '${e.value.length}',
                            }),
                          ),
                        ),
                        for (final r in e.value)
                          ListRow(
                            title: r.name,
                            subtitle: r.author.isEmpty ? null : 'p_diary_author'.trParams({'args1': r.author}),
                            trailing: AppBadge(
                              label: 'p_diary_status_${r.status}'.tr,
                              tone: switch (r.status) {
                                'published' => AppTone.success,
                                'draft' => AppTone.warning,
                                _ => AppTone.neutral,
                              },
                            ),
                          ),
                      ],
                    ],
                  ),
                );
              }),
            ),
          ),
        ],
      ),
    );
  }
}

class _DiaryRow {
  const _DiaryRow(this.name, this.status, this.author);

  final String name;
  final String status;
  final String author;
}

// ------------------------------------------------------------------- health

class PrincipalHealthScreen extends StatefulWidget {
  const PrincipalHealthScreen({super.key});

  @override
  State<PrincipalHealthScreen> createState() => _HealthState();
}

class _HealthState extends State<PrincipalHealthScreen> {
  final c = manageCtl();
  final bool canMed = PermissionService.can(Perm.medicationRead);
  final bool canInc = PermissionService.can(Perm.incidentRead);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    await Future.wait([
      if (canMed) c.loadMedication(),
      if (canInc) c.loadIncidents(),
      if (PermissionService.can(Perm.childrenRead)) c.loadChildren(),
    ]);
  }

  Widget _section(String title, PLoad<PSnap> load, Widget Function(PDoc d) row, String emptyKey) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PSection(title),
        SizedBox(
          height: 0,
          child: const SizedBox.shrink(),
        ),
        Obx(() {
          final data = load.data.value;
          switch (load.state.value) {
            case ViewState.loading:
              return AppText('state_loading'.tr, style: AppTypography.bodySmall);
            case ViewState.error:
            case ViewState.offlineEmpty:
            case ViewState.forbidden:
              return Row(
                children: [
                  Expanded(child: AppText(load.error.value?.userMessage ?? 'error_generic'.tr, style: AppTypography.bodySmall)),
                  AppButtonText(label: 'action_retry'.tr, onTap: _load),
                ],
              );
            default:
              if (data == null || data.items.isEmpty) {
                return AppText(emptyKey.tr, style: AppTypography.bodySmall);
              }
              return Column(children: [for (final d in data.items) row(d)]);
          }
        }),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return PrincipalPage(
      title: 'p_manage_health'.tr,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.only(bottom: AppDimens.s6),
          children: [
            if (canMed)
              _section('p_health_medication'.tr, c.medication, (d) {
                final from = _dateText(d.str('fromDay'));
                final to = _dateText(d.str('toDay'));
                return ListRow(
                  title: c.childName(d.str('childId')),
                  subtitle: [
                    d.str('medicineName'),
                    d.str('dose'),
                    d.list('times').join(', '),
                    if (from.isNotEmpty) '$from - $to',
                  ].where((e) => e.isNotEmpty).join(' · '),
                  trailing: AppBadge(label: 'p_med_pending'.tr, tone: AppTone.warning),
                );
              }, 'p_health_medication_empty'),
            if (canInc)
              _section('p_health_incidents'.tr, c.incidents, (d) {
                final at = d.dt('occurredAt') ?? d.dt('createdAt');
                return ListRow(
                  title: d.str('childId').isEmpty ? 'p_incident_no_child'.tr : c.childName(d.str('childId')),
                  subtitle: [
                    d.str('type'),
                    if (at != null) CampusClock(SessionController.to.timezone).dateTime(at),
                  ].where((e) => e.isNotEmpty).join(' · '),
                  trailing: AppBadge(
                    label: 'p_incident_open'.tr,
                    tone: d.str('severity') == 'high' || d.str('severity') == 'critical' ? AppTone.error : AppTone.warning,
                  ),
                );
              }, 'p_health_incidents_empty'),
          ],
        ),
      ),
    );
  }
}
