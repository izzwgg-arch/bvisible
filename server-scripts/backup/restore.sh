#!/usr/bin/env bash
# Rebuild B Visible on a fresh Ubuntu 24.04 host from a restore bundle.
#
#   sudo ./restore.sh --domain app.example.com
#
# Ships inside the bundle produced by make-backup.sh and expects to be run from
# the extracted bundle directory. Idempotent enough to re-run after a failure:
# each step checks for its own prior work before redoing it.
#
# Application code is cloned from git at the commit pinned in MANIFEST.txt.
# State (database, uploads) comes from the bundle. Secrets come from you.
set -euo pipefail

BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="/opt/bvisible"
DEPLOY_USER="deploy"
ENV_OUT="$ROOT/shared/env/.env"
NODE_MAJOR=22

DOMAIN=""
ENV_FILE=""
REPO_URL=""
BRANCH=""
COMMIT=""
SSH_ALLOW=""
SKIP_CERTBOT=0

log()  { printf '\n\033[1m[restore] %s\033[0m\n' "$*"; }
warn() { printf '\n[restore] WARNING: %s\n' "$*" >&2; }
die()  { printf '\n[restore] FATAL: %s\n' "$*" >&2; exit 1; }
step() { printf '\n──────── %s\n' "$*"; }

usage() {
  cat <<EOF
Usage: sudo ./restore.sh --domain <fqdn> [options]

  --domain <fqdn>     Public hostname for nginx + TLS. Required.
  --env-file <path>   Pre-filled .env. If omitted, restore.sh writes
                      ./env.filled from the template and asks you to
                      complete the REISSUE fields, then re-run.
  --ssh-allow <cidr>  Restrict SSH to this CIDR (e.g. 50.48.0.0/15).
                      Omit to leave SSH open to all sources.
  --repo <url>        Override repo URL from MANIFEST.txt.
  --commit <sha>      Override commit from MANIFEST.txt.
  --skip-certbot      Configure nginx on :80 only, no TLS issuance.
  -h, --help          This message.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)       DOMAIN="$2"; shift 2 ;;
    --env-file)     ENV_FILE="$2"; shift 2 ;;
    --ssh-allow)    SSH_ALLOW="$2"; shift 2 ;;
    --repo)         REPO_URL="$2"; shift 2 ;;
    --commit)       COMMIT="$2"; shift 2 ;;
    --skip-certbot) SKIP_CERTBOT=1; shift ;;
    -h|--help)      usage; exit 0 ;;
    *)              die "unknown argument: $1" ;;
  esac
done

# ================================================================= preflight ==
step "Preflight"
[ "$(id -u)" -eq 0 ] || die "must run as root (use sudo)"
[ -n "$DOMAIN" ]     || { usage; die "--domain is required"; }
[ -f "$BUNDLE_DIR/MANIFEST.txt" ] || die "MANIFEST.txt not found -- run this from inside the extracted bundle"
[ -f "$BUNDLE_DIR/db/bvisible.dump" ] || die "db/bvisible.dump missing from bundle"

. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || warn "tested on Ubuntu 24.04; found ${PRETTY_NAME:-unknown}"

log "Verifying bundle checksums"
( cd "$BUNDLE_DIR" && sha256sum -c checksums.sha256 --quiet ) \
  || die "bundle checksum mismatch -- the archive is corrupt or was tampered with"

# Split on the FIRST colon only -- repo URLs contain one ("https://").
manifest() { grep -E "^$1 " "$BUNDLE_DIR/MANIFEST.txt" | head -1 | sed 's/^[^:]*: *//'; }
[ -n "$REPO_URL" ] || REPO_URL="$(manifest repo)"
[ -n "$COMMIT" ]   || COMMIT="$(manifest commit)"
BRANCH="$(manifest branch)"
[ -n "$REPO_URL" ] && [ "$REPO_URL" != unknown ] || die "no repo URL in manifest; pass --repo"
[ -n "$COMMIT" ]   && [ "$COMMIT" != unknown ]   || die "no commit in manifest; pass --commit"

