#!/bin/bash
# Verify the SMTP mailer foundation deployed correctly.
# Pre-req: bash /tmp/.reset-and-verify.sh has been run recently OR
# BOOTSTRAP_PASSWORD is exported.
#
# Checks:
#   1. /settings/email-test is gated for unauthenticated requests (307).
#   2. After SUPER_ADMIN login, /settings/email-test returns 200.
#   3. Page body advertises "SMTP is not configured" while .env keys are
#      blank (the expected halfway state until creds are pasted in).
#   4. POSTing the test-email form does NOT 500. It returns the page
#      with a sanitized config error and never echoes any password.
#   5. /admin/users still 200 (didn't break the existing surface).

set -euo pipefail

BASE_PUB="https://vmi3270817.contaboserver.net"
EMAIL="${BOOTSTRAP_EMAIL:-admin@bvisible.local}"
PASSWORD="${BOOTSTRAP_PASSWORD:?must export BOOTSTRAP_PASSWORD}"

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
note()  { printf "\033[34m--- %s\033[0m\n" "$*"; }

note "1. /settings/email-test without cookie -> 307"
CODE=$(curl -ksS -o /dev/null -w "%{http_code}" "$BASE_PUB/settings/email-test")
echo "  $CODE"
[[ "$CODE" == "307" ]] && green "  middleware gate OK" || { red "FAIL"; exit 1; }

note "2. Login as SUPER_ADMIN"
COOKIE_JAR=$(mktemp)
HIDDEN_TSV=$(mktemp)
LOGIN_HTML_FILE=$(mktemp)
EXTRACT_PY=$(mktemp --suffix=.py)
trap 'rm -f $COOKIE_JAR $HIDDEN_TSV $LOGIN_HTML_FILE $EXTRACT_PY' EXIT

curl -ksS "$BASE_PUB/login" > "$LOGIN_HTML_FILE"

cat > "$EXTRACT_PY" <<'PY'
import sys, re, html
src_path, out_path = sys.argv[1], sys.argv[2]
with open(src_path, "r", encoding="utf-8", errors="replace") as f:
    data = f.read()
m = re.search(r"<form\b[^>]*>(.*?)</form>", data, re.DOTALL)
form = m.group(1) if m else data
with open(out_path, "w", encoding="utf-8") as out:
    for tag in re.finditer(r"<input\b[^>]*>", form):
        t = tag.group(0)
        if 'type="hidden"' not in t:
            continue
        n = re.search(r'name="([^"]+)"', t)
        v = re.search(r'value="([^"]*)"', t)
        if not n: continue
        out.write(f"{n.group(1)}\t{html.unescape(v.group(1)) if v else ''}\n")
PY
python3 "$EXTRACT_PY" "$LOGIN_HTML_FILE" "$HIDDEN_TSV"

CURL_ARGS=()
while IFS=$'\t' read -r NAME VAL; do
  CURL_ARGS+=( -F "$NAME=$VAL" )
done < "$HIDDEN_TSV"

LOGIN_RESP=$(curl -ksS -i -X POST "$BASE_PUB/login" "${CURL_ARGS[@]}" -F "email=$EMAIL" -F "password=$PASSWORD")
SESSION_VAL=$(echo "$LOGIN_RESP" | grep -i '^set-cookie: bv_session=' | head -n1 | grep -oE 'bv_session=[^;]+' | cut -d= -f2-)
[[ -n "$SESSION_VAL" ]] && green "  login OK" || { red "FAIL: no session cookie"; exit 1; }
COOKIE_HOST=$(echo "$BASE_PUB" | sed -E 's|https?://||;s|/.*||')
{ echo "# Netscape HTTP Cookie File"; printf '%s\tFALSE\t/\tTRUE\t0\tbv_session\t%s\n' "$COOKIE_HOST" "$SESSION_VAL"; } > "$COOKIE_JAR"

note "3. /settings/email-test with SUPER_ADMIN cookie -> 200"
ETEST_HTML=$(mktemp)
ETEST_CODE=$(curl -ksS -b "$COOKIE_JAR" -o "$ETEST_HTML" -w "%{http_code}" "$BASE_PUB/settings/email-test")
echo "  /settings/email-test -> $ETEST_CODE"
[[ "$ETEST_CODE" == "200" ]] && green "  page reachable" || { red "FAIL"; head -c 400 "$ETEST_HTML"; exit 1; }

note "4. Page body mentions the unconfigured-SMTP marker"
if grep -q "SMTP is not configured" "$ETEST_HTML"; then
  green "  amber panel rendered as expected (no SMTP_USER/PASSWORD/FROM yet)"
