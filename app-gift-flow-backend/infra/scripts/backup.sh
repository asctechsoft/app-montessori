#!/usr/bin/env bash
# Backup PostgreSQL hằng ngày (cron). Mã hoá bằng age/gpg và đẩy ra NGOÀI VPS (rclone/S3).
# Chạy: BACKUP_RECIPIENT=<age-public-key> ./backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/var/backups/giftflow
mkdir -p "$OUT"
docker compose exec -T postgres pg_dump -U giftflow -Fc giftflow \
  | age -r "${BACKUP_RECIPIENT:?set BACKUP_RECIPIENT}" > "$OUT/giftflow-$STAMP.dump.age"
# Giữ 7 bản gần nhất
ls -1t "$OUT"/giftflow-*.dump.age | tail -n +8 | xargs -r rm -f
# TODO owner: rclone copy "$OUT" remote:giftflow-backups   (offsite)
echo "backup ok: $OUT/giftflow-$STAMP.dump.age"