AVAIL_GB=$(df -PBG / | awk 'NR==2{gsub("G","",$4); print $4}')
[ "$AVAIL_GB" -ge 10 ] || die "need at least 10GB free on /, have ${AVAIL_GB}G"

log "Restoring commit $COMMIT (branch $BRANCH) from $REPO_URL onto $DOMAIN"

# ============================================================ 1. environment ==
step "1/10  Environment file"
if [ -z "$ENV_FILE" ]; then
  ENV_FILE="$BUNDLE_DIR/env.filled"
  if [ ! -f "$ENV_FILE" ]; then
    cp "$BUNDLE_DIR/config/env.template" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    cat <<EOF

  Wrote $ENV_FILE

  Fill in ONE field, then run this script again:

    SHEETS_WRITEBACK_SA_KEY   new Google service-account key, as ONE line
                              with literal \\n escapes (not real newlines)

  Leave everything else blank. The AUTO fields are generated for you, and
  SMTP_* stay empty on purpose -- mail settings live in the smtp_config
  table and are re-entered through Settings > Email after the restore.

EOF
    exit 2
  fi
fi
[ -f "$ENV_FILE" ] || die "env file not found: $ENV_FILE"

get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d "\"'"; }
# Only the Sheets key is required here. SMTP_* in .env are intentionally empty
# in production -- mail settings live in the smtp_config table and are entered
# through Settings > Email, so requiring SMTP_PASSWORD would block a valid
# restore.
[ -n "$(get SHEETS_WRITEBACK_SA_KEY)" ] \
  || die "SHEETS_WRITEBACK_SA_KEY is still blank in $ENV_FILE -- reissue it first"

PG_USER="$(get POSTGRES_USER)"; PG_DB="$(get POSTGRES_DB)"
[ -n "$PG_USER" ] && [ -n "$PG_DB" ] || die "POSTGRES_USER/POSTGRES_DB missing from $ENV_FILE"

gen() { openssl rand -hex 32; }
PG_PASS="$(get POSTGRES_PASSWORD)"; [ -n "$PG_PASS" ] || { PG_PASS="$(gen)"; log "Generated POSTGRES_PASSWORD"; }
ING="$(get INGEST_SECRET)";         [ -n "$ING" ]     || { ING="$(gen)";     log "Generated INGEST_SECRET"; }
ING_TICK="$(get INGEST_TICK_SECRET)"; [ -n "$ING_TICK" ] || { ING_TICK="$(gen)"; log "Generated INGEST_TICK_SECRET"; }

# ========================================================== 2. base packages ==
step "2/10  Base packages and runtimes"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git rsync ufw fail2ban nginx \
  sysstat openssl >/dev/null

if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  systemctl enable --now docker
fi

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt "$NODE_MAJOR" ]; then
  log "Installing Node $NODE_MAJOR"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
corepack enable >/dev/null 2>&1 || true
corepack prepare pnpm@latest --activate >/dev/null 2>&1 || true

# Chromium libs for Playwright-backed PDF export.
apt-get install -y -qq libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 \
  libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 >/dev/null 2>&1 || \
  warn "some chromium libs failed to install; PDF export may need attention"

# ============================================================ 3. deploy user ==
step "3/10  Deploy user"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
  log "Created user $DEPLOY_USER"
fi
usermod -aG sudo,docker "$DEPLOY_USER"
# The deploy worker runs unattended and installs systemd units, so it needs
# passwordless sudo. This mirrors the retired server exactly; scope it down in
# /etc/sudoers.d/90-deploy later if you want a smaller blast radius.
echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-deploy
chmod 440 /etc/sudoers.d/90-deploy
visudo -cf /etc/sudoers.d/90-deploy >/dev/null || die "sudoers file for $DEPLOY_USER is invalid"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 700 "/home/$DEPLOY_USER/.ssh"

# ================================================================ 4. sources ==
step "4/10  Application source at pinned commit"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 755 "$ROOT" "$ROOT/app"
# The tree is owned by deploy but root also runs git against it below; without
# this, git 2.35+ refuses with "detected dubious ownership".
git config --global --add safe.directory "$ROOT/app"
if [ ! -d "$ROOT/app/.git" ]; then
  sudo -u "$DEPLOY_USER" git clone "$REPO_URL" "$ROOT/app"
