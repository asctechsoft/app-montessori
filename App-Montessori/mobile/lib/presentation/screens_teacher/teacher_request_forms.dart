import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/teacher_common.dart';
import '../../controller/teacher_requests_controller.dart';
import '../../controller/teacher_time_controller.dart';
import '../../models/data_models/teacher_models.dart';
import '../../models/ui_models/app_tone.dart';
import '../../services/network/api_service.dart';
import '../../utils/date_formatter.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../common_components/app_banner.dart';
import '../common_components/app_button.dart';
import '../common_components/app_input.dart';
import '../common_components/bottom_sheet_base.dart';
import 'teacher_widgets.dart';

String _hhmm(TimeOfDay t) =>
    '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

Future<void> showAdjustForm(TeacherRequestsController r) => BottomSheetBase.show<void>(
  title: 't_req_adjust'.tr,
  builder: (_) => _AdjustForm(r: r),
);

Future<void> showLeaveForm(TeacherRequestsController r) => BottomSheetBase.show<void>(
  title: 't_req_leave'.tr,
  builder: (_) => _LeaveForm(r: r),
);

Future<void> showSwapForm(TeacherRequestsController r, TeacherTimeController t) =>
    BottomSheetBase.show<void>(title: 't_req_swap'.tr, builder: (_) => _SwapForm(r: r, t: t));

/// Shared submit wrapper: one opId per intent, field errors mapped, data kept.
mixin _SubmitState<T extends StatefulWidget> on State<T> {
  FormErrors err = FormErrors();
  String? opId;

  Future<void> submit(Future<void> Function(String opId) send, String doneKey) async {
    opId ??= ApiService.newOpId();
    try {
      await send(opId!);
      opId = null;
      if (!mounted) return;
      Navigator.of(context).pop();
      teacherToast(doneKey.tr);
    } catch (e) {
      final ex = toAppException(e);
      if (!ex.isNetwork) opId = null;
      if (mounted) setState(() => err = FormErrors.from(ex));
    }
  }
}

class _AdjustForm extends StatefulWidget {
  const _AdjustForm({required this.r});
  final TeacherRequestsController r;

  @override
  State<_AdjustForm> createState() => _AdjustFormState();
}

class _AdjustFormState extends State<_AdjustForm> with _SubmitState {
  DateTime _day = DateTime.now();
  String _kind = 'out';
  TimeOfDay? _time;
  bool _nextDay = false;
  final _reason = TextEditingController();

  @override
  void initState() {
    super.initState();
    _day = DateFormatter.parseDayKey(teacherClock().dayKey()) ?? DateTime.now();
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AppBanner(message: 't_req_adjust_hint'.tr, tone: AppTone.info),
        const SizedBox(height: AppDimens.s3),
        if (err.general != null) ...[ErrorBanner(err.general!), const SizedBox(height: AppDimens.s3)],
        AppInput(
          label: 't_req_day'.tr,
          kind: AppInputKind.date,
          dateValue: _day,
          firstDate: _day.subtract(const Duration(days: 62)),
          lastDate: DateFormatter.parseDayKey(teacherClock().dayKey()),
          error: err.of('dayKey'),
          onDatePicked: (d) => setState(() => _day = d),
        ),
        const SizedBox(height: AppDimens.s3),
        ChoiceChips(
          options: const ['in', 'out'],
          value: _kind,
          labelOf: (o) => o == 'in' ? 't_punch_in'.tr : 't_punch_out'.tr,
          onChanged: (o) => setState(() => _kind = o),
        ),
        if (err.of('kind') != null) AppText(err.of('kind')!, style: AppTypography.caption),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 't_req_time'.tr,
          kind: AppInputKind.time,
          timeValue: _time,
          required: true,
          error: err.of('requestedTime'),
          onTimePicked: (t) => setState(() => _time = t),
        ),
        const SizedBox(height: AppDimens.s2),
        Row(
          children: [
            Switch(value: _nextDay, onChanged: (v) => setState(() => _nextDay = v)),
            Expanded(child: AppText('t_req_next_day'.tr, style: AppTypography.body)),
          ],
        ),
        const SizedBox(height: AppDimens.s2),
        AppInput(
          label: 't_reason'.tr,
          controller: _reason,
          kind: AppInputKind.multiline,
          required: true,
          error: err.of('reason'),
        ),
        const SizedBox(height: AppDimens.s4),
        AppButton(
          label: 't_req_send'.tr,
          loadingLabel: 'state_sending'.tr,
          onPressed: () async {
            if (_time == null) {
              setState(() => err = FormErrors({'requestedTime': 'field_required'.tr}));
              return;
            }
            await submit(
              (id) => widget.r.requestAdjust(
                dayKey: DateFormatter.dayKey(_day),
                kind: _kind,
                time: _hhmm(_time!),
                nextDay: _nextDay,
                reason: _reason.text.trim(),
                opId: id,
              ),
              't_req_sent',
            );
          },
        ),
      ],
    );
  }
}

class _LeaveForm extends StatefulWidget {
  const _LeaveForm({required this.r});
  final TeacherRequestsController r;

