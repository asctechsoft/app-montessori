import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../models/data_models/queued_op.dart';
import '../../models/ui_models/app_tone.dart';
import '../../services/connectivity_service.dart';
import '../../services/sync/offline_queue.dart';
import '../../utils/date_formatter.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../common_components/app_button.dart';
import '../common_components/app_icons.dart';
import '../common_components/bottom_sheet_base.dart';
import '../common_components/sync_badge.dart';
import '../common_components/tone_colors.dart';

/// Thin bar at the top of every shell: "Đang ngoại tuyến" and/or "N thao tác
/// chưa đồng bộ" (tap for the list). Hidden when online and nothing is queued.
class SyncStatusBar extends StatelessWidget {
  const SyncStatusBar({super.key});

  @override
  Widget build(BuildContext context) {
    final conn = ConnectivityService.to;
    final queue = OfflineQueue.to;
    return Obx(() {
      final online = conn.isOnline.value;
      final pending = queue.items.length;
      if (online && pending == 0) return const SizedBox.shrink();
      final failed = queue.items.any((o) => o.state == SyncState.failed);
      final tone = failed ? AppTone.error : AppTone.warning;
      final text = !online
          ? (pending > 0
                ? 'sync_offline_pending'.trParams({'args1': '$pending'})
                : 'sync_offline'.tr)
          : 'sync_pending_count'.trParams({'args1': '$pending'});
      return Semantics(
        container: true,
        liveRegion: true,
        child: Material(
          color: tone.bg,
          child: InkWell(
            onTap: pending > 0 ? () => showQueueSheet() : null,
            child: Container(
              constraints: const BoxConstraints(minHeight: AppDimens.touchMin),
              padding: const EdgeInsets.symmetric(
                horizontal: AppDimens.s4,
                vertical: AppDimens.s2,
              ),
              child: Row(
                children: [
                  Icon(online ? AppIcons.refresh : AppIcons.offline, size: AppDimens.iconMd, color: tone.fg),
                  const SizedBox(width: AppDimens.s2),
                  Expanded(
                    child: AppText(
                      text,
                      style: AppTypography.label.copyWith(color: tone.fg),
                    ),
                  ),
                  if (pending > 0)
                    Icon(AppIcons.chevronRight, size: AppDimens.iconMd, color: tone.fg),
                ],
              ),
            ),
          ),
        ),
      );
    });
  }
}

/// List of queued ops with Retry / Discard for failed ones.
Future<void> showQueueSheet() {
  return BottomSheetBase.show<void>(
    title: 'sync_sheet_title'.tr,
    builder: (ctx) {
      final queue = OfflineQueue.to;
      return Obx(() {
        if (queue.items.isEmpty) {
          return Padding(
            padding: const EdgeInsets.all(AppDimens.s4),
            child: AppText('sync_sheet_empty'.tr, style: AppTypography.body),
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final op in queue.items) _QueueRow(op: op),
          ],
        );
      });
    },
    footerBuilder: (ctx) => AppButton(
      label: 'sync_retry_all'.tr,
      icon: AppIcons.refresh,
      onPressed: () => OfflineQueue.to.flush(),
    ),
  );
}

class _QueueRow extends StatelessWidget {
  const _QueueRow({required this.op});

  final QueuedOp op;

  @override
  Widget build(BuildContext context) {
    final queue = OfflineQueue.to;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: AppDimens.s3),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.divider)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AppText(op.label ?? op.action, style: AppTypography.bodyStrong),
          const SizedBox(height: AppDimens.s1),
          SyncBadge(state: op.state, deviceTime: op.deviceTime),
          AppText(
            DateFormatter.dateTime(op.deviceTime),
            style: AppTypography.caption,
          ),
          if (op.lastError != null)
            Padding(
              padding: const EdgeInsets.only(top: AppDimens.s1),
              child: AppText(
                op.lastError!,
                style: AppTypography.bodySmall.copyWith(color: AppColors.error),
              ),
            ),
          if (op.state == SyncState.failed)
            Row(
              children: [
                AppButton(
                  label: 'action_retry'.tr,
                  size: AppButtonSize.sm,
                  variant: AppButtonVariant.secondary,
                  expand: false,
                  onPressed: () => queue.retry(op.opId),
                ),
                const SizedBox(width: AppDimens.s3),
                AppButton(
                  label: 'sync_discard'.tr,
                  size: AppButtonSize.sm,
                  variant: AppButtonVariant.destructiveOutline,
                  expand: false,
                  onPressed: () => queue.discard(op.opId),
                ),
              ],
            ),
        ],
      ),
    );
  }
}