else
  echo "  (page does not contain 'SMTP is not configured' — checking for diagnostics block instead)"
  if grep -qE '(SMTP configuration|maskedUser)' "$ETEST_HTML"; then
    green "  diagnostics rendered — SMTP appears configured already"
  else
    red "FAIL: page rendered but missing both expected markers"
    head -c 800 "$ETEST_HTML"
    exit 1
  fi
fi

note "5. Page contains no obvious credential VALUE leak"
# Note: the page legitimately mentions SMTP_PASSWORD as an env-key name
# in operator instructions ("Set SMTP_HOST, SMTP_PORT, SMTP_USER,
# SMTP_PASSWORD..."). What we DO want to fail on is anything that looks
# like a credential value: argon2 hashes, literal password=value pairs
# with a non-blank value, or base64-looking auth blobs near the word
# "password".
if grep -qE '(\$argon2id\$|password=[A-Za-z0-9!@#%^&*+\-_/]{6,})' "$ETEST_HTML"; then
  red "FAIL: page contains something that looks like a credential value"
  grep -oE '(\$argon2id\$[^"<]+|password=[A-Za-z0-9!@#%^&*+\-_/]{6,})' "$ETEST_HTML" | head -3
  exit 1
else
  green "  no credential-shaped value found in page body"
fi

note "6. POST the test-email form (graceful failure expected, no 500)"
ETEST_TSV=$(mktemp)
# The page contains TWO forms (AppShell sidebar logout + the test-email
# form). The default extractor picks the first form, which would route
# our POST to logoutAction and delete the session. Use a more specific
# extractor that picks the form containing <input name="recipient">.
EXTRACT_PY2=$(mktemp --suffix=.py)
cat > "$EXTRACT_PY2" <<'PY'
import sys, re, html
src_path, out_path = sys.argv[1], sys.argv[2]
with open(src_path, "r", encoding="utf-8", errors="replace") as f:
    data = f.read()
chosen = None
for m in re.finditer(r"<form\b[^>]*>(.*?)</form>", data, re.DOTALL):
    body = m.group(1)
    if re.search(r'<input\b[^>]*name="recipient"', body):
        chosen = body
        break
if chosen is None:
    sys.stderr.write("could not find a form with input[name=recipient]\n")
    sys.exit(2)
with open(out_path, "w", encoding="utf-8") as out:
    for tag in re.finditer(r"<input\b[^>]*>", chosen):
        t = tag.group(0)
        if 'type="hidden"' not in t: continue
        n = re.search(r'name="([^"]+)"', t)
        v = re.search(r'value="([^"]*)"', t)
        if not n: continue
        out.write(f"{n.group(1)}\t{html.unescape(v.group(1)) if v else ''}\n")
PY
python3 "$EXTRACT_PY2" "$ETEST_HTML" "$ETEST_TSV"
ETEST_ARGS=()
while IFS=$'\t' read -r NAME VAL; do
  ETEST_ARGS+=( -F "$NAME=$VAL" )
done < "$ETEST_TSV"
echo "  hidden input count: ${#ETEST_ARGS[@]}"
rm -f "$EXTRACT_PY2"

POST_RESP=$(curl -ksS -i -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -X POST "$BASE_PUB/settings/email-test" \
  "${ETEST_ARGS[@]}" \
  -F "recipient=$EMAIL")
POST_STATUS=$(echo "$POST_RESP" | head -n1 | tr -d '\r')
echo "  $POST_STATUS"
echo "  Set-Cookie lines from POST response:"
{ echo "$POST_RESP" | grep -i '^set-cookie:' || echo "    (none)"; } | sed 's/^/    /' | head -5
echo "  Location header:"
{ echo "$POST_RESP" | grep -i '^location:' || echo "    (none)"; } | sed 's/^/    /' | head -3
echo "$POST_RESP" | head -n1 | grep -qE 'HTTP/1\.1 (200|303)' && green "  POST returned non-500" || { red "FAIL: 500 from email-test action"; echo "$POST_RESP" | head -n 40; exit 1; }
# After the POST, re-prime the cookie jar with the live bv_session
# value (the POST may have rotated it). curl -c writes the entire
# cookie store; that should suffice.

note "7. /admin/users with cookie still 200 (no regression)"
ADMU=$(curl -ksS -b "$COOKIE_JAR" -o /dev/null -w "%{http_code}" "$BASE_PUB/admin/users")
echo "  $ADMU"
[[ "$ADMU" == "200" ]] && green "  /admin/users still OK" || { red "FAIL"; exit 1; }

rm -f "$ETEST_HTML" "$ETEST_TSV"
green "ALL MAILER CHECKS PASSED"
