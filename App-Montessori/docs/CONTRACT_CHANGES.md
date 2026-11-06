# CONTRACT_CHANGES

Đề xuất/ghi chú thay đổi hợp đồng phát sinh từ phía mobile (nền tảng app). Chưa sửa `CONTRACT.md`; backend/web cần xác nhận.

## 1. Hình dạng phản hồi `org.listMine` (CONTRACT §4 chỉ ghi "trả orgs + vai trò + cơ sở")

Mobile đọc `data.orgs[]` với mỗi phần tử (tolerant, thiếu trường dùng mặc định):

```jsonc
{
  "orgs": [{
    "orgId": "o1",                 // hoặc "id"
    "name": "Hệ thống Mầm non Hoa Sen",   // hoặc "orgName"
    "timezone": "Asia/Ho_Chi_Minh",
    "member": {                    // có thể phẳng ngay trong phần tử
      "kind": "owner|staff|parent",
      "status": "active",
      "grants": [ { "id", "roleId", "campusIds": ["cg"|"*"], "classIds": [], "validFrom", "validTo", "extraPerms", "deniedPerms" } ],
      "childIds": ["c1"],
      "permsByCampus": { "cg": ["attendance.read", "..."], "*": [] },
      "employeeId": "e1"
    },
    "campuses": [ { "campusId": "cg", "code": "CG", "name": "Trường Mầm non Cầu Giấy", "timezone": "Asia/Ho_Chi_Minh", "status": "active" } ],
    "children": [ { "childId": "c1", "fullName": "Nguyễn Minh An", "campusId": "cg", "classId": "k1", "className": "Lớp Mầm 1" } ]   // chỉ phụ huynh
  }]
}
```

Đề nghị backend: (a) trả đúng dạng trên; (b) `campuses` gồm mọi cơ sở user được phép trong org (staff theo grant, parent theo cơ sở của con);
(c) `children` có tên + lớp + cơ sở để mobile dựng bộ chọn bé không cần đọc thêm Firestore; (d) chỉ trả member `status == 'active'` (mobile vẫn lọc).

## 2. `invite.claimPending`

Mobile gọi không `orgId`, payload rỗng, ngay sau đăng nhập và trước `org.listMine`. Lỗi (không phải mạng) bị bỏ qua. Không dùng giá trị trả về.

## 3. Ánh xạ `roleId` -> vai trò app (mobile tự quyết, cần backend/web thống nhất)

| roleId | Shell mobile |
|---|---|
| owner, principal, hr, accountant, tech_admin | Hiệu trưởng (quản lý) |
| teacher, nurse, kitchen, transport | Giáo viên (nhân sự) |
| member.kind = parent | Phụ huynh |

Nếu cần shell riêng cho kế toán/nhân sự/y tế, đề xuất thêm trường `appRole` vào `Grant` hoặc vào kết quả `org.listMine`.

## 4. Danh sách action được xếp hàng offline (CONTRACT §8: "thao tác chờ gửi")

Mobile chỉ xếp hàng `handover.receive`, `punch.record`, `attendance.mark`, luôn kèm `opId`. Backend cần đảm bảo idempotent theo `opId`
và chấp nhận `deviceTime`/`at` cũ hơn (không lệch quá ngưỡng cho `punch.record`; `punch.record` ghi `serverTime` và `result`).

## 5. Không thay đổi

Không đổi tên action, mã lỗi, collection hay quyền. `mobile/lib/values/permissions.dart` có test đối chiếu `ALL_PERMISSIONS` với `permissions.ts`.

---

# BE-1 (org / entity / children / attendance / care / comms / approvals / rules / seed) — ghi chú lệch & bổ sung hợp đồng

Web/mobile đọc phần này. Không có action nào bị đổi tên; chỉ làm rõ hình dạng payload và bổ sung trường.

