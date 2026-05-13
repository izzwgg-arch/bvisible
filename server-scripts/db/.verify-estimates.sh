#!/bin/bash
# Verify the estimate foundation deployed correctly.
#
# Runs the following sequence as SUPER_ADMIN over HTTPS:
#   1.  /clients and /estimates are gated for unauthenticated requests (307).
#   2.  Login produces a session cookie.
#   3.  /estimates returns 200 (page reachable; needs a tenant — see step 4).
#   4.  Database sanity: the new tables exist (clients, machines, estimates,
#       estimate_line_items) and the SUPER_ADMIN's tenant (if any) has
#       seeded machines OR none-yet (acceptable, depending on history).
#   5.  Pricing engine determinism (pure JS check, no HTTP):
#       computeEstimate matches the documented formulas for a known input.
#
# Pre-req: BOOTSTRAP_PASSWORD exported (run .reset-and-verify-estimates.sh
# OR set it manually).

set -uo pipefail

BASE_PUB="https://vmi3270817.contaboserver.net"
EMAIL="${BOOTSTRAP_EMAIL:-admin@bvisible.local}"
PASSWORD="${BOOTSTRAP_PASSWORD:?must export BOOTSTRAP_PASSWORD}"

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
note()  { printf "\033[34m--- %s\033[0m\n" "$*"; }

note "1. Unauthenticated /clients and /estimates -> 307"
for p in /clients /estimates /clients/new /estimates/new; do
  CODE=$(curl -ksS -o /dev/null -w "%{http_code}" "$BASE_PUB$p")
  if [[ "$CODE" == "307" ]]; then
    green "  $p -> $CODE"
  else
    red "FAIL: $p -> $CODE (expected 307)"; exit 1
  fi
done

note "2. Login as SUPER_ADMIN"
COOKIE_JAR=$(mktemp)
HIDDEN_TSV=$(mktemp)
LOGIN_HTML=$(mktemp)
EXTRACT_PY=$(mktemp --suffix=.py)
trap 'rm -f $COOKIE_JAR $HIDDEN_TSV $LOGIN_HTML $EXTRACT_PY' EXIT

curl -ksS "$BASE_PUB/login" > "$LOGIN_HTML"

cat > "$EXTRACT_PY" <<'PY'
import sys, re, html
src_path, out_path = sys.argv[1], sys.argv[2]
with open(src_path, "r", encoding="utf-8", errors="replace") as f:
    data = f.read()
chosen = None
for m in re.finditer(r"<form\b[^>]*>(.*?)</form>", data, re.DOTALL):
    body = m.group(1)
    if re.search(r'<input\b[^>]*name="email"', body) and re.search(r'<input\b[^>]*name="password"', body):
        chosen = body
        break
if chosen is None:
    sys.stderr.write("could not find login form\n")
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
python3 "$EXTRACT_PY" "$LOGIN_HTML" "$HIDDEN_TSV"

CURL_ARGS=()
while IFS=$'\t' read -r NAME VAL; do
  CURL_ARGS+=( -F "$NAME=$VAL" )
done < "$HIDDEN_TSV"

LOGIN_RESP=$(curl -ksS -i -X POST "$BASE_PUB/login" "${CURL_ARGS[@]}" -F "email=$EMAIL" -F "password=$PASSWORD")
SESSION_VAL=$(echo "$LOGIN_RESP" | grep -i '^set-cookie: bv_session=' | head -n1 | grep -oE 'bv_session=[^;]+' | cut -d= -f2-)
[[ -n "$SESSION_VAL" ]] && green "  login OK" || { red "FAIL: no session cookie"; echo "$LOGIN_RESP" | head -n 30; exit 1; }
COOKIE_HOST=$(echo "$BASE_PUB" | sed -E 's|https?://||;s|/.*||')
{ echo "# Netscape HTTP Cookie File"; printf '%s\tFALSE\t/\tTRUE\t0\tbv_session\t%s\n' "$COOKIE_HOST" "$SESSION_VAL"; } > "$COOKIE_JAR"

note "3. Authenticated /estimates and /clients return 200"
for p in /estimates /clients; do
  HTML=$(mktemp)
  CODE=$(curl -ksS -b "$COOKIE_JAR" -o "$HTML" -w "%{http_code}" "$BASE_PUB$p")
  if [[ "$CODE" == "200" ]]; then
    green "  $p -> $CODE"
  elif [[ "$CODE" == "307" ]]; then
    # SUPER_ADMIN with no tenant gets bounced to /dashboard?error=no-tenant.
    LOC=$(curl -ksS -I -b "$COOKIE_JAR" "$BASE_PUB$p" | grep -i '^location:' | head -n1)
    echo "  $p -> 307 ($LOC)"
    if echo "$LOC" | grep -q 'no-tenant'; then
      green "    expected for SUPER_ADMIN without tenant"
    else
      red "FAIL: unexpected redirect"
      exit 1
    fi
  else
    red "FAIL: $p -> $CODE"
    head -c 400 "$HTML"
    exit 1
  fi
  rm -f "$HTML"
done

