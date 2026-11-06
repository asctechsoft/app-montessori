# CONTRACT — Hệ thống quản lý mầm non nhiều cơ sở (B2B)

Nguồn sự thật chung cho **backend / web / mobile**. Mọi thay đổi hợp đồng phải sửa file này trước.

Firebase project: `app-montessori-36ec6` (config web ở `config web.txt`, Android `google-services.json`, package `com.asc.app_montessori`).
Thư mục: `backend/` (Firebase: Firestore rules, Storage rules, Cloud Functions TypeScript), `web/` (Next.js admin), `mobile/` (Flutter: 1 app 3 vai trò Phụ huynh / Giáo viên / Hiệu trưởng, dùng `asc_common`, cấu trúc như `D:\App_Start_Up\music_asc\muvik`).
Tài liệu nghiệp vụ: `Luong_web_quan_tri_mam_non.md`, `Tai_lieu_nghiep_vu_...docx` (đã trích ở `docs/BUSINESS.txt`), design system `MamNon_App_Design_System/` (tokens.json), ảnh mobile `scream/`.

## 1. Đa tenant (B2B)

- Mỗi khách hàng = 1 **organization** (`orgs/{orgId}`). Toàn bộ dữ liệu nghiệp vụ nằm **dưới** `orgs/{orgId}/...` → cách ly từ đường dẫn. Không bao giờ query chéo org.
- Cơ sở = `orgs/{orgId}/campuses/{campusId}`. Mọi doc thuộc cơ sở đều có `campusId`.
- Một người dùng = 1 Firebase Auth account, có thể là thành viên nhiều org/cơ sở. Không dùng tài khoản dùng chung.
- Tài khoản "platform admin" (custom claim `platformAdmin: true`) của nhà cung cấp (ASC) tạo org khách hàng. Ngoài ra cho phép **tự đăng ký** org (`org.create`) để demo: người tạo thành `owner`.
- Mọi **ghi** đi qua Cloud Function callable `api` (Admin SDK). Rules cấm client ghi (trừ `users/{uid}` hồ sơ cá nhân và `users/{uid}/devices/*`). Client **đọc** trực tiếp Firestore, bị rules chặn theo membership.
- Máy chủ kiểm tra quyền cho từng request (org, cơ sở, vai trò, hiệu lực thời gian). Mặc định từ chối.

## 2. Quy ước dữ liệu

- Tiền: **số nguyên VND** (`amount: 3600000`). Không float.
- `dayKey`: chuỗi `YYYY-MM-DD` theo múi giờ cơ sở (`campus.timezone`, mặc định `Asia/Ho_Chi_Minh`). Sự kiện: Firestore `Timestamp`. Ngày học/công lưu riêng bằng `dayKey`.
- Mọi doc: `createdAt, updatedAt (Timestamp), createdBy, updatedBy (uid), version (int, tăng mỗi lần ghi)`. Sửa có `expectedVersion` → lệch version trả `aborted`/`VERSION_CONFLICT`.
- Không xóa cứng dữ liệu nghiệp vụ: `archived: true` hoặc `status`.
- Chứng từ tài chính/công/điểm danh đã chốt: **không sửa**, chỉ tạo chứng từ điều chỉnh liên kết (`adjustsId`).
- Trạng thái dùng chuỗi snake_case tiếng Anh; nhãn tiếng Việt ở UI (xem §9).
- Doc id xác định để chống trùng: attendance `${childId}_${dayKey}_${session}`; receivable `rcv_${childId}_${periodKey}_${type}`; bank payment `${source}_${txnCode}`; punch theo `opId`.
- `opId`: client sinh UUID cho mọi thao tác ghi quan trọng (idempotency). Server lưu kết quả ở `orgs/{orgId}/ops/{opId}`; gửi lại cùng `opId` trả đúng kết quả cũ, không ghi lần hai.

## 3. Membership & phân quyền

