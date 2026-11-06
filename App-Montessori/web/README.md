# Web quản trị mầm non (Next.js App Router + TypeScript)

Nền tảng web quản trị cho hệ thống mầm non nhiều cơ sở (B2B). Hợp đồng dữ liệu/API: `../docs/CONTRACT.md`. Luồng và 48 màn W01–W48: `../Luong_web_quan_tri_mam_non.md`. Design system: `../MamNon_App_Design_System/`.

## Chạy

```bash
cd web
npm install
cp .env.example .env.local      # đã có sẵn .env.local cho project app-montessori-36ec6
npm run dev                     # http://localhost:3000
npm run build                   # build production (phải sạch)
npm run lint                    # ESLint (next lint)
npm run typecheck               # tsc --noEmit
```

Biến môi trường (`.env.local`, không commit):

| Biến | Ý nghĩa |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_STORAGE_BUCKET`, `_MESSAGING_SENDER_ID`, `_APP_ID`, `_MEASUREMENT_ID` | Firebase Web config (từ `config web.txt`) |
| `NEXT_PUBLIC_USE_EMULATORS` | `true` = nối Auth 9099 / Firestore 8080 / Functions 5001 / Storage 9199 |

## Cấu trúc

```
src/
  app/
    layout.tsx               Root: font hệ thống, Providers (Toast > Dirty > Auth)
    dang-nhap/page.tsx       W01 (ngoài khung ứng dụng)
    (app)/layout.tsx         Gate: chưa đăng nhập -> /dang-nhap; nạp ngữ cảnh; ScopeProvider + AppShell + ScreenGuard
    (app)/page.tsx           "/" -> trang đầu tiên được phép
    (app)/[...slug]/page.tsx Bộ định tuyến màn hình: khớp src/lib/screens.ts -> src/screens/registry.tsx (chưa có -> ComingSoon)
  components/ui/             Bộ component dùng lại (xem bên dưới) — import từ '@/components/ui'
  components/layout/         AppShell (sidebar + topbar), ScreenGuard (403/chọn cơ sở), nav (GuardedLink, hỏi bỏ thay đổi)
  providers/                 AuthProvider, ScopeProvider
  lib/                       firebase, api, permissions, format, status, screens, hooks/
  screens/                   Mỗi màn một file W##Ten.tsx + registry.tsx + ComingSoon.tsx
  styles/                    tokens.css (từ tokens.json), ui.css, shell.css, globals.css
```

Không dùng mã màu hex ngoài `styles/tokens.css`; dùng `var(--color-*)`, `var(--space-*)`, `var(--radius-*)`.

## API nội bộ chính

- `callApi<R>(action, { orgId, campusId, payload, opId })` → dữ liệu `data` của `api`; lỗi ném `ApiError { code, message, fieldErrors, details }`. `newOpId()` sinh UUID.
- `useAsyncAction((opId, ...args) => promise)` → `{ run, busy, error, reset }`: chống gửi trùng, opId ổn định cho một lần submit (đổi sau khi thành công).
- `useForm({ initial, validate })` → `values, errors, dirty, submitting, formError, bind(name), field(name), onSubmit(handler(values, opId)), reset(next?)`. Giữ dữ liệu khi lỗi, ánh xạ `fieldErrors` của server vào field, cuộn/focus tới lỗi đầu, đăng ký chặn rời trang khi dirty.
- `useFirestoreQuery(key, build, map?)` / `useDoc(...)` → `{ status: 'loading'|'ready'|'empty'|'error', data, error, retry }` (realtime). `key = null` = chưa chạy. Dùng `scope.scopeKey` hoặc `org.orgId` trong key để tải lại khi đổi phạm vi.
- `useApiQuery(key, action, () => ({orgId, campusId, payload}))` → trạng thái như trên cho dữ liệu đọc qua `api` (dashboard, report).
- `useScope()` → `org, campuses, campusId ('all' | id), campus, tz, years, yearId, roleId, perms, can(perm, campusId?), canAnywhere(perm), canOrg(perm), select*()`. `useAuth()` → `user, orgs, signIn, signOut, refresh()` (gọi `refresh()` sau khi tạo cơ sở/đổi quyền để cập nhật danh sách).
- `useToast()` → `success/error/info/warning` (chỉ `success` sau khi server xác nhận). `useDirtyGuard()` → `confirmDiscard()`.
- Component: Button (primary/secondary/tertiary/destructive/destructiveOutline; sm/md/lg; `loading`), LinkButton, IconButton, FormField + Input/Select/Textarea/DateInput/MoneyInput/Checkbox, Badge/StatusBadge (`domain` + `value` theo CONTRACT §9), Banner, Card, Avatar, Tabs, Pagination, DataTable, Modal/ConfirmDialog, Drawer, Stat/MetricCard, PageHeader, Breadcrumbs, EmptyState/ErrorState, Skeleton, Stepper.
- `format.ts`: `formatVnd(4100000)` = `4.100.000 đ`, `formatDate`, `formatTime`, `dayKey(date, tz)`, `parseDisplayDate`.

## Phân quyền và phạm vi

- `src/lib/screens.ts` là NGUỒN DUY NHẤT cho menu + guard: mã W##, đường dẫn, tiêu đề, nhóm menu, quyền cần (một trong), phạm vi `org` | `campus` | `any`.
  - `org`: cần quyền cấp tổ chức (khóa `'*'`). `campus`: cần quyền ở cơ sở đang chọn (đang "Tất cả cơ sở" → màn "Chọn cơ sở"). `any`: có quyền ở bất kỳ cơ sở nào, trang tự lọc dữ liệu.
  - Route không khai báo ở đây coi như không tồn tại (kể cả khi có file page). Mục menu thiếu quyền bị ẩn; vào thẳng URL ra trang 403 nêu đúng phạm vi + nút quay lại, không tải dữ liệu.
- Lựa chọn tổ chức/cơ sở/năm học/vai trò lưu `localStorage` (`mn.scope.v1`) chỉ để nhớ giao diện; luôn đối chiếu với danh sách do máy chủ trả (`org.listMine`) và hồ sơ thành viên realtime. Quyền thật do máy chủ kiểm tra từng request. "Vai trò đang dùng" chỉ thu hẹp giao diện.
- Tài khoản bị khóa/thu hồi (từ `org.listMine` hoặc hồ sơ thành viên realtime) → đăng xuất, xóa cache `mn.*`, thông báo ở trang đăng nhập.

## Thêm trang mới (5 bước)

1. **Tìm mã màn** trong `src/lib/screens.ts` (đã có đủ W01–W48). Nếu cần route mới/đổi quyền, sửa dòng tương ứng tại đây (đường dẫn, `perm`, `scope`, `menu`).
2. **Tạo `src/screens/W08Leads.tsx`** export component nhận `{ screen, params }` (kiểu `ScreenProps` trong `registry.tsx`).
3. **Đăng ký** một dòng trong `src/screens/registry.tsx`: `W08: W08Leads,`.
4. **Dữ liệu**: đọc bằng `useFirestoreQuery`/`useDoc` (key chứa `org.orgId`/`campusId`), ghi bằng `callApi` bọc trong `useAsyncAction`/`useForm.onSubmit`; luôn truyền `orgId` (+ `campusId` cho action cần cơ sở) và `opId`.
5. **Kiểm tra** checklist dưới, `npm run lint && npm run build`.

Ví dụ tối thiểu:

```tsx
'use client';
import { collection, query, where } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import { useFirestoreQuery } from '@/lib/hooks/useFirestore';
import { useScope } from '@/providers/ScopeProvider';
import { PageHeader, DataTable, StatusBadge, type Column } from '@/components/ui';

