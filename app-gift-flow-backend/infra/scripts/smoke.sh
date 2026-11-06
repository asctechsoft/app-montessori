#!/usr/bin/env bash
# Smoke test sau deploy: ./smoke.sh https://api.example.com
set -euo pipefail
BASE=${1:?base url}
curl -fsS "$BASE/health/live" >/dev/null && echo "live ok"
curl -fsS "$BASE/health/ready" >/dev/null && echo "ready ok"
TOKEN=$(curl -fsS -X POST "$BASE/v1/auth/guest" -H 'content-type: application/json' \
  -d "{\"device_id\":\"$(cat /proc/sys/kernel/random/uuid)\"}" | sed -E 's/.*"access_token":"([^"]+)".*/\1/')
curl -fsS "$BASE/v1/me" -H "authorization: Bearer $TOKEN" >/dev/null && echo "auth ok"
