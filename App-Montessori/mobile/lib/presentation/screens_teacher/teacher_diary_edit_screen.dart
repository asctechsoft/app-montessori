import 'dart:io';

import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:image_picker/image_picker.dart';

import '../../controller/session_controller.dart';
import '../../controller/teacher_class_controller.dart';
import '../../controller/teacher_common.dart';
import '../../controller/teacher_diary_controller.dart';
import '../../models/data_models/teacher_models.dart';
import '../../models/ui_models/app_tone.dart';
import '../../services/network/api_service.dart';
import '../../services/network/app_exception.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../common_components/app_banner.dart';
import '../common_components/app_button.dart';
import '../common_components/app_card.dart';
import '../common_components/app_icons.dart';
import '../common_components/app_input.dart';
import '../common_components/confirm_dialog.dart';
import '../common_components/screen_scaffold.dart';
import 'teacher_widgets.dart';

/// T03 editor: one child's diary, or (template) the class-wide template that is
/// applied after a review of the children list. Saves a DRAFT only.
class TeacherDiaryEditScreen extends StatefulWidget {
  const TeacherDiaryEditScreen({super.key, this.childId, this.template = false});
  final String? childId;
  final bool template;

  @override
  State<TeacherDiaryEditScreen> createState() => _TeacherDiaryEditScreenState();
}

class _TeacherDiaryEditScreenState extends State<TeacherDiaryEditScreen> {
  late final TeacherDiaryController d = teacherCtl(() => TeacherDiaryController());
  late final TeacherClassController cls = teacherCtl(() => TeacherClassController());
  late DailyLogDraft draft;
  late final TextEditingController _activities;
  late final TextEditingController _note;
  FormErrors _err = FormErrors();
  bool _dirty = false;
  void Function()? _unregister;
  String? _opId;
  final Set<String> _targets = {};
  final _picker = ImagePicker();

  TeacherChild? get child => widget.childId == null ? null : cls.childById(widget.childId!);

  @override
  void initState() {
    super.initState();
    draft = DailyLogDraft.from(child == null ? null : d.logs[child!.id]);
    _activities = TextEditingController(text: draft.activities);
    _note = TextEditingController(text: draft.note);
    _unregister = SessionController.to.registerDirtyGuard(() => _dirty);
    if (widget.template) {
      _targets.addAll(d.kids.where((k) => d.statusOf(k.id) != 'published').map((k) => k.id));
    }
  }

  @override
  void dispose() {
    _unregister?.call();
    _activities.dispose();
    _note.dispose();
    super.dispose();
  }

  void _touch(VoidCallback f) => setState(() {
    f();
    _dirty = true;
  });

  String _hhmm(TimeOfDay t) =>
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  TimeOfDay? _parse(String s) {
    final m = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(s);
    if (m == null) return null;
    return TimeOfDay(hour: int.parse(m.group(1)!), minute: int.parse(m.group(2)!));
  }

  Future<void> _addPhoto(TeacherChild k) async {
    try {
      final x = await _picker.pickImage(source: ImageSource.gallery, maxWidth: 1600, imageQuality: 80);
      if (x == null) return;
      final path = await d.uploadPhoto(k, File(x.path));
      _touch(() => draft.photoPaths.add(path));
    } catch (e) {
      if (mounted) setState(() => _err = FormErrors.from(e));
    }
  }

  Future<void> _save() async {
    draft
      ..activities = _activities.text
      ..note = _note.text;
    setState(() => _err = FormErrors());
    if (widget.template) return _applyTemplate();
    final k = child;
    if (k == null) return;
    if (draft.isEmpty) {
      setState(() => _err = FormErrors({}, 't_diary_empty_form'.tr));
      return;
    }
    _opId ??= ApiService.newOpId();
    try {
      await d.save(k, draft, opId: _opId);
      _opId = null;
      _dirty = false;
      await d.load();
      if (!mounted) return;
      teacherToast('t_diary_saved'.tr);
      Get.back<void>();
    } catch (e) {
      final ex = toAppException(e);
      if (!ex.isNetwork) _opId = null;
      if (!mounted) return;
      // Keep everything typed; show the server message / field errors.
      setState(() => _err = FormErrors.from(ex));
    }
  }

  Future<void> _applyTemplate() async {
    final targets = d.kids.where((k) => _targets.contains(k.id)).toList();
    if (targets.isEmpty) {
      setState(() => _err = FormErrors({}, 't_template_pick'.tr));
      return;
    }
    if (draft.isEmpty) {
      setState(() => _err = FormErrors({}, 't_diary_empty_form'.tr));
      return;
    }
    final ok = await ConfirmDialog.show(
      title: 't_template_confirm_title'.trParams({'args1': '${targets.length}'}),
      message: 't_template_confirm_message'.tr,
      confirmLabel: 't_template_apply'.tr,
      details: ImpactList(lines: [for (final k in targets) k.fullName]),
      onConfirm: () async {
        final failed = await d.saveTemplate(targets, draft);
        if (failed.isNotEmpty) {
          final names = failed.keys.map((id) => cls.childById(id)?.fullName ?? id).join(', ');
          throw AppException('PRECONDITION', 't_template_failed'.trParams({'args1': names}));
        }
      },
    );
    if (ok && mounted) {
      _dirty = false;
      teacherToast('t_template_done'.trParams({'args1': '${targets.length}'}));
      Get.back<void>();
    }
  }

