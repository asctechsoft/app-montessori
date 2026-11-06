import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';

import '../../models/ui_models/app_tone.dart';
import '../../models/ui_models/status_catalog.dart';
import '../../services/network/app_exception.dart';
import '../../utils/date_formatter.dart';
import '../../utils/money_formatter.dart';
import '../../utils/toast_utils.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../common_components/app_avatar.dart';
import '../common_components/app_badge.dart';
import '../common_components/app_banner.dart';
import '../common_components/app_button.dart';
import '../common_components/app_card.dart';
import '../common_components/app_icons.dart';
import '../common_components/app_input.dart';
import '../common_components/bottom_nav.dart';
import '../common_components/bottom_sheet_base.dart';
import '../common_components/confirm_dialog.dart';
import '../common_components/list_row.dart';
import '../common_components/scope_selector.dart';
import '../common_components/screen_scaffold.dart';
import '../common_components/skeleton_loader.dart';
import '../common_components/status_view.dart';
import '../common_components/sync_badge.dart';

/// Debug gallery of every component and state (DESIGN_SYSTEM checklist: "Dựng
/// catalog trạng thái để QA độc lập với dữ liệu thật"). Not shipped on the
/// product flavor. Use the chips to emulate widths 320-430 and text scale
/// 100/150/200 %.
class CatalogScreen extends StatefulWidget {
  const CatalogScreen({super.key});

  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen> {
  double _scale = 1;
  double? _width;
  ViewState _view = ViewState.ready;
  String _childId = 'c1';
  String _campusId = 'cg';
  int _nav = 0;
  DateTime? _date;
  TimeOfDay? _time;
  int? _amount = 4100000;
  bool _clean = true;

  Widget _section(String title, List<Widget> kids) => Padding(
    padding: const EdgeInsets.only(bottom: AppDimens.s6),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AppText(title, style: AppTypography.heading3),
        const SizedBox(height: AppDimens.s3),
        ...kids.expand((w) => [w, const SizedBox(height: AppDimens.s3)]),
      ],
    ),
  );

  Widget _chips<T>(List<T> values, T current, String Function(T) label, ValueChanged<T> on) =>
      Wrap(
        spacing: AppDimens.s2,
        runSpacing: AppDimens.s2,
        children: [
          for (final v in values)
            ChoiceChip(
              label: Text(label(v)),
              selected: v == current,
              onSelected: (_) => on(v),
            ),
        ],
      );

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    Widget content = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _section('QA', [
          _chips<double>([1, 1.5, 2], _scale, (v) => '${(v * 100).round()}%', (v) => setState(() => _scale = v)),
          _chips<double?>([null, 320, 360, 390, 430], _width, (v) => v == null ? 'auto' : '${v.round()}', (v) => setState(() => _width = v)),
        ]),
        _section('Button', [
          for (final v in AppButtonVariant.values)
            Wrap(
              spacing: AppDimens.s2,
              runSpacing: AppDimens.s2,
              children: [
                for (final s in AppButtonSize.values)
                  AppButton(
                      label: '${v.name} ${s.name}',
                      variant: v,
                      size: s,
                      expand: false,
                      onPressed: () {},
                    ),
              ],
            ),
          AppButton(label: 'Primary + icon', icon: AppIcons.check, onPressed: () {}),
          AppButton(label: 'Loading (chặn gửi trùng)', loading: true, loadingLabel: 'Đang gửi', onPressed: () {}),
          AppButton(
            label: 'Async 2s (tự loading)',
            onPressed: () => Future<void>.delayed(const Duration(seconds: 2)),
          ),
          const AppButton(label: 'Disabled', onPressed: null),
          AppButton(label: 'Nhãn tiếng Việt rất dài để kiểm tra xuống dòng trong nút', onPressed: () {}),
          Row(
            children: [
              Expanded(child: AppButton(label: 'Từ chối', variant: AppButtonVariant.destructiveOutline, onPressed: () {})),
              const SizedBox(width: AppDimens.s3),
              Expanded(child: AppButton(label: 'Duyệt', onPressed: () {})),
            ],
          ),
        ]),
        _section('Input', [
          const AppInput(label: 'Họ tên', hint: 'Nguyễn Văn A', required: true, helper: 'Như trên giấy khai sinh'),
          const AppInput(label: 'Lỗi', initialValue: 'abc', error: 'Email không hợp lệ'),
          const AppInput(label: 'Chỉ đọc', initialValue: 'Cơ sở Cầu Giấy', readOnly: true, helper: 'Chỉ cập nhật qua yêu cầu'),
          const AppInput(label: 'Vô hiệu', initialValue: 'Không sửa', disabled: true),
          const AppInput(label: 'Số điện thoại', kind: AppInputKind.phone, initialValue: '0983123121'),
          const AppInput(label: 'Mật khẩu', kind: AppInputKind.password, initialValue: 'secret1'),
          AppInput(
            label: 'Ngày nghỉ',
            kind: AppInputKind.date,
            dateValue: _date,
            hint: 'dd/MM/yyyy',
            onDatePicked: (d) => setState(() => _date = d),
          ),
          AppInput(
            label: 'Giờ đón',
            kind: AppInputKind.time,
            timeValue: _time,
            hint: 'HH:mm',
            onTimePicked: (t) => setState(() => _time = t),
          ),
          AppInput(
            label: 'Số tiền',
            kind: AppInputKind.money,
            amount: _amount,
            helper: _amount == null ? null : MoneyFormatter.format(_amount!),
            onAmountChanged: (v) => setState(() => _amount = v),
          ),
          const AppInput(label: 'Ghi chú', kind: AppInputKind.multiline, hint: 'Nhập nội dung...'),
          const AppOtpInput(label: 'Mã OTP'),
        ]),
        _section('Badge / StatusBadge (CONTRACT §9)', [
          Wrap(
            spacing: AppDimens.s2,
            runSpacing: AppDimens.s2,
            children: [
              for (final e in StatusCatalog.all) StatusBadge(e.key, e.value),
              const AppBadge(label: 'Quá hạn 3 ngày', tone: AppTone.error),
            ],
          ),
        ]),
        _section('Banner', [
          for (final t in AppTone.values)
            AppBanner(
              tone: t,
              title: t.name,
              message: 'Thông điệp ngắn, tối đa hai đến ba câu, có hành động riêng khi cần.',
              actionLabel: t == AppTone.warning ? 'Xem' : null,
              onAction: t == AppTone.warning ? () {} : null,
            ),
        ]),
        _section('Card / Avatar / ListRow / ChildRow', [
          AppCard(child: AppText('Card thường', style: AppTypography.body)),
          AppCard(selected: true, child: AppText('Card đã chọn (kèm dấu chọn)', style: AppTypography.body)),
          AppCard(onTap: () {}, child: AppText('Card bấm được', style: AppTypography.body)),
          Row(
            children: [
              const AppAvatar(name: 'Nguyễn Minh An', size: AppDimens.avatarSm),
              const SizedBox(width: AppDimens.s2),
              const AppAvatar(name: 'Trần Bảo Ngọc'),
              const SizedBox(width: AppDimens.s2),
              const AppAvatar(name: 'Cô Lan', size: AppDimens.avatarLg),
              const SizedBox(width: AppDimens.s2),
              const AppAvatar(name: 'Hương', size: AppDimens.avatarXl),
            ],
          ),
          AppCard(
            padding: const EdgeInsets.symmetric(horizontal: AppDimens.s4),
            child: Column(
              children: [
                ListRow(title: 'Học phí tháng 10', subtitle: 'Còn 5 ngày đến hạn', trailing: Text(MoneyFormatter.format(4100000), style: AppTypography.bodyStrong), onTap: () {}, divider: true),
                const ChildRow(name: 'Nguyễn Minh An', className: 'Lớp Mầm 1', trailing: StatusBadge(StatusKind.handover, 'received')),
              ],
            ),
          ),
        ]),
        _section('ScopeSelector', [
          ScopeSelector(
            style: ScopeSelectorStyle.cards,
            label: 'Bé',
            selectedId: _childId,
            options: const [
              ScopeOption(id: 'c1', title: 'Nguyễn Minh An', subtitle: 'Lớp Mầm 1'),
              ScopeOption(id: 'c2', title: 'Nguyễn Gia Bình', subtitle: 'Lớp Chồi 2'),
            ],
            hasUnsavedChanges: () => !_clean,
            onSelected: (id) async => setState(() => _childId = id),
          ),
          ScopeSelector(
            label: 'Cơ sở',
            leadingIcon: AppIcons.school,
            selectedId: _campusId,
            options: const [
              ScopeOption(id: 'cg', title: 'Trường Mầm non Cầu Giấy'),
              ScopeOption(id: 'tx', title: 'Trường Mầm non Thanh Xuân'),
            ],
            hasUnsavedChanges: () => !_clean,
            onSelected: (id) async => setState(() => _campusId = id),
          ),
          SwitchListTile(
            title: const Text('Có dữ liệu chưa lưu (hỏi trước khi đổi)'),
            value: !_clean,
            onChanged: (v) => setState(() => _clean = !v),
          ),
        ]),
        _section('SyncBadge', [
          SyncBadge(state: SyncState.pending, deviceTime: DateTime.now()),
          SyncBadge(state: SyncState.failed, deviceTime: DateTime.now()),
          const SyncBadge(state: SyncState.synced, showSynced: true),
        ]),
        _section('Sheet / Dialog / Toast', [
          AppButton(
            label: 'BottomSheet',
            variant: AppButtonVariant.secondary,
            onPressed: () => BottomSheetBase.show<void>(
              title: 'Chọn cơ sở',
              builder: (_) => Column(
                children: [
                  for (var i = 1; i <= 12; i++) ListRow(title: 'Dòng $i', divider: true, showChevron: false),
                ],
              ),
              footerBuilder: (ctx) => AppButton(label: 'Xác nhận', onPressed: () => Navigator.of(ctx).pop()),
            ),
          ),
          AppButton(
            label: 'ConfirmDialog (nêu đối tượng + tác động)',
            variant: AppButtonVariant.secondary,
            onPressed: () => ConfirmDialog.show(
              title: 'Xác nhận trả bé',
              message: 'Xác nhận trả Nguyễn Minh An cho bà Trần Thị Hoa lúc 16:45?',
              confirmLabel: 'Xác nhận trả bé',
              details: const ImpactList(lines: ['Trạng thái chuyển sang Đã trả', 'Phụ huynh nhận thông báo']),
              onConfirm: () => Future<void>.delayed(const Duration(seconds: 1)),
            ),
          ),
          AppButton(
            label: 'ConfirmDialog nguy hiểm + thiếu dữ liệu',
            variant: AppButtonVariant.secondary,
            onPressed: () => ConfirmDialog.show(
              title: 'Thu hồi quyền đón',
              message: 'Thu hồi quyền đón của người này từ bây giờ?',
              confirmLabel: 'Thu hồi',
              destructive: true,
              disabledReason: 'Thiếu lý do thu hồi.',
            ),
          ),
          AppButton(
            label: 'Toast',
            variant: AppButtonVariant.secondary,
            onPressed: () => AppToast.success('Đã lưu nháp'),
          ),
        ]),
        _section('Skeleton', [const SkeletonLoader(rows: 2)]),
        _section('StatusView', [
          _chips<ViewState>(ViewState.values, _view, (v) => v.name, (v) => setState(() => _view = v)),
          SizedBox(
            height: 360,
            child: StatusView(
              state: _view,
              staleSince: DateTime.now().subtract(const Duration(hours: 2)),
              activeFilters: const ['Lớp Mầm 1', 'Chưa nhận'],
              onClearFilters: () => setState(() => _view = ViewState.ready),
              error: const AppException(AppException.internal, '', requestId: 'req-8f2a'),
              onRetry: () => setState(() => _view = ViewState.loading),
              onBack: () {},
              onEmptyAction: () {},
              emptyActionLabel: 'Thêm',
              child: const Center(child: Text('Nội dung (ready)')),
            ),
          ),
        ]),
        _section('Formatters', [
          AppText('${MoneyFormatter.format(4100000)}  |  ${MoneyFormatter.format(-1000000)}', style: AppTypography.metric),
          AppText(
            '${DateFormatter.date(DateTime(2026, 10, 16))}  ${DateFormatter.time(DateTime(2026, 1, 1, 7, 5))}  '
            '${CampusClock('Asia/Ho_Chi_Minh').time(DateTime.utc(2026, 10, 16, 8, 0))} (UTC+7)',
            style: AppTypography.body,
          ),
        ]),
        _section('BottomNav (5 mục, nhãn 2 dòng, badge)', [
          ClipRRect(
            borderRadius: BorderRadius.circular(AppDimens.radiusMd),
            child: BottomNav(
              currentIndex: _nav,
              onTap: (i) => setState(() => _nav = i),
              items: [
                const BottomNavItem(label: 'Trang chủ', icon: AppIcons.home, activeIcon: AppIcons.homeActive),
                const BottomNavItem(label: 'Lớp học', icon: AppIcons.classroom, activeIcon: AppIcons.classroomActive, badgeCount: 3),
                const BottomNavItem(label: 'Nhật ký', icon: AppIcons.diary),
                const BottomNavItem(label: 'Công cá nhân', icon: AppIcons.timeclock, badgeCount: 120),
                BottomNavItem(label: 'Tiện ích', icon: AppIcons.utilities),
              ],
            ),
          ),
        ]),
      ],
    );

    if (_width != null) {
      content = Align(
        alignment: Alignment.topCenter,
        child: SizedBox(width: _width, child: content),
      );
    }
    return MediaQuery(
      data: mq.copyWith(
        textScaler: TextScaler.linear(_scale),
        size: _width == null ? mq.size : Size(_width!, mq.size.height),
      ),
      child: ScreenScaffold(
        title: 'Catalog (debug)',
        padding: EdgeInsets.fromLTRB(
          _width != null && _width! < AppDimens.compactWidth ? AppDimens.s4 : AppDimens.s6,
          AppDimens.s4,
          _width != null && _width! < AppDimens.compactWidth ? AppDimens.s4 : AppDimens.s6,
          AppDimens.s6,
        ),
        children: [content],
      ),
    );
  }
}