## B1. `org.listMine` — ĐÃ theo đề xuất mục 1 ở trên
Trả `{ uid, platformAdmin, orgs:[{ orgId, id, name, orgName, status, plan, timezone, member:{kind,status,displayName,grants,childIds,permsByCampus,employeeId}, kind, memberStatus, roles[], grants, permsByCampus, childIds, employeeId, campuses:[{id, campusId, code, name, status, timezone}], children:[{childId, fullName, code, campusId, classId, className, status}] }] }`. Chỉ trả member `status=='active'`. Staff: cơ sở theo `permsByCampus` (có `campus.read`); parent: cơ sở của các con. Dạng lồng `member` và dạng phẳng cùng tồn tại.

## B2. Opid bắt buộc (router trả VALIDATION nếu thiếu `opId`)
`lead.enroll`, `transfer.request`, `attendance.mark`, `handover.receive`, `handover.pickup`. (`org.create`/`invite.claimPending` scope `none`: không có bộ nhớ opId.) Mobile offline: `attendance.mark`/`handover.receive` an toàn khi gửi lại. `handover.receive/pickup` nhận `at` (ISO) chỉ khi nằm trong [-18h, +5m] so với giờ máy chủ, ngoài khoảng thì dùng giờ máy chủ (luôn ghi `recordedAt` = giờ máy chủ). `attendance.mark` không nhận `dayKey` ở tương lai.

