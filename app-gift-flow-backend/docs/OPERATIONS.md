# Vận hành GiftFlow API

## Trước khi deploy VPS 76.13.16.235 (cần owner xác nhận)
1. Xác nhận đúng VPS, tài khoản SSH, distro, CPU/RAM/disk, port đang dùng, firewall, backup hiện có.
2. DNS: subdomain do owner sở hữu → A record tới IP; chờ DNS; Caddy tự cấp Let's Encrypt. Không dùng IP làm base URL phát hành.
3. SSH bằng key, user không phải root; `ufw` chỉ mở 22 (giới hạn nguồn), 80, 443; tắt password auth sau khi test key.
4. Cài Docker Engine + Compose plugin từ nguồn chính thức.
5. `.env` đặt trên server (chmod 600), không commit: `JWT_ACCESS_SECRET` (≥32 ký tự ngẫu nhiên), `POSTGRES_PASSWORD`, `API_DOMAIN`, `OPENAI_API_KEY`, `STT_MODEL`, `LLM_MODEL`, `CORS_ORIGINS`, `QUOTA_LIMIT_PER_PERIOD`; production nên `DOCS_ENABLED=false`.
6. `docker compose -f infra/docker-compose.yml up -d --build` → migration tự chạy (`migrationsRun`). Postgres chỉ ở network `internal`.
7. `infra/scripts/smoke.sh https://<domain>`.

## Backup / Restore
- `infra/scripts/backup.sh` (cron hằng ngày): `pg_dump -Fc` → mã hoá `age` → giữ 7 bản; **cần** cấu hình đẩy offsite (rclone/S3).
- Restore drill định kỳ: `age -d -i key file | docker compose exec -T postgres pg_restore -U giftflow -d giftflow --clean`; đối chiếu số dòng `gifts`, tổng `SUM(amount_vnd)` confirmed.

## Giám sát
Cảnh báo: disk, lỗi DB, 5xx, chi phí AI (đếm `usage_quotas.used` × đơn giá). Log container xoay vòng (`--log-opt max-size`).

## Rollback
Giữ image tag cũ (`docker tag`), `docker compose up -d` với tag trước. Migration chỉ thêm; revert bằng `npm run migration:revert`.

## Chuyển Cloud Run (sau này)
API stateless (export dùng thư mục tạm → chuyển sang GCS + signed URL); Postgres → managed DB (verify row count/checksum + restore); secrets → Secret Manager; domain mapping/LB; chạy song song VPS 3–7 ngày, DNS TTL ngắn. App không cần cập nhật nếu domain/endpoint/schema giữ nguyên.
