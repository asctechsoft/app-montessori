import 'package:app_montessori/models/ui_models/app_tone.dart';
import 'package:app_montessori/models/ui_models/status_catalog.dart';
import 'package:app_montessori/presentation/common_components/app_avatar.dart';
import 'package:app_montessori/presentation/common_components/app_badge.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_utils.dart';

void main() {
  // CONTRACT §9, verbatim.
  const expected = <StatusKind, Map<String, String>>{
    StatusKind.attendance: {
      'present': 'Có mặt',
      'absent_excused': 'Nghỉ có phép',
      'absent_unexcused': 'Nghỉ không phép',
      'no_class': 'Ngày không học',
      'unconfirmed': 'Chưa xác nhận',
    },
    StatusKind.handover: {
      'not_received': 'Chưa nhận',
      'received': 'Đã nhận',
      'picked_up': 'Đã trả',
    },
    StatusKind.payment: {
      'unpaid': 'Chưa thanh toán',
      'pending_reconciliation': 'Chờ đối soát',
      'partially_paid': 'Đã thanh toán một phần',
      'paid': 'Đã thanh toán',
      'overdue': 'Quá hạn',
      'cancelled': 'Đã hủy',
    },
    StatusKind.approval: {
      'pending': 'Chờ duyệt',
      'approved': 'Đã duyệt',
      'rejected': 'Từ chối',
    },
    StatusKind.campus: {
      'preparing': 'Chuẩn bị',
      'active': 'Đang hoạt động',
      'paused': 'Tạm ngừng',
      'closed': 'Đã đóng',
    },
  };

  test('Vietnamese strings carry the CONTRACT §9 labels', () {
    final vi = loadStrings('values-vi');
    for (final kind in expected.entries) {
      for (final code in kind.value.entries) {
        final spec = StatusCatalog.of(kind.key, code.key);
        expect(spec.labelKey, isNot('status_unknown'), reason: '${kind.key}/${code.key}');
        expect(vi[spec.labelKey], code.value, reason: '${kind.key}/${code.key}');
      }
    }
    expect(vi[StatusCatalog.of(StatusKind.sync, 'pending').labelKey], 'Chưa đồng bộ');
  });

  test('every catalog entry has an EN and a VI string', () {
    final vi = loadStrings('values-vi');
    final en = loadStrings('values');
    for (final e in StatusCatalog.all) {
      final key = StatusCatalog.of(e.key, e.value).labelKey;
      expect(vi[key], isNotEmpty, reason: key);
      expect(en[key], isNotEmpty, reason: key);
    }
  });

  testWidgets('StatusBadge shows label text AND an icon (not colour alone)', (tester) async {
    await tester.pumpWidget(
      vietnameseApp(
        const Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            StatusBadge(StatusKind.payment, 'pending_reconciliation'),
            StatusBadge(StatusKind.payment, 'paid'),
            StatusBadge(StatusKind.attendance, 'absent_excused'),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Chờ đối soát'), findsOneWidget);
    expect(find.text('Đã thanh toán'), findsOneWidget);
    expect(find.text('Nghỉ có phép'), findsOneWidget);
    expect(find.byType(Icon), findsNWidgets(3));
  });

  testWidgets('pending reconciliation is not styled like paid', (tester) async {
    final pending = StatusCatalog.of(StatusKind.payment, 'pending_reconciliation');
    final paid = StatusCatalog.of(StatusKind.payment, 'paid');
    expect(pending.tone, AppTone.warning);
    expect(paid.tone, AppTone.success);
    expect(pending.icon, isNot(paid.icon));
  });

  testWidgets('sync badge says "Chưa đồng bộ"', (tester) async {
    await tester.pumpWidget(vietnameseApp(StatusBadge.sync(SyncState.pending)));
    await tester.pumpAndSettle();
    expect(find.text('Chưa đồng bộ'), findsOneWidget);
  });

  testWidgets('unknown code falls back to a neutral label, never the raw code', (tester) async {
    await tester.pumpWidget(vietnameseApp(const StatusBadge(StatusKind.payment, 'weird_code')));
    await tester.pumpAndSettle();
    expect(find.text('Không xác định'), findsOneWidget);
    expect(find.text('weird_code'), findsNothing);
  });

  test('AppAvatar initials (no other child photo fallback)', () {
    expect(AppAvatar.initials('Nguyễn Minh An'), 'NA');
    expect(AppAvatar.initials('Lan'), 'L');
    expect(AppAvatar.initials('  '), '?');
    expect(AppAvatar.initials('Ân Đức'), 'ÂĐ');
  });
}
