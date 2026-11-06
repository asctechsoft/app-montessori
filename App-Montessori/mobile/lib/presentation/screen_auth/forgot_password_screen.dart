import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../models/ui_models/app_tone.dart';
import '../../services/auth_service.dart';
import '../../services/network/app_exception.dart';
import '../../utils/validators.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../common_components/app_banner.dart';
import '../common_components/app_button.dart';
import '../common_components/app_icons.dart';
import '../common_components/app_input.dart';
import '../common_components/screen_scaffold.dart';

/// Password reset by email. The confirmation never reveals whether the address
/// has an account.
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final TextEditingController _email = TextEditingController();
  String? _emailError;
  AppException? _error;
  bool _sent = false;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    setState(() {
      _error = null;
      _emailError = Validators.email(_email.text);
    });
    if (_emailError != null) return;
    try {
      await AuthService.to.sendPasswordReset(_email.text);
      if (mounted) setState(() => _sent = true);
    } on AppException catch (e) {
      if (mounted) {
        setState(() {
          if (e.fieldErrors.containsKey('email')) {
            _emailError = e.fieldErrors['email'];
          } else {
            _error = e;
          }
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return ScreenScaffold(
      title: 'forgot_title'.tr,
      footer: _sent
          ? AppButton(label: 'forgot_back_to_login'.tr, onPressed: () => Get.back<void>())
          : AppButton(
              label: 'forgot_submit'.tr,
              loadingLabel: 'state_sending'.tr,
              size: AppButtonSize.lg,
              onPressed: _send,
            ),
      children: [
        AppText('forgot_message'.tr, style: AppTypography.body),
        const SizedBox(height: AppDimens.s5),
        if (_sent)
          AppBanner(
            tone: AppTone.success,
            title: 'forgot_sent_title'.tr,
            message: 'forgot_sent_message'.tr,
          )
        else ...[
          if (_error != null) ...[
            AppBanner(tone: AppTone.error, message: _error!.userMessage),
            const SizedBox(height: AppDimens.s4),
          ],
          AppInput(
            label: 'field_email'.tr,
            controller: _email,
            kind: AppInputKind.email,
            required: true,
            prefixIcon: AppIcons.email,
            error: _emailError,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.email],
            onSubmitted: (_) => _send(),
          ),
        ],
      ],
    );
  }
}
