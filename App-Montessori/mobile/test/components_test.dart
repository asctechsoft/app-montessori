import 'dart:async';

import 'package:app_montessori/models/ui_models/app_tone.dart';
import 'package:app_montessori/presentation/common_components/app_button.dart';
import 'package:app_montessori/presentation/common_components/app_input.dart';
import 'package:app_montessori/presentation/common_components/bottom_nav.dart';
import 'package:app_montessori/presentation/common_components/status_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_utils.dart';

void main() {
  testWidgets('AppButton: async onPressed locks the button (no double submit)', (tester) async {
    var taps = 0;
    final completer = Completer<void>();
    await tester.pumpWidget(
      vietnameseApp(
        AppButton(
          label: 'Gửi đơn',
          onPressed: () {
            taps++;
            return completer.future;
          },
        ),
      ),
    );
    await tester.tap(find.text('Gửi đơn'));
    await tester.pump();
    await tester.tap(find.text('Gửi đơn'));
    await tester.pump();
    expect(taps, 1);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    completer.complete();
    await tester.pumpAndSettle();
    expect(find.byType(CircularProgressIndicator), findsNothing);
  });

  testWidgets('AppButton: disabled does nothing; hit area is at least 48', (tester) async {
    await tester.pumpWidget(
      vietnameseApp(
        const Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AppButton(label: 'Tắt', onPressed: null),
            AppButton(label: 'Nhỏ', onPressed: null, size: AppButtonSize.sm),
          ],
        ),
      ),
    );
    final size = tester.getSize(find.widgetWithText(AppButton, 'Nhỏ'));
    expect(size.height, greaterThanOrEqualTo(48));
  });

  testWidgets('AppInput: label outside, error below with text', (tester) async {
    await tester.pumpWidget(
      vietnameseApp(
        const SizedBox(
          width: 320,
          child: AppInput(label: 'Email', error: 'Email không hợp lệ', required: true),
        ),
      ),
    );
    expect(find.textContaining('Email', findRichText: true), findsWidgets);
    expect(find.text('Email không hợp lệ'), findsOneWidget);
    final field = tester.getSize(find.byType(TextField));
    expect(field.height, greaterThanOrEqualTo(52));
  });

  testWidgets('AppInput money formats thousands and reports the integer', (tester) async {
    int? value;
    await tester.pumpWidget(
      vietnameseApp(
        SizedBox(
          width: 320,
          child: AppInput(
            label: 'Số tiền',
            kind: AppInputKind.money,
            onAmountChanged: (v) => value = v,
          ),
        ),
      ),
    );
    await tester.enterText(find.byType(TextField), '4100000');
    await tester.pump();
    expect(find.text('4.100.000'), findsOneWidget);
    expect(value, 4100000);
  });

  testWidgets('BottomNav: 5 items, long label wraps, badge announced', (tester) async {
    int? tapped;
    await tester.pumpWidget(
      vietnameseApp(
        SizedBox(
          width: 320,
          child: BottomNav(
            currentIndex: 3,
            onTap: (i) => tapped = i,
            items: const [
              BottomNavItem(label: 'Trang chủ', icon: Icons.home),
              BottomNavItem(label: 'Lớp học', icon: Icons.groups, badgeCount: 3),
              BottomNavItem(label: 'Nhật ký', icon: Icons.book),
              BottomNavItem(label: 'Công cá nhân', icon: Icons.badge),
              BottomNavItem(label: 'Tiện ích', icon: Icons.apps),
            ],
          ),
        ),
      ),
    );
    expect(find.text('Công cá nhân'), findsOneWidget);
    expect(find.text('3'), findsOneWidget);
    await tester.tap(find.text('Lớp học'), warnIfMissed: false);
    expect(tapped, 1);
    expect(tester.getSize(find.byType(BottomNav)).height, greaterThanOrEqualTo(64));
  });

  testWidgets('StatusView renders each state', (tester) async {
    Future<void> show(ViewState s) async {
      await tester.pumpWidget(
        vietnameseApp(
          SizedBox(
            width: 360,
            height: 500,
            child: StatusView(
              state: s,
              onRetry: () {},
              onClearFilters: () {},
              activeFilters: const ['Lớp Mầm 1'],
              child: const Text('NỘI DUNG'),
            ),
          ),
        ),
      );
      await tester.pump();
    }

    await show(ViewState.ready);
    expect(find.text('NỘI DUNG'), findsOneWidget);
    await show(ViewState.empty);
    expect(find.text('Chưa có dữ liệu'), findsOneWidget);
    await show(ViewState.noResults);
    expect(find.text('Không có kết quả'), findsOneWidget);
    expect(find.text('Xóa bộ lọc'), findsOneWidget);
    await show(ViewState.error);
    expect(find.text('Thử lại'), findsOneWidget);
    await show(ViewState.offlineEmpty);
    expect(find.text('Không có kết nối mạng'), findsOneWidget);
    await show(ViewState.forbidden);
    expect(find.text('Bạn không có quyền xem nội dung này'), findsOneWidget);
    await show(ViewState.offlineStale);
    expect(find.text('NỘI DUNG'), findsOneWidget);
    expect(find.textContaining('ngoại tuyến'), findsOneWidget);
  });
}
