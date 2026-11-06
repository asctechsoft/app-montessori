import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../configs/app_config.dart';
import '../../configs/app_figs.dart';
import '../../configs/locale_config.dart';
import '../../controller/auth_controller.dart';
import '../../controller/session_controller.dart';
import '../../controller/settings_controller.dart';
import '../../services/sync/offline_queue.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../../values/route_name.dart';
import '../common_components/app_avatar.dart';
import '../common_components/app_button.dart';
import '../common_components/app_card.dart';
import '../common_components/app_icons.dart';
import '../common_components/confirm_dialog.dart';
import '../common_components/list_row.dart';
import '../common_components/screen_scaffold.dart';
import '../screen_shell/sync_status_bar.dart';

/// Account section: profile header, working context, switch role/campus,
/// language, unsynced operations, app info, sign out. Used by the "Cá nhân"
/// tab of parent/principal and embedded in the teacher's "Tiện ích" tab.
class ProfileContent extends StatelessWidget {
  const ProfileContent({super.key});

  Future<void> _switchContext() async {
    final s = SessionController.to;
    if (s.hasUnsavedChanges) {
      final ok = await ConfirmDialog.show(
        title: 'scope_unsaved_title'.tr,
        message: 'scope_unsaved_message'.tr,
        confirmLabel: 'scope_unsaved_confirm'.tr,
        cancelLabel: 'scope_unsaved_stay'.tr,
        destructive: true,
      );
      if (!ok) return;
    }
    await Get.toNamed<void>(RouteName.contextPicker);
  }

  Future<void> _signOut() async {
    final pending = OfflineQueue.to.unsyncedCount;
    final ok = await ConfirmDialog.show(
      title: 'signout_title'.tr,
      message: pending > 0
          ? 'signout_message_pending'.trParams({'args1': '$pending'})
          : 'signout_message'.tr,
      confirmLabel: 'profile_sign_out'.tr,
      destructive: true,
    );
    if (ok) await AuthController.to.signOut();
  }

  @override
  Widget build(BuildContext context) {
    final s = SessionController.to;
    final settings = SettingsController.to;
    final queue = OfflineQueue.to;

    return Obx(() {
      final name = s.displayName.value.isNotEmpty ? s.displayName.value : s.email.value;
      final role = s.role;
      final switchable = s.options.fold<int>(0, (n, o) => n + o.campuses.length) > 1;
      final langLabel = settings.locale.value.languageCode == 'vi'
          ? 'Tiếng Việt'
          : 'English';
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AppCard(
            child: Row(
              children: [
                AppAvatar(name: name, size: AppDimens.avatarLg),
                const SizedBox(width: AppDimens.s3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      AppText(name, style: AppTypography.title, maxLines: 2, overflow: TextOverflow.ellipsis),
                      if (s.email.value.isNotEmpty && s.email.value != name)
                        AppText(s.email.value, style: AppTypography.bodySmall),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppDimens.s4),
          AppCard(
            padding: const EdgeInsets.symmetric(horizontal: AppDimens.s4, vertical: AppDimens.s2),
            child: Column(
              children: [
                _InfoRow(label: 'profile_org'.tr, value: s.orgName),
                _InfoRow(label: 'profile_campus'.tr, value: s.campusName),
                _InfoRow(
                  label: 'profile_role'.tr,
                  value: role == null ? '' : role.labelKey.tr,
                  last: true,
                ),
              ],
            ),
          ),
          if (switchable) ...[
            const SizedBox(height: AppDimens.s3),
            AppButton(
              label: 'profile_switch'.tr,
              icon: AppIcons.swap,
              variant: AppButtonVariant.secondary,
              onPressed: _switchContext,
            ),
          ],
          const SizedBox(height: AppDimens.s4),
          AppCard(
            padding: const EdgeInsets.symmetric(horizontal: AppDimens.s4),
            child: Column(
              children: [
                ListRow(
                  title: 'profile_language'.tr,
                  subtitle: langLabel,
                  leading: const Icon(AppIcons.language, color: AppColors.action),
                  divider: true,
                  onTap: () => Get.toNamed<void>(RouteName.language),
                ),
                ListRow(
                  title: 'profile_unsynced'.tr,
                  subtitle: queue.unsyncedCount == 0
                      ? 'profile_unsynced_none'.tr
                      : 'sync_pending_count'.trParams({'args1': '${queue.unsyncedCount}'}),
                  leading: const Icon(Icons.cloud_upload_outlined, color: AppColors.action),
                  divider: AppFigs.isShowTestOption,
                  onTap: queue.unsyncedCount == 0 ? null : () => showQueueSheet(),
                ),
                if (AppFigs.isShowTestOption)
                  ListRow(
                    title: 'profile_catalog'.tr,
                    leading: const Icon(AppIcons.dashboard, color: AppColors.action),
                    onTap: () => Get.toNamed<void>(RouteName.catalog),
                  ),
              ],
            ),
          ),
          const SizedBox(height: AppDimens.s4),
          AppButton(
            label: 'profile_sign_out'.tr,
            icon: AppIcons.logout,
            variant: AppButtonVariant.destructiveOutline,
            onPressed: _signOut,
          ),
          const SizedBox(height: AppDimens.s4),
          const Center(child: _VersionText()),
        ],
      );
    });
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value, this.last = false});

  final String label;
  final String value;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: AppDimens.s3),
      decoration: last
          ? null
          : const BoxDecoration(
              border: Border(bottom: BorderSide(color: AppColors.divider)),
            ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(flex: 4, child: AppText(label, style: AppTypography.bodySmall)),
          Expanded(
            flex: 6,
            child: AppText(value, style: AppTypography.bodyStrong),
          ),
        ],
      ),
    );
  }
}

class _VersionText extends StatelessWidget {
  const _VersionText();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<PackageInfo>(
      future: PackageInfo.fromPlatform(),
      builder: (context, snap) {
        final v = snap.data == null
            ? ''
            : 'profile_version'.trParams({
                'args1': '${snap.data!.version} (${snap.data!.buildNumber})',
              });
        return AppText(
          [v, AppConfig.supportEmail].where((e) => e.isNotEmpty).join('\n'),
          style: AppTypography.caption,
          textAlign: TextAlign.center,
        );
      },
    );
  }
}

/// "Cá nhân" tab (parent, principal).
class ProfileTab extends StatelessWidget {
  const ProfileTab({super.key});

  @override
  Widget build(BuildContext context) {
    return ScreenScaffold(
      title: 'tab_profile'.tr,
      showBack: false,
      inShell: true,
      children: const [ProfileContent()],
    );
  }
}

/// Language screen: radio list, applies immediately (no restart).
class LanguageScreen extends StatelessWidget {
  const LanguageScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final settings = SettingsController.to;
    return ScreenScaffold(
      title: 'profile_language'.tr,
      children: [
        Obx(
          () => AppCard(
            padding: const EdgeInsets.symmetric(horizontal: AppDimens.s4),
            child: Column(
              children: [
                for (final (i, l) in AppLocaleConfig.supportedLocales.indexed)
                  ListRow(
                    title: l.languageCode == 'vi' ? 'Tiếng Việt' : 'English',
                    divider: i == 0,
                    showChevron: false,
                    trailing: settings.locale.value.languageCode == l.languageCode
                        ? const Icon(Icons.check_circle, color: AppColors.brand)
                        : null,
                    onTap: () => settings.setLocale(l),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
