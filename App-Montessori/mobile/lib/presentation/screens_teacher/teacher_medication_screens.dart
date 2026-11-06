import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/teacher_care_controller.dart';
import '../../controller/teacher_class_controller.dart';
import '../../controller/teacher_common.dart';
import '../../models/data_models/teacher_models.dart';
import '../../models/ui_models/app_tone.dart';
import '../../services/network/api_service.dart';
import '../../services/network/app_exception.dart';
import '../../services/permission_service.dart';
import '../../utils/date_formatter.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../../values/permissions.dart';
import '../../values/route_teacher.dart';
import '../common_components/app_badge.dart';
import '../common_components/app_banner.dart';
import '../common_components/app_button.dart';
import '../common_components/app_card.dart';
import '../common_components/app_icons.dart';
import '../common_components/app_input.dart';
import '../common_components/confirm_dialog.dart';
import '../common_components/scope_selector.dart';
import '../common_components/screen_scaffold.dart';
import 'teacher_widgets.dart';

AppTone _medTone(String s) => switch (s) {
  'received' => AppTone.success,
  'rejected' => AppTone.error,
  'paused' => AppTone.warning,
  _ => AppTone.warning,
};

/// T04 medication requests of the class.
class TeacherMedListScreen extends StatefulWidget {
  const TeacherMedListScreen({super.key});

  @override
  State<TeacherMedListScreen> createState() => _TeacherMedListScreenState();
}

class _TeacherMedListScreenState extends State<TeacherMedListScreen> {
  late final TeacherCareController c = teacherCtl(() => TeacherCareController());
  int _seg = 0;

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      final groups = [
        c.medsWhere({'pending'}),
        c.medsWhere({'received'}),
        c.medsWhere({'rejected', 'paused'}),
      ];
      final shown = groups[_seg];
      return ScreenScaffold(
        title: 't_med_title'.tr,
        contextLabels: teacherContext(),
        onRefresh: c.load,
        children: [
          SegmentBar(
            labels: [
              't_med_seg_pending'.trParams({'args1': '${groups[0].length}'}),
              't_med_seg_active'.trParams({'args1': '${groups[1].length}'}),
              't_med_seg_other'.tr,
            ],
            index: _seg,
            onChanged: (i) => setState(() => _seg = i),
          ),
          const SizedBox(height: AppDimens.s3),
          ...stateChildren(
            state: c.state.value,
            error: c.error.value,
            onRetry: c.load,
            staleSince: c.loadedAt.value,
            emptyTitle: 't_med_empty_title'.tr,
            emptyMessage: 't_med_empty_message'.tr,
            emptyIcon: AppIcons.medicine,
            content: () => [
              if (shown.isEmpty) AppBanner(message: 't_med_none_here'.tr, tone: AppTone.info),
              for (final m in shown) ...[
                AppCard(
                  onTap: () => Get.toNamed<void>(RouteTeacher.medDetail, arguments: m),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(child: AppText(c.nameOf(m.childId), style: AppTypography.bodyStrong)),
                          AppBadge(label: 't_med_status_${m.status}'.tr, tone: _medTone(m.status)),
                        ],
                      ),
                      AppText('${m.medicineName} - ${m.dose}', style: AppTypography.body),
                      AppText(
                        't_med_times'.trParams({'args1': m.times.join(', ')}),
                        style: AppTypography.bodySmall,
                      ),
                      if (m.incomplete) ...[
                        const SizedBox(height: AppDimens.s2),
                        AppBadge(label: 't_med_incomplete'.tr, tone: AppTone.error),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: AppDimens.s3),
              ],
            ],
          ),
        ],
      );
    });
  }
}

/// One medication request: receive / reject / pause, and record every dose.
class TeacherMedDetailScreen extends StatefulWidget {
  const TeacherMedDetailScreen({super.key, required this.request});
  final MedRequest request;

