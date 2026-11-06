# Backend — Firebase (Firestore + Cloud Functions TypeScript)

Hệ thống quản lý mầm non nhiều cơ sở, mô hình B2B (mỗi khách hàng = 1 `org`, dữ liệu cách ly theo đường dẫn `orgs/{orgId}/...`).
Hợp đồng chung: `../docs/CONTRACT.md` (+ ghi chú lệch/bổ sung: `../docs/CONTRACT_CHANGES.md`). Project Firebase: `app-montessori-36ec6`.

```
backend/
  firebase.json            # emulator (auth 9099, firestore 8080, functions 5001, storage 9199, ui 4000), rules, indexes
  firestore.rules          # client chỉ ĐỌC (theo membership/permsByCampus/childIds); ghi chỉ users/{uid} + devices
  firestore.indexes.json   # index composite + fieldOverrides collectionGroup (members.uid, invites.email/phone)
  storage.rules            # đường dẫn orgs/{orgId}/campuses/{campusId}/..., đọc/ghi theo membership
  functions/               # Cloud Function callable `api` (region asia-southeast1)
    src/core/              # router (idempotency opId), Ctx (require/can/audit/tx), store, validate, approvals, permissions
    src/modules/           # org, entity, children, attendance, care, comms, approvals (BE-1) + hr, payroll, finance, ops, reports, admin (BE-2)
    src/__tests__/         # test node:test chạy trên emulator
  scripts/seed.ts          # dữ liệu mẫu CONTRACT §10 (idempotent)
```

## Yêu cầu
Node 20, Firebase CLI (>= 14), Java 17+ (emulator Firestore). Cài phụ thuộc: `npm --prefix functions install`.

## Chạy emulator
```bash
cd backend
firebase emulators:start --only auth,firestore,functions,storage --project app-montessori-36ec6
# UI: http://localhost:4000   | Functions: http://localhost:5001
```
Cloud Function chạy từ `functions/lib` → build trước: `npm --prefix functions run build` (hoặc `npm --prefix functions run build:watch`).
Client trỏ emulator: web `connectAuthEmulator/connectFirestoreEmulator/connectFunctionsEmulator`; mobile tương tự (host `10.0.2.2` trên Android emulator).

## Seed dữ liệu mẫu
```bash
# emulator đang chạy (auth + firestore):
npm --prefix functions run seed
```
Seed tạo org `hoasen` ("Hệ thống Mầm non Hoa Sen"), 2 cơ sở `CG`/`TX`, 3 lớp, 6 trẻ (MN001 Nguyễn Minh An…), người giám hộ, quyền đón, điểm danh 4 ngày + bàn giao hôm nay, nhật ký, đơn nghỉ, yêu cầu thuốc, sự cố, thông báo, trao đổi và dữ liệu học phí kỳ 10/2026 (3.000.000 + 770.000 + 200.000 − 300.000 − 70.000 = 3.600.000, nợ cũ 500.000 → còn phải thu 4.100.000). Chạy lại nhiều lần an toàn (id cố định).
Tài khoản dev (mật khẩu chung `Montessori@123` — chỉ dùng phát triển), in ra cuối lệnh seed:

| Vai trò | Email |
|---|---|
| Chủ chuỗi | `owner@hoasen.test` |
| Hiệu trưởng CG | `hieutruong.huong@hoasen.test` |
| Giáo viên Mầm 1 | `giaovien.lan@hoasen.test` |
| Kế toán | `ketoan.minh@hoasen.test` |
| Phụ huynh (mẹ) | `phuhuynh.linh@hoasen.test` (+84912345678) |
| Phụ huynh (bố) | `phuhuynh.nam@hoasen.test` |

Seed lên dự án THẬT (không khuyến nghị; cần credentials và ghi đè các tài liệu mẫu): `SEED_LIVE=1 npm --prefix functions run seed`.