interface Row { id: string; name: string; status: string }

export function W20Incidents() {
  const { org, campusId, scopeKey } = useScope();
  const q = useFirestoreQuery<Row>(
    campusId && campusId !== 'all' ? `incidents|${scopeKey}` : null,
    () => query(collection(firebase().db, 'orgs', org!.orgId, 'incidents'), where('campusId', '==', campusId)),
    (id, d) => ({ id, name: String(d.title ?? id), status: String(d.status ?? '') }),
  );
  const cols: Column<Row>[] = [
    { key: 'name', header: 'Sự cố', value: (r) => r.name, sortable: true },
    { key: 'status', header: 'Trạng thái', render: (r) => <StatusBadge domain="approval" value={r.status} /> },
  ];
  return (
    <>
      <PageHeader title="Sự cố và xử lý" code="W20" />
      <DataTable caption="Danh sách sự cố" columns={cols} rows={q.data} rowKey={(r) => r.id}
        status={q.status} error={q.error?.message} onRetry={q.retry} searchText={(r) => r.name} />
    </>
  );
}
```

## Checklist trạng thái giao diện (mọi trang)

- [ ] Danh sách đủ 5 trạng thái: Đang tải (skeleton), Có dữ liệu, Chưa có dữ liệu (kèm hành động tạo nếu có quyền), Không có kết quả lọc (nút "Xóa bộ lọc"), Lỗi + "Thử lại" — dùng `DataTable`/`ErrorState`.
- [ ] Biểu mẫu: label ngoài input, bắt buộc có dấu `*`, lỗi dưới field (icon + chữ), banner lỗi chung gần nút gửi, kiểm tra trường bắt buộc/trùng mã/khoảng ngày/số tiền; lưu lỗi vẫn giữ dữ liệu.
- [ ] Nút gửi dùng `loading` (chặn gửi trùng) + `opId` từ `useForm`/`useAsyncAction`; không toast thành công trước khi `callApi` resolve.
- [ ] Phát hành, khóa kỳ, thu tiền, hoàn, chuyển cơ sở, thu hồi quyền: dùng `ConfirmDialog` nêu đối tượng + tác động; nhãn nút xác nhận dạng động từ + đối tượng; nút đỏ chỉ cho thao tác làm mất quyền/dữ liệu, không dùng cho "Quay lại".
- [ ] Xung đột version (`VERSION_CONFLICT`): gửi `expectedVersion`, hiện thông báo tải lại/đối chiếu, không ghi đè im lặng.
- [ ] Tác vụ hàng loạt: hiện tiến độ và kết quả từng bản ghi.
- [ ] Khai báo quyền/scope đúng trong `screens.ts`; không tin bộ chọn cơ sở làm căn cứ quyền (server kiểm tra lại).
- [ ] Trạng thái hiển thị bằng chữ + icon (`StatusBadge`), nhãn VN theo CONTRACT §9; tiền `formatVnd`, ngày `dd/MM/yyyy`, giờ theo `scope.tz`.
- [ ] Vùng chạm ≥ 44px, focus ring 2px, không mã hex ngoài `tokens.css`.

## Trạng thái các màn

Đã làm: W01 Đăng nhập, W02 Tổng quan toàn chuỗi, W03 Danh sách cơ sở (+ đổi trạng thái cơ sở), W04 Tạo cơ sở mới, W06 Vai trò và ma trận quyền (+ tạo/sửa vai trò tùy biến), W07 Tài khoản và lời mời. Các màn còn lại hiển thị `ComingSoon` ghi rõ mã W##.
