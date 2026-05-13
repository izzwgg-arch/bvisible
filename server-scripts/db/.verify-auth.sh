#!/bin/bash
# End-to-end verification of the auth foundation. Runs on the deploy
# server. Tests public endpoints, middleware redirects, real login via
# server-action POST with parsed action-id, cookie shape, signed-in
# /dashboard access, and logout via revocation.

set -euo pipefail

BASE_LOCAL="http://127.0.0.1:3000"
BASE_PUB="https://vmi3270817.contaboserver.net"
EMAIL="${BOOTSTRAP_EMAIL:-admin@bvisible.local}"
PASSWORD="${BOOTSTRAP_PASSWORD:?must export BOOTSTRAP_PASSWORD}"

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
note()  { printf "\033[34m--- %s\033[0m\n" "$*"; }

note "1. /api/health public, both upstream and via nginx"
LOCAL_HEALTH=$(curl -fsS "$BASE_LOCAL/api/health")
PUB_HEALTH=$(curl -fsS "$BASE_PUB/api/health")
echo "  local: $LOCAL_HEALTH"
echo "  pub:   $PUB_HEALTH"
[[ "$LOCAL_HEALTH" == *'"status":"ok"'* ]] && green "  health OK" || { red "FAIL"; exit 1; }

note "2. /login is publicly reachable (200)"
LOGIN_CODE=$(curl -ksS -o /dev/null -w "%{http_code}" "$BASE_PUB/login")
echo "  /login -> $LOGIN_CODE"
[[ "$LOGIN_CODE" == "200" ]] && green "  /login OK" || { red "FAIL"; exit 1; }

note "3. /dashboard without cookie redirects to /login?next=/dashboard"
DASH_CODE=$(curl -ksS -o /dev/null -w "%{http_code}" "$BASE_PUB/dashboard")
DASH_LOC=$(curl -ksSI "$BASE_PUB/dashboard" | grep -i '^location:' | tr -d '\r' | head -n1)
echo "  /dashboard (no cookie) -> $DASH_CODE  $DASH_LOC"
[[ "$DASH_CODE" == "307" ]] && [[ "$DASH_LOC" == *'/login?next=%2Fdashboard'* || "$DASH_LOC" == *'/login?next=/dashboard'* ]] \
  && green "  middleware redirect OK" \
  || { red "FAIL: expected 307 to /login?next=/dashboard, got $DASH_CODE $DASH_LOC"; exit 1; }

note "4. /admin/users without cookie also redirects (middleware gate)"
ADM_CODE=$(curl -ksS -o /dev/null -w "%{http_code}" "$BASE_PUB/admin/users")
echo "  /admin/users (no cookie) -> $ADM_CODE"
[[ "$ADM_CODE" == "307" ]] && green "  /admin/users gate OK" || { red "FAIL"; exit 1; }

note "5. Login via server-action POST (no-JS form path)"
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
        if not n:
            continue
        name = n.group(1)
        val = html.unescape(v.group(1)) if v else ""
        out.write(f"{name}\t{val}\n")
PY

python3 "$EXTRACT_PY" "$LOGIN_HTML_FILE" "$HIDDEN_TSV"

CURL_ARGS=()
while IFS=$'\t' read -r NAME VAL; do
  CURL_ARGS+=( -F "$NAME=$VAL" )
  echo "  hidden: $NAME = ${VAL:0:80}"
done < "$HIDDEN_TSV"

