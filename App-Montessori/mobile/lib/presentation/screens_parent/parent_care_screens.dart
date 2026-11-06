import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/parent_care_controller.dart';
import '../../models/data_models/parent_models.dart';
import '../../models/ui_models/app_tone.dart';
import '../../models/ui_models/status_catalog.dart';
import '../../utils/date_formatter.dart';
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
import '../common_components/confirm_dialog.dart';
import '../common_components/screen_scaffold.dart';
import 'parent_form.dart';
import 'parent_widgets.dart';

const _reasonIds = ['sick', 'family', 'travel', 'other'];

String reasonLabel(LeaveRequest l) {
  if (l.reasonText != null) return l.reasonText!;
  final id = l.reasonId ?? '';
  return _reasonIds.contains(id) ? 'p03_reason_$id'.tr : id;
}

/// P03: leave requests, medication requests and a shortcut to care notes.
class ParentCareScreen extends StatefulWidget {
  const ParentCareScreen({super.key});

  @override
  State<ParentCareScreen> createState() => _ParentCareScreenState();
}

class _ParentCareScreenState extends State<ParentCareScreen> {
  int tab = 0;

  @override
  Widget build(BuildContext context) {
    final c = Get.put(ParentCareController());
    return Obx(
      () => ScreenScaffold(
        title: 'screen_p03'.tr,
        contextLabels: parentContextLabels(),
        header: const ParentScopeHeader(),
        footer: Row(
          children: [
            Expanded(
              child: AppButton(
                label: tab == 0 ? 'p03_new_leave'.tr : 'p03_new_medication'.tr,
                icon: tab == 0 ? AppIcons.calendar : AppIcons.medicine,
                onPressed: () => Get.toNamed<void>(
                  tab == 0 ? RouteParent.leaveForm : RouteParent.medicationForm,
                ),
              ),
            ),
          ],
        ),
        body: ParentStateView(
          controller: c,
          emptyTitle: 'p01_no_child_title'.tr,
          emptyMessage: 'p01_no_child_message'.tr,
          emptyIcon: AppIcons.child,
          builder: () => ParentList(
            onRefresh: c.load,
            children: [
              Wrap(
                spacing: AppDimens.s2,
                runSpacing: AppDimens.s2,
                children: [
                  ChoiceChip(
                    label: Text('p03_tab_leave'.tr),
                    selected: tab == 0,
                    onSelected: (_) => setState(() => tab = 0),
                  ),
                  ChoiceChip(
                    label: Text('p03_tab_medication'.tr),
                    selected: tab == 1,
                    onSelected: (_) => setState(() => tab = 1),
                  ),
                ],
              ),
              const SizedBox(height: AppDimens.s3),
              AppButton(
                label: 'p03_send_note'.tr,
                variant: AppButtonVariant.secondary,
                icon: AppIcons.email,
                onPressed: () => Get.toNamed<void>(RouteParent.noteForm),
              ),
              const SizedBox(height: AppDimens.s4),
              if (tab == 0) ..._leaves(c) else ..._meds(c),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _leaves(ParentCareController c) {
    final list = c.sortedLeaves;
    if (list.isEmpty) {
      return [AppCard(child: AppText('p03_no_leaves'.tr, style: AppTypography.bodySmall))];
    }
    return [
      for (final l in list) ...[_LeaveCard(l: l, c: c), const SizedBox(height: AppDimens.s3)],
    ];
  }

  List<Widget> _meds(ParentCareController c) {
    final list = c.sortedMedications;
    if (list.isEmpty) {
      return [AppCard(child: AppText('p03_no_meds'.tr, style: AppTypography.bodySmall))];
    }
    return [
      for (final m in list) ...[_MedCard(m: m), const SizedBox(height: AppDimens.s3)],
    ];
  }
}

class _LeaveCard extends StatelessWidget {
  const _LeaveCard({required this.l, required this.c});

  final LeaveRequest l;
  final ParentCareController c;

  Future<void> _cancel() async {
    await ConfirmDialog.show(
      title: 'p03_cancel_title'.tr,
      message: 'p03_cancel_message'.trParams({'args1': leaveRange(l.fromDay, l.toDay)}),
      confirmLabel: 'p03_cancel_confirm'.tr,
      cancelLabel: 'scope_unsaved_stay'.tr,
      destructive: true,
      details: ImpactList(lines: ['p03_cancel_impact_1'.tr, 'p03_cancel_impact_2'.tr]),
      onConfirm: () => c.cancelLeave(l.id),
    );
  }

  @override
  Widget build(BuildContext context) {
    final canCancel = l.isPending || (l.status == 'approved' && l.fromDay.compareTo(c.today) > 0);
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: AppText(leaveRange(l.fromDay, l.toDay), style: AppTypography.title),
              ),
              const SizedBox(width: AppDimens.s2),
              StatusBadge(
                StatusKind.approval,
                l.status,
                labelOverride: l.status == 'pending' ? 'p03_status_pending'.tr : null,
              ),
            ],
          ),
          AppText(sessionLabel(l.session), style: AppTypography.bodySmall),
          ParentInfoRow(icon: AppIcons.diary, label: 'p03_reason'.tr, value: reasonLabel(l)),
          if (l.note != null && l.note!.isNotEmpty)
            ParentInfoRow(icon: AppIcons.email, label: 'p03_note'.tr, value: l.note!),
          if (l.submittedAt != null)
            ParentInfoRow(
              icon: AppIcons.calendar,
              label: 'p03_submitted_at'.tr,
              value: campusDateTime(l.submittedAt!),
            ),
          if (l.status == 'rejected' && l.decisionNote != null)
            AppBanner(tone: AppTone.error, message: l.decisionNote!),
          if (l.status == 'approved' && l.mealCancelled == true)
            AppBanner(tone: AppTone.success, icon: AppIcons.meal, message: 'p03_meal_cancelled'.tr),
          if (canCancel) ...[
            const SizedBox(height: AppDimens.s2),
            AppButton(
              label: 'p03_cancel_action'.tr,
              variant: AppButtonVariant.destructiveOutline,
              size: AppButtonSize.sm,
              expand: false,
              onPressed: _cancel,
            ),
          ],
        ],
      ),
    );
  }
}

