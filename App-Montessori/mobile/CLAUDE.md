# CLAUDE.md

Hướng dẫn cho Claude Code khi làm việc trong `mobile/` (Flutter app `app_montessori`). Đọc thêm `README.md` (kiến trúc, cách thêm tính năng).

## Dự án

Một app, ba vai trò (parent / teacher / principal), hệ thống mầm non nhiều cơ sở (B2B). GetX cho state, DI, routing.
Backend: Firebase `app-montessori-36ec6`; client ĐỌC Firestore trực tiếp, mọi GHI qua callable `api` (region `asia-southeast1`).
Hợp đồng: `../docs/CONTRACT.md` (nguồn sự thật; đổi hợp đồng thì ghi `../docs/CONTRACT_CHANGES.md`). Nghiệp vụ: `../docs/BUSINESS.txt`.
Thiết kế: `../MamNon_App_Design_System/` + ảnh `../scream/`. Cấu trúc theo muvik (`D:\App_Start_Up\music_asc\muvik`) + `asc_common`.

## Lệnh

```bash
flutter pub get
flutter run --flavor dev            # flavor bắt buộc: alpha | dev | product | claude
flutter analyze                     # phải sạch
flutter test
flutter build apk --flavor claude --debug
dart run tool/gen_strings.dart      # sinh lib/xml_strings từ tool/strings_src.dart (dùng Dart của Flutter nếu `dart` trong PATH lỗi native assets)
dart run tool/check_strings.dart
flutter run --flavor dev --dart-define=USE_EMULATORS=true    # emulator 10.0.2.2: 9099/8080/5001/9199
```

Không có `python` trong PATH; không viết tool bằng Python.

## Kiến trúc (một dòng mỗi lớp)

```
presentation/ (screen_*, common_components)  -> UI, không gọi API/Firestore trực tiếp
controller/   (GetX)                         -> trạng thái màn hình, gọi repository/service
repository/                                  -> đọc Firestore (FirestoreRepository), mapping model
services/                                    -> ApiService, AuthService, OfflineQueue, PushService, storage
models/ values/ configs/ utils/              -> dữ liệu, token+route+permissions, hằng/prefs, tiện ích
```

Ánh xạ `core/*` của DESIGN_SYSTEM §15 vào cấu trúc này: xem bảng trong `README.md`. KHÔNG tạo thư mục `core/` hay `features/` riêng.

## Quy ước bắt buộc