fi
sudo -u "$DEPLOY_USER" git -C "$ROOT/app" fetch --all --tags --prune
sudo -u "$DEPLOY_USER" git -C "$ROOT/app" checkout --force "$COMMIT"
log "Checked out $(git -C "$ROOT/app" rev-parse --short HEAD)"

# ============================================================== 5. filesystem ==
step "5/10  Directory layout and deploy queue"
# 04-layout-and-queue.sh reads its inputs from /root/deploy-queue.
install -d -m 755 /root/deploy-queue
cp "$ROOT/app/server-scripts/deploy-queue/"* /root/deploy-queue/
# 04-layout-and-queue.sh copies six scripts from here, but db-verify.sh is not
# one of the repo's deploy-queue/ files -- it lives under server-scripts/db/.
cp "$ROOT/app/server-scripts/db/db-verify.sh" /root/deploy-queue/
cp "$ROOT/app/server-scripts/cron/"*.service /root/deploy-queue/ 2>/dev/null || true
cp "$ROOT/app/server-scripts/cron/"*.timer   /root/deploy-queue/ 2>/dev/null || true
bash "$ROOT/app/server-scripts/04-layout-and-queue.sh"

install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 750 "$ROOT/cron"
cp "$ROOT/app/server-scripts/cron/"*.sh "$ROOT/cron/" 2>/dev/null || true
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$ROOT/cron"
chmod 750 "$ROOT/cron/"*.sh 2>/dev/null || true

# ============================================================== 6. env write ==
step "6/10  Writing .env"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 750 "$ROOT/shared/env"
DB_URL="postgresql://$PG_USER:$PG_PASS@127.0.0.1:5432/$PG_DB?schema=public"
{
  grep -vE '^(POSTGRES_PASSWORD|INGEST_SECRET|INGEST_TICK_SECRET|DATABASE_URL|APP_BASE_URL)=' "$ENV_FILE" \
    | grep -vE '^#' | grep -vE '^$'
  echo "POSTGRES_PASSWORD=$PG_PASS"
  echo "INGEST_SECRET=$ING"
  echo "INGEST_TICK_SECRET=$ING_TICK"
  echo "DATABASE_URL=$DB_URL"
  echo "APP_BASE_URL=https://$DOMAIN"
} > "$ENV_OUT"
chown "$DEPLOY_USER:$DEPLOY_USER" "$ENV_OUT"
chmod 640 "$ENV_OUT"
log "Wrote $ENV_OUT (640 $DEPLOY_USER:$DEPLOY_USER)"

# =============================================================== 7. postgres ==
step "7/10  PostgreSQL container"
docker network inspect bvisible_internal >/dev/null 2>&1 || docker network create bvisible_internal
docker volume  inspect bvisible_pgdata   >/dev/null 2>&1 || docker volume  create bvisible_pgdata

if ! docker inspect bvisible-db >/dev/null 2>&1; then
  docker run -d \
    --name bvisible-db \
    --network bvisible_internal \
    --restart unless-stopped \
    -e POSTGRES_USER="$PG_USER" \
    -e POSTGRES_PASSWORD="$PG_PASS" \
    -e POSTGRES_DB="$PG_DB" \
    -e POSTGRES_INITDB_ARGS="--data-checksums" \
    -p 127.0.0.1:5432:5432 \
    -v bvisible_pgdata:/var/lib/postgresql/data \
    -v "$ROOT/app/server-scripts/db/init:/docker-entrypoint-initdb.d:ro" \
    postgres:16-alpine
  log "Started bvisible-db"
fi

log "Waiting for PostgreSQL to accept connections"
for i in $(seq 1 60); do
  docker exec bvisible-db pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1 && break
  [ "$i" -eq 60 ] && die "postgres did not become ready within 60s"
  sleep 1
done