## B3. Hình dạng payload (làm rõ)
- `child.save` — PHẲNG: `{id?, campusId (khi tạo), code?, fullName, dob, gender, nickname, address, photoConsent, avatarPath, notes, missingDocuments[], health?:{allergies[],conditions[],dietNote,bloodType,doctor,hospital,emergencyContact,notes} (cần `children.health.read`), confirmDuplicate?, expectedVersion?}` (cũng chấp nhận lồng `{child:{...}}`). Không đổi `code`/`campusId`/lớp ở đây (dùng `lead.enroll`, `transfer.request`). Trùng họ tên + ngày sinh → `CONFLICT` (`details.duplicates`) trừ khi `confirmDuplicate:true`. Mã trẻ tự sinh `MN001…` (đếm theo org), trùng mã → `VALIDATION` `fieldErrors.code`.
- `lead.enroll{leadId?, child:{id?|fullName,dob,...,health?}, classId, startDate, feePlanId?, guardians:[{name,phone,email?,relation,perms:{notify,viewFees,pickup}}], requestException?, exceptionReason?, confirmDuplicate?}` → `{status:'enrolled', childId, code, enrollmentId, guardians:[{id,status,inviteCode,warning}], warnings[]}` hoặc `{status:'pending_approval', approvalId}`. `child.id` cho phép nhập học trẻ đã tạo bằng `child.save`.
- `lead.save`: `{id?, campusId, childName, childDob?, parentName, phone, email?, source?, interestedClassId?, note?, tourAt?, consultNote?, documents[]}` → trả thêm `duplicates` (khách trùng SĐT cùng cơ sở, không chặn).
- `child.setStatus` thôi học (`withdrawn|archived`) kết thúc enrollment đang hiệu lực, gỡ `classId`; trả `outstandingReceivables`. Áp dụng NGAY (ngày hiệu lực lưu ở lịch sử `childStatusHistory` và `statusEffectiveDate`).
- `child.unlinkGuardian{childId, linkId, reason}`; `child.linkGuardian` trả `{id(linkId), status:'linked'|'invited', uid, inviteCode, perms, warning}`. `linkId = {childId}_{sha1(phone|e:email)[:20]}` (xác định).
- `assignment.save{id?, classId, uid, role:'main'|'assistant'|'substitute', validFrom, validTo?, note, cancel?, reason?}`; `validFrom/To` ISO hoặc dayKey; trùng thời gian → `CONFLICT` `details.conflicts`. Người được phân công phải có `attendance.write` tại cơ sở.
- `transfer.request{childId, toClassId (BẮT BUỘC), toCampusId?, effectiveDate, debtHandling:'stay'|'move', depositHandling:'stay'|'move'|'refund', reason}` → `{id, status:'pending', sides:{[campusId]:{status,approvalId}}, impact}`; chuyển khác cơ sở tạo 2 phiếu duyệt (cơ sở đi + cơ sở đến, quyền `children.transfer` ở từng cơ sở). `transfer.decide{id, decision, note, campusId?}` (không truyền `campusId` → tự chọn bên mình có quyền). Hoàn tất khi mọi bên duyệt; KHÔNG áp dụng theo ngày tương lai — thay đổi lớp/cơ sở của trẻ có hiệu lực ngay khi duyệt xong, các enrollment mang `startDate/endDate = effectiveDate`.
- `attendance.mark` trả `{saved:[{childId,id,status,created}], rejected:[{childId,reason}]}`; trẻ không thuộc lớp trong ngày → `rejected`. `attendance.close{classId,dayKey,allowUnconfirmed?}`: còn trẻ chưa điểm danh → `PRECONDITION` kèm `missingChildIds`, hoặc `allowUnconfirmed:true` để ghi `status:'unconfirmed'`. Doc `attendanceClosures/{classId}_{dayKey}` đánh dấu đã chốt.
- `attendance.requestCorrection{attendanceId,newValue:{status?,arrivedAt?,note?,healthNote?},reason}` → `{id, approvalId}`; `attendance.decideCorrection{id,decision,note}` (id = id yêu cầu sửa). Người duyệt cần `classes.write` (hiệu trưởng/chủ chuỗi), không tự duyệt.
- `handover.pickup{childId,dayKey,pickupPersonId,verification:{method,note}}`: `pickupPersonId` = id doc `pickupAuthorizations` (người giám hộ có quyền `pickup` tự có doc `pa_{linkId}` loại `guardian`; cũng chấp nhận truyền `linkId`). Chặn bằng `PRECONDITION` + `details.reason` ∈ `not_received | already_picked_up | authorization_not_found | authorization_wrong_child | authorization_pending | authorization_rejected | authorization_revoked | authorization_expired | authorization_not_started`. `verification.method` ∈ `id_check|qr|otp|phone_call`; `qr/otp` ghi `supportOnly:true` (không thay thế kiểm tra ủy quyền).
- `handover.receive` đồng thời ghi điểm danh `present` (nếu chưa chốt & chưa có hoặc đang vắng) và trả `alreadyReceived:true` khi người thứ hai nhận cùng bé.
- `pickupAuth.save{id?, childId, personName, relation, phone?, idNumberLast4?, idType?, validFrom?, validTo (bắt buộc), validFromTime?, validToTime?, note?}`: phụ huynh (cần `childPerms[childId].pickup`) tạo → `pending`; nhân viên `children.write` tạo → `approved`. `pickupAuth.decide{id,decision,note}` / `pickupAuth.revoke{id,reason}` (phụ huynh của bé cũng thu hồi được; ủy quyền loại `guardian` thu hồi qua `child.unlinkGuardian`).
- `leave.submit{childId,fromDay,toDay,session,reasonId,reasonText?,note}` → doc có `submittedAt` (giờ máy chủ). `leave.decide` ghi `mealCancelled` + `mealCancelledDays[]`: một ngày nghỉ được hủy suất ăn nếu ngày đó sau ngày gửi, hoặc cùng ngày gửi và giờ GỬI (`submittedAt`) ≤ `campus.mealCutoff` (mặc định 08:30). Ghi `affectsAttendance:false`.
- `dailyLog.save{childId,dayKey,meals,sleep,hygiene,mood,activities,note,photoPaths}`: doc id `{childId}_{dayKey}`; ảnh phải nằm dưới `orgs/{orgId}/campuses/{campusId}/` và bé phải có `photoConsent:true`. `dailyLog.publish` cần `care.publish` (hiệu trưởng/chủ chuỗi; giáo viên chỉ tạo nháp).
- `medication.request{childId,medicineName,dose,times[HH:mm],fromDay,toDay,instructions,reason?,storage?,photoPath?}` — thiếu tên/liều/giờ/hướng dẫn → `VALIDATION`. `medication.administer` bắt buộc `dose` + `result ∈ given|partial|refused|vomited|missed`.
- `incident.save`: `restricted` mặc định `true` + `viewerUids[]` (người xem được ngoài người có `children.write`); `shareWithParent` chỉ người có `children.write` được bật.
- `notification.save{id?,campusId?,title,body,category,attachmentPaths,requireAck,scope:{type,ids},scheduledAt?}`; `notification.submit` (tự duyệt nếu người gửi có `notify.approve`, nếu không tạo approval `notification`); `notification.approve{id,decision?,note?}`; `notification.send{id,scope?,at?,requireAck?}` — lên lịch (`status:'scheduled'`, cần job gọi `dispatchDueNotifications()` trong `modules/comms.ts` — BE-2 `triggers.ts`). Receipts: `notificationReceipts/{notifId}_{uid}` có `readAt`, `ackAt`, `requireAck`. `markRead/ack` nhận `{id}`.
- `thread.open{childId|classId,subject,priority,text?}`; `thread.assign{threadId,uid,dueAt?,priority?}`; `thread.close{threadId,resolution}`.
- `campus.create` trả `{campus:{id,...}, copied, principalInvite}`; `campusId = code viết hoa`. `campus.setStatus`/`setupProgress`/`invite.revoke`/`member.*` scope `org` (campusId nằm trong payload).
- `role.save{id?,key?,name,perms,description?}`; vai trò tùy biến id dạng `role_xxx`; chỉ đưa vào quyền mà chính người lưu đang có.
- `member.invite` giữ chặn leo thang: người mời chỉ cấp được quyền mà mình có ở đúng phạm vi; không cấp `owner`.