  @override
  State<TeacherMedDetailScreen> createState() => _TeacherMedDetailScreenState();
}

class _TeacherMedDetailScreenState extends State<TeacherMedDetailScreen> {
  late final TeacherCareController c = teacherCtl(() => TeacherCareController());
  final _dose = TextEditingController();
  final _note = TextEditingController();
  TimeOfDay _time = campusNowOfDay();
  String? _result;
  FormErrors _err = FormErrors();
  String? _adminOp;
  String? _decideOp;
  List<MedAdmin> _history = const [];
  bool _historyLoading = true;
  AppException? _historyError;

  MedRequest get req => c.meds.firstWhereOrNull((m) => m.id == widget.request.id) ?? widget.request;

  @override
  void initState() {
    super.initState();
    _loadHistory();
  }

  @override
  void dispose() {
    _dose.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _loadHistory() async {
    setState(() {
      _historyLoading = true;
      _historyError = null;
    });
    try {
      final h = await c.history(widget.request.id);
      if (mounted) setState(() => _history = h);
    } catch (e) {
      if (mounted) setState(() => _historyError = toAppException(e));
    } finally {
      if (mounted) setState(() => _historyLoading = false);
    }
  }

  Future<void> _decide(String decision) async {
    String? reason;
    if (decision == 'rejected' || decision == 'paused') {
      reason = await askText(
        title: decision == 'rejected' ? 't_med_reject_title'.tr : 't_med_pause_title'.tr,
        label: 't_reason'.tr,
        confirmLabel: decision == 'rejected' ? 't_med_reject'.tr : 't_med_pause'.tr,
      );
      if (reason == null) return;
    } else {
      final ok = await ConfirmDialog.show(
        title: 't_med_receive_title'.tr,
        message: 't_med_receive_message'.trParams({
          'args1': req.medicineName,
          'args2': c.nameOf(req.childId),
        }),
        confirmLabel: 't_med_receive'.tr,
      );
      if (!ok) return;
    }
    _decideOp ??= ApiService.newOpId();
    try {
      await c.decide(req, decision, reason: reason, opId: _decideOp);
      _decideOp = null;
      if (mounted) {
        setState(() => _err = FormErrors());
        teacherToast('t_med_decided'.tr);
      }
    } catch (e) {
      final ex = toAppException(e);
      if (!ex.isNetwork) _decideOp = null;
      if (mounted) setState(() => _err = FormErrors.from(ex));
    }
  }

  Future<void> _administer() async {
    final errors = <String, String>{};
    if (_dose.text.trim().isEmpty) errors['dose'] = 't_med_dose_required'.tr;
    if (_result == null) errors['result'] = 'field_required'.tr;
    if (errors.isNotEmpty) {
      setState(() => _err = FormErrors(errors));
      return;
    }
    _adminOp ??= ApiService.newOpId();
    try {
      await c.administer(
        request: req,
        at: campusTimeToInstant(_time),
        dose: _dose.text.trim(),
        result: _result!,
        note: _note.text.trim().isEmpty ? null : _note.text.trim(),
        opId: _adminOp!,
      );
      _adminOp = null;
      _dose.clear();
      _note.clear();
      if (!mounted) return;
      setState(() {
        _result = null;
        _err = FormErrors();
        _time = campusNowOfDay();
      });
      teacherToast('t_med_given_saved'.tr);
      await _loadHistory();
    } catch (e) {
      final ex = toAppException(e);
      if (!ex.isNetwork) _adminOp = null;
      if (mounted) setState(() => _err = FormErrors.from(ex));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      final r = req;
      final clock = teacherClock();
      final canWrite = PermissionService.can(Perm.medicationWrite);
      return ScreenScaffold(
        title: r.medicineName,
        contextLabels: teacherContext(),
        children: [
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(child: AppText(c.nameOf(r.childId), style: AppTypography.heading3)),
                    AppBadge(label: 't_med_status_${r.status}'.tr, tone: _medTone(r.status)),
                  ],
                ),
                InfoLine(label: 't_med_name'.tr, value: r.medicineName.isEmpty ? '-' : r.medicineName, icon: AppIcons.medicine),
                InfoLine(label: 't_med_requested_dose'.tr, value: r.dose.isEmpty ? '-' : r.dose),
                InfoLine(label: 't_med_times_label'.tr, value: r.times.isEmpty ? '-' : r.times.join(', ')),
                InfoLine(
                  label: 't_med_period'.tr,
                  value: '${_d(r.fromDay)} - ${_d(r.toDay)}',
                  icon: AppIcons.calendar,
                ),
                InfoLine(label: 't_med_instructions'.tr, value: r.instructions.isEmpty ? '-' : r.instructions),
                if (r.storage != null) InfoLine(label: 't_med_storage'.tr, value: r.storage!),
                if (r.reason != null) InfoLine(label: 't_med_reason'.tr, value: r.reason!),
                if (r.requestedByName != null) InfoLine(label: 't_med_from'.tr, value: r.requestedByName!),
              ],
            ),
          ),
          if (_err.general != null) ...[const SizedBox(height: AppDimens.s3), ErrorBanner(_err.general!)],
          if (r.incomplete) ...[
            const SizedBox(height: AppDimens.s3),
            AppBanner(tone: AppTone.error, title: 't_med_incomplete'.tr, message: 't_med_incomplete_hint'.tr),
          ],
          const SizedBox(height: AppDimens.s3),
          if (canWrite && r.status == 'pending')
            Row(
              children: [
                Expanded(
                  child: AppButton(
                    label: 't_med_reject'.tr,
                    variant: AppButtonVariant.destructiveOutline,
                    onPressed: () => _decide('rejected'),
                  ),
                ),
                const SizedBox(width: AppDimens.s3),
                Expanded(
                  child: AppButton(
                    label: 't_med_receive'.tr,
                    onPressed: r.incomplete ? null : () => _decide('received'),
                  ),
                ),
              ],
            ),
          if (canWrite && r.status == 'received')
            AppButton(
              label: 't_med_pause'.tr,
              variant: AppButtonVariant.secondary,
              onPressed: () => _decide('paused'),
            ),
          if (canWrite && r.status == 'paused')
            AppButton(label: 't_med_resume'.tr, onPressed: () => _decide('received')),
          if (canWrite && r.status == 'received') ...[
            TeacherSection('t_med_record_title'.tr),
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  AppInput(
                    label: 't_med_given_at'.tr,
                    kind: AppInputKind.time,
                    timeValue: _time,
                    error: _err.of('at'),
                    onTimePicked: (t) => setState(() => _time = t),
                  ),
                  const SizedBox(height: AppDimens.s3),
                  // Never pre-filled from the request: the actual dose is typed.
                  AppInput(
                    label: 't_med_actual_dose'.tr,
                    hint: 't_med_dose_hint'.tr,
                    helper: 't_med_requested_dose_is'.trParams({'args1': r.dose}),
                    controller: _dose,
                    required: true,
                    error: _err.of('dose'),
                  ),
                  const SizedBox(height: AppDimens.s3),
                  AppText('t_med_result'.tr, style: AppTypography.bodyStrong),
                  const SizedBox(height: AppDimens.s2),
                  ChoiceChips(
                    options: const ['given', 'partial', 'refused', 'vomited', 'missed'],
                    value: _result,
                    labelOf: (o) => 't_med_result_$o'.tr,
                    onChanged: (o) => setState(() => _result = o),
                  ),
                  if (_err.of('result') != null)
                    AppText(_err.of('result')!, style: AppTypography.caption),
                  const SizedBox(height: AppDimens.s3),
                  AppInput(
                    label: 't_med_note'.tr,
                    controller: _note,
                    kind: AppInputKind.multiline,
                    error: _err.of('note'),
                  ),
                  const SizedBox(height: AppDimens.s4),
                  AppButton(
                    label: 't_med_save_given'.tr,
                    loadingLabel: 'state_sending'.tr,
                    onPressed: _administer,
                  ),
                ],
              ),
            ),
          ],
          TeacherSection('t_med_history'.tr),
          if (_historyLoading)
            const SizedBox(height: 80, child: Center(child: CircularProgressIndicator()))
          else if (_historyError != null)
            AppBanner(
              tone: AppTone.error,
              message: _historyError!.userMessage,
              actionLabel: 'action_retry'.tr,
              onAction: _loadHistory,
            )
          else if (_history.isEmpty)
            AppText('t_med_history_empty'.tr, style: AppTypography.bodySmall)
          else
            for (final a in _history) ...[
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    AppText(
                      '${a.at == null ? '' : clock.dateTime(a.at!)} - ${'t_med_result_${a.result}'.tr}',
                      style: AppTypography.bodyStrong,
                    ),
                    AppText('t_med_dose_given'.trParams({'args1': a.dose}), style: AppTypography.body),
                    if (a.administeredByName != null)
                      AppText(a.administeredByName!, style: AppTypography.bodySmall),
                    if (a.note != null) AppText(a.note!, style: AppTypography.bodySmall),
                  ],
                ),
              ),
              const SizedBox(height: AppDimens.s2),
            ],
        ],
      );
    });
  }

  String _d(String k) {
    final dt = DateFormatter.parseDayKey(k);
    return dt == null ? k : DateFormatter.date(dt);
  }
}