- **Token**: màu/cỡ chữ/khoảng cách/bo góc chỉ từ `AppColors`, `AppTypography`, `AppDimens` (1:1 với `tokens.json`). Không hex, không số khoảng cách tùy ý ngoài lưới 4. Light mode only.
- **Component**: dùng lại `presentation/common_components/` (AppButton, AppInput, StatusBadge, StatusView, ScreenScaffold, ConfirmDialog, ScopeSelector...). Không tự viết style nút/ô nhập. Dùng `AppText/AppRow/AppColumn/AppTouchable/BottomSafeArea` của `asc_common` thay vì viết lại.
- **Chuỗi**: mọi chữ hiển thị là khóa trong `tool/strings_src.dart` (EN + VI thật), dùng `'key'.tr` hoặc `'key'.trParams({'args1': ...})`. Sau khi sửa: `gen_strings.dart` rồi `check_strings.dart`. Không sửa tay `xml_strings/*`. Nhãn trạng thái VN theo CONTRACT §9 và dùng `StatusBadge`.
- **Trạng thái dữ liệu**: mọi danh sách/chi tiết hiển thị đủ `loading / ready / empty / noResults / error + Thử lại / offlineStale / offlineEmpty / forbidden` qua `StatusView`. Không spinner toàn màn vô hạn, không hiện số 0 thay cho dữ liệu thiếu.
- **Ghi dữ liệu**: `ApiService.to.call(...)`. Tạo `opId` bằng `ApiService.newOpId()` MỘT lần cho mỗi ý định (mọi ghi quan trọng) và dùng lại khi thử lại. Lỗi chuẩn hóa thành `AppException` (`code`, `userMessage`, `fieldErrors`); không lộ stack. Không báo "thành công" trước khi server xác nhận; nút gửi dùng `AppButton` async (tự khóa gửi trùng).
- **Offline**: chỉ `handover.receive`, `punch.record`, `attendance.mark` qua `OfflineQueue.enqueue`. Thanh toán, trả trẻ (`handover.pickup`), duyệt hoàn/duyệt khác: không bao giờ xếp hàng. Hiện `SyncBadge` "Chưa đồng bộ" + giờ máy.
- **Scope**: lấy org/campus/role/child từ `SessionController.to`. Controller phụ thuộc scope dùng `with ScopeAware`. Cache chỉ qua `ScopedCache` với `SessionController.to.scopeKey`. Không query chéo org; đường dẫn Firestore dựng bằng `FirestoreRepository.orgCollection/orgDoc`. Phụ huynh lọc theo `childId`, giáo viên theo cơ sở/lớp.
- **Quyền UI**: `PermissionService.can(Perm.xxx)` chỉ để ẩn/hiện; server luôn kiểm tra. Hằng quyền ở `values/permissions.dart` (bản Dart của `backend/functions/src/core/permissions.ts`; test đối chiếu danh sách).
- **Tiền/ngày**: tiền là `int` VND, hiển thị `MoneyFormatter.format` (`4.100.000 đ`); ngày `DateFormatter` (`dd/MM/yyyy`, `HH:mm`) và giờ cơ sở bằng `CampusClock(session.timezone)`; `dayKey` `YYYY-MM-DD` theo giờ cơ sở.
- **Chạm/kích thước**: vùng chạm >= 48; thử 320/360/390/430 và chữ 100/150/200% (Catalog có công cụ giả lập). Text không cắt tên bé và số tiền (cho xuống dòng).
- **Log**: `AppLog.info` (chỉ dev), `AppLog.error` (Crashlytics non-fatal). Không `print`. Không log token, SĐT, sức khỏe, số tiền chi tiết.
- **Prefs**: khóa ở `configs/pref_const.dart`, mặc định ở `pref_defaults.dart`, chỉ đọc/ghi qua `PrefStore`.
- **Flavor**: đọc qua `AppFigs`, không đọc `appFlavor` trực tiếp. Màn debug (`/catalog`) chỉ bật khi `AppFigs.isShowTestOption`.
- **Khởi động**: thêm bước khởi tạo mới vào danh sách `StartupStep` trong `main.dart` (idempotent, có timeout). Service dùng chung `Get.put(..., permanent: true)` trong bước `services`.
- **Lifecycle**: huỷ `StreamSubscription`/`Worker`/dirty guard trong `onClose`.
- **Ảnh trẻ/chứng từ**: không URL công khai dài hạn, không đưa vào analytics; `AppAvatar` fallback là chữ cái đầu, không bao giờ ảnh của bé khác.

## Nơi đặt file

| Thêm... | Đặt ở |
|---|---|
| route | `values/route_name.dart` + `values/app_pages.dart` |
| tab của một vai trò | `presentation/screen_shell/role_tabs.dart` (thay `PlaceholderTab`) |
| màn tính năng | `presentation/screen_<feature>/` |
| widget dùng lại | `presentation/common_components/` (không import repository/API/session) |
| model Firestore | `models/data_models/`; enum/value UI: `models/ui_models/` |
| truy cập Firestore | `repository/<x>_repository.dart` extends `FirestoreRepository` |
| gọi API/logic ứng dụng | `services/` hoặc `services/network/` |
| hằng cấu hình | `configs/app_config.dart` |
| khóa prefs | `configs/pref_const.dart` + `pref_defaults.dart` |
| chuỗi | `tool/strings_src.dart` |

## File cục bộ (git-ignore)

- `android/app/google-services.json` (copy từ `../google-services.json`); thiếu thì build Android lỗi.
- `android/key.properties` chỉ cho ký bản store; không có thì bản release ký bằng debug key.
Không commit keystore, mật khẩu, token, service account.

## Ghi chú

- Hình dạng phản hồi `org.listMine`/`invite.claimPending` được app giả định tolerant (xem `../docs/CONTRACT_CHANGES.md`); sửa `OrgMembership.fromMap` nếu backend khác.
- Flutter 3.47 / Dart 3.13: dùng null-aware element (`'k': ?v`), dot shorthand được phép.
- Test dùng chuỗi thật qua `test/test_utils.dart` (`vietnameseApp`, `loadStrings`).
