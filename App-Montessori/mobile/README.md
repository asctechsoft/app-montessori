# app_montessori (mobile)

Một app Flutter, ba vai trò (Phụ huynh / Giáo viên / Hiệu trưởng) cho hệ thống quản lý mầm non nhiều cơ sở (B2B).
Package `com.asc.app_montessori`, Firebase project `app-montessori-36ec6`, backend callable `api` (region `asia-southeast1`).

Tài liệu nguồn: `../docs/CONTRACT.md` (dữ liệu, quyền, API), `../docs/BUSINESS.txt` (nghiệp vụ, mã màn P/T/H),
`../MamNon_App_Design_System/` (tokens, component), ảnh bố cục `../scream/*.png`.
Cấu trúc và quy ước theo app mẫu `D:\App_Start_Up\music_asc\muvik` (GetX + `asc_common`, 4 flavor, XML strings).

## Chạy nhanh

```bash
cd mobile
flutter pub get
flutter run --flavor dev                    # bắt buộc chọn flavor: alpha | dev | product | claude
flutter analyze
flutter test
flutter build apk --flavor claude --debug   # kiểm tra build
```

- Máy này không có `python` trong PATH, nên công cụ chuỗi viết bằng Dart. `dart` trong PATH có thể là SDK khác Flutter; nếu lỗi
  "native assets", dùng đúng Dart của Flutter: `C:\Users\Asus\AppData\Local\Flutter_sdk\flutter\bin\dart`.
  ```bash
  dart run tool/gen_strings.dart     # tool/strings_src.dart -> lib/xml_strings/values{,-vi}/strings.xml
  dart run tool/check_strings.dart   # báo khóa dùng mà chưa có (exit 1) và khóa thừa
  ```
- Emulator Firebase (Auth 9099, Firestore 8080, Functions 5001, Storage 9199, host `10.0.2.2` cho Android emulator):
  ```bash
  flutter run --flavor dev --dart-define=USE_EMULATORS=true
  flutter run --flavor dev --dart-define=USE_EMULATORS=true --dart-define=EMULATOR_HOST=192.168.1.20   # máy thật
  ```
- Đăng nhập số điện thoại (OTP, phụ huynh) mặc định tắt: `--dart-define=PHONE_OTP=true` (cần bật Phone provider + SHA trong Firebase).
- `android/app/google-services.json` (git-ignore) lấy từ `../google-services.json`. iOS cần `GoogleService-Info.plist` (chưa có).

## `asc_common`: path dependency

`pubspec.yaml` dùng `path: ../../asc_common` (máy dev có sẵn `D:\App_Start_Up\asc_common`). Để dùng git ref ghim như muvik, thay bằng:

```yaml
asc_common:
  git:
    url: https://github.com/asctechsoft/asc_common.git
    ref: 96a4c3b
```

`dsp_base` KHÔNG dùng (không quảng cáo): Firebase khởi tạo trực tiếp ở `lib/services/firebase_bootstrap.dart`.

## Kiến trúc

Ánh xạ DESIGN_SYSTEM §15 (`core/...`) vào cấu trúc muvik (không có thư mục `core/` riêng):

| DESIGN_SYSTEM §15 | Nằm ở |
|---|---|
| `core/design_system` tokens + theme | `lib/values/` (`app_colors`, `app_dimensions`, `app_typography`, `app_theme`) |
| `core/design_system` components/patterns | `lib/presentation/common_components/` |
| `core/session`, `core/scope` | `lib/controller/session_controller.dart`, `auth_controller.dart`, `lib/models/data_models/{membership,session_context}.dart` |
| `core/permissions` | `lib/values/permissions.dart` (bản Dart của backend) + `lib/services/permission_service.dart` |
| `core/network` | `lib/services/network/` (`ApiService`, `AppException`) |
| `core/storage` (cache theo scope) | `lib/services/storage/` (`PrefStore`, `ScopedCache`) |
| `core/sync` | `lib/services/sync/offline_queue.dart` + `presentation/common_components/sync_badge.dart` |
| `core/formatting` | `lib/utils/money_formatter.dart`, `date_formatter.dart`, `validators.dart` |
| `core/observability` | `lib/utils/app_log.dart` (Crashlytics, không log dữ liệu nhạy cảm) |
| `roles/{parent,teacher,principal}` | `lib/presentation/screen_shell/` (`role_shell`, `role_tabs`) |
| `features/*` | `lib/presentation/screen_<feature>/` + `controller/` + `repository/` + `models/` |
| `catalog/` | `lib/presentation/screen_debug/catalog_screen.dart` (Cá nhân -> Catalog, flavor khác product) |