// ----------------------------------------------------------------- incidents

class TeacherIncidentListScreen extends StatelessWidget {
  const TeacherIncidentListScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = teacherCtl(() => TeacherCareController());
    return Obx(() {
      final clock = teacherClock();
      return ScreenScaffold(
        title: 't_incident_title'.tr,
        contextLabels: teacherContext(),
        onRefresh: c.load,
        footer: PermissionService.can(Perm.incidentWrite)
            ? AppButton(
                label: 't_incident_new'.tr,
                icon: Icons.add,
                size: AppButtonSize.lg,
                onPressed: () => Get.toNamed<void>(RouteTeacher.incidentForm),
              )
            : null,
        children: stateChildren(
          state: c.state.value,
          error: c.error.value,
          onRetry: c.load,
          staleSince: c.loadedAt.value,
          emptyTitle: 't_incident_empty_title'.tr,
          emptyMessage: 't_incident_empty_message'.tr,
          emptyIcon: AppIcons.health,
          content: () => [
            if (c.incidents.isEmpty) AppBanner(message: 't_incident_empty_message'.tr, tone: AppTone.info),
            for (final i in c.incidents) ...[
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(child: AppText(i.type, style: AppTypography.bodyStrong)),
                        AppBadge(
                          label: 't_severity_${i.severity}'.tr,
                          tone: switch (i.severity) {
                            'serious' => AppTone.error,
                            'moderate' => AppTone.warning,
                            _ => AppTone.info,
                          },
                        ),
                      ],
                    ),
                    if (i.childId != null) AppText(c.nameOf(i.childId), style: AppTypography.body),
                    if (i.occurredAt != null)
                      AppText(clock.dateTime(i.occurredAt!), style: AppTypography.bodySmall),
                    AppText(i.description, style: AppTypography.bodySmall),
                    const SizedBox(height: AppDimens.s1),
                    AppText(
                      i.status == 'closed' ? 't_incident_closed'.tr : 't_incident_open'.tr,
                      style: AppTypography.caption,
                    ),
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

class TeacherIncidentFormScreen extends StatefulWidget {
  const TeacherIncidentFormScreen({super.key});

  @override
  State<TeacherIncidentFormScreen> createState() => _TeacherIncidentFormScreenState();
}

class _TeacherIncidentFormScreenState extends State<TeacherIncidentFormScreen> {
  late final TeacherCareController c = teacherCtl(() => TeacherCareController());
  late final TeacherClassController cls = teacherCtl(() => TeacherClassController());
  final _type = TextEditingController();
  final _loc = TextEditingController();
  final _desc = TextEditingController();
  final _aid = TextEditingController();
  String? _childId;
  String _severity = 'minor';
  TimeOfDay _time = campusNowOfDay();
  FormErrors _err = FormErrors();
  String? _opId;

  @override
  void dispose() {
    _type.dispose();
    _loc.dispose();
    _desc.dispose();
    _aid.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final errors = <String, String>{};
    if (_type.text.trim().isEmpty) errors['type'] = 'field_required'.tr;
    if (_desc.text.trim().length < 5) errors['description'] = 't_incident_desc_short'.tr;
    if (errors.isNotEmpty) {
      setState(() => _err = FormErrors(errors));
      return;
    }
    _opId ??= ApiService.newOpId();
    try {
      await c.saveIncident({
        'childId': ?_childId,
        'occurredAt': campusTimeToInstant(_time).toUtc().toIso8601String(),
        'type': _type.text.trim(),
        'severity': _severity,
        'location': _loc.text.trim(),
        'description': _desc.text.trim(),
        'firstAid': _aid.text.trim(),
      }, _opId!);
      _opId = null;
      if (!mounted) return;
      teacherToast('t_incident_saved'.tr);
      Get.back<void>();
    } catch (e) {
      final ex = toAppException(e);
      if (!ex.isNetwork) _opId = null;
      if (mounted) setState(() => _err = FormErrors.from(ex));
    }
  }

  @override
  Widget build(BuildContext context) {
    return ScreenScaffold(
      title: 't_incident_new'.tr,
      contextLabels: teacherContext(),
      footer: AppButton(
        label: 't_incident_save'.tr,
        loadingLabel: 'state_sending'.tr,
        size: AppButtonSize.lg,
        onPressed: _save,
      ),
      children: [
        if (_err.general != null) ...[ErrorBanner(_err.general!), const SizedBox(height: AppDimens.s3)],
        ScopeSelector(
          label: 't_incident_child'.tr,
          sheetTitle: 't_incident_child'.tr,
          options: [
            ScopeOption(id: '', title: 't_incident_no_child'.tr),
            for (final k in cls.allKids) ScopeOption(id: k.id, title: k.fullName),
          ],
          selectedId: _childId ?? '',
          onSelected: (id) async => setState(() => _childId = id.isEmpty ? null : id),
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(label: 't_incident_type'.tr, controller: _type, required: true, error: _err.of('type')),
        const SizedBox(height: AppDimens.s3),
        AppText('t_incident_severity'.tr, style: AppTypography.bodyStrong),
        const SizedBox(height: AppDimens.s2),
        ChoiceChips(
          options: const ['minor', 'moderate', 'serious'],
          value: _severity,
          labelOf: (o) => 't_severity_$o'.tr,
          onChanged: (o) => setState(() => _severity = o),
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 't_incident_time'.tr,
          kind: AppInputKind.time,
          timeValue: _time,
          error: _err.of('occurredAt'),
          onTimePicked: (t) => setState(() => _time = t),
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(label: 't_incident_location'.tr, controller: _loc, error: _err.of('location')),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 't_incident_desc'.tr,
          controller: _desc,
          kind: AppInputKind.multiline,
          required: true,
          error: _err.of('description'),
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 't_incident_first_aid'.tr,
          controller: _aid,
          kind: AppInputKind.multiline,
          error: _err.of('firstAid'),
        ),
        const SizedBox(height: AppDimens.s3),
        AppBanner(message: 't_incident_restricted'.tr, tone: AppTone.info, icon: AppIcons.lock),
      ],
    );
  }
}
