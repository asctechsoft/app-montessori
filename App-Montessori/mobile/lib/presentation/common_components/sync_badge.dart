import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../models/ui_models/app_tone.dart';
import '../../utils/date_formatter.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import 'app_badge.dart';

/// "Chưa đồng bộ" marker for a record that only exists on this device
/// (DESIGN_SYSTEM §12). Shows the device time of the action. Synced records
/// show nothing (unless [showSynced]).
class SyncBadge extends StatelessWidget {
  const SyncBadge({
    super.key,
    required this.state,
    this.deviceTime,
    this.showSynced = false,
  });

  final SyncState state;

  /// Device clock when the action was made.
  final DateTime? deviceTime;
  final bool showSynced;

  @override
  Widget build(BuildContext context) {
    if (state == SyncState.synced && !showSynced) return const SizedBox.shrink();
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Flexible(child: StatusBadge.sync(state)),
        if (deviceTime != null && state != SyncState.synced) ...[
          const SizedBox(width: AppDimens.s2),
          Flexible(
            child: AppText(
              'sync_device_time'.trParams({'args1': DateFormatter.time(deviceTime!)}),
              style: AppTypography.caption,
            ),
          ),
        ],
      ],
    );
  }
}