```
lib/
  main.dart                 StartupGate + StartupStep -> MontessoriApp (GetMaterialApp)
  configs/                  app_config, app_figs (flavor), locale_config, pref_const, pref_defaults
  values/                   route_name, app_pages (+ContextGuard), app_theme, app_colors, app_dimensions,
                            app_typography, permissions
  models/data_models/       membership (OrgMembership, Grant, CampusInfo, ChildRef), session_context, queued_op
  models/ui_models/         app_role, app_tone (AppTone, RequestState, SyncState, ViewState), status_catalog
  controller/               session_controller, auth_controller, settings_controller, login_controller, scope_aware
  repository/               firestore_repository (đọc stream theo scope)
  services/                 auth_service, push_service, connectivity_service, permission_service, firebase_bootstrap
    network/                api_service, app_exception
    storage/                pref_store, scoped_cache
    sync/                   offline_queue
  utils/                    app_log, app_localize, money_formatter, date_formatter, validators, toast_utils
  presentation/
    common_components/      AppButton, AppInput, AppBadge/StatusBadge, AppBanner, AppCard, AppAvatar, ListRow/ChildRow,
                            ScreenScaffold, BottomNav, BottomSheetBase, ConfirmDialog, SkeletonLoader, StatusView,
                            ScopeSelector, SyncBadge, app_icons, tone_colors
    screen_splash/ screen_auth/ screen_context/ screen_shell/ screen_profile/ screen_debug/
  xml_strings/values{,-vi}/ strings.xml (sinh ra, đừng sửa tay)
tool/                       strings_src.dart, gen_strings.dart, check_strings.dart
test/                       formatters, permissions, offline_queue, api_service, status_badge, components
```

### Luồng khởi động và phiên

`main` -> `StartupGate` (orientation, system ui, prefs, firebase, date formats, language, services) -> `SplashScreen`:
- chưa đăng nhập -> `/login`;
- đã đăng nhập -> `AuthController.afterSignIn`: bind OfflineQueue theo uid, `invite.claimPending`, `org.listMine`, đăng ký push;
  rồi khôi phục ngữ cảnh gần nhất hợp lệ hoặc tự chọn nếu chỉ có 1 lựa chọn -> shell của vai trò; nếu không -> `/context`
  (chọn tổ chức/vai trò/cơ sở; xử lý cả "chưa có liên kết", lỗi, offline có/không cache).

Vai trò suy ra từ `member.kind` + grants (`Grant.appRole`): `owner/principal/hr/accountant/tech_admin` -> hiệu trưởng;
`teacher/nurse/kitchen/transport` -> giáo viên (shell nhân sự); `kind=parent` -> phụ huynh. Một tài khoản có thể có nhiều vai trò/org.

### Phạm vi (scope) và cache

`SessionContext{orgId, campusId, role, childId?}`; khóa cache `org|campus|uid|role|child`. Đổi vai trò/cơ sở/bé
(`SessionController.selectContext/selectChild`): (1) xóa `ScopedCache` của scope cũ, (2) đặt context mới và lưu, (3) tăng `scopeEpoch`.
Controller tính năng dùng mixin `ScopeAware` (`onScopeChanged`) để bỏ dữ liệu cũ và tải lại; luồng Firestore của
`FirestoreRepository` tự bỏ sự kiện đến muộn sau khi đổi scope. Màn có dữ liệu chưa lưu đăng ký
`SessionController.registerDirtyGuard(() => dirty)`; `ScopeSelector` và nút "Đổi vai trò" sẽ hỏi trước khi bỏ.
Đăng xuất: `ScopedCache.clearAll()` + hủy token push; hàng đợi offline của user vẫn giữ trên máy.

### Ghi dữ liệu và offline

Mọi ghi đi qua `ApiService.to.call(action, orgId, campusId, payload, opId)`. Client chỉ đọc Firestore (`FirestoreRepository`).
Chỉ `handover.receive`, `punch.record`, `attendance.mark` được xếp hàng offline (`OfflineQueue.allowedActions`); thanh toán, trả trẻ,
duyệt hoàn/duyệt khác **không** bao giờ vào hàng đợi. UI không báo "Thành công" khi mới xếp hàng; hiển thị `SyncBadge` "Chưa đồng bộ" kèm giờ máy.