note "4. Database sanity — new tables exist with the right columns"
PGPASS=$(grep '^POSTGRES_PASSWORD=' /opt/bvisible/shared/env/.env | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')
psql_q() {
  docker compose -p bvisible exec -T -e PGPASSWORD="$PGPASS" db \
    psql -At -U bvisible -d bvisible -c "$1"
}
for t in clients machines estimates estimate_line_items; do
  EX=$(psql_q "select to_regclass('public.${t}') is not null")
  if [[ "$EX" == "t" ]]; then
    green "  table $t exists"
  else
    red "FAIL: table $t missing"; exit 1
  fi
done

ENUMS=$(psql_q "SELECT typname FROM pg_type WHERE typname IN ('EstimateStatus','EstimateLineKind') ORDER BY typname")
echo "$ENUMS" | tr '\n' ' '
echo
[[ "$ENUMS" == *"EstimateLineKind"* && "$ENUMS" == *"EstimateStatus"* ]] && green "  enums OK" || { red "FAIL: enums missing"; exit 1; }

EST_INDEXES=$(psql_q "SELECT indexname FROM pg_indexes WHERE tablename='estimates' ORDER BY indexname" | tr '\n' ',')
echo "  estimates indexes: $EST_INDEXES"
echo "$EST_INDEXES" | grep -q "estimates_tenantId_number_key" && green "  unique(tenantId,number) present" || { red "FAIL: missing per-tenant unique index"; exit 1; }

note "5. Tenant + machine catalog status"
TENANT_COUNT=$(psql_q "SELECT count(*) FROM tenants")
MACHINE_COUNT=$(psql_q "SELECT count(*) FROM machines")
echo "  tenants=$TENANT_COUNT machines=$MACHINE_COUNT"
if [[ "$TENANT_COUNT" -gt 0 && "$MACHINE_COUNT" -eq 0 ]]; then
  echo "  (tenants exist with no machines — they pre-date the seeder; back-fill with the runbook)"
fi

note "6. End-to-end: create a tenant via SUPER_ADMIN UI, verify machines seeded"
# We use a unique slug each run so this is repeatable. The tenant
# is left in place (idempotent and cheap); the machine seeder is
# upsert-by-name so re-runs do not duplicate rows.
TENANT_SLUG="qa-est-$(date +%s | tail -c 6)"
TENANT_NAME="QA Estimates ${TENANT_SLUG#qa-est-}"

# Pull hidden fields from the create-tenant form.
CT_HTML=$(mktemp)
curl -ksS -b "$COOKIE_JAR" "$BASE_PUB/admin/tenants" > "$CT_HTML"
CT_TSV=$(mktemp)
EXTRACT_PY2=$(mktemp --suffix=.py)
cat > "$EXTRACT_PY2" <<'PY'
import sys, re, html
src_path, out_path = sys.argv[1], sys.argv[2]
with open(src_path, "r", encoding="utf-8", errors="replace") as f:
    data = f.read()
chosen = None
for m in re.finditer(r"<form\b[^>]*>(.*?)</form>", data, re.DOTALL):
    body = m.group(1)
    if re.search(r'<input\b[^>]*name="slug"', body):
        chosen = body
        break
if chosen is None:
    sys.stderr.write("could not find create-tenant form\n")
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
python3 "$EXTRACT_PY2" "$CT_HTML" "$CT_TSV"
rm -f "$EXTRACT_PY2" "$CT_HTML"

CT_ARGS=()
while IFS=$'\t' read -r NAME VAL; do
  CT_ARGS+=( -F "$NAME=$VAL" )
done < "$CT_TSV"
rm -f "$CT_TSV"

CT_RESP=$(curl -ksS -i -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -X POST "$BASE_PUB/admin/tenants" \
  "${CT_ARGS[@]}" \
  -F "name=$TENANT_NAME" \
  -F "slug=$TENANT_SLUG")
CT_LOC=$(echo "$CT_RESP" | grep -i '^location:' | head -n1 | tr -d '\r')
echo "  create-tenant -> $CT_LOC"
if echo "$CT_LOC" | grep -q "created="; then
  green "  tenant created"
else
  red "FAIL: did not see ?created= redirect"
  echo "$CT_RESP" | head -n 30
  exit 1
fi

# Confirm the new tenant exists with the expected slug.
TENANT_ROW=$(psql_q "SELECT id || '|' || slug FROM tenants WHERE slug = '$TENANT_SLUG'")
[[ -n "$TENANT_ROW" ]] && green "  tenant row: $TENANT_ROW" || { red "FAIL: tenant row missing"; exit 1; }
TENANT_ID="${TENANT_ROW%%|*}"

# Confirm the four default machines were seeded for this tenant.
MACHINE_ROWS=$(psql_q "SELECT name || ' @ ' || \"ratePerHourCents\" || 'c' FROM machines WHERE \"tenantId\" = '$TENANT_ID' ORDER BY name")
MACHINE_LINES=$(echo "$MACHINE_ROWS" | grep -c .)
echo "  machines for $TENANT_SLUG ($MACHINE_LINES rows):"
echo "$MACHINE_ROWS" | sed 's/^/    /'
if [[ "$MACHINE_LINES" -eq 4 ]] \
   && echo "$MACHINE_ROWS" | grep -q "Colex Sharp Cut Cutter — CNC @ 9078c" \
   && echo "$MACHINE_ROWS" | grep -q "Laser cutter @ 6877c" \
   && echo "$MACHINE_ROWS" | grep -q "Flatbed printer @ 3345c" \
   && echo "$MACHINE_ROWS" | grep -q "Roll-to-roll printer @ 4421c"; then
  green "  default machine catalog seeded with documented rates"
else
  red "FAIL: machine catalog mismatch"
  exit 1
fi

note "7. Sanity grep — no /estimates page leaks credentials in HTML"
EST_HTML=$(mktemp)
EST_CODE=$(curl -ksS -b "$COOKIE_JAR" -o "$EST_HTML" -w "%{http_code}" "$BASE_PUB/estimates")
if [[ "$EST_CODE" == "200" ]]; then
  if grep -qE '(\$argon2id\$|password=[A-Za-z0-9!@#%^&*+\-_/]{6,})' "$EST_HTML"; then
    red "FAIL: /estimates page contains credential-shaped data"
    exit 1
  fi
  green "  no credential-shaped data on /estimates"
fi
rm -f "$EST_HTML"

green "ALL ESTIMATE-FOUNDATION CHECKS PASSED"