```
users/{uid}: { uid, displayName, email, phone, photoUrl?, locale, createdAt, updatedAt }       // client được ghi (trừ field cấm)
users/{uid}/devices/{deviceId}: { fcmToken, platform, orgId?, updatedAt }                       // client ghi

orgs/{orgId}: { name, status: 'active'|'suspended', ownerUid, plan, timezone, currency:'VND', createdAt... }
orgs/{orgId}/members/{uid}: {
  uid, displayName, email, phone,
  kind: 'owner' | 'staff' | 'parent',
  status: 'invited'|'active'|'suspended'|'revoked',
  grants: Grant[],                    // chỉ staff/owner
  childIds: string[],                 // chỉ parent: các con được liên kết
  permsByCampus: { [campusId | '*']: string[] },   // SERVER TÍNH, rules đọc
  employeeId?: string, version, createdAt, updatedAt
}
Grant = { id, roleId, campusIds: string[] /* ['*'] = toàn org */, classIds?: string[], validFrom?: ISO, validTo?: ISO, extraPerms?: string[], deniedPerms?: string[] }
orgs/{orgId}/roles/{roleId}: { name, perms: string[], system: false }     // vai trò tùy biến; vai trò hệ thống ở code
orgs/{orgId}/invites/{inviteId}: { email?, phone?, displayName, kind, grants?, childIds?, status:'pending'|'accepted'|'revoked'|'expired', code, expiresAt, ... }
```

`permsByCampus` = hợp (vai trò + extraPerms − deniedPerms) của các grant còn hiệu lực. Khóa `'*'` cho grant toàn org. Job định kỳ tính lại khi grant hết hạn. Server tính lại ở mỗi request (không tin cache).

### Quyền (permission strings) — dùng chung, định nghĩa trong `backend/functions/src/core/permissions.ts`, bản sao TS ở `web/src/lib/permissions.ts`, Dart ở `mobile/lib/values/permissions.dart`

```
org.manage campus.read campus.manage members.read members.manage roles.manage
leads.read leads.write
children.read children.write children.health.read children.transfer
classes.read classes.write
attendance.read attendance.write handover.write leave.decide
care.read care.write care.publish
medication.read medication.write incident.read incident.write
staff.read staff.write roster.write
timekeeping.read timekeeping.approve timekeeping.lock timekeeping.reopen
leave_staff.decide
payroll.read payroll.write payroll.approve
fees.read fees.write billing.write billing.approve
payments.read payments.write payments.reconcile refunds.approve
expenses.read expenses.write expenses.approve
kitchen.read kitchen.write stock.read stock.write assets.read assets.write transport.read transport.write
notify.read notify.send notify.approve inbox.handle
reports.read reports.export audit.read import.write backup.manage approvals.read
```

Vai trò hệ thống (`roleId`): `owner`(tất cả), `principal`, `teacher`, `hr`, `accountant`, `nurse`, `kitchen`, `transport`, `tech_admin`, `parent`(không perm, dùng childIds). `principal` KHÔNG có `payroll.*`, `refunds.approve`, `expenses.approve`, `timekeeping.reopen`, `billing.approve` mặc định (phải cấp riêng qua `extraPerms`). `tech_admin` chỉ `members.read members.manage campus.read audit.read backup.manage` — không có children.health.read/payroll/ảnh trẻ. Ma trận đầy đủ nằm trong `permissions.ts`.

Giáo viên: phạm vi lớp = `grant.classIds` (nếu rỗng thì theo `assignments` đang hiệu lực). Server chặn ghi ngoài lớp; mobile lọc theo lớp.
Phụ huynh: chỉ đọc doc có `childId ∈ member.childIds` (hoặc `childIds` chứa), chỉ các collection được rules cho phép.

## 4. API: Cloud Function callable `api` (region `asia-southeast1`)

Gọi: `httpsCallable('api')({ action, orgId?, campusId?, payload, opId? })` → `{ ok: true, data }`.
Lỗi: `HttpsError(code, message, details)`, `details = { code: 'PERMISSION_DENIED'|'UNAUTHENTICATED'|'NOT_FOUND'|'VALIDATION'|'VERSION_CONFLICT'|'CONFLICT'|'PRECONDITION'|'INVALID_STATE'|'LIMIT', fieldErrors?: {field: msg}, ... }`. Thông điệp lỗi tiếng Việt, không lộ stack.
Router: `backend/functions/src/core/router.ts`; mỗi module ở `src/modules/<name>.ts` export `actions: Record<string, ActionDef>`.

