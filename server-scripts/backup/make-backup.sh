#!/usr/bin/env bash
# Build a portable, self-contained restore bundle for B Visible.
#
# Run as root ON THE SERVER BEING RETIRED. Produces a single .tar.gz that,
# together with the GitHub repo, is everything needed to stand the app back up
# on a fresh Ubuntu box via the restore.sh it carries inside.
#
# The bundle carries STATE only (database, uploads, config shape). Application
# code is NOT included -- it is cloned from git at a pinned commit, so the
# bundle stays small and the code provenance stays auditable.
#
# Secrets are deliberately NOT copied verbatim. See build_env_template().
set -euo pipefail

ROOT="/opt/bvisible"
ENV_FILE="$ROOT/shared/env/.env"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${OUT_DIR:-$ROOT/backups}"
WORK="$(mktemp -d /tmp/bvisible-bundle.XXXXXX)"
BUNDLE="$OUT_DIR/bvisible-restore-$STAMP.tar.gz"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '\n[make-backup] %s\n' "$*"; }
die() { printf '\n[make-backup] FATAL: %s\n' "$*" >&2; exit 1; }

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# ---------------------------------------------------------------- preflight --
[ "$(id -u)" -eq 0 ] || die "must run as root"
[ -f "$ENV_FILE" ]   || die "no .env at $ENV_FILE"
command -v docker >/dev/null || die "docker not found"
docker inspect bvisible-db >/dev/null 2>&1 || die "container bvisible-db not running"

# Read DB coordinates out of the live .env rather than guessing.
get_env() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d "\"'"; }
PG_USER="$(get_env POSTGRES_USER)"
PG_DB="$(get_env POSTGRES_DB)"
[ -n "$PG_USER" ] && [ -n "$PG_DB" ] || die "POSTGRES_USER/POSTGRES_DB missing from .env"

# Free space check: uploads + db + slack, in KB.
UPLOADS_KB="$(du -sk "$ROOT/shared/uploads" 2>/dev/null | cut -f1)"
NEED_KB=$(( ${UPLOADS_KB:-0} + 512000 ))
AVAIL_KB=$(df -Pk "$OUT_DIR" | awk 'NR==2{print $4}')
[ "$AVAIL_KB" -gt "$NEED_KB" ] || die "need ~${NEED_KB}KB free in $OUT_DIR, have ${AVAIL_KB}KB"

mkdir -p "$WORK"/{db,uploads,config/systemd,config/cron}
umask 077

# ------------------------------------------------------------------ database --
# Custom format (-Fc): compressed, and restorable with pg_restore -j for speed.
# Single database only -- NOT pg_dumpall. Cluster-wide role password hashes are
# intentionally left behind; the new server mints its own.
log "Dumping database '$PG_DB' (custom format)"
docker exec bvisible-db pg_dump -U "$PG_USER" -d "$PG_DB" -Fc --no-owner --no-acl \
  > "$WORK/db/bvisible.dump"
[ -s "$WORK/db/bvisible.dump" ] || die "database dump is empty"
docker exec bvisible-db pg_dump -U "$PG_USER" -d "$PG_DB" --schema-only --no-owner --no-acl \
  > "$WORK/db/schema-reference.sql" || true

# ------------------------------------------------------------------- uploads --
log "Archiving uploads ($(du -sh "$ROOT/shared/uploads" | cut -f1))"
tar -czf "$WORK/uploads/uploads.tar.gz" -C "$ROOT/shared" uploads

# -------------------------------------------------------------------- config --
log "Capturing configuration"
cp "$ROOT/app/ecosystem.config.cjs" "$WORK/config/" 2>/dev/null || true
cp /etc/nginx/sites-available/bvisible "$WORK/config/nginx-bvisible.conf" 2>/dev/null \
  || cp /etc/nginx/sites-enabled/bvisible "$WORK/config/nginx-bvisible.conf" 2>/dev/null || true
for u in /etc/systemd/system/bvisible-*.service /etc/systemd/system/bvisible-*.timer; do
  [ -e "$u" ] && cp "$u" "$WORK/config/systemd/"
