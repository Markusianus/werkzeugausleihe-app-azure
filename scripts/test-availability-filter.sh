#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:3100}"
HEALTH_URL="$BASE_URL/api/health"
TOOLS_URL="$BASE_URL/api/werkzeuge?verfuegbar_von=2026-03-24&verfuegbar_bis=2026-03-26"
BAD_RANGE_URL="$BASE_URL/api/werkzeuge?verfuegbar_von=2026-03-26&verfuegbar_bis=2026-03-24"
MISSING_HALF_URL="$BASE_URL/api/werkzeuge?verfuegbar_von=2026-03-24"

printf '== Healthcheck ==\n'
curl -fsS "$HEALTH_URL" >/dev/null

printf '== Zeitraumfilter gültig ==\n'
HTTP_CODE=$(curl -sS -o /tmp/toolhub-tools-valid.json -w '%{http_code}' "$TOOLS_URL")
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Expected 200 for valid availability filter, got $HTTP_CODE" >&2
  cat /tmp/toolhub-tools-valid.json >&2 || true
  exit 1
fi
node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync('/tmp/toolhub-tools-valid.json','utf8')); if(!Array.isArray(data)) { console.error('Expected JSON array for valid filter'); process.exit(1); } console.log('Tools returned:', data.length);"

printf '== Zeitraumfilter ungültiger Bereich ==\n'
HTTP_CODE=$(curl -sS -o /tmp/toolhub-tools-bad-range.json -w '%{http_code}' "$BAD_RANGE_URL")
if [[ "$HTTP_CODE" != "400" ]]; then
  echo "Expected 400 for invalid range, got $HTTP_CODE" >&2
  cat /tmp/toolhub-tools-bad-range.json >&2 || true
  exit 1
fi

printf '== Zeitraumfilter unvollständig ==\n'
HTTP_CODE=$(curl -sS -o /tmp/toolhub-tools-half.json -w '%{http_code}' "$MISSING_HALF_URL")
if [[ "$HTTP_CODE" != "400" ]]; then
  echo "Expected 400 for incomplete range, got $HTTP_CODE" >&2
  cat /tmp/toolhub-tools-half.json >&2 || true
  exit 1
fi

printf 'All availability filter checks passed.\n'