class _MedCard extends StatelessWidget {
  const _MedCard({required this.m});

  final MedicationRequest m;

  @override
  Widget build(BuildContext context) {
    final tone = switch (m.status) {
      'received' => AppTone.success,
      'rejected' => AppTone.error,
      'paused' => AppTone.warning,
      _ => AppTone.warning,
    };
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: AppText(m.medicineName, style: AppTypography.title)),
              const SizedBox(width: AppDimens.s2),
              AppBadge(label: 'p03_med_${m.status}'.tr, tone: tone),
            ],
          ),
          AppText('${m.dose} · ${m.times.join(', ')}', style: AppTypography.body),
          if (m.fromDay != null && m.toDay != null)
            AppText(leaveRange(m.fromDay!, m.toDay!), style: AppTypography.bodySmall),
          if (m.instructions != null) AppText(m.instructions!, style: AppTypography.bodySmall),
          if (m.status == 'rejected' && m.reason != null)
            AppBanner(tone: AppTone.error, message: m.reason!),
        ],
      ),
    );
  }
}

// ----------------------------------------------------------------------------
// Forms

class ParentLeaveFormScreen extends StatefulWidget {
  const ParentLeaveFormScreen({super.key});

  @override
  State<ParentLeaveFormScreen> createState() => _ParentLeaveFormScreenState();
}

class _ParentLeaveFormScreenState extends State<ParentLeaveFormScreen> with ParentFormState {
  late final ParentCareController c = Get.find<ParentCareController>();
  DateTime? from;
  DateTime? to;
  String sessionCode = 'all';
  String? reasonId;
  final reasonText = TextEditingController();
  final note = TextEditingController();

  @override
  bool get isDirty => from != null || to != null || reasonId != null || note.text.isNotEmpty;

  @override
  void dispose() {
    reasonText.dispose();
    note.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final ok = setLocalErrors(
      ParentCareController.validateLeave(
        from: from,
        to: to,
        reasonId: reasonId,
        todayKey: c.today,
      ),
    );
    if (!ok) return;
    await send(
      () => c.submitLeave(
        from: from!,
        to: to!,
        session: sessionCode,
        reasonId: reasonId!,
        reasonText: reasonId == 'other' ? reasonText.text.trim() : '',
        note: note.text.trim(),
        opId: opId,
      ),
      onDone: () => done('p03_leave_sent'),
    );
  }