if [[ ${#CURL_ARGS[@]} -eq 0 ]]; then
  red "FAIL: could not extract any hidden form inputs from /login"
  exit 1
fi

RESP=$(curl -ksS -i -c "$COOKIE_JAR" \
  -X POST "$BASE_PUB/login" \
  "${CURL_ARGS[@]}" \
  -F "email=$EMAIL" \
  -F "password=$PASSWORD")

echo "$RESP" | sed '/^\r$/q' | head -n 30
SET_COOKIE=$(echo "$RESP" | grep -i '^set-cookie: bv_session=' | head -n1 || true)
echo "  Set-Cookie header: ${SET_COOKIE:0:140}..."

if [[ -z "$SET_COOKIE" ]]; then
  red "FAIL: no bv_session Set-Cookie returned"
  echo "Full response head:"
  echo "$RESP" | head -n 80
  exit 1
fi

# Extract the bv_session value from Set-Cookie and seed cookie jar by
# hand: curl -c only persists cookies if the response reaches a final
# state, but our login response is a 303 redirect to /dashboard which
# we did not follow. Just write a Netscape-format cookie line manually.
SESSION_VAL=$(echo "$SET_COOKIE" | grep -oE 'bv_session=[^;]+' | head -n1 | cut -d= -f2-)
COOKIE_HOST=$(echo "$BASE_PUB" | sed -E 's|https?://||;s|/.*||')
{
  echo "# Netscape HTTP Cookie File"
  echo -e "$COOKIE_HOST\tFALSE\t/\tTRUE\t0\tbv_session\t$SESSION_VAL"
} > "$COOKIE_JAR"

# Verify cookie attributes (case-insensitive: Next emits SameSite=lax)
SC_LOWER=$(printf '%s' "$SET_COOKIE" | tr '[:upper:]' '[:lower:]')
[[ "$SC_LOWER" == *"httponly"* ]]      && echo "  HttpOnly: yes"   || { red "FAIL HttpOnly"; exit 1; }
[[ "$SC_LOWER" == *"secure"* ]]        && echo "  Secure: yes"     || { red "FAIL Secure"; exit 1; }
[[ "$SC_LOWER" == *"samesite=lax"* ]]  && echo "  SameSite=Lax: yes" || { red "FAIL SameSite"; exit 1; }
green "  login + cookie attributes OK"

note "6. Authenticated GET /dashboard with cookie"
DASH_AUTH=$(curl -ksS -b "$COOKIE_JAR" -o /tmp/dash.html -w "%{http_code}" "$BASE_PUB/dashboard")
echo "  /dashboard (with cookie) -> $DASH_AUTH"
[[ "$DASH_AUTH" == "200" ]] && green "  authenticated /dashboard OK" || { red "FAIL"; head -c 400 /tmp/dash.html; exit 1; }
grep -q "$EMAIL" /tmp/dash.html && echo "  body mentions $EMAIL: yes" || echo "  (body did not mention email — check render)"

note "7. /admin/tenants with SUPER_ADMIN cookie -> 200"
ADM2=$(curl -ksS -b "$COOKIE_JAR" -o /dev/null -w "%{http_code}" "$BASE_PUB/admin/tenants")
echo "  /admin/tenants -> $ADM2"
[[ "$ADM2" == "200" ]] && green "  SUPER_ADMIN can reach /admin/tenants" || { red "FAIL"; exit 1; }

note "8. Logout: revoke session via /settings logoutAction, then dashboard must redirect"
SETTINGS_HTML_FILE=$(mktemp)
LOGOUT_TSV=$(mktemp)
curl -ksS -b "$COOKIE_JAR" "$BASE_PUB/settings" > "$SETTINGS_HTML_FILE"
# Re-use the same extractor — but the logout form is one of multiple
# forms on /settings. Extract hidden inputs from EVERY form, then
# pick the one whose action descriptor mentions a different action id
# (the logout action).
python3 "$EXTRACT_PY" "$SETTINGS_HTML_FILE" "$LOGOUT_TSV"
echo "  /settings hidden inputs:"
sed 's/^/    /' "$LOGOUT_TSV" | head -20

# Actually the simplest path: settings has multiple forms (logout +
# change-password). Find each <form>, extract its hidden inputs, and
# pick the form whose first $ACTION_REF input has the SHORTEST sibling
# input set — logout has only the action descriptor + key, no extra
# user fields.
cat > "$EXTRACT_PY" <<'PY'
import sys, re, html, json
src_path = sys.argv[1]
with open(src_path, "r", encoding="utf-8", errors="replace") as f:
    data = f.read()
forms = re.findall(r"<form\b[^>]*>(.*?)</form>", data, re.DOTALL)
# We want the form that posts the logoutAction. logoutAction takes no
# args, so its form has only hidden $ACTION_* fields and no <input
# type="text"|"email"|"password"> children.
chosen = None
for form in forms:
    user_inputs = re.findall(r'<input\b[^>]*type="(?:text|email|password)"[^>]*>', form)
    hidden = re.findall(r'<input\b[^>]*type="hidden"[^>]*>', form)
    if not hidden:
        continue
    if not user_inputs:
        chosen = form
        break
if chosen is None:
    sys.stderr.write("could not find argument-less form on /settings\n")
    sys.exit(2)
out_path = sys.argv[2]
with open(out_path, "w", encoding="utf-8") as out:
    for tag in re.finditer(r"<input\b[^>]*>", chosen):
        t = tag.group(0)
        if 'type="hidden"' not in t:
            continue
        n = re.search(r'name="([^"]+)"', t)
        v = re.search(r'value="([^"]*)"', t)
        if not n:
            continue
        name = n.group(1)
        val = html.unescape(v.group(1)) if v else ""
        out.write(f"{name}\t{val}\n")
PY

LOGOUT_FIELDS_TSV=$(mktemp)
python3 "$EXTRACT_PY" "$SETTINGS_HTML_FILE" "$LOGOUT_FIELDS_TSV"
LOGOUT_ARGS=()
while IFS=$'\t' read -r NAME VAL; do
  LOGOUT_ARGS+=( -F "$NAME=$VAL" )
done < "$LOGOUT_FIELDS_TSV"

LOGOUT_RESP=$(curl -ksS -i -b "$COOKIE_JAR" \
  -X POST "$BASE_PUB/settings" \
  "${LOGOUT_ARGS[@]}")
echo "$LOGOUT_RESP" | sed '/^\r$/q' | head -n 20

LOGOUT_LOC=$(echo "$LOGOUT_RESP" | grep -i '^location:' | tr -d '\r' | head -n1)
LOGOUT_CLEAR=$(echo "$LOGOUT_RESP" | grep -i '^set-cookie: bv_session=' | tr -d '\r' | head -n1)
echo "  logout Location: $LOGOUT_LOC"
echo "  logout Set-Cookie: $LOGOUT_CLEAR"
[[ "$LOGOUT_LOC" == *'/login'* ]] && green "  logout redirected to /login" || { red "FAIL: logout did not redirect to /login"; exit 1; }
# Cookie should be cleared (empty value or Max-Age=0 / Expires in past)
if [[ "$LOGOUT_CLEAR" == *"bv_session=;"* || "$LOGOUT_CLEAR" == *"Max-Age=0"* || "$LOGOUT_CLEAR" == *"Expires=Thu, 01 Jan 1970"* ]]; then
  green "  logout cleared cookie"
else
  echo "  (cookie not visibly cleared in Set-Cookie; will verify via revoked session below)"
fi

# After logout, the OLD cookie value must no longer authenticate.
# Even if the browser cookie wasn't physically cleared, the DB session
# row should be revoked, so requests with that cookie redirect to login.
sleep 1
DASH_AFTER=$(curl -ksS -b "$COOKIE_JAR" -o /dev/null -w "%{http_code}" "$BASE_PUB/dashboard")
echo "  /dashboard after logout (with old cookie) -> $DASH_AFTER"
[[ "$DASH_AFTER" == "307" ]] && green "  old session cookie no longer authenticates" || { red "FAIL: old cookie still authenticates"; exit 1; }

rm -f "$SETTINGS_HTML_FILE" "$LOGOUT_TSV" "$LOGOUT_FIELDS_TSV"

note "9. Audit log: latest login_success + logout rows"
PGPASS=$(grep '^POSTGRES_PASSWORD=' /opt/bvisible/shared/env/.env | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')
cd /opt/bvisible/app
docker compose -p bvisible exec -T -e PGPASSWORD="$PGPASS" db psql -U bvisible -d bvisible -c \
  "SELECT \"createdAt\", action, \"userId\", \"ipAddress\" FROM audit_logs WHERE action IN ('login_success','logout') ORDER BY \"createdAt\" DESC LIMIT 5;"

note "10. Public port safety: postgres still bound 127.0.0.1 only"
ss -tln | grep ':5432' || true
ss -tln src 0.0.0.0:5432 | grep -q '5432' && { red "FAIL: 5432 publicly bound"; exit 1; } || echo "  not publicly bound"

note "ALL CHECKS PASSED"
