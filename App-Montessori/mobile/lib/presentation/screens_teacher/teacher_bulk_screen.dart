import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/teacher_class_controller.dart';
import '../../controller/teacher_common.dart';
import '../../models/data_models/teacher_models.dart';
import '../../models/ui_models/app_tone.dart';
import '../../services/network/api_service.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../common_components/app_avatar.dart';
import '../common_components/app_banner.dart';
import '../common_components/app_button.dart';
import '../common_components/app_card.dart';
import '../common_components/confirm_dialog.dart';
import '../common_components/screen_scaffold.dart';
import 'teacher_widgets.dart';

/// Bulk attendance: pick the children, pick the status, REVIEW the list, then
/// confirm. Nothing is selected by default so the teacher must look at each name.
class TeacherBulkScreen extends StatefulWidget {
  const TeacherBulkScreen({super.key});

  @override
  State<TeacherBulkScreen> createState() => _TeacherBulkScreenState();
}

class _TeacherBulkScreenState extends State<TeacherBulkScreen> {
  late final TeacherClassController c = teacherCtl(() => TeacherClassController());
  final Set<String> _picked = {};
  String _status = 'present';
  String? _opId;
  String? _opKey;

  List<TeacherChild> get _unmarked => c.kids
      .where((k) => const ['unmarked', 'unconfirmed'].contains(c.attendanceOf(k.id)))
      .toList();

  Future<void> _review() async {
    final chosen = _unmarked.where((k) => _picked.contains(k.id)).toList();
    if (chosen.isEmpty) return;
    // One opId per exact selection+status; a retry reuses it.
    final key = '${chosen.map((e) => e.id).join(',')}|$_status';
    if (_opKey != key) {
      _opKey = key;
      _opId = ApiService.newOpId();
    }
    final ok = await ConfirmDialog.show(
      title: 't_bulk_confirm_title'.trParams({'args1': '${chosen.length}'}),
      message: 't_bulk_confirm_message'.trParams({'args1': 'status_attendance_$_status'.tr}),
      confirmLabel: 't_confirm'.tr,
      details: ImpactList(lines: [for (final k in chosen) k.fullName]),
      onConfirm: () async {
        final out = await c.mark(children: chosen, status: _status, opId: _opId);
        teacherToast(
          out == SubmitOutcome.queued ? 't_saved_local'.tr : 't_bulk_done'.trParams({'args1': '${chosen.length}'}),
          tone: out == SubmitOutcome.queued ? AppTone.warning : AppTone.success,
        );
      },
    );
    if (ok && mounted) Get.back<void>();
  }

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      final list = _unmarked;
      return ScreenScaffold(
        title: 't_bulk_title'.tr,
        contextLabels: teacherContext(),
        footer: AppButton(
          label: 't_bulk_review'.trParams({'args1': '${_picked.length}'}),
          size: AppButtonSize.lg,
          onPressed: _picked.isEmpty ? null : _review,
        ),
        children: [
          AppBanner(message: 't_bulk_hint'.tr, tone: AppTone.info),
          const SizedBox(height: AppDimens.s3),
          AppText('t_bulk_status'.tr, style: AppTypography.bodyStrong),
          const SizedBox(height: AppDimens.s2),
          ChoiceChips(
            options: const ['present', 'absent_excused', 'absent_unexcused'],
            value: _status,
            labelOf: (o) => 'status_attendance_$o'.tr,
            onChanged: (o) => setState(() => _status = o),
          ),
          const SizedBox(height: AppDimens.s3),
          if (list.isEmpty)
            AppBanner(message: 't_bulk_none'.tr, tone: AppTone.success)
          else ...[
            AppButton(
              label: _picked.length == list.length ? 't_bulk_clear'.tr : 't_bulk_all'.tr,
              variant: AppButtonVariant.tertiary,
              expand: false,
              onPressed: () => setState(() {
                if (_picked.length == list.length) {
                  _picked.clear();
                } else {
                  _picked.addAll(list.map((e) => e.id));
                }
              }),
            ),
            for (final k in list) ...[
              AppCard(
                selected: _picked.contains(k.id),
                onTap: () => setState(() {
                  if (!_picked.add(k.id)) _picked.remove(k.id);
                }),
                semanticLabel: k.fullName,
                child: Row(
                  children: [
                    Icon(
                      _picked.contains(k.id) ? Icons.check_box : Icons.check_box_outline_blank,
                      color: _picked.contains(k.id) ? AppColors.brand : AppColors.textSecondary,
                    ),
                    const SizedBox(width: AppDimens.s3),
                    AppAvatar(name: k.fullName, size: AppDimens.avatarMd),
                    const SizedBox(width: AppDimens.s3),
                    Expanded(child: AppText(k.fullName, style: AppTypography.bodyStrong)),
                  ],
                ),
              ),
              const SizedBox(height: AppDimens.s2),
            ],
          ],
        ],
      );
    });
  }
}
