import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../configs/app_config.dart';
import '../../controller/auth_controller.dart';
import '../../models/ui_models/app_tone.dart';
import '../../services/network/api_service.dart';
import '../../services/network/app_exception.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../common_components/app_button.dart';
import '../common_components/app_banner.dart';

/// First routed screen. Decides where to go: login (no user), or loads the
/// session (`invite.claimPending` + `org.listMine`) and goes to the role shell
/// or to the context picker. A slow/failed load shows a retry, never a blank.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  AppException? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _go());
  }

  Future<void> _go() async {
    setState(() => _error = null);
    try {
      final route = await AuthController.to
          .startRoute()
          .timeout(const Duration(seconds: 25));
      if (mounted) await Get.offAllNamed<void>(route);
    } catch (e) {
      if (mounted) setState(() => _error = ApiService.normalizeError(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(AppDimens.s6),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 96,
                  height: 96,
                  decoration: BoxDecoration(
                    color: AppColors.brandSoft,
                    borderRadius: BorderRadius.circular(28),
                  ),
                  child: const Icon(Icons.school_outlined, size: 48, color: AppColors.brand),
                ),
                const SizedBox(height: AppDimens.s5),
                AppText(AppConfig.appName, style: AppTypography.heading2),
                const SizedBox(height: AppDimens.s1),
                AppText('splash_tagline'.tr, style: AppTypography.bodySmall),
                const SizedBox(height: AppDimens.s8),
                if (_error == null)
                  const SizedBox(
                    width: 28,
                    height: 28,
                    child: CircularProgressIndicator(strokeWidth: 3),
                  )
                else ...[
                  AppBanner(message: _error!.userMessage, tone: AppTone.error),
                  const SizedBox(height: AppDimens.s4),
                  AppButton(label: 'action_retry'.tr, onPressed: _go),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