## B4. Dữ liệu bổ sung
- `members/{uid}` thêm `permsAny: string[]` (hợp quyền mọi cơ sở — rules dùng cho members/roles/invites/backups) và `childPerms: {[childId]: {notify, viewFees, pickup}}` (parent).
- Collection mới do BE-1 ghi: `childCodes`, `counters/childCode`, `childStatusHistory`, `attendanceClosures`, `attendanceCorrections`, `transfers` (`sides`), `depositMovements`, `healthRecords`, `medicationAdmins`, `guardianLinks` (id xác định), `enrollments`, `assignments`.
- `registerEntity.uniqueBy` được hiểu là TỔ HỢP các field (vd categories: `['type','code']`), kiểm tra trong cùng `campusId`.
- Categories/classes/academicYears/calendarExceptions là cấp cơ sở (`campusId` bắt buộc).

## B5. Phân quyền theo lớp
`ctx.allowedClassIds()` (core) trả `null` (không hạn chế) khi grant giáo viên KHÔNG có `classIds`, trong khi CONTRACT §3 nói "nếu rỗng thì theo assignments đang hiệu lực". Không sửa core; BE-1 dùng `classScope(ctx, campusId)` trong `modules/util.ts` (grant `classIds` ∪ assignments hiệu lực). BE-2 nên dùng cùng hàm nếu cần hạn chế theo lớp.