### Danh sách action (tên chính xác — web/mobile gọi đúng tên này)

**Tổ chức & tài khoản** (`org.ts`)
`org.create{name, ownerCampus?:{code,name,address}}` (scope none) · `org.update` · `org.listMine` (scope none; trả orgs+vai trò+cơ sở user thuộc) · `campus.create{code,name,address,phone,timezone,openTime,closeTime,principalInvite?:{email,displayName},copyFrom?:{campusId, parts:['classes','feePolicies','shifts','menus','categories']}}` · `campus.update` · `campus.setStatus{campusId,status:'preparing'|'active'|'paused'|'closed',reason}` (đóng cơ sở: kiểm tra trẻ đang học/công nợ/đặt cọc, trả `PRECONDITION` kèm danh sách) · `campus.setupProgress` · `member.invite{kind,email?,phone?,displayName,grants?,childIds?}` · `invite.claimPending` (scope none; gọi sau mỗi lần đăng nhập: khớp email/phone đã xác minh với invites pending → tạo member) · `invite.revoke` · `member.updateGrants` · `member.setStatus{uid,status,reason}` (suspend/revoke → `revokeRefreshTokens`) · `role.save` · `me.setActiveContext` không cần (client giữ).

**Danh mục chung** (`entity.ts`) — generic, có registry cấu hình quyền/validate/campus-scope:
`entity.save{collection, id?, data, expectedVersion?}` · `entity.archive{collection,id,reason}`.
Collections trong registry: `academicYears, calendarExceptions(ngày nghỉ/ngoại lệ), classes, categories(danh mục: lý do nghỉ, loại sự cố, đơn vị...), feePolicies(draft; publish qua feePolicy.publish), shifts, rosters, menus(draft), stockItems, assets, assetRequests, routes, trips, expenses(draft)`. Quyền/`campusId` bắt buộc theo từng collection (xem `entity.ts`).

**Tuyển sinh / trẻ / lớp** (`children.ts`)
`lead.save` · `lead.setStatus{id,status:'new'|'contacted'|'tour_scheduled'|'trial'|'documents'|'approved'|'enrolled'|'lost'}` · `lead.enroll{leadId?,child:{...},classId,startDate,feePlanId?,guardians:[...]}` (kiểm tra sĩ số; lớp đầy → `LIMIT` hoặc tạo approval ngoại lệ nếu `requestException:true`) · `child.save` · `child.setStatus{childId,status:'pending'|'active'|'trial'|'on_leave'|'withdrawn'|'archived',effectiveDate,reason}` · `child.linkGuardian{childId,guardian:{name,phone,email?,relation},perms:{notify,viewFees,pickup}}` (số điện thoại/email đã có tài khoản → tạo link sau xác minh, không tạo trùng) · `child.unlinkGuardian` · `assignment.save` (phân công GV, kiểm tra chồng lấn) · `transfer.request{childId,toClassId?,toCampusId?,effectiveDate,debtHandling:'stay'|'move',depositHandling}` · `transfer.decide{id,decision,note}` (cần các bên) → tạo enrollment mới, đóng enrollment cũ.

