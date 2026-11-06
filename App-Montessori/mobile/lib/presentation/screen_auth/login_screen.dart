import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../configs/app_config.dart';
import '../../controller/login_controller.dart';
import '../../models/ui_models/app_tone.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../../values/route_name.dart';
import '../common_components/app_banner.dart';
import '../common_components/app_button.dart';
import '../common_components/app_icons.dart';
import '../common_components/app_input.dart';
import '../common_components/screen_scaffold.dart';
import 'language_switch.dart';

/// Email + password sign-in. States: idle, field errors, general error banner,
/// loading (button locked), network error. Forgot-password and (behind
/// `PHONE_OTP`) phone sign-in for parents.
class LoginScreen extends StatelessWidget {
  const LoginScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = Get.find<LoginController>();

    Future<void> submit() async {
      FocusScope.of(context).unfocus();
      final route = await c.submit();
      if (route != null) await Get.offAllNamed<void>(route);
    }

    return ScreenScaffold(
      showAppBar: false,
      showBack: false,
      children: [
        const SizedBox(height: AppDimens.s8),
        Center(
          child: Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              color: AppColors.brandSoft,
              borderRadius: BorderRadius.circular(AppDimens.radiusXl),
            ),
            child: const Icon(AppIcons.school, size: 36, color: AppColors.brand),
          ),
        ),
        const SizedBox(height: AppDimens.s5),
        Semantics(
          header: true,
          child: AppText(
            'login_title'.tr,
            style: AppTypography.heading1,
            textAlign: TextAlign.center,
          ),
        ),
        const SizedBox(height: AppDimens.s2),
        AppText(
          'login_subtitle'.tr,
          style: AppTypography.body.copyWith(color: AppColors.textSecondary),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: AppDimens.s6),
        Obx(() {
          final e = c.formError.value;
          if (e == null) return const SizedBox.shrink();
          return Padding(
            padding: const EdgeInsets.only(bottom: AppDimens.s4),
            child: AppBanner(
              tone: AppTone.error,
              title: e.isNetwork ? 'login_error_network_title'.tr : null,
              message: e.userMessage,
            ),
          );
        }),
        Obx(
          () => AppInput(
            label: 'field_email'.tr,
            controller: c.email,
            kind: AppInputKind.email,
            required: true,
            prefixIcon: AppIcons.email,
            error: c.emailError.value,
            textInputAction: TextInputAction.next,
            autofillHints: const [AutofillHints.username, AutofillHints.email],
            onChanged: (_) => c.onFieldChanged(),
          ),
        ),
        const SizedBox(height: AppDimens.s4),
        Obx(
          () => AppInput(
            label: 'field_password'.tr,
            controller: c.password,
            kind: AppInputKind.password,
            required: true,
            prefixIcon: AppIcons.lock,
            error: c.passwordError.value,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.password],
            onChanged: (_) => c.onFieldChanged(),
            onSubmitted: (_) => submit(),
          ),
        ),
        Align(
          alignment: AlignmentDirectional.centerEnd,
          child: AppButton(
            label: 'login_forgot'.tr,
            variant: AppButtonVariant.tertiary,
            size: AppButtonSize.sm,
            expand: false,
            onPressed: () => Get.toNamed<void>(RouteName.forgotPassword),
          ),
        ),
        const SizedBox(height: AppDimens.s4),
        AppButton(
          label: 'login_submit'.tr,
          loadingLabel: 'login_submitting'.tr,
          size: AppButtonSize.lg,
          onPressed: submit,
        ),
        if (AppConfig.phoneOtpEnabled) ...[
          const SizedBox(height: AppDimens.s3),
          AppButton(
            label: 'login_with_phone'.tr,
            icon: AppIcons.phone,
            variant: AppButtonVariant.secondary,
            size: AppButtonSize.lg,
            onPressed: () => Get.toNamed<void>(RouteName.phoneOtp),
          ),
        ],
        const SizedBox(height: AppDimens.s6),
        AppText(
          'login_no_account_hint'.tr,
          style: AppTypography.bodySmall,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: AppDimens.s4),
        const Center(child: LanguageSwitch()),
      ],
    );
  }
}