## B6. Rules / Storage
- Rules đọc `members/{uid}.permsByCampus` đã lưu (không tính lại): grant hết hạn chỉ mất hiệu lực ở rules sau khi job `expireGrants` (triggers) tính lại; mọi ghi qua API vẫn chặn đúng lúc (router tính lại mỗi request).
- Phụ huynh đọc được `classes, academicYears, calendarExceptions, categories` toàn org (không có dữ liệu cá nhân) vì rules không ánh xạ child→class; `feePolicies/menus` chỉ bản `published`.
- Query phía client PHẢI kèm `where('campusId','==',…)` (nhân viên) hoặc `childId`/`uid` (phụ huynh) mới qua rules.
- `users/{uid}` client chỉ được ghi các field `uid, displayName, email, phone, photoUrl, locale, createdAt, updatedAt` (không dùng email/phone ở đây để xác thực — `invite.claimPending` dùng Auth).
- Đường dẫn Storage (xem `backend/storage.rules`): `children/{childId}/…`, `dailyLogs/{dayKey}/{childId}/…`, `parent/{uid}/…` (biên nhận, ảnh đơn thuốc), `payments|expenses|staff|notifications|menus|assets/…`, `staffSelf/{uid}/…`, `messages/{threadId}/…`.

## B7. Chưa làm / hạn chế đã biết
- Chuyển lớp/cơ sở không có "áp dụng theo lịch" cho ngày hiệu lực tương lai (áp dụng ngay khi đủ duyệt).
- Một số điện thoại/email thuộc tài khoản nhân viên (member.kind staff) không thể được liên kết làm phụ huynh cùng org (cần tài khoản riêng); API trả `warning`.
- `member.setStatus` thu hồi refresh token toàn cục của uid (đăng nhập lại ở mọi org).

## BE-2 (hr, payroll, finance, ops, reports, admin, triggers)

Không sửa core/. Lệch / bổ sung so với CONTRACT:
- Mọi action BE-2 dùng `scope:'org'`; `campusId` lấy từ `payload.campusId` (hoặc `campusId` ngoài) và kiểm quyền theo cơ sở (không bắt buộc scope 'campus').
- Collection mới cần rules (BE-1): `staffAssignments`, `rosterEntries`, `punchAdjustments`, `overtimeRequests`, `shiftSwaps`, `timesheetDays` (nhân viên đọc dòng có employeeId của mình), `timesheetAdjustments`, `timesheets/{id}/snapshots`; `salaries` + `employees/{id}/private/bank` (chỉ payroll.read); `payrollRuns/{id}/items|payments`, `payslips` (employeeUid==uid); `receivableAdjustments`, `allocations`, `credits`, `bankTransactions`, `cashLedger`, `fundReconciliations`; `mealLocks`, `stocktakes`, `stockTransfers` (đọc cả bên nhận: toCampusId), `stockLots`, `stockMovements`, `trips/{id}/riders|events`, `assets/{id}/history`, `alerts` (đọc theo recipientPerm/campus), `importJobs`, `backups`.
- Trạng thái receivable: `draft|unpaid|partially_paid|paid|overdue|cancelled` + cờ `isOverdue` và `pendingReconciliation` (thay cho trạng thái pending_reconciliation ở cấp khoản; trạng thái đó nằm ở `payments.status`). Khoản kỳ = 1 receivable `rcv_${childId}_${periodKey}_monthly` chứa `lines`; nợ cũ là các khoản kỳ trước (không cộng vào khoản mới).
- Hoàn tiền chỉ từ số dư có (`credits`); giảm khoản đã thu qua `receivable.adjust` sinh credit.
- `payments` có `type: receipt|reversal|refund|proof`; sổ quỹ `cashLedger` là nguồn cho báo cáo dòng tiền.
- Action thêm ngoài contract: không có (meal.recordServed kiêm sửa billable sau chốt kèm lý do).
- Giả định dữ liệu BE-1: children{fullName,code,classId,status,enrolledAt}, leaveRequests{mealCancelledDays}, handovers{state,pickedUpAt}, campus{mealCutoff,closeTime,geofence{lat,lng,radiusM},expenseLimit}, health{allergies}.
- Composite index cần (campusId + dayKey range): rosterEntries, punches, punchAdjustments, overtimeRequests, mealOrders, handovers, attendance, cashLedger, trips; (employeeId + dayKey): rosterEntries, punches; collection group `notifications` (status, scheduledAt).