  @override
  State<_LeaveForm> createState() => _LeaveFormState();
}

class _LeaveFormState extends State<_LeaveForm> with _SubmitState {
  String _type = 'annual';
  late DateTime _from;
  late DateTime _to;
  final _reason = TextEditingController();

  @override
  void initState() {
    super.initState();
    _from = DateFormatter.parseDayKey(teacherClock().dayKey()) ?? DateTime.now();
    _to = _from;
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (err.general != null) ...[ErrorBanner(err.general!), const SizedBox(height: AppDimens.s3)],
        AppText('t_req_leave_type'.tr, style: AppTypography.bodyStrong),
        const SizedBox(height: AppDimens.s2),
        ChoiceChips(
          options: const ['annual', 'sick', 'unpaid', 'maternity', 'wedding', 'bereavement', 'other'],
          value: _type,
          labelOf: (o) => 't_leave_type_$o'.tr,
          onChanged: (o) => setState(() => _type = o),
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 't_req_from'.tr,
          kind: AppInputKind.date,
          dateValue: _from,
          firstDate: _from.subtract(const Duration(days: 31)),
          lastDate: _from.add(const Duration(days: 365)),
          error: err.of('fromDay'),
          onDatePicked: (d) => setState(() {
            _from = d;
            if (_to.isBefore(d)) _to = d;
          }),
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 't_req_to'.tr,
          kind: AppInputKind.date,
          dateValue: _to,
          firstDate: _from,
          lastDate: _from.add(const Duration(days: 365)),
          error: err.of('toDay'),
          onDatePicked: (d) => setState(() => _to = d),
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 't_reason'.tr,
          controller: _reason,
          kind: AppInputKind.multiline,
          required: true,
          error: err.of('reason'),
        ),
        const SizedBox(height: AppDimens.s4),
        AppButton(
          label: 't_req_send'.tr,
          loadingLabel: 'state_sending'.tr,
          onPressed: () => submit(
            (id) => widget.r.requestLeave(
              type: _type,
              fromDay: DateFormatter.dayKey(_from),
              toDay: DateFormatter.dayKey(_to),
              reason: _reason.text.trim(),
              opId: id,
            ),
            't_req_sent',
          ),
        ),
      ],
    );
  }
}

class _SwapForm extends StatefulWidget {
  const _SwapForm({required this.r, required this.t});
  final TeacherRequestsController r;
  final TeacherTimeController t;

  @override
  State<_SwapForm> createState() => _SwapFormState();
}

class _SwapFormState extends State<_SwapForm> with _SubmitState {
  String? _entryId;
  final _to = TextEditingController();
  final _reason = TextEditingController();

  @override
  void dispose() {
    _to.dispose();
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final today = teacherClock().dayKey();
    final entries = widget.t.roster
        .where((e) => e.dayKey.compareTo(today) >= 0 && e.actualEmployeeId == null)
        .toList();
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (err.general != null) ...[ErrorBanner(err.general!), const SizedBox(height: AppDimens.s3)],
        AppText('t_req_swap_shift'.tr, style: AppTypography.bodyStrong),
        const SizedBox(height: AppDimens.s2),
        if (entries.isEmpty)
          AppBanner(message: 't_req_swap_no_shift'.tr, tone: AppTone.warning)
        else
          ChoiceChips(
            options: [for (final e in entries) e.id],
            value: _entryId,
            labelOf: (id) {
              final e = entries.firstWhere((x) => x.id == id);
              final d = DateFormatter.parseDayKey(e.dayKey);
              return '${d == null ? e.dayKey : DateFormatter.date(d)} ${e.start}-${e.end}';
            },
            onChanged: (o) => setState(() => _entryId = o),
          ),
        if (err.of('entryId') != null) AppText(err.of('entryId')!, style: AppTypography.caption),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 't_req_swap_to'.tr,
          helper: 't_req_swap_to_hint'.tr,
          controller: _to,
          required: true,
          error: err.of('toEmployeeId'),
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 't_reason'.tr,
          controller: _reason,
          kind: AppInputKind.multiline,
          error: err.of('reason'),
        ),
        const SizedBox(height: AppDimens.s4),
        AppButton(
          label: 't_req_send'.tr,
          loadingLabel: 'state_sending'.tr,
          onPressed: () async {
            final errors = <String, String>{};
            if (_entryId == null) errors['entryId'] = 'field_required'.tr;
            if (_to.text.trim().isEmpty) errors['toEmployeeId'] = 'field_required'.tr;
            if (errors.isNotEmpty) {
              setState(() => err = FormErrors(errors));
              return;
            }
            await submit(
              (id) => widget.r.requestSwap(
                entryId: _entryId!,
                toEmployeeId: _to.text.trim(),
                reason: _reason.text.trim().isEmpty ? null : _reason.text.trim(),
                opId: id,
              ),
              't_req_sent',
            );
          },
        ),
      ],
    );
  }
}

/// Keeps the [RosterEntry] import used by tooling.
typedef TeacherRosterEntry = RosterEntry;