# ============================================================ 8. data restore ==
step "8/10  Restoring database and uploads"
ALREADY=$(docker exec bvisible-db psql -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo 0)
if [ "${ALREADY:-0}" -gt 0 ]; then
  warn "database already has $ALREADY tables -- skipping restore (drop the volume to force a clean restore)"
else
  docker cp "$BUNDLE_DIR/db/bvisible.dump" bvisible-db:/tmp/bvisible.dump
  docker exec bvisible-db pg_restore -U "$PG_USER" -d "$PG_DB" \
    --no-owner --no-acl -j 4 /tmp/bvisible.dump
  docker exec bvisible-db rm -f /tmp/bvisible.dump
  RESTORED=$(docker exec bvisible-db psql -U "$PG_USER" -d "$PG_DB" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
  log "Restored $RESTORED tables"
fi

install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 755 "$ROOT/shared"
tar -xzf "$BUNDLE_DIR/uploads/uploads.tar.gz" -C "$ROOT/shared"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$ROOT/shared/uploads"
log "Restored $(find "$ROOT/shared/uploads" -type f | wc -l) upload files"

# Secrets sealed by lib/email-ingest/crypto.ts use a key derived from
# INGEST_SECRET. A fresh INGEST_SECRET (which is the point, post-incident)
# means every stored ciphertext is now undecryptable. Surface that here rather
# than letting mail fail mysteriously days later.
# length(col) > 0 rather than col <> '': no empty-string literals to quote, and
# NULL columns fall out naturally since length(NULL) > 0 is NULL, not true.
# A failing probe must be loud -- reporting 0 would read as "nothing to redo".
q() {
  local out
  if ! out="$(docker exec bvisible-db psql -U "$PG_USER" -d "$PG_DB" -tAc "$1" 2>&1)"; then
    warn "sealed-secret probe failed, assuming secrets need re-entry: $out"
    echo "?"
    return
  fi
  echo "$out"
}
SEALED_SMTP=$(q 'SELECT count(*) FROM smtp_config WHERE length("passwordCipher") > 0')
SEALED_IMAP=$(q 'SELECT count(*) FROM tenant_email_inboxes WHERE length("passwordCipher") > 0')
SEALED_AI=$(q 'SELECT count(*) FROM assistant_settings WHERE length("apiKeyCipher") > 0 OR length("ylApiKeyCipher") > 0')
case "$SEALED_SMTP$SEALED_IMAP$SEALED_AI" in
  *\?*) RESEAL_TOTAL="an unknown number of" ;;
  *)    RESEAL_TOTAL=$(( SEALED_SMTP + SEALED_IMAP + SEALED_AI )) ;;
esac

# ============================================================ 9. web + build ==
step "9/10  nginx, TLS, and application build"
if [ -f "$BUNDLE_DIR/config/nginx-bvisible.conf" ]; then
  sed "s/vmi3270817\.contaboserver\.net/$DOMAIN/g; s/server_name .*;/server_name $DOMAIN;/" \
    "$BUNDLE_DIR/config/nginx-bvisible.conf" > /etc/nginx/sites-available/bvisible
else
  cp "$ROOT/app/server-scripts/nginx/bvisible.conf" /etc/nginx/sites-available/bvisible
  sed -i "s/server_name .*;/server_name $DOMAIN;/" /etc/nginx/sites-available/bvisible
fi
ln -sfn /etc/nginx/sites-available/bvisible /etc/nginx/sites-enabled/bvisible
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

