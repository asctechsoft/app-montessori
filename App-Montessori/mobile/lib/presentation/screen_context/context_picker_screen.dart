import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/auth_controller.dart';
import '../../controller/session_controller.dart';
import '../../models/data_models/membership.dart';
import '../../models/data_models/session_context.dart';
import '../../models/ui_models/app_role.dart';
import '../../models/ui_models/app_tone.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_pages.dart';
import '../../values/app_typography.dart';
import '../common_components/app_button.dart';
import '../common_components/app_card.dart';
import '../common_components/app_icons.dart';
import '../common_components/confirm_dialog.dart';
import '../common_components/list_row.dart';
import '../common_components/screen_scaffold.dart';
import '../common_components/status_view.dart';

/// Pick organisation + role + campus. Shown after sign-in when there is more
/// than one choice (or none), and from Profile -> "Đổi vai trò / cơ sở".
///
/// States: loading, no membership (`empty`: invite not claimed yet), error /
/// offline (retry), cached memberships (stale banner), ready.
class ContextPickerScreen extends StatelessWidget {
  const ContextPickerScreen({super.key});

  Future<void> _choose(ContextOption o, CampusInfo campus) async {
    final session = SessionController.to;
    final next = SessionContext(
      orgId: o.membership.orgId,
      campusId: campus.id,
      role: o.role,
    );
    final changing = session.context.value != null && session.context.value != next;
    if (changing && session.hasUnsavedChanges) {
      final ok = await ConfirmDialog.show(
        title: 'scope_unsaved_title'.tr,
        message: 'scope_unsaved_message'.tr,
        confirmLabel: 'scope_unsaved_confirm'.tr,
        cancelLabel: 'scope_unsaved_stay'.tr,
        destructive: true,
      );
      if (!ok) return;
    }
    await session.selectContext(next);
    await Get.offAllNamed<void>(AppPages.shellFor(o.role));
  }

  @override
  Widget build(BuildContext context) {
    final session = SessionController.to;
    final canGoBack = session.context.value != null && Navigator.of(context).canPop();

    return ScreenScaffold(
      title: 'context_title'.tr,
      showBack: canGoBack,
      actions: [
        if (!canGoBack)
          Padding(
            padding: const EdgeInsets.only(right: AppDimens.s2),
            child: AppButton(
              label: 'profile_sign_out'.tr,
              icon: AppIcons.logout,
              variant: AppButtonVariant.tertiary,
              size: AppButtonSize.sm,
              expand: false,
              onPressed: AuthController.to.signOut,
            ),
          ),
      ],
      onRefresh: session.loadMemberships,
      children: [
        Obx(() {
          final state = session.loadState.value;
          final options = session.options;
          switch (state) {
            case ViewState.loading:
              return const StatusView(state: ViewState.loading);
            case ViewState.empty:
              return SizedBox(
                height: 420,
                child: StatusView(
                  state: ViewState.empty,
                  emptyIcon: AppIcons.school,
                  emptyTitle: 'context_empty_title'.tr,
                  emptyMessage: 'context_empty_message'.tr,
                  emptyActionLabel: 'action_retry'.tr,
                  onEmptyAction: session.loadMemberships,
                ),
              );
            case ViewState.error:
            case ViewState.offlineEmpty:
            case ViewState.forbidden:
              return SizedBox(
                height: 420,
                child: StatusView(
                  state: state,
                  error: session.loadError.value,
                  onRetry: session.loadMemberships,
                  onBack: AuthController.to.signOut,
                ),
              );
            default:
              break;
          }
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (state == ViewState.offlineStale)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppDimens.s4),
                  child: SizedBox(
                    height: 96,
                    child: StatusView(
                      state: ViewState.offlineStale,
                      staleSince: session.membershipsSavedAt.value,
                      onRetry: session.loadMemberships,
                    ),
                  ),
                ),
              AppText('context_message'.tr, style: AppTypography.body),
              const SizedBox(height: AppDimens.s4),
              for (final o in options) ...[
                _OptionCard(option: o, onChoose: _choose),
                const SizedBox(height: AppDimens.s3),
              ],
            ],
          );
        }),
      ],
    );
  }
}

class _OptionCard extends StatelessWidget {
  const _OptionCard({required this.option, required this.onChoose});

  final ContextOption option;
  final Future<void> Function(ContextOption, CampusInfo) onChoose;

  IconData get _icon => switch (option.role) {
    AppRole.parent => AppIcons.child,
    AppRole.teacher => AppIcons.classroom,
    AppRole.principal => AppIcons.manage,
  };

  @override
  Widget build(BuildContext context) {
    final session = SessionController.to;
    final cur = session.context.value;
    final single = option.campuses.length == 1;
    final isCurrentRole = cur != null &&
        cur.orgId == option.membership.orgId &&
        cur.role == option.role;

    return AppCard(
      padding: const EdgeInsets.symmetric(
        horizontal: AppDimens.s4,
        vertical: AppDimens.s2,
      ),
      selected: isCurrentRole && single,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ListRow(
            title: option.role.labelKey.tr,
            subtitle: option.membership.orgName,
            leading: Container(
              width: AppDimens.avatarMd,
              height: AppDimens.avatarMd,
              decoration: const BoxDecoration(
                color: AppColors.brandSoft,
                shape: BoxShape.circle,
              ),
              child: Icon(_icon, color: AppColors.action),
            ),
            onTap: single ? () => onChoose(option, option.campuses.first) : null,
            showChevron: single,
            trailing: isCurrentRole && single
                ? const Icon(Icons.check_circle, color: AppColors.brand)
                : null,
          ),
          if (!single) ...[
            Padding(
              padding: const EdgeInsets.only(bottom: AppDimens.s1),
              child: AppText('context_pick_campus'.tr, style: AppTypography.label),
            ),
            for (final c in option.campuses)
              ListRow(
                title: c.name,
                subtitle: c.code.isEmpty ? null : c.code,
                divider: true,
                leading: const Icon(AppIcons.school, color: AppColors.textSecondary),
                trailing: isCurrentRole && cur.campusId == c.id
                    ? const Icon(Icons.check_circle, color: AppColors.brand)
                    : null,
                onTap: () => onChoose(option, c),
              ),
          ],
        ],
      ),
    );
  }
}

