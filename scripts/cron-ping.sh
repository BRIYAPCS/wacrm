#!/usr/bin/env bash
# ============================================================
# cron-ping.sh — drive wacrm's scheduled maintenance endpoints.
#
# Hits both cron routes with the shared secret so:
#   - /api/automations/cron  drains due automation "Wait" steps
#   - /api/flows/cron         sweeps stale/abandoned flow runs
#
# Point a scheduler at this every ~5 minutes (see
# docs/automations-and-cron.md). Safe to run as often as you like —
# each call is idempotent and returns quickly when there's nothing due.
#
# Usage:
#   BASE_URL=https://crm.example.com \
#   AUTOMATION_CRON_SECRET=xxxx \
#   ./scripts/cron-ping.sh
#
# Both vars are required. Exits non-zero if either endpoint fails, so a
# scheduler that surfaces failures (cron MAILTO, GitHub Actions) alerts you.
# ============================================================
set -euo pipefail

: "${BASE_URL:?set BASE_URL, e.g. https://crm.example.com}"
: "${AUTOMATION_CRON_SECRET:?set AUTOMATION_CRON_SECRET (same value as the app env)}"

ping() {
  local path="$1"
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "x-cron-secret: ${AUTOMATION_CRON_SECRET}" \
    "${BASE_URL}${path}")
  echo "  ${path} -> ${code}"
  # 200 = worked. 503 = cron not configured (secret missing on the server).
  # 401 = secret mismatch. Anything but 200 is a failure worth surfacing.
  [ "$code" = "200" ]
}

echo "cron-ping $(date -u +%FT%TZ)"
ok=0
ping "/api/automations/cron" || ok=1
ping "/api/flows/cron" || ok=1
ping "/api/scheduled-messages/cron" || ok=1
exit "$ok"