for u in "$BUNDLE_DIR"/config/systemd/*.service "$BUNDLE_DIR"/config/systemd/*.timer; do
  [ -e "$u" ] && cp "$u" /etc/systemd/system/
done
systemctl daemon-reload
for t in /etc/systemd/system/bvisible-*.timer; do
  [ -e "$t" ] && systemctl enable --now "$(basename "$t")" || true
done

log "Building the application (this takes several minutes)"
JOB="$ROOT/deploy-queue/jobs/$(date -u +%Y%m%dT%H%M%S)-restore.json"
cat > "$JOB" <<EOF
{
  "repoUrl": "$REPO_URL",
  "branch": "$BRANCH",
  "commitHash": "$COMMIT",
  "requestedBy": "restore.sh",
  "services": [],
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
chown "$DEPLOY_USER:$DEPLOY_USER" "$JOB"
sudo -u "$DEPLOY_USER" bash "$ROOT/deploy-queue/deploy-worker.sh" || die "build failed -- see $ROOT/deploy-queue/logs/"

if [ "$SKIP_CERTBOT" -eq 0 ]; then
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
    || warn "certbot failed -- DNS may not point here yet. Re-run: certbot --nginx -d $DOMAIN"
fi

# ============================================================ 10. hardening ===
step "10/10  Hardening"
# Key-only SSH. The 00- prefix matters: sshd_config is first-match-wins and
# cloud-init writes PasswordAuthentication yes into 50-cloud-init.conf on boot.
cat > /etc/ssh/sshd_config.d/00-hardening.conf <<'EOF'
PasswordAuthentication no
PermitRootLogin prohibit-password
KbdInteractiveAuthentication no
PubkeyAuthentication yes
EOF
sshd -t && systemctl reload ssh && log "SSH is key-only"

ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
if [ -n "$SSH_ALLOW" ]; then
  ufw allow from "$SSH_ALLOW" to any port 22 proto tcp comment 'ssh: allowlist' >/dev/null
  log "SSH restricted to $SSH_ALLOW"
else
  ufw allow 22/tcp >/dev/null
  warn "SSH is open to all sources -- pass --ssh-allow <cidr> to restrict it"
fi
ufw allow 80/tcp  >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

mkdir -p /etc/fail2ban/jail.d
cat > /etc/fail2ban/jail.d/sshd.local <<EOF
[sshd]
enabled  = true
port     = ssh
backend  = systemd
maxretry = 5
findtime = 10m
bantime  = 1h
EOF
[ -n "$SSH_ALLOW" ] && cat > /etc/fail2ban/jail.d/allowlist.local <<EOF
[DEFAULT]
ignoreip = 127.0.0.1/8 ::1 $SSH_ALLOW
EOF
systemctl enable --now fail2ban >/dev/null 2>&1 || true
systemctl restart fail2ban >/dev/null 2>&1 || true

sed -i 's/^ENABLED="false"/ENABLED="true"/' /etc/default/sysstat 2>/dev/null || true
systemctl enable --now sysstat >/dev/null 2>&1 || true

# ================================================================== verify ====
step "Verification"
sleep 5
HEALTH="$(curl -fsS --max-time 20 http://127.0.0.1:3000/api/health 2>/dev/null || echo FAILED)"
TABLES="$(docker exec bvisible-db psql -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo '?')"

cat <<EOF

================================================================
  RESTORE COMPLETE
================================================================
  domain     : https://$DOMAIN
  commit     : $COMMIT
  db tables  : $TABLES
  uploads    : $(find "$ROOT/shared/uploads" -type f | wc -l) files
  health     : $HEALTH

  STILL TO DO BY HAND
    1. Add your SSH public key to /root/.ssh/authorized_keys and
       /home/$DEPLOY_USER/.ssh/authorized_keys -- password login is OFF, so do
       this from your current session before you log out.
    2. Point $DOMAIN DNS at this host if you have not already.
    3. RE-ENTER $RESEAL_TOTAL SEALED SECRET(S). INGEST_SECRET was regenerated,
       and it is the key for everything sealed by lib/email-ingest/crypto.ts.
       The restored ciphertexts cannot be decrypted with the new key:
         - smtp_config           : $SEALED_SMTP row(s)  -> Settings > Email
         - tenant_email_inboxes  : $SEALED_IMAP row(s)  -> Admin > Tenants > Email inbox
         - assistant_settings    : $SEALED_AI row(s)   -> Assistant > Settings
       Until these are re-entered, outbound mail and email ingestion will fail.
    4. Confirm the Google service account still has access to the sheet.
    5. Send a test estimate to verify SMTP end to end.
================================================================
EOF
[ "$HEALTH" = FAILED ] && die "health check failed -- inspect $ROOT/shared/logs/pm2/"
exit 0