  @override
  Widget build(BuildContext context) {
    final today = DateFormatter.parseDayKey(c.today) ?? DateTime.now();
    return ScreenScaffold(
      title: 'p03_new_leave'.tr,
      contextLabels: parentContextLabels(),
      footer: AppButton(
        label: 'p03_leave_submit'.tr,
        loadingLabel: 'state_sending'.tr,
        onPressed: _submit,
      ),
      children: [
        if (formError != null) ...[
          AppBanner(tone: AppTone.error, message: formError!),
          const SizedBox(height: AppDimens.s3),
        ],
        AppInput(
          label: 'p03_from'.tr,
          kind: AppInputKind.date,
          required: true,
          dateValue: from,
          firstDate: today,
          lastDate: DateTime(today.year + 1, today.month, today.day),
          error: fieldErrors['fromDay'],
          onDatePicked: (d) => setState(() {
            from = d;
            to ??= d;
            renewOp();
          }),
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 'p03_to'.tr,
          kind: AppInputKind.date,
          required: true,
          dateValue: to,
          firstDate: from ?? today,
          lastDate: DateTime(today.year + 1, today.month, today.day),
          error: fieldErrors['toDay'],
          onDatePicked: (d) => setState(() {
            to = d;
            renewOp();
          }),
        ),
        const SizedBox(height: AppDimens.s4),
        AppText('p03_session'.tr, style: AppTypography.label),
        Wrap(
          spacing: AppDimens.s2,
          children: [
            for (final s in const ['all', 'am', 'pm'])
              ChoiceChip(
                label: Text(sessionLabel(s)),
                selected: sessionCode == s,
                onSelected: (_) => setState(() => sessionCode = s),
              ),
          ],
        ),
        const SizedBox(height: AppDimens.s4),
        AppText('${'p03_reason'.tr} *', style: AppTypography.label),
        Wrap(
          spacing: AppDimens.s2,
          children: [
            for (final r in _reasonIds)
              ChoiceChip(
                label: Text('p03_reason_$r'.tr),
                selected: reasonId == r,
                onSelected: (_) => setState(() {
                  reasonId = r;
                  fieldErrors.remove('reasonId');
                }),
              ),
          ],
        ),
        if (fieldErrors['reasonId'] != null)
          AppText(
            fieldErrors['reasonId']!,
            style: AppTypography.bodySmall.copyWith(color: AppColors.error),
          ),
        if (reasonId == 'other') ...[
          const SizedBox(height: AppDimens.s3),
          AppInput(label: 'p03_reason_text'.tr, controller: reasonText, maxLength: 200),
        ],
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 'p03_note'.tr,
          controller: note,
          kind: AppInputKind.multiline,
          maxLength: 500,
          helper: 'p03_note_helper'.tr,
          error: fieldErrors['note'],
        ),
      ],
    );
  }
}

class ParentMedicationFormScreen extends StatefulWidget {
  const ParentMedicationFormScreen({super.key});

  @override
  State<ParentMedicationFormScreen> createState() => _ParentMedicationFormScreenState();
}