done
cp "$ROOT"/cron/*.sh "$WORK/config/cron/" 2>/dev/null || true

# --------------------------------------------------------------------- env ----
# The old .env is compromised as of the 2026-08-13 incident. Carry the SHAPE and
# the non-secret values; blank every secret so the restore cannot silently
# resurrect a leaked credential.
build_env_template() {
  local out="$1"
  local secrets="POSTGRES_PASSWORD SMTP_PASSWORD SHEETS_WRITEBACK_SA_KEY INGEST_SECRET INGEST_TICK_SECRET DATABASE_URL"
  {
    echo "# B Visible environment -- generated $STAMP by make-backup.sh"
    echo "# Non-secret values are preserved. Every secret below was blanked on"
    echo "# purpose: the previous values left the old server and must not return."
    echo "#"
    echo "#   AUTO   restore.sh generates a fresh random value if left blank"
    echo "#   REISSUE you must mint a new one from the provider before restoring"
    echo ""
  } > "$out"
  while IFS= read -r line; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    local key="${line%%=*}"
    if echo "$secrets" | grep -qw "$key"; then
      case "$key" in
        POSTGRES_PASSWORD|INGEST_SECRET|INGEST_TICK_SECRET)
          echo "# AUTO -- leave blank and restore.sh will generate one" >> "$out"
          echo "$key=" >> "$out" ;;
        DATABASE_URL)
          echo "# AUTO -- rebuilt by restore.sh from POSTGRES_* values" >> "$out"
          echo "$key=" >> "$out" ;;
        SMTP_PASSWORD)
          echo "# REISSUE -- change the mailbox password, then paste it here" >> "$out"
          echo "$key=" >> "$out" ;;
        SHEETS_WRITEBACK_SA_KEY)
          echo "# REISSUE -- delete the old Google service-account key, create a" >> "$out"
          echo "# new one, and paste it as ONE line with literal \\n escapes." >> "$out"
          echo "$key=" >> "$out" ;;
      esac
    else
      echo "$line" >> "$out"
    fi
  done < "$ENV_FILE"
}
build_env_template "$WORK/config/env.template"

# ------------------------------------------------------------------ manifest --
COMMIT="$(git -C "$ROOT/app" rev-parse HEAD 2>/dev/null || echo unknown)"
BRANCH="$(git -C "$ROOT/app" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
REPO="$(git -C "$ROOT/app" config --get remote.origin.url 2>/dev/null || echo unknown)"

cat > "$WORK/MANIFEST.txt" <<EOF
B Visible restore bundle
========================
created         : $STAMP (UTC)
source host     : $(hostname) / $(hostname -I | awk '{print $1}')
os              : $(. /etc/os-release; echo "$PRETTY_NAME")

repo            : $REPO
branch          : $BRANCH
commit          : $COMMIT

postgres        : $(docker exec bvisible-db postgres --version 2>/dev/null | awk '{print $3}') (image postgres:16-alpine)
node            : $(su - deploy -c 'node --version' 2>/dev/null || echo unknown)
pnpm            : $(su - deploy -c 'pnpm --version' 2>/dev/null || echo unknown)

database        : $PG_DB (user $PG_USER)
db dump bytes   : $(stat -c %s "$WORK/db/bvisible.dump")
uploads bytes   : $(stat -c %s "$WORK/uploads/uploads.tar.gz")
uploads files   : $(find "$ROOT/shared/uploads" -type f | wc -l)

CONTENTS
  db/bvisible.dump        pg_dump -Fc of the application database
  db/schema-reference.sql schema-only dump, for eyeballing/diffing
  uploads/uploads.tar.gz  everything under shared/uploads
  config/                 nginx site, systemd units, cron scripts, pm2 config
  config/env.template     env shape with all secrets blanked
  restore.sh              one-command rebuild on a fresh Ubuntu 24.04 host

RESTORE
  tar -xzf <this bundle>.tar.gz
  cd bvisible-restore-$STAMP
  sudo ./restore.sh --domain your.domain.com

NOTE
  Application code is not in this bundle. restore.sh clones $REPO
  at commit $COMMIT. Keep that repo reachable, or the bundle
  cannot rebuild the app.
EOF

# ----------------------------------------------------------------- assemble --
cp "$SCRIPT_DIR/restore.sh" "$WORK/restore.sh"
chmod 755 "$WORK/restore.sh"

log "Checksumming"
( cd "$WORK" && find . -type f ! -name checksums.sha256 -print0 \
    | sort -z | xargs -0 sha256sum > checksums.sha256 )

mkdir -p "$OUT_DIR"
STAGE="$(mktemp -d /tmp/bvisible-stage.XXXXXX)"
mv "$WORK" "$STAGE/bvisible-restore-$STAMP"
tar -czf "$BUNDLE" -C "$STAGE" "bvisible-restore-$STAMP"
rm -rf "$STAGE"
WORK="$(mktemp -d)"  # keep the EXIT trap harmless

chmod 600 "$BUNDLE"
log "Verifying bundle integrity"
gzip -t "$BUNDLE" || die "bundle failed gzip verification"

cat <<EOF

================================================================
  BUNDLE READY
================================================================
  path   : $BUNDLE
  size   : $(du -h "$BUNDLE" | cut -f1)
  sha256 : $(sha256sum "$BUNDLE" | cut -d' ' -f1)

  Download it, then verify the checksum matches on your machine:

    scp -i ~/.ssh/cursor_bvisible root@$(hostname -I | awk '{print $1}'):$BUNDLE .
    sha256sum $(basename "$BUNDLE")

  This bundle contains your full customer database. Treat it as
  sensitive: keep it encrypted at rest and off shared storage.
================================================================
EOF