## Nhóm C (W29–W35, W41–W47) — điểm lệch / đề nghị
8. `approvals` (W47): rules đọc cần `requiredPerm` trong doc nên truy vấn liệt kê theo `campusId` có thể bị `permission-denied`. Web đang truy vấn `campusId ==|in` rồi hiện trạng thái lỗi + Thử lại. Đề nghị thêm action `approval.list` hoặc rules phù hợp.
9. `receivableAdjustments` không có rule đọc: W35 chỉ tạo qua `receivable.adjust`, duyệt ở W47; không liệt kê được chứng từ điều chỉnh.
10. Thông báo (W42): chưa có action xem trước người nhận. Web lưu nháp -> `notification.submit` (trả `recipientPreview`) rồi hiển thị số người nhận trong dialog gửi/duyệt.
11. Báo cáo kỳ khóa (W44): `report.get` tính lại theo dữ liệu hiện tại, chưa lưu phiên bản bản chốt. Web chỉ so sánh các lần tạo trong phiên. Bộ lọc "năm học" chưa có tham số ở `report.get` (chỉ from/to/classId).
12. W33: `payment.record` không có chế độ xem trước; web mô phỏng phân bổ (nợ cũ trước) chỉ để hiển thị tác động, kết quả thật lấy từ máy chủ.
13. W46: `backups` không có `campusId`; đọc bằng truy vấn không ràng buộc cơ sở (rules `canAny backup.manage`).

## Nhóm B (W21–W28, W36–W40) — đọc Firestore trực tiếp, cần backend bổ sung rules/index

8. Firestore rules CHƯA có (rơi vào `/{other=**}` = từ chối) cho các collection web đọc: `staffAssignments`, `rosterEntries`, `timesheetDays`, `timesheets/{id}/snapshots`, `overtimeRequests` (rules đang ghi `overtimes`), `salaries`, `employees/{id}/private/bank` (cần `payroll.read`), `payrollRuns/{id}/items` và `payrollRuns/{id}/payments` (rules hiện chỉ có `payrollRuns/*/payslips`), `cashLedger`, `fundReconciliations`, `mealLocks`, `stocktakes`, `stockTransfers` (đọc theo `campusId` và `toCampusId`), `trips/{id}/riders`, `assets/{id}/history`, `timesheetAdjustments`. Khi thiếu, màn hiện trạng thái lỗi + Thử lại (không bịa dữ liệu).
9. Chỉ mục composite cần: `rosterEntries(campusId, dayKey)`, `mealOrders(campusId, dayKey)`, `cashLedger(campusId, dayKey)`, `trips(campusId, dayKey)`, `stockMovements(campusId, at desc)`, `contracts(campusId, employeeId)`, `staffAssignments(campusId, employeeId)`.
10. W21/W22 chỉ liệt kê nhân viên có cơ sở chính = cơ sở đang chọn (rules đọc `employees` theo `campusId`). Nhân viên được phân công sang cơ sở khác chưa hiện ở cơ sở nhận; đề nghị action `employee.list{campusId}` hoặc rules theo `campusIds`.
11. `entity.save{collection:'shifts'}` dùng để tạo ca (W23); `roster.publish` không có chế độ chạy thử: web chỉ kiểm tra chồng ca phía client, thiếu giáo viên do server trả `TEACHER_SHORTAGE` rồi xác nhận bằng `acknowledgeShortage:true`.

## Nhóm A (W05, W08–W20, W48) — ghi chú lệch/giả định