**Điểm danh & bàn giao** (`attendance.ts`)
`attendance.mark{classId,dayKey,session:'all'|'am'|'pm',items:[{childId,status:'present'|'absent_excused'|'absent_unexcused'|'no_class',arrivedAt?,droppedBy?,note?,healthNote?}]}` (không tạo trùng; doc id xác định; sau chốt → yêu cầu sửa) · `attendance.close{classId,dayKey}` · `attendance.requestCorrection{attendanceId,newValue,reason}` / `attendance.decideCorrection{id,decision}` · `handover.receive{childId,dayKey,droppedBy,at?}` · `handover.pickup{childId,dayKey,pickupPersonId,verification:{method:'id_check'|'qr'|'otp'|'phone_call',note},at?}` (chặn nếu chưa nhận; chặn nếu người đón không có trong `pickupAuthorizations` hiệu lực hoặc đã thu hồi/hết hạn; mã `PRECONDITION` + `reason`) · `pickupAuth.save`(phụ huynh tạo/ủy quyền có thời hạn; trạng thái `pending→approved` do nhà trường) / `pickupAuth.decide` / `pickupAuth.revoke` · `leave.submit{childId,fromDay,toDay,session,reasonId,note}` (phụ huynh) · `leave.decide{id,decision:'approved'|'rejected',note}` (tính cờ `mealCancelled` theo `campus.mealCutoff` HH:mm so với `submittedAt`/`decidedAt`) · `leave.cancel`.

**Chăm sóc** (`care.ts`)
`dailyLog.save{childId,dayKey,meals:[],sleep:[],hygiene:{},mood,activities:[],note,photoPaths:[]}` (draft) · `dailyLog.publish{classId,dayKey,childIds?}` (xuất bản, kiểm tra đúng trẻ/ngày/ảnh có consent) · `health.record{childId,heightCm,weightKg,measuredOn,note}` · `medication.request` (phụ huynh) · `medication.decide{id,decision:'received'|'rejected'|'paused',reason}` · `medication.administer{requestId,at,dose,result,note}` · `incident.save` · `incident.close`.

**Nhân sự & công** (`hr.ts`)
`employee.save{...}` (kèm `contracts`) · `employee.assign` (đợt phân công cơ sở/lớp/chức danh, hiệu lực) · `roster.publish{campusId,fromDay,toDay,entries:[{employeeId,dayKey,shiftId}]}` (kiểm tra chồng ca/thiếu GV) · `punch.record{kind:'in'|'out',deviceTime,location?:{lat,lng,accuracy},source:'app'|'device'|'manual'}` (opId = mã thao tác, loại trùng; ghi `serverTime`, `result`: ok/outside_radius/no_location) · `punchAdjust.request{dayKey,kind,requestedTime,reason,evidencePaths?}` / `punchAdjust.decide{id,decision,note}` (tạo bản điều chỉnh liên kết, KHÔNG xóa lượt gốc) · `staffLeave.request{type,fromDay,toDay,reason,handoverTo?}` / `staffLeave.decide` (kiểm số dư phép, ca trùng, cảnh báo thiếu GV) · `shiftSwap.request/respond/decide` · `timesheet.build{campusId,periodKey}` (tính công theo ca, ca qua đêm thuộc ngày bắt đầu, thiếu lượt = `incomplete`, không tính đủ công) · `timesheet.lock{campusId,periodKey}` (snapshot) · `timesheet.reopen{campusId,periodKey,reason}` · `overtime.request/decide`.

**Lương** (`payroll.ts`): `salary.save`(thành phần lương) · `payroll.build{campusId,periodKey}` (từ timesheet đã khóa; công thức `base × paidDays / standardDays`, làm tròn đồng) · `payroll.submit` · `payroll.approve` · `payroll.publish` (tạo payslips; nhân viên chỉ xem của mình) · `payroll.recordPayment{runId,items}` (nhiều đợt; "đã duyệt ≠ đã phát hành ≠ đã trả").

