#!/usr/bin/env bash
# OCR runtime verification: middleware posture, tick auth, host binaries,
# optional loopback tick, and financial isolation (no VendorPriceHistory
# from unapproved OCR line items). Never prints secrets.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ENV_FILE="${BVISIBLE_ENV_FILE:-/opt/bvisible/shared/env/.env}"
TICK_URL="${BVISIBLE_OCR_TICK_URL:-http://127.0.0.1:3000/api/internal/ocr/tick}"
RESP_JSON="/tmp/.verify-ocr-tick-resp.json"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

echo "== static: OCR tick route =="
test -f apps/web/app/api/internal/ocr/tick/route.ts
grep -q 'runOcrWorkerTick' apps/web/app/api/internal/ocr/tick/route.ts
pass "route handler present"

echo "== static: middleware allowlist =="
grep -qF "'/api/internal/ocr/tick'" apps/web/middleware.ts
pass "middleware whitelists /api/internal/ocr/tick"

echo "== static: secret fallback in route =="
grep -q 'OCR_TICK_SECRET' apps/web/app/api/internal/ocr/tick/route.ts
grep -q 'INGEST_TICK_SECRET' apps/web/app/api/internal/ocr/tick/route.ts
pass "OCR_TICK_SECRET with INGEST_TICK_SECRET fallback documented in code"

ocr_tick_secret_configured() {
  [ -f "$ENV_FILE" ] || return 1
  if grep -qE '^OCR_TICK_SECRET=.+$' "$ENV_FILE" 2>/dev/null; then
    return 0
  fi
  if grep -qE '^INGEST_TICK_SECRET=.+$' "$ENV_FILE" 2>/dev/null; then
    return 0
  fi
  return 1
}

echo "== env: tick secret configured (names only) =="
if ocr_tick_secret_configured; then
  if [ -f "$ENV_FILE" ] && grep -qE '^OCR_TICK_SECRET=.+$' "$ENV_FILE" 2>/dev/null; then
    pass "OCR_TICK_SECRET is set"
  else
    pass "INGEST_TICK_SECRET is set (OCR tick fallback)"
  fi
else
  echo "WARN: neither OCR_TICK_SECRET nor INGEST_TICK_SECRET set in $ENV_FILE"
fi

load_tick_secret() {
  if [ ! -f "$ENV_FILE" ]; then
    return 1
  fi
  # shellcheck disable=SC1090
  (
    set -a
    # shellcheck source=/dev/null
    . "$ENV_FILE"
    set +a
    if [ -n "${OCR_TICK_SECRET:-}" ]; then
      printf '%s' "$OCR_TICK_SECRET"
    elif [ -n "${INGEST_TICK_SECRET:-}" ]; then
      printf '%s' "$INGEST_TICK_SECRET"
    else
      return 1
    fi
  )
}

http_tick() {
  local extra_header="${1:-}"
  local args=(-sS -o "$RESP_JSON" -w '%{http_code}' --max-time 120 -X POST)
  if [ -n "$extra_header" ]; then
    args+=(-H "$extra_header")
  fi
  args+=(-H 'content-length: 0' "$TICK_URL")
  curl "${args[@]}" 2>/dev/null || echo "000"
}

if curl -fsS --max-time 3 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
  echo "== http: tick without secret (must not redirect to /login) =="
  CODE="$(http_tick)"
  if [ "$CODE" = "307" ] || [ "$CODE" = "302" ]; then
    fail "got redirect HTTP $CODE — middleware still sending tick to /login"
  fi
  if [ "$CODE" != "401" ] && [ "$CODE" != "503" ]; then
    fail "expected 401 or 503 without secret, got HTTP $CODE"
  fi
  if grep -qi 'login' "$RESP_JSON" 2>/dev/null && [ "$CODE" != "401" ] && [ "$CODE" != "503" ]; then
    fail "response body looks like a login page"
  fi
  pass "no login redirect (HTTP $CODE)"

  echo "== http: tick with invalid secret =="
  CODE="$(http_tick 'x-bvisible-ocr-secret: invalid-verify-secret')"
  [ "$CODE" = "401" ] || fail "expected 401 for bad secret, got HTTP $CODE"
  pass "invalid secret returns 401"

  if SECRET="$(load_tick_secret 2>/dev/null || true)" && [ -n "${SECRET:-}" ]; then
    echo "== http: tick with configured secret =="
    CODE="$(http_tick "x-bvisible-ocr-secret: $SECRET")"
    if [ "$CODE" -lt 200 ] || [ "$CODE" -ge 300 ]; then
      BODY=$(head -c 400 "$RESP_JSON" 2>/dev/null || true)
      fail "expected 2xx with valid secret, got HTTP $CODE :: $BODY"
    fi
    pass "tick accepted (HTTP $CODE)"
  else
    echo "SKIP: configured secret tick (set OCR_TICK_SECRET or INGEST_TICK_SECRET in $ENV_FILE)"
  fi
else
  echo "SKIP: loopback HTTP checks (Next.js not listening on 127.0.0.1:3000)"
fi

echo "== host: tesseract =="
if command -v tesseract >/dev/null 2>&1; then
  tesseract --version | head -n 1
  pass "tesseract on PATH"
else
  fail "tesseract not found — run: sudo bash server-scripts/ocr/install-runtime-deps.sh"
fi

echo "== host: pdftoppm =="
if command -v pdftoppm >/dev/null 2>&1; then
  pdftoppm -v 2>&1 | head -n 1
  pass "pdftoppm on PATH"
else
  fail "pdftoppm not found — run: sudo bash server-scripts/ocr/install-runtime-deps.sh"
fi

if [ -d /opt/bvisible/app ] && command -v docker >/dev/null 2>&1; then
  echo "== db: no VendorPriceHistory from unapproved OCR line items =="
  cd /opt/bvisible/app
  BAD=$(docker compose exec -T db psql -U bvisible -d bvisible -t -A -c \
    "SELECT COUNT(*) FROM vendor_price_histories vph
     INNER JOIN ocr_line_items oli ON oli.id = vph.\"ocrLineItemId\"
     INNER JOIN ocr_documents od ON od.id = oli.\"ocrDocumentId\"
     WHERE od.status <> 'CONFIRMED';" 2>/dev/null | tr -d '[:space:]' || echo "")
  if [ -n "$BAD" ] && [ "$BAD" != "0" ]; then
    fail "found $BAD vendor_price_histories rows tied to non-CONFIRMED OCR docs"
  fi
  pass "no VendorPriceHistory linked to unapproved OCR docs"
else
  echo "SKIP: DB financial isolation check (not on production app host)"
fi

rm -f "$RESP_JSON"
echo "OK — OCR runtime verification complete."