8. W05: `academicYears` yêu cầu `classes.write` (entity.ts) trong khi route W05 chỉ yêu cầu `campus.manage`; web chỉ hiện nút sửa năm học khi có cả hai quyền. Giờ vận hành/khung đón trả lưu bằng `campus.update` (workingDays, pickupFrom/To, dropoffFrom/To, mealCutoff); ngoại lệ lưu riêng `calendarExceptions`.
9. Web đọc Firestore luôn có `where('campusId','==',…)` (rules). W20: người không có `children.write` đọc `incidents` bằng hai truy vấn (`restricted==false` và `viewerUids array-contains uid`) vì rules; cần xác nhận truy vấn `array-contains` được rules chấp nhận.
10. W13: cơ sở đích khác cơ sở hiện tại đọc `classes` của cơ sở đó (cần `classes.read` ở đó) và dùng `enrolledCount` do máy chủ đồng bộ làm sĩ số.
11. Giờ trong phân công giáo viên/hẹn tham quan/sự cố gửi ISO múi giờ cố định `+07:00` (như mục 6).

---

# Mobile hiệu trưởng (principal) — ghi chú dùng action/dữ liệu

- Dùng `dashboard.campus` (+ `alerts`, `pendingApprovals`), `report.get` (`handover`, `attendance`, `hr`, `tuition`, `enrollment` kèm `rows`/`definitions` để mở dữ liệu cấu thành) và `approval.decide{id,decision,note}` (opId sinh một lần cho mỗi ý định).
- Danh sách chờ duyệt đọc trực tiếp `approvals` (campusId + status=='pending'), lọc phía app theo `requiredPerm` tại cơ sở; panel chi tiết đọc `impact`/`payload` theo từng `type` (hình dạng lấy từ code `createApproval` ở backend). Đề nghị backend thêm `impact.before/after` có cấu trúc cho `shift_swap` (hiện app tách tên từ `summary`) và tên lớp (`fromClassName/toClassName`) cho `transfer`.
- Giờ đóng cửa cơ sở (`campus.closeTime`) chưa có trong `org.listMine`; app dùng mặc định 17:30 để cảnh báo "trẻ còn ở trường" nếu chưa có alert `still_*` từ máy chủ. Đề nghị trả `closeTime` trong `campuses[]`.
- Màn Nhân sự đọc `employees`, `rosterEntries`, `punches`, `staffLeaves(status=pending)`, `shiftSwaps(status=awaiting_manager)` theo `campusId` + `dayKey`; cần rules cho phép đọc với `timekeeping.read`.

---

# MOBILE-T (giáo viên / nhân viên T01–T07) — lệch & đề xuất

1. **Rules thiếu cho nhân viên đọc dữ liệu của mình**: `rosterEntries` (ca làm) và `timesheetDays` (bảng công ngày) không có `match` trong `firestore.rules` nên client bị từ chối. Mobile: ca hôm nay đọc `rosterEntries` (`employeeId == me`) và nếu bị `permission-denied` thì chỉ hiện "Chưa có ca để hiển thị"; bảng công cá nhân dựng từ `punches` GỐC (`employeeId == me`), ngày thiếu lượt vào/ra hiện "Chưa đủ dữ liệu", không hiện "đủ công". Đề xuất: cho phép đọc `rosterEntries`/`timesheetDays` khi `employeeId == member.employeeId` (hoặc `actualEmployeeId`).
2. **Danh bạ đồng nghiệp** cho `shiftSwap.request{toEmployeeId}`: giáo viên không có `staff.read` nên không liệt kê được `employees`; mobile cho nhập mã nhân viên. Đề xuất: trả danh sách đồng nghiệp cùng cơ sở/ca qua một action hoặc cho đọc `employees` rút gọn.
3. **`dailyLog.publish` cần `care.publish`** (giáo viên không có): mobile chỉ lưu nháp, nút "Công bố" hiện khi có quyền; giáo viên thấy thông báo "quản lý công bố".
4. **`handover.pickup`**: mobile gửi `pickupPersonId` = id doc `pickupAuthorizations`; map `details.reason` sang chuỗi hướng dẫn; ONLINE ONLY.
5. **`punch.record`** nhận thêm `note` (lý do chấm thủ công khi mất định vị) và `location` khi có; luôn kèm `opId` (xếp hàng offline cùng opId). `campusId` gửi ở cấp request.
6. **Thông báo của nhân viên**: đọc `notificationReceipts` (`uid == me`) rồi `notifications/{id}`; mobile giả định receipt có trường `notifId` hoặc id dạng `{notifId}_{uid}`.
7. **Ảnh nhật ký** upload Storage tại `orgs/{orgId}/campuses/{campusId}/dailyLogs/{dayKey}/{childId}/{file}` và chỉ gửi PATH trong `photoPaths` (chỉ khi bé có `photoConsent`). Cần `storage.rules` cho phép giáo viên ghi đường dẫn này.


