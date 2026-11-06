import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/parent_health_controller.dart';
import '../../models/ui_models/app_tone.dart';
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
import '../common_components/list_row.dart';
import '../common_components/screen_scaffold.dart';
import 'parent_form.dart';
import 'parent_widgets.dart';

String _num(double? v, String unitKey) =>
    v == null ? '-' : '${v.toStringAsFixed(v % 1 == 0 ? 0 : 1)} ${unitKey.tr}';

/// P06: health measurements, allergy notes and the child's profile.
class ParentHealthScreen extends StatelessWidget {
  const ParentHealthScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = Get.put(ParentHealthController());
    return Obx(
      () => ScreenScaffold(
        title: 'screen_p06'.tr,
        contextLabels: parentContextLabels(),
        header: const ParentScopeHeader(),
        footer: AppButton(
          label: 'p06_request_update'.tr,
          icon: AppIcons.person,
          onPressed: () => Get.toNamed<void>(RouteParent.profileRequest),
        ),
        body: ParentStateView(
          controller: c,
          emptyTitle: 'p01_no_child_title'.tr,
          emptyMessage: 'p01_no_child_message'.tr,
          emptyIcon: AppIcons.child,
          builder: () => ParentList(onRefresh: c.load, children: _content(c)),
        ),
      ),
    );
  }

  List<Widget> _content(ParentHealthController c) {
    final h = c.health.value;
    final p = c.profile.value;
    final recs = c.sortedRecords;
    return [
      ParentSectionHeader(title: 'p06_allergy'.tr),
      if (h == null || h.isEmpty)
        AppCard(child: AppText('p06_no_health_info'.tr, style: AppTypography.bodySmall))
      else
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (h.allergies.isNotEmpty)
                Wrap(
                  spacing: AppDimens.s2,
                  runSpacing: AppDimens.s2,
                  children: [
                    for (final a in h.allergies)
                      AppBadge(label: a, tone: AppTone.error, icon: AppIcons.error),
                  ],
                ),
              if (h.conditions.isNotEmpty)
                ParentInfoRow(
                  icon: AppIcons.health,
                  label: 'p06_conditions'.tr,
                  value: h.conditions.join(', '),
                ),
              if (h.dietNote != null)
                ParentInfoRow(icon: AppIcons.meal, label: 'p06_diet'.tr, value: h.dietNote!),
              if (h.bloodType != null)
                ParentInfoRow(icon: AppIcons.health, label: 'p06_blood'.tr, value: h.bloodType!),
              if (h.doctor != null)
                ParentInfoRow(icon: AppIcons.person, label: 'p06_doctor'.tr, value: h.doctor!),
              if (h.hospital != null)
                ParentInfoRow(icon: AppIcons.school, label: 'p06_hospital'.tr, value: h.hospital!),
              if (h.emergencyContact != null)
                ParentInfoRow(
                  icon: AppIcons.phone,
                  label: 'p06_emergency'.tr,
                  value: h.emergencyContact!,
                ),
              if (h.notes != null)
                ParentInfoRow(icon: AppIcons.email, label: 'p03_note'.tr, value: h.notes!),
            ],
          ),
        ),
      const SizedBox(height: AppDimens.s4),
      ParentSectionHeader(title: 'p06_measurements'.tr),
      if (recs.isEmpty)
        AppCard(child: AppText('p06_no_measurements'.tr, style: AppTypography.bodySmall))
      else
        AppCard(
          padding: const EdgeInsets.symmetric(horizontal: AppDimens.s4),
          child: Column(
            children: [
              for (final r in recs)
                ListRow(
                  title: dayText(r.measuredOn),
                  subtitle:
                      '${_num(r.heightCm, 'p06_unit_cm')} · ${_num(r.weightKg, 'p06_unit_kg')}'
                      '${r.bmi == null ? '' : ' · ${'p06_bmi'.tr} ${r.bmi!.toStringAsFixed(1)}'}',
                  showChevron: false,
                  divider: true,
                ),
            ],
          ),
        ),
      const SizedBox(height: AppDimens.s4),
      ParentSectionHeader(title: 'p06_profile'.tr),
      if (p == null)
        AppCard(child: AppText('p06_no_profile'.tr, style: AppTypography.bodySmall))
      else
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ParentInfoRow(icon: AppIcons.child, label: 'p06_full_name'.tr, value: p.fullName),
              if (p.code != null)
                ParentInfoRow(icon: AppIcons.diary, label: 'p06_code'.tr, value: p.code!),
              if (p.dob != null)
                ParentInfoRow(icon: AppIcons.calendar, label: 'p06_dob'.tr, value: dayText(p.dob)),
              if (p.gender != null)
                ParentInfoRow(
                  icon: AppIcons.person,
                  label: 'p06_gender'.tr,
                  value: switch (p.gender) {
                    'male' => 'p06_male'.tr,
                    'female' => 'p06_female'.tr,
                    final g => g!,
                  },
                ),
              if (p.address != null)
                ParentInfoRow(icon: AppIcons.location, label: 'p06_address'.tr, value: p.address!),
              if (p.photoConsent != null)
                ParentInfoRow(
                  icon: AppIcons.visibility,
                  label: 'p06_photo_consent'.tr,
                  value: p.photoConsent! ? 'p06_yes'.tr : 'p06_no'.tr,
                ),
            ],
          ),
        ),
      const SizedBox(height: AppDimens.s3),
      AppText(
        'p06_verify_note'.tr,
        style: AppTypography.bodySmall.copyWith(color: AppColors.textSecondary),
      ),
    ];
  }
}

/// Profile change request: the school verifies it before applying; nothing is
/// edited directly.
class ParentProfileRequestScreen extends StatefulWidget {
  const ParentProfileRequestScreen({super.key});

  @override
  State<ParentProfileRequestScreen> createState() => _ParentProfileRequestScreenState();
}

class _ParentProfileRequestScreenState extends State<ParentProfileRequestScreen>
    with ParentFormState {
  late final ParentHealthController c = Get.find<ParentHealthController>();
  final text = TextEditingController();

  @override
  bool get isDirty => text.text.isNotEmpty;

  @override
  void dispose() {
    text.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!setLocalErrors({if (text.text.trim().length < 5) 'text': 'error_required'})) return;
    final name = c.profile.value?.fullName ?? '';
    await send(
      () => c.requestProfileUpdate(
        subject: 'p06_request_subject'.trParams({'args1': name}),
        text: text.text.trim(),
        opId: opId,
      ),
      onDone: () => done('p06_request_sent'),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ScreenScaffold(
      title: 'p06_request_update'.tr,
      contextLabels: parentContextLabels(),
      footer: AppButton(
        label: 'p06_request_submit'.tr,
        loadingLabel: 'state_sending'.tr,
        onPressed: _submit,
      ),
      children: [
        AppBanner(tone: AppTone.info, message: 'p06_request_explain'.tr),
        const SizedBox(height: AppDimens.s3),
        if (formError != null) ...[
          AppBanner(tone: AppTone.error, message: formError!),
          const SizedBox(height: AppDimens.s3),
        ],
        AppInput(
          label: 'p06_request_text'.tr,
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