**Học phí & thu tiền** (`finance.ts`)
`feePolicy.publish{id}` (tạo phiên bản mới, có `effectiveFrom`, không đổi khoản thu cũ) · `billing.preview{campusId,periodKey,childIds?}` (nháp, trả từng dòng + lỗi) · `billing.run{...}` (lưu nháp `billingRuns/{id}` + `receivables` ở trạng thái draft, chống trùng theo `rcv_` id) · `billing.approve{runId}` · `billing.publish{runId}` (phát hành + thông báo phụ huynh) · `payment.record{childId,amount,channel:'cash'|'bank_transfer'|'gateway',allocations?:[{receivableId,amount}],reference?}` (opId bắt buộc; phân bổ cũ trước, dư → `credits`) · `payment.submitProof{childId,amount,imagePath,note}` (phụ huynh → `pending_reconciliation`, KHÔNG ghi thu) · `payment.reconcile{paymentId|proofId, bankTxnId?}` · `bank.import{rows:[{source,txnCode,amount,at,content,account}]}` (khóa duy nhất `${source}_${txnCode}`; trùng bỏ qua) · `payment.cancel{paymentId,reason}` (chứng từ đảo) · `refund.request/approve/pay` · `receivable.adjust{receivableId,amount,reason}` (chứng từ điều chỉnh) · `expense.request/approve/pay` · `fund.reconcile`.
Công nợ: `balance = openingDebt + billed + adjustUp − discount − allocated` (không sửa trực tiếp số dư; mọi thay đổi qua giao dịch). Ví dụ chuẩn: nợ cũ 500.000 + phải thu mới 3.600.000 = 4.100.000; thu 2.000.000 (500.000 nợ cũ + 1.500.000 kỳ mới) → còn 2.100.000.
Trạng thái thanh toán receivable: `unpaid | pending_reconciliation | partially_paid | paid | overdue(tính từ dueDate) | cancelled`.

**Bếp / kho / vận hành** (`ops.ts`)
`menu.submit/approve/publish` (kiểm tra dị ứng → cảnh báo trẻ không ăn được) · `meal.lock{campusId,dayKey}` (chốt suất: expected/locked/served/billable lưu riêng) · `meal.recordServed` · `stock.receive{itemId,lot,expiry,qty,unitCost,supplier}` · `stock.issue{...}` (FEFO, không âm kho) · `stock.stocktake` / `stock.approveVariance` · `stock.transfer.send/receive` · `asset.transition{assetId,to,assigneeUid?,note}` · `trip.start/board/alight/handover/endCheck` (đối chiếu số trẻ).

**Thông báo & trao đổi** (`comms.ts`)
`notification.save` (draft) · `notification.submit` · `notification.approve` · `notification.send{id,scope:{type:'org'|'campus'|'class'|'users',ids},at?,requireAck}` (resolve người nhận phía server, ghi `notificationReceipts`; push FCM không chứa nội dung sức khỏe/công nợ chi tiết) · `notification.markRead/ack` (người nhận) · `thread.open{childId?,classId?,subject,priority}` · `thread.post{threadId,text,attachmentPaths?}` · `thread.assign{threadId,uid,dueAt}` · `thread.close`.

**Phê duyệt tập trung** (`approvals.ts`): mọi yêu cầu cần duyệt tạo doc `approvals/{id}` `{type, refCollection, refId, campusId, requestedBy, status:'pending'|'approved'|'rejected'|'cancelled', summary, impact, requiredPerm}` → `approval.list{campusId?, status?='pending'|'approved'|'rejected'|'cancelled'|'all', type?, limit?=100 (tối đa 200)}` (scope org) trả `{items,truncated}` đã lọc phía máy chủ: người lập, platformAdmin, hoặc có `approvals.read` VÀ `requiredPerm` của yêu cầu tại campus đó (client KHÔNG query trực tiếp collection `approvals` vì rules không chứng minh được requiredPerm cho truy vấn list) → `approval.decide{id,decision,note}` gọi handler tương ứng theo `type` (không có modal chung: mỗi type có handler riêng). Loại: `attendance_correction, punch_adjust, staff_leave, shift_swap, overtime, transfer, enrollment_exception, refund, receivable_adjust, payment_cancel, expense, billing_run, payroll_run, timesheet_reopen, notification, stock_variance, menu`.

**Báo cáo/xuất/nhập/sao lưu** (`reports.ts`, `admin.ts`): `report.get{type:'overview'|'enrollment'|'attendance'|'handover'|'tuition'|'cashflow'|'hr'|'ops', campusId?,from,to,classId?}` → `{metrics, rows, definitions}` (mở dữ liệu cấu thành) · `export.csv{report,filters}` (ghi audit "export") · `import.validate{kind:'children'|'staff'|'guardians',rows}` → lỗi từng dòng · `import.commit{jobId}` · `backup.record` / `backup.verify` (ghi nhận lịch/kết quả; sao lưu thực = Firestore scheduled export, xem backend/README) · `dashboard.chain` · `dashboard.campus{campusId}`.

