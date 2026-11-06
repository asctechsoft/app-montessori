# GiftFlow AI – Backend (NestJS)

API v1 cho app Flutter `app-gift-flow`. Stack: NestJS 11 · TypeORM · PostgreSQL (prod) / sql.js (dev, không cần cài DB) · JWT guest auth · STT + LLM qua nhà cung cấp thuê ngoài (có provider **mock** chạy ngay không cần key).

## Chạy local (không cần Postgres, không cần API key)
```bash
npm install
cp .env.example .env      # đã có sẵn giá trị dev
npm run start:dev         # http://localhost:3000   Swagger: /docs
npm test && npm run test:e2e
```
Trong `AI_PROVIDER=mock` mỗi segment audio trả về một câu mẫu xoay vòng (hoặc field `transcript_hint`) để chạy trọn luồng *ghi âm → pending/confirmed → danh sách*.

## Khi có token AI (làm sau)
Chỉ sửa `.env` trên server, **không** đưa key vào app/git:
```
AI_PROVIDER=openai
OPENAI_API_KEY=...
STT_MODEL=<model STT sau benchmark>
LLM_MODEL=<model LLM sau benchmark>
```
Provider nằm sau interface `SttProvider` / `ExtractionProvider` (`src/modules/ai`) nên đổi nhà cung cấp không ảnh hưởng app.

## Kết nối app
App đọc `API_BASE_URL` qua `--dart-define`:
```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000      # Android emulator
flutter run --dart-define=API_BASE_URL=http://<IP-LAN-may>:3000  # máy thật cùng Wi-Fi
```
Bản phát hành dùng domain HTTPS, không dùng IP.

## Endpoint chính
`POST /v1/auth/guest|refresh` · `GET /v1/me` · `events` CRUD (+`PUT` upsert cho sync) · `events/:id/gifts` · `gifts/:id` (+`PUT`, `/confirm`) · `POST /v1/voice/segments` · `GET /v1/events/:id/stats` · `POST /v1/events/:id/exports` + `GET /v1/exports/:id` · `/health/live|ready`. Chi tiết: Swagger `/docs`, `/docs/openapi.json`.

`PUT /v1/events/:id`, `PUT /v1/gifts/:id` là endpoint upsert idempotent (last-write-wins theo `updated_at`) mà outbox của app dùng — bổ sung ngoài danh sách tối thiểu trong blueprint.

## Quy tắc đã cài đặt
Owner scope mọi query (user khác → 404) · idempotency theo `request_id` · quota AI trừ nguyên tử phía server (429) · amount mơ hồ/tên thiếu/nghi trùng → `pending_review`, không auto-confirm · stats/export chỉ cộng `confirmed` · xoá mềm + audit (không lưu PII) · MIME sniffing + giới hạn dung lượng/thời lượng audio · refresh token xoay vòng, phát hiện tái sử dụng · chống formula injection khi xuất Excel · mọi lỗi dạng `{code,message,request_id,details?}`.

## Triển khai VPS (CHỈ sau khi owner duyệt)
```bash
cp .env.example .env   # đặt JWT_ACCESS_SECRET, POSTGRES_PASSWORD, API_DOMAIN, key AI...
docker compose -f infra/docker-compose.yml up -d --build
infra/scripts/smoke.sh https://$API_DOMAIN
```
Xem `docs/OPERATIONS.md` (VPS, backup/restore, chuyển Cloud Run) và `docs/SECURITY.md`. **Chưa** SSH/DNS/deploy gì lên 76.13.16.235.

## Đăng nhập Google
`POST /v1/auth/google {id_token}` (kèm Bearer guest để gộp dữ liệu guest vào tài khoản Google). Cần `GOOGLE_CLIENT_IDS` trong `.env`.