---

# MOBILE-PARENT (P01-P07) - gia dinh doc/ghi dung o app phu huynh

## M1. Cach doc (Firestore, query luon co childId / uid / participants)
- `handovers` va `attendance`: `childId == c && dayKey == hom nay` (trang thai o truong chi hien khi co doc; khong suy ra tu thieu du lieu).
- `dailyLogs`: `childId == c && status == 'published' && dayKey whereIn [14 ngay]` (chi dung dang bang nhau, khong can composite index). Hinh dang `meals/sleep/hygiene/mood` do giao vien ghi tu do: app doc kha dung `meals[].{session|meal|name, level|amount|ate|appetite|status|note}`, `sleep[].{from|start,to|end,quality|note|duration}`, `hygiene.{toilet,diaper,bath,handWash,note}`, `mood`. De nghi BE/teacher chot schema; truong la bi bo qua, khong bao gio hien gia tri mac dinh.
- `receivables` (bo `draft`/`cancelled` o client), `payments` (`type:'proof'`, `status:'pending_reconciliation'` hien "Cho doi soat"), `menus` (`status=='published' && dayKey`), `pickupAuthorizations`, `leaveRequests`, `medicationRequests`, `healthRecords`, `children/{id}` va `children/{id}/private/health` theo childId.
- `notificationReceipts where uid == me` (tieu de/ngay/readAt/ackAt/requireAck nam ngay tren receipt; noi dung doc `notifications/{id}` khi mo). `threads where participants array-contains me`, `threads/{id}/messages orderBy at`.
- De nghi (chua co): `campuses/{id}.bankAccount:{bankName, accountNo, accountName}` de hien thong tin chuyen khoan; thieu thi app hien "lien he van phong".

## M2. Cach ghi (callable `api`, luon co opId, khong qua OfflineQueue)
`leave.submit{childId,fromDay,toDay,session,reasonId('sick'|'family'|'travel'|'other'),reasonText?,note}`, `leave.cancel{id}`, `medication.request{...}`, `pickupAuth.save{childId,personName,relation,phone?,idNumberLast4?,validFrom,validTo,note?}`, `pickupAuth.revoke{id,reason}`, `payment.submitProof{childId,amount,imagePath,note?}` (anh upload truoc vao `orgs/{org}/campuses/{campus}/parent/{uid}/proofs/{opId}.jpg`, cung opId), `notification.markRead/ack{id}`, `thread.open{childId,subject,priority,text}`, `thread.post{threadId,text}`.
- "Dan do" (P03) = `thread.open` ve be; "Yeu cau cap nhat ho so" (P06) = `thread.open` voi chu de "Cap nhat ho so cua <be>" (chua co action sua ho so truc tiep cho phu huynh; truong xac minh roi cap nhat).
- `pickupAuth.save` bi tu choi voi `PERMISSION_DENIED` neu `childPerms[child].pickup != true`; app hien thong bao quyen.

---

# APPROVAL-LIST
- Them action `approval.list{campusId?, status?, type?, limit?}` (scope org): loc phia may chu theo `approvals.read` + `requiredPerm` tai campus cua yeu cau (hoac nguoi lap). Web W47 va mobile principal dung action nay thay cho doc Firestore truc tiep (rules khong doi, khong noi long).