## Test
```bash
cd backend
firebase emulators:exec --only firestore,auth --project app-montessori-36ec6 "npm --prefix functions run build && npm --prefix functions test"
```
Bao gồm: AT01 (cô lập cơ sở), AT02 (phụ huynh chỉ con liên kết), AT03 (hai giáo viên nhận cùng bé, trả trẻ chưa nhận), AT04 (người đón bị thu hồi/hết hạn), idempotency `opId`, grant hết hạn, sĩ số + ngoại lệ, chốt điểm danh + sửa có duyệt, đơn nghỉ/`mealCancelled`, chuyển cơ sở hai bên duyệt, thông báo (duyệt → gửi → đọc/xác nhận), và kiểm thử rules bằng `@firebase/rules-unit-testing` (client không ghi được, cross-org bị chặn, parent/teacher theo phạm vi).
Kiểm tra kiểu: `npm --prefix functions run lint` (= `tsc --noEmit`).

## Deploy
```bash
cd backend
firebase login
firebase use app-montessori-36ec6
firebase deploy --only firestore:rules,firestore:indexes,storage      # rules + index
firebase deploy --only functions                                       # tự chạy build (predeploy)
# hoặc tất cả: firebase deploy
```
Storage rules dùng `firestore.get()` (đọc `members`) — lần deploy đầu Firebase CLI sẽ hỏi cấp quyền liên kết Storage↔Firestore.
Index mới có thể mất vài phút để build; collection-group `members.uid`, `invites.email/phone`, `notifications(status, scheduledAt)` là bắt buộc cho `org.listMine`, `invite.claimPending`, gửi thông báo theo lịch.

## Biến môi trường / cấu hình
- Không có secret trong mã. Admin SDK dùng Application Default Credentials của môi trường Cloud Functions.
- Emulator: `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST` (do `firebase emulators:exec/start` gán; seed/test tự đặt mặc định `127.0.0.1:8080/9099`), `GCLOUD_PROJECT` (mặc định `app-montessori-36ec6` trong seed/test).
- Seed live: `SEED_LIVE=1`, `GOOGLE_APPLICATION_CREDENTIALS`.
- Region cố định `asia-southeast1` (`functions/src/core/firebase.ts`).

## Tạo tài khoản platformAdmin (nhà cung cấp ASC)
`platformAdmin` là custom claim; chỉ gán bằng Admin SDK từ máy tin cậy (không từ client):
```js
// node -e (đã đặt GOOGLE_APPLICATION_CREDENTIALS tới service account của dự án)
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
initializeApp();
getAuth().setCustomUserClaims('<UID>', { platformAdmin: true }).then(() => console.log('ok'));
```
Người dùng phải đăng nhập lại (hoặc làm mới ID token) để claim có hiệu lực. platformAdmin vượt qua kiểm tra quyền/campus của API (kể cả org `suspended`) — cấp rất hạn chế. Khách hàng cũng có thể tự đăng ký org bằng `org.create` (người tạo thành `owner`).

## Sao lưu / khôi phục
- **Firestore PITR** (khôi phục theo thời điểm 7 ngày): `gcloud firestore databases update --database='(default)' --enable-pitr`.
- **Scheduled export** hằng ngày sang GCS: tạo bucket `gs://<project>-firestore-backup` rồi `gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=14w` (hoặc `gcloud firestore export gs://<bucket>/$(date +%F)` bằng Cloud Scheduler + Cloud Function). Bật versioning/khóa xóa cho bucket.
- Cloud Storage (ảnh/chứng từ): bật object versioning + soft delete.
- Ghi nhận lịch và kết quả kiểm tra khôi phục qua action `backup.record` / `backup.verify` (W46). Không có nút "phục hồi" cho nhân viên cơ sở: khôi phục chỉ do quản trị hệ thống thực hiện sau khi xem tác động.
- **Mục tiêu**: RPO 24 giờ (sao lưu hằng ngày) và RTO 8 giờ; nên diễn tập khôi phục vào một database/project riêng mỗi quý và ghi kết quả bằng `backup.verify`.

## Quy ước vận hành
- Mọi ghi nghiệp vụ qua `api`; client chỉ đọc Firestore (xem bảng `../docs/CONTRACT.md` §5) và ghi `users/{uid}`, `users/{uid}/devices/*`.
- Mọi thao tác ghi quan trọng có `opId`; lỗi trả `HttpsError(code, message tiếng Việt, details.code)`.
- Nhật ký thao tác: `orgs/{orgId}/auditLogs` (chỉ `audit.read`, client không ghi).
- Tiền = số nguyên VND; `dayKey` = `YYYY-MM-DD` theo múi giờ cơ sở.