class _ParentMedicationFormScreenState extends State<ParentMedicationFormScreen>
    with ParentFormState {
  late final ParentCareController c = Get.find<ParentCareController>();
  final name = TextEditingController();
  final dose = TextEditingController();
  final instructions = TextEditingController();
  final reason = TextEditingController();
  final storage = TextEditingController();
  final List<TimeOfDay> times = [];
  DateTime? from;
  DateTime? to;

  @override
  bool get isDirty =>
      name.text.isNotEmpty || dose.text.isNotEmpty || instructions.text.isNotEmpty || times.isNotEmpty;

  @override
  void dispose() {
    for (final t in [name, dose, instructions, reason, storage]) {
      t.dispose();
    }
    super.dispose();
  }

  String _hhmm(TimeOfDay t) =>
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  Future<void> _submit() async {
    final today = DateFormatter.parseDayKey(c.today);
    final ok = setLocalErrors({
      if (name.text.trim().length < 2) 'medicineName': 'error_required',
      if (dose.text.trim().isEmpty) 'dose': 'error_required',
      if (times.isEmpty) 'times': 'p03_error_times',
      if (from == null) 'fromDay': 'error_required',
      if (to == null) 'toDay': 'error_required',
      if (from != null && to != null && to!.isBefore(from!)) 'toDay': 'error_date_range',
      if (from != null && today != null && from!.isBefore(today)) 'fromDay': 'p03_error_past',
      if (instructions.text.trim().length < 3) 'instructions': 'error_required',
    });
    if (!ok) return;
    await send(
      () => c.submitMedication(
        medicineName: name.text.trim(),
        dose: dose.text.trim(),
        times: [for (final t in times) _hhmm(t)],
        from: from!,
        to: to!,
        instructions: instructions.text.trim(),
        reason: reason.text.trim(),
        storage: storage.text.trim(),
        opId: opId,
      ),
      onDone: () => done('p03_med_sent'),
    );
  }

  @override
  Widget build(BuildContext context) {
    final today = DateFormatter.parseDayKey(c.today) ?? DateTime.now();
    final last = DateTime(today.year + 1, today.month, today.day);
    return ScreenScaffold(
      title: 'p03_new_medication'.tr,
      contextLabels: parentContextLabels(),
      footer: AppButton(
        label: 'p03_med_submit'.tr,
        loadingLabel: 'state_sending'.tr,
        onPressed: _submit,
      ),
      children: [
        AppBanner(tone: AppTone.info, message: 'p03_med_explain'.tr),
        const SizedBox(height: AppDimens.s3),
        if (formError != null) ...[
          AppBanner(tone: AppTone.error, message: formError!),
          const SizedBox(height: AppDimens.s3),
        ],
        AppInput(
          label: 'p03_med_name'.tr,
          controller: name,
          required: true,
          maxLength: 120,
          error: fieldErrors['medicineName'],
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 'p03_med_dose'.tr,
          controller: dose,
          required: true,
          maxLength: 60,
          hint: 'p03_med_dose_hint'.tr,
          error: fieldErrors['dose'],
        ),
        const SizedBox(height: AppDimens.s3),
        AppText('${'p03_med_times'.tr} *', style: AppTypography.label),
        Wrap(
          spacing: AppDimens.s2,
          runSpacing: AppDimens.s2,
          children: [
            for (final t in times)
              InputChip(
                label: Text(_hhmm(t)),
                onDeleted: () => setState(() => times.remove(t)),
                deleteButtonTooltipMessage: 'action_close'.tr,
              ),
          ],
        ),
        AppInput(
          label: 'p03_med_add_time'.tr,
          kind: AppInputKind.time,
          error: fieldErrors['times'],
          onTimePicked: (t) => setState(() {
            if (!times.any((x) => x.hour == t.hour && x.minute == t.minute)) times.add(t);
            times.sort((a, b) => (a.hour * 60 + a.minute).compareTo(b.hour * 60 + b.minute));
            fieldErrors.remove('times');
          }),
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 'p03_from'.tr,
          kind: AppInputKind.date,
          required: true,
          dateValue: from,
          firstDate: today,
          lastDate: last,
          error: fieldErrors['fromDay'],
          onDatePicked: (d) => setState(() {
            from = d;
            to ??= d;
          }),
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 'p03_to'.tr,
          kind: AppInputKind.date,
          required: true,
          dateValue: to,
          firstDate: from ?? today,
          lastDate: last,
          error: fieldErrors['toDay'],
          onDatePicked: (d) => setState(() => to = d),
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 'p03_med_instructions'.tr,
          controller: instructions,
          kind: AppInputKind.multiline,
          required: true,
          maxLength: 500,
          error: fieldErrors['instructions'],
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(label: 'p03_med_reason'.tr, controller: reason, maxLength: 300),
        const SizedBox(height: AppDimens.s3),
        AppInput(label: 'p03_med_storage'.tr, controller: storage, maxLength: 200),
      ],
    );
  }
}

/// "Dặn dò": a care note to the school, sent as a conversation about the child.
class ParentNoteFormScreen extends StatefulWidget {
  const ParentNoteFormScreen({super.key});

  @override
  State<ParentNoteFormScreen> createState() => _ParentNoteFormScreenState();
}

class _ParentNoteFormScreenState extends State<ParentNoteFormScreen> with ParentFormState {
  late final ParentCareController c = Get.isRegistered<ParentCareController>()
      ? Get.find<ParentCareController>()
      : Get.put(ParentCareController());
  final subject = TextEditingController();
  final text = TextEditingController();

  @override
  bool get isDirty => subject.text.isNotEmpty || text.text.isNotEmpty;

  @override
  void dispose() {
    subject.dispose();
    text.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final ok = setLocalErrors({
      if (subject.text.trim().length < 3) 'subject': 'error_required',
      if (text.text.trim().isEmpty) 'text': 'error_required',
    });
    if (!ok) return;
    await send(
      () => c.sendNote(subject: subject.text.trim(), text: text.text.trim(), opId: opId),
      onDone: () => done('p03_note_sent'),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ScreenScaffold(
      title: 'p03_send_note'.tr,
      contextLabels: parentContextLabels(),
      footer: AppButton(
        label: 'p03_note_submit'.tr,
        loadingLabel: 'state_sending'.tr,
        onPressed: _submit,
      ),
      children: [
        AppBanner(tone: AppTone.info, message: 'p03_note_explain'.tr),
        const SizedBox(height: AppDimens.s3),
        if (formError != null) ...[
          AppBanner(tone: AppTone.error, message: formError!),
          const SizedBox(height: AppDimens.s3),
        ],
        AppInput(
          label: 'p03_note_subject'.tr,
          controller: subject,
          required: true,
          maxLength: 200,
          error: fieldErrors['subject'],
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 'p03_note_text'.tr,
          controller: text,
          kind: AppInputKind.multiline,
          required: true,
          maxLength: 1000,
          error: fieldErrors['text'],
        ),
      ],
    );
  }
}