**Nhật ký thao tác**: mỗi action ghi `orgs/{orgId}/auditLogs/{id}`: `{at, actorUid, actorName, campusId, action, collection, docId, before, after, reason, result:'ok'|'denied'|'error', requestId}`. Người thường không đọc/sửa (cần `audit.read`; client không ghi). Xuất hồ sơ/ truy cập nhạy cảm (`export.csv`, đọc sức khỏe qua API) cũng ghi.

## 5. Firestore: bảng collection dưới `orgs/{orgId}`

| Collection | Ai đọc (rules) | Ghi |
|---|---|---|
| members, roles, invites | `members.read` (bản thân luôn đọc member của mình) | server |
| campuses | mọi member của org (staff theo campus perm `campus.read`; parent theo child campus) | server |
| academicYears, calendarExceptions, categories, classes | `classes.read`/`campus.read` ở cơ sở; parent đọc lớp con mình | server |
| children | `children.read` ở cơ sở; parent: `id ∈ childIds` | server |
| childHealth (sub-doc `children/{id}/private/health`) | `children.health.read`/`medication.read`; parent của trẻ | server |
| guardianLinks, pickupAuthorizations | `children.read`; parent đọc của con mình | server |
| enrollments, assignments, transfers | `children.read` / `classes.read` | server |
| leads | `leads.read` | server |
| attendance, handovers, attendanceCorrections | `attendance.read`; parent của trẻ | server |
| leaveRequests | `attendance.read`; parent (của con) | server |
| dailyLogs | `care.read` (nháp) ; parent chỉ khi `status=='published'` | server |
| healthRecords, medicationRequests, medicationAdmins | `medication.read`/`children.health.read`; parent của con | server |
| incidents | `incident.read` (KHÔNG parent trừ khi `shareWithParent`) | server |
| employees, contracts, shifts, rosters | `staff.read`; nhân viên đọc của mình (`employeeId`) | server |
| punches, timesheets, punchAdjustments, staffLeaves, shiftSwaps | `timekeeping.read`; nhân viên chỉ của mình | server |
| payrollRuns | `payroll.read`; payslips: `payroll.read` hoặc `employeeUid==uid` | server |
| feePolicies | `fees.read` ; parent đọc bản published áp dụng cơ sở | server |
| billingRuns, receivables, payments, allocations, credits, refunds | `payments.read`; parent đọc receivables/payments của con mình nếu `guardianLinks.perms.viewFees` | server |
| expenses | `expenses.read` | server |
| menus | `kitchen.read`; parent đọc `status=='published'` | server |
| mealOrders, stockItems, stockLots, stockMovements | `kitchen.read`/`stock.read` | server |
| assets, assetRequests, routes, trips | `assets.read`/`transport.read`; parent đọc trips của con (trạng thái) | server |
| notifications | `notify.read`; người nhận qua `notificationReceipts` | server |
| notificationReceipts/{notifId_uid} | chính người nhận | server (người nhận được gọi action đánh dấu đọc) |
| threads, threads/*/messages | `inbox.handle` hoặc thành viên thread (parent mở thread cho con mình) | server |
| approvals | `approvals.read` + `requiredPerm` ở cơ sở; người yêu cầu đọc của mình | server |
| auditLogs | `audit.read` | server |
| ops, importJobs, backups | `import.write`/`backup.manage` | server |

Storage (`orgs/{orgId}/campuses/{campusId}/...`): ảnh trẻ/nhật ký/chứng từ/biên nhận. Không công khai; client upload qua đường dẫn rules cho phép theo vai trò, đọc bằng `getDownloadURL` (token) chỉ cho người có quyền (rules đọc theo membership). Tên file lưu path trong doc, không lưu URL công khai dài hạn.

## 6. FCM
Token ở `users/{uid}/devices/{deviceId}`. Function gửi push theo `notification.send` và theo sự kiện (nhận trẻ, trả trẻ, thuốc, học phí). Payload push **không** chứa nội dung sức khỏe hoặc số tiền chi tiết; chỉ "Có cập nhật mới từ nhà trường".

## 7. Web (Next.js) — `web/`
App Router + TypeScript, Firebase JS SDK (Auth, Firestore, Functions, Storage), `NEXT_PUBLIC_FIREBASE_*` từ `.env.local` (đã tạo, lấy từ `config web.txt`). Design tokens từ `MamNon_App_Design_System/tokens.json` (màu brand #168579, action #11776D...; light mode). 48 màn W01–W48 theo `Luong_web_quan_tri_mam_non.md` §14 (mã ↔ route trong `web/src/lib/screens.ts`). Menu ẩn mục không có quyền; truy cập trực tiếp bị chặn bằng guard. Mọi danh sách có đủ trạng thái Đang tải / Có dữ liệu / Trống / Không có kết quả lọc / Lỗi + Thử lại. Biểu mẫu: validate trường, trùng mã, khoảng ngày, số tiền; lưu lỗi giữ dữ liệu; nút busy chặn gửi trùng; xung đột version → tải lại/đối chiếu. Thao tác phát hành, khóa kỳ, thu tiền, hoàn, chuyển cơ sở, thu hồi quyền: **hộp thoại xem tác động** trước khi xác nhận.

## 8. Mobile (Flutter) — `mobile/`
1 app, 3 shell theo vai trò (đổi vai trò/cơ sở trong app; xóa cache ngữ cảnh khi đổi). Cấu trúc như muvik: `lib/{configs,values,models,controller,repository,services,utils,presentation,xml_strings}`, GetX, `asc_common` (path `../../asc_common`... xem mobile README), 4 flavor `alpha|dev|product|claude`, `applicationId com.asc.app_montessori`. Tokens từ design system. Bottom nav: Phụ huynh (Trang chủ, Nhật ký, Học phí, Tiện ích, Cá nhân); Giáo viên (Trang chủ, Lớp học, Nhật ký, Công cá nhân, Tiện ích); Hiệu trưởng (Tổng quan, Quản lý, Nhân sự, Phê duyệt, Cá nhân). Không báo thành công khi mới lưu cục bộ; thao tác chờ gửi hiển thị "Chưa đồng bộ".

## 9. Nhãn trạng thái (VN)
attendance: present "Có mặt", absent_excused "Nghỉ có phép", absent_unexcused "Nghỉ không phép", no_class "Ngày không học", unconfirmed "Chưa xác nhận". handover: not_received "Chưa nhận", received "Đã nhận", picked_up "Đã trả". payment: unpaid "Chưa thanh toán", pending_reconciliation "Chờ đối soát", partially_paid "Đã thanh toán một phần", paid "Đã thanh toán", overdue "Quá hạn", cancelled "Đã hủy". approval: pending "Chờ duyệt", approved "Đã duyệt", rejected "Từ chối". campus: preparing "Chuẩn bị", active "Đang hoạt động", paused "Tạm ngừng", closed "Đã đóng".

## 10. Dữ liệu mẫu (seed)
Org "Hệ thống Mầm non Hoa Sen"; cơ sở `CG` "Trường Mầm non Cầu Giấy" (+ `TX` Thanh Xuân); lớp Mầm 1 (Cầu Giấy), Chồi 2; trẻ MN001 Nguyễn Minh An (12/05/2023), Nguyễn Gia Bình; mẹ Nguyễn Thùy Linh, bố Nguyễn Văn Nam; cô Lan (GV), cô Hương (hiệu trưởng CG), kế toán Minh; học phí 3.000.000, ăn 35.000/suất, đón muộn 200.000, giảm 300.000, nợ cũ 500.000. Seed script: `backend/scripts/seed.ts` (emulator hoặc live).
