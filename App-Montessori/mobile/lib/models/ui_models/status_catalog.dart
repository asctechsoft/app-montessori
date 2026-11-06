import 'package:flutter/material.dart';

import 'app_tone.dart';

/// Families of business status codes (CONTRACT §9).
enum StatusKind { attendance, handover, payment, approval, campus, sync }

/// Label key + tone + icon of one status code. Labels live in the XML strings
/// (`status_<kind>_<code>`); Vietnamese text follows CONTRACT §9 exactly.
class StatusSpec {
  const StatusSpec(this.labelKey, this.tone, this.icon);

  final String labelKey;
  final AppTone tone;
  final IconData icon;
}

class StatusCatalog {
  StatusCatalog._();

  static const StatusSpec unknown = StatusSpec(
    'status_unknown',
    AppTone.neutral,
    Icons.help_outline,
  );

  static const Map<StatusKind, Map<String, StatusSpec>> _table = {
    StatusKind.attendance: {
      'present': StatusSpec(
        'status_attendance_present',
        AppTone.success,
        Icons.check_circle_outline,
      ),
      'absent_excused': StatusSpec(
        'status_attendance_absent_excused',
        AppTone.info,
        Icons.event_busy_outlined,
      ),
      'absent_unexcused': StatusSpec(
        'status_attendance_absent_unexcused',
        AppTone.error,
        Icons.cancel_outlined,
      ),
      'no_class': StatusSpec(
        'status_attendance_no_class',
        AppTone.neutral,
        Icons.event_available_outlined,
      ),
      'unconfirmed': StatusSpec(
        'status_attendance_unconfirmed',
        AppTone.warning,
        Icons.help_outline,
      ),
    },
    StatusKind.handover: {
      'not_received': StatusSpec(
        'status_handover_not_received',
        AppTone.neutral,
        Icons.schedule,
      ),
      'received': StatusSpec(
        'status_handover_received',
        AppTone.success,
        Icons.how_to_reg_outlined,
      ),
      'picked_up': StatusSpec(
        'status_handover_picked_up',
        AppTone.info,
        Icons.logout,
      ),
    },
    StatusKind.payment: {
      'unpaid': StatusSpec(
        'status_payment_unpaid',
        AppTone.info,
        Icons.receipt_long_outlined,
      ),
      'pending_reconciliation': StatusSpec(
        'status_payment_pending_reconciliation',
        AppTone.warning,
        Icons.hourglass_top,
      ),
      'partially_paid': StatusSpec(
        'status_payment_partially_paid',
        AppTone.warning,
        Icons.timelapse,
      ),
      'paid': StatusSpec(
        'status_payment_paid',
        AppTone.success,
        Icons.check_circle_outline,
      ),
      'overdue': StatusSpec(
        'status_payment_overdue',
        AppTone.error,
        Icons.error_outline,
      ),
      'cancelled': StatusSpec(
        'status_payment_cancelled',
        AppTone.neutral,
        Icons.block,
      ),
    },
    StatusKind.approval: {
      'pending': StatusSpec(
        'status_approval_pending',
        AppTone.warning,
        Icons.schedule,
      ),
      'approved': StatusSpec(
        'status_approval_approved',
        AppTone.success,
        Icons.check_circle_outline,
      ),
      'rejected': StatusSpec(
        'status_approval_rejected',
        AppTone.error,
        Icons.cancel_outlined,
      ),
      'cancelled': StatusSpec(
        'status_approval_cancelled',
        AppTone.neutral,
        Icons.block,
      ),
    },
    StatusKind.campus: {
      'preparing': StatusSpec(
        'status_campus_preparing',
        AppTone.info,
        Icons.construction_outlined,
      ),
      'active': StatusSpec(
        'status_campus_active',
        AppTone.success,
        Icons.check_circle_outline,
      ),
      'paused': StatusSpec(
        'status_campus_paused',
        AppTone.warning,
        Icons.pause_circle_outline,
      ),
      'closed': StatusSpec(
        'status_campus_closed',
        AppTone.neutral,
        Icons.lock_outline,
      ),
    },
    StatusKind.sync: {
      'synced': StatusSpec(
        'status_sync_synced',
        AppTone.success,
        Icons.cloud_done_outlined,
      ),
      'pending': StatusSpec(
        'status_sync_pending',
        AppTone.warning,
        Icons.cloud_upload_outlined,
      ),
      'failed': StatusSpec(
        'status_sync_failed',
        AppTone.error,
        Icons.cloud_off_outlined,
      ),
    },
  };

  static StatusSpec of(StatusKind kind, String code) =>
      _table[kind]?[code] ?? unknown;

  /// Every `(kind, code)` known to the catalog, for tests and the catalog screen.
  static Iterable<MapEntry<StatusKind, String>> get all sync* {
    for (final e in _table.entries) {
      for (final code in e.value.keys) {
        yield MapEntry(e.key, code);
      }
    }
  }
}