## Thêm một tính năng mới (từng bước)

Ví dụ: màn "Đơn nghỉ của lớp" (T04) cho giáo viên.

1. **Route**: thêm `static const String leaveList = '/teacher/leave';` vào `values/route_name.dart`; thêm `GetPage` trong
   `values/app_pages.dart` kèm `binding: BindingsBuilder(() => Get.lazyPut(() => LeaveListController()))` và
   `middlewares: [ContextGuard(AppRole.teacher)]`. Hoặc, nếu là nội dung của một tab, thay `PlaceholderTab` trong `presentation/screen_shell/role_tabs.dart`.
2. **Model**: `lib/models/data_models/leave_request.dart` (`fromMap(id, map)`; tiền là `int`, thời điểm là `Timestamp`, `dayKey` là String). Enum UI vào `models/ui_models/`.
3. **Repository**: `lib/repository/leave_repository.dart` extends `FirestoreRepository`: đọc bằng `watchCollection('leaveRequests', fromMap: ..., build: (q) => q.where(...))`
   (lọc theo cơ sở/lớp/`childId` đúng như rules CONTRACT §5). Ghi: gọi `ApiService.to.call('leave.decide', orgId:, campusId:, payload:, opId: ApiService.newOpId())` ngay trong repository/service, không trong widget.
4. **Controller**: `lib/controller/leave_list_controller.dart` extends `GetxController with ScopeAware`; giữ `Rx<ViewState>` (`loading/ready/empty/noResults/error/offlineStale`), `AppException? error`, danh sách; `onScopeChanged()` hủy stream, xóa dữ liệu và tải lại.
   Tạo `opId` MỘT lần cho mỗi ý định ghi và dùng lại khi thử lại. Lỗi `fieldErrors` ánh xạ vào field; `VERSION_CONFLICT` -> tải lại và báo.
5. **Quyền**: chỉ hiện CTA khi `PermissionService.can(Perm.leaveDecide)` (server vẫn kiểm tra lại).
6. **Màn hình**: `lib/presentation/screen_leave/leave_list_screen.dart` dựng bằng `ScreenScaffold(title, contextLabels, children/body, footer)`, `StatusView(state: ...)`
   cho 8 trạng thái, `StatusBadge(StatusKind.approval, status)`, `AppButton`, `ConfirmDialog` cho thao tác nhạy cảm (nêu đối tượng + tác động). Màu/cỡ chữ/khoảng cách chỉ lấy từ `AppColors/AppTypography/AppDimens`.
7. **Chuỗi**: thêm khóa vào `tool/strings_src.dart` (`['English', 'Tiếng Việt']`), chạy `dart run tool/gen_strings.dart` và `dart run tool/check_strings.dart`; dùng `'key'.tr` / `'key'.trParams({'args1': v})`.
8. **Offline** (chỉ nếu thuộc danh sách cho phép): `OfflineQueue.to.enqueue(action:, orgId:, campusId:, payload:, label:)`, hiện `SyncBadge`.
9. **Test + kiểm tra**: `flutter analyze`, `flutter test`; xem ở 320/360/390/430 và chữ 100/150/200% (Cá nhân -> Catalog có công cụ giả lập), vùng chạm >= 48.

## Cổng chất lượng (checklist DESIGN_SYSTEM)

Chữ co giãn theo hệ thống (kẹp 85%-200% trong `main.dart`); nút/ô nhập >= 48; mọi nhãn trạng thái có chữ + icon;
không hex tùy tiện; light mode only; nhãn VN theo CONTRACT §9 (`StatusBadge`, có test).

## Chưa làm / ghi chú

- Màn tính năng của 3 vai trò: chỉ có placeholder ghi mã P0x/T0x/H0x trong `role_tabs.dart`.
- Onboarding: bỏ qua (chưa cần). iOS: chưa có `GoogleService-Info.plist`, chưa build thử.
- Upload ảnh/chứng từ (Storage), vị trí chấm công (`geolocator`), `url_launcher`: đã có dependency + quyền Android/iOS, chưa có UI.
- Hình dạng phản hồi `org.listMine` là giả định, xem `../docs/CONTRACT_CHANGES.md`.