  @override
  Widget build(BuildContext context) {
    final k = child;
    final published = k != null && (d.logs[k.id]?.isPublished ?? false);
    final dayDate = d.day.value;
    return ScreenScaffold(
      title: widget.template ? 't_diary_template'.tr : (k?.fullName ?? 'screen_t03'.tr),
      contextLabels: teacherContext(),
      footer: AppButton(
        label: widget.template ? 't_template_review'.tr : 't_diary_save_draft'.tr,
        loadingLabel: 'state_sending'.tr,
        size: AppButtonSize.lg,
        onPressed: _save,
      ),
      children: [
        AppText(dayDate, style: AppTypography.bodySmall),
        if (published) ...[
          const SizedBox(height: AppDimens.s2),
          AppBanner(message: 't_diary_edit_after_publish'.tr, tone: AppTone.warning),
        ],
        if (widget.template) ...[
          const SizedBox(height: AppDimens.s2),
          AppBanner(message: 't_template_hint'.tr, tone: AppTone.info),
        ],
        if (_err.general != null) ...[const SizedBox(height: AppDimens.s3), ErrorBanner(_err.general!)],
        TeacherSection('t_diary_meals'.tr),
        for (final m in DailyLogDraft.mealTypes) ...[
          AppText('t_meal_$m'.tr, style: AppTypography.bodyStrong),
          const SizedBox(height: AppDimens.s2),
          ChoiceChips(
            options: DailyLogDraft.mealLevels,
            value: draft.meals[m],
            labelOf: (o) => 't_meal_level_$o'.tr,
            onChanged: (o) => _touch(() => draft.meals[m] = o),
          ),
          const SizedBox(height: AppDimens.s3),
        ],
        TeacherSection('t_diary_sleep'.tr),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: AppInput(
                label: 't_sleep_from'.tr,
                kind: AppInputKind.time,
                timeValue: _parse(draft.sleepFrom),
                error: _err.of('sleep'),
                onTimePicked: (t) => _touch(() => draft.sleepFrom = _hhmm(t)),
              ),
            ),
            const SizedBox(width: AppDimens.s3),
            Expanded(
              child: AppInput(
                label: 't_sleep_to'.tr,
                kind: AppInputKind.time,
                timeValue: _parse(draft.sleepTo),
                onTimePicked: (t) => _touch(() => draft.sleepTo = _hhmm(t)),
              ),
            ),
          ],
        ),
        TeacherSection('t_diary_hygiene'.tr),
        ChoiceChips(
          options: DailyLogDraft.toiletOptions,
          value: draft.toilet,
          labelOf: (o) => 't_toilet_$o'.tr,
          onChanged: (o) => _touch(() => draft.toilet = o),
        ),
        TeacherSection('t_diary_mood'.tr),
        ChoiceChips(
          options: DailyLogDraft.moods,
          value: draft.mood,
          labelOf: (o) => 't_mood_$o'.tr,
          onChanged: (o) => _touch(() => draft.mood = o),
        ),
        TeacherSection('t_diary_activities'.tr),
        AppInput(
          label: 't_diary_activities_label'.tr,
          helper: 't_diary_activities_hint'.tr,
          controller: _activities,
          kind: AppInputKind.multiline,
          onChanged: (_) => _dirty = true,
          error: _err.of('activities'),
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 't_diary_note'.tr,
          controller: _note,
          kind: AppInputKind.multiline,
          maxLength: 1500,
          onChanged: (_) => _dirty = true,
          error: _err.of('note'),
        ),
        if (!widget.template && k != null) ...[
          TeacherSection('t_diary_photos_title'.tr),
          if (!k.photoConsent)
            AppBanner(message: 't_diary_no_consent'.tr, tone: AppTone.warning, icon: Icons.no_photography_outlined)
          else ...[
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AppText(
                    't_diary_photos'.trParams({'args1': '${draft.photoPaths.length}'}),
                    style: AppTypography.body,
                  ),
                  if (_err.of('photoPaths') != null)
                    AppText(_err.of('photoPaths')!, style: AppTypography.caption.copyWith(color: AppColors.error)),
                  const SizedBox(height: AppDimens.s2),
                  Wrap(
                    spacing: AppDimens.s2,
                    runSpacing: AppDimens.s2,
                    children: [
                      for (var i = 0; i < draft.photoPaths.length; i++)
                        InputChip(
                          label: Text('t_diary_photo_n'.trParams({'args1': '${i + 1}'})),
                          onDeleted: () => _touch(() => draft.photoPaths.removeAt(i)),
                          deleteIcon: const Icon(AppIcons.close, size: AppDimens.iconMd),
                          materialTapTargetSize: MaterialTapTargetSize.padded,
                        ),
                    ],
                  ),
                  const SizedBox(height: AppDimens.s2),
                  AppButton(
                    label: 't_diary_add_photo'.tr,
                    variant: AppButtonVariant.secondary,
                    icon: Icons.add_photo_alternate_outlined,
                    onPressed: () => _addPhoto(k),
                  ),
                ],
              ),
            ),
          ],
        ],
        if (widget.template) ...[
          TeacherSection('t_template_targets'.tr),
          for (final c in d.kids) ...[
            AppCard(
              selected: _targets.contains(c.id),
              onTap: () => setState(() {
                if (!_targets.add(c.id)) _targets.remove(c.id);
              }),
              child: Row(
                children: [
                  Icon(
                    _targets.contains(c.id) ? Icons.check_box : Icons.check_box_outline_blank,
                    color: _targets.contains(c.id) ? AppColors.brand : AppColors.textSecondary,
                  ),
                  const SizedBox(width: AppDimens.s3),
                  Expanded(child: AppText(c.fullName, style: AppTypography.bodyStrong)),
                  if (d.statusOf(c.id) != 'none')
                    AppText('t_diary_status_${d.statusOf(c.id)}'.tr, style: AppTypography.caption),
                ],
              ),
            ),
            const SizedBox(height: AppDimens.s2),
          ],
        ],
      ],
    );
  }
}
