import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../configs/app_config.dart';
import '../../controller/auth_controller.dart';
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

/// Phone OTP sign-in for parents. Reachable only when `AppConfig.phoneOtpEnabled`
/// (`--dart-define=PHONE_OTP=true`) because it needs the Firebase phone provider
/// and SHA fingerprints. The OTP is one pastable field (see [AppOtpInput]).
class PhoneOtpScreen extends StatefulWidget {
  const PhoneOtpScreen({super.key});

  @override
  State<PhoneOtpScreen> createState() => _PhoneOtpScreenState();
}

class _PhoneOtpScreenState extends State<PhoneOtpScreen> {
  final TextEditingController _phone = TextEditingController();
  String? _phoneError;
  String? _otpError;
  String _otp = '';
  String? _verificationId;
  int? _resendToken;
  AppException? _error;

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    setState(() {
      _error = null;
      _phoneError = Validators.phone(_phone.text);
    });
    if (_phoneError != null) return;
    try {
      final id = await AuthService.to.requestPhoneCode(
        Validators.toE164(_phone.text)!,
        resendToken: _resendToken,
        onResendToken: (t) => _resendToken = t,
      );
      if (mounted) setState(() => _verificationId = id);
    } on AppException catch (e) {
      if (mounted) {
        setState(() {
          if (e.fieldErrors.containsKey('phone')) {
            _phoneError = e.fieldErrors['phone'];
          } else {
            _error = e;
          }
        });
      }
    }
  }

  Future<void> _confirm() async {
    setState(() {
      _error = null;
      _otpError = Validators.otp(_otp);
    });
    if (_otpError != null) return;
    try {
      final user = await AuthService.to.confirmPhoneCode(_verificationId!, _otp);
      await AuthController.to.afterSignIn(user);
      final route = await AuthController.to.routeAfterSession();
      await Get.offAllNamed<void>(route);
    } on AppException catch (e) {
      if (mounted) {
        setState(() {
          if (e.code == AppException.authInvalid) {
            _otpError = e.message;
          } else {
            _error = e;
          }
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final codeStep = _verificationId != null;
    return ScreenScaffold(
      title: 'phone_title'.tr,
      footer: AppButton(
        label: codeStep ? 'phone_confirm'.tr : 'phone_send_code'.tr,
        loadingLabel: 'state_sending'.tr,
        size: AppButtonSize.lg,
        onPressed: codeStep ? _confirm : _sendCode,
      ),
      children: [
        AppText(
          codeStep ? 'phone_code_message'.tr : 'phone_message'.tr,
          style: AppTypography.body,
        ),
        const SizedBox(height: AppDimens.s5),
        if (_error != null) ...[
          AppBanner(tone: AppTone.error, message: _error!.userMessage),
          const SizedBox(height: AppDimens.s4),
        ],
        if (!codeStep)
          AppInput(
            label: 'field_phone'.tr,
            controller: _phone,
            kind: AppInputKind.phone,
            required: true,
            prefixIcon: AppIcons.phone,
            error: _phoneError,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.telephoneNumber],
            onSubmitted: (_) => _sendCode(),
          )
        else ...[
          AppOtpInput(
            label: 'field_otp'.tr,
            length: AppConfig.otpLength,
            error: _otpError,
            autofocus: true,
            onChanged: (v) => _otp = v,
            onCompleted: (v) {
              _otp = v;
              _confirm();
            },
          ),
          const SizedBox(height: AppDimens.s3),
          AppButton(
            label: 'phone_resend'.tr,
            variant: AppButtonVariant.tertiary,
            size: AppButtonSize.sm,
            expand: false,
            onPressed: _sendCode,
          ),
        ],
      ],
    );
  }
}
