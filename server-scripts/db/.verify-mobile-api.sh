#!/bin/bash
# Smoke checks for /api/v1 mobile foundation (Bearer JWT + rotating refresh).
# Prerequisites:
#   - Next listening at BASE (default http://127.0.0.1:3000)
#   - Server env: MOBILE_JWT_SECRET (>= 32 chars)
#   - BOOTSTRAP_EMAIL + BOOTSTRAP_PASSWORD for a tenant user (not SUPER_ADMIN)
# Optional:
#   - TEST_PO_ID — existing PO id; runs presign-only check

set -euo pipefail

BASE="${BASE:-http://127.0.0.1:3000}"
EMAIL="${BOOTSTRAP_EMAIL:?export BOOTSTRAP_EMAIL}"
PASSWORD="${BOOTSTRAP_PASSWORD:?export BOOTSTRAP_PASSWORD}"

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
note()  { printf "\033[34m--- %s\033[0m\n" "$*"; }

note "1) Bad login -> 401"
BAD_CODE=$(curl -sS -o /tmp/bv-mobile-bad.json -w "%{http_code}" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"wrong-password-$(date +%s)\"}" \
  "$BASE/api/v1/auth/login")
[[ "$BAD_CODE" == "401" ]] && green "401 OK" || { red "expected 401 got $BAD_CODE"; exit 1; }

note "2) Good login -> tokens"
LOGIN_JSON=$(curl -sS -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"deviceLabel\":\"verify-script\"}" \
  "$BASE/api/v1/auth/login")
echo "$LOGIN_JSON" | grep -q '"ok":true' && green "login envelope OK" || { red "$LOGIN_JSON"; exit 1; }
ACCESS=$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["data"]["accessToken"])' <<<"$LOGIN_JSON")
REFRESH=$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["data"]["refreshToken"])' <<<"$LOGIN_JSON")

note "3) Refresh rotates; stale refresh rejected"
REFRESH2_JSON=$(curl -sS -H 'Content-Type: application/json' \
  -d "{\"refreshToken\":\"$REFRESH\"}" \
  "$BASE/api/v1/auth/refresh")
echo "$REFRESH2_JSON" | grep -q '"ok":true' && green "refresh OK" || { red "$REFRESH2_JSON"; exit 1; }
STALE=$(curl -sS -o /dev/null -w "%{http_code}" -H 'Content-Type: application/json' \
  -d "{\"refreshToken\":\"$REFRESH\"}" \
  "$BASE/api/v1/auth/refresh")
[[ "$STALE" == "401" ]] && green "old refresh rejected" || { red "expected 401 stale refresh got $STALE"; exit 1; }

NEW_ACCESS=$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["data"]["accessToken"])' <<<"$REFRESH2_JSON")

note "4) PO list with Bearer"
POLIST=$(curl -sS -H "Authorization: Bearer $NEW_ACCESS" "$BASE/api/v1/purchase-orders")
echo "$POLIST" | grep -q '"ok":true' && green "PO list OK" || { red "$POLIST"; exit 1; }

note "5) Logout; subsequent API calls with same access JWT fail"
LO=$(curl -sS -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $NEW_ACCESS" \
  -X POST "$BASE/api/v1/auth/logout")
[[ "$LO" == "200" ]] && green "logout OK" || { red "logout http $LO"; exit 1; }
AFTER=$(curl -sS -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $NEW_ACCESS" \
  "$BASE/api/v1/purchase-orders")
[[ "$AFTER" == "401" ]] && green "revoked session blocked" || { red "expected 401 after logout got $AFTER"; exit 1; }

if [[ -n "${TEST_PO_ID:-}" ]]; then
  note "6) Optional presign for PO $TEST_PO_ID"
  LOGIN_AGAIN=$(curl -sS -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
    "$BASE/api/v1/auth/login")
  ACC2=$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["data"]["accessToken"])' <<<"$LOGIN_AGAIN")
  PRES=$(curl -sS -H "Authorization: Bearer $ACC2" -H 'Content-Type: application/json' \
    -d "{\"purchaseOrderId\":\"$TEST_PO_ID\",\"kind\":\"RECEIPT\",\"originalFilename\":\"probe.pdf\",\"declaredSizeBytes\":4}" \
    "$BASE/api/v1/uploads/presign")
  echo "$PRES" | grep -q '"uploadUrl"' && green "presign OK" || { red "$PRES"; exit 1; }

  if [[ "${TEST_UPLOAD_COMPLETE_IDEMPOTENCY:-}" == "1" ]]; then
    note "6b) PUT minimal PDF bytes + POST complete twice (same attachmentId)"
    UID=$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["data"]["uploadId"])' <<<"$PRES")
    UURL=$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["data"]["uploadUrl"])' <<<"$PRES")
    printf '%%PDF' > /tmp/bv-mobile-probe.pdf
    curl -fsS -X PUT -H "Authorization: Bearer $ACC2" --data-binary @/tmp/bv-mobile-probe.pdf "$UURL" >/dev/null
    C1=$(curl -sS -H "Authorization: Bearer $ACC2" -H 'Content-Type: application/json' \
      -d "{\"uploadId\":\"$UID\"}" "$BASE/api/v1/uploads/complete")
    C2=$(curl -sS -H "Authorization: Bearer $ACC2" -H 'Content-Type: application/json' \
      -d "{\"uploadId\":\"$UID\"}" "$BASE/api/v1/uploads/complete")
    A1=$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["data"]["attachmentId"])' <<<"$C1")
    A2=$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["data"]["attachmentId"])' <<<"$C2")
    R2=$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["data"].get("idempotentReplay", False))' <<<"$C2")
    echo "$C1" | grep -q '"ok":true' && echo "$C2" | grep -q '"ok":true' && [[ "$A1" == "$A2" ]] && [[ "$R2" == "True" ]] \
      && green "double-complete idempotent OK" \
      || { red "C1=$C1 C2=$C2"; exit 1; }
  fi
fi

green "All mobile API smoke checks passed."
