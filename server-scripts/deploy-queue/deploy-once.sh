#!/usr/bin/env bash
# Execute exactly one deploy job. Called by deploy-worker.sh.
# Usage: deploy-once.sh <job_json_path> <log_path>
set -euo pipefail

JOB_FILE="${1:?job file required}"
LOG_FILE="${2:?log file required}"

ROOT="/opt/bvisible"
APP_DIR="$ROOT/app"
RELEASES_DIR="$ROOT/releases"
SHARED_DIR="$ROOT/shared"

log() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOG_FILE"; }

log "==== deploy-once START ===="
log "Job file: $JOB_FILE"

if ! command -v jq >/dev/null 2>&1; then
  log "FATAL: jq not installed"
  exit 2
fi

REPO_URL=$(jq -r '.repoUrl // empty'      "$JOB_FILE")
BRANCH=$(jq   -r '.branch // "main"'      "$JOB_FILE")
COMMIT=$(jq   -r '.commitHash // empty'   "$JOB_FILE")
SERVICES=$(jq -r '.services // [] | join(",")' "$JOB_FILE")
WHO=$(jq      -r '.requestedBy // "unknown"' "$JOB_FILE")

log "Requested by: $WHO"
log "Repo:        $REPO_URL"
log "Branch:      $BRANCH"
log "Commit:      $COMMIT"
log "Services:    $SERVICES"

# Hard validations
if [ -z "$REPO_URL" ]; then log "FATAL: repoUrl is required"; exit 3; fi
if [ -z "$COMMIT" ];   then log "FATAL: commitHash is required (no floating deploys)"; exit 3; fi

mkdir -p "$APP_DIR" "$RELEASES_DIR" "$SHARED_DIR"

# Initial clone if app dir is empty
if [ ! -d "$APP_DIR/.git" ]; then
  log "First-time clone of $REPO_URL"
  rm -rf "$APP_DIR"
  git clone --no-single-branch "$REPO_URL" "$APP_DIR" 2>&1 | tee -a "$LOG_FILE"
fi

cd "$APP_DIR"

# Ensure remote URL matches (in case of repo moves)
CURRENT_URL=$(git config --get remote.origin.url || echo "")
if [ "$CURRENT_URL" != "$REPO_URL" ]; then
  log "Updating remote.origin.url $CURRENT_URL -> $REPO_URL"
  git remote set-url origin "$REPO_URL"
fi

log "Fetching origin..."
git fetch --all --prune --tags 2>&1 | tee -a "$LOG_FILE"

# Reject deploys with dirty tracked files
if ! git diff --quiet || ! git diff --cached --quiet; then
  log "FATAL: working tree has dirty tracked files. Refusing to deploy."
  git status --porcelain | tee -a "$LOG_FILE"
  exit 4
fi

# Verify commit exists
if ! git cat-file -e "${COMMIT}^{commit}" 2>/dev/null; then
  log "FATAL: commitHash $COMMIT not found on origin"
  exit 5
fi

log "Checking out $COMMIT (detached)..."
git checkout --detach "$COMMIT" 2>&1 | tee -a "$LOG_FILE"

# Snapshot release for rollback
TS=$(date -u +%Y%m%dT%H%M%SZ)
RELEASE_DIR="$RELEASES_DIR/$TS-$(echo "$COMMIT" | cut -c1-12)"
log "Snapshotting release to $RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
rsync -a --delete --exclude '.git' "$APP_DIR/" "$RELEASE_DIR/"
ln -sfn "$RELEASE_DIR" "$RELEASES_DIR/current"

# Link shared resources into the live working tree
log "Linking shared/env -> $APP_DIR/.env (if not present)"
if [ -f "$SHARED_DIR/env/.env" ] && [ ! -e "$APP_DIR/.env" ]; then
  ln -s "$SHARED_DIR/env/.env" "$APP_DIR/.env"
fi
if [ -d "$SHARED_DIR/uploads" ]; then
  rm -rf "$APP_DIR/uploads" 2>/dev/null || true
  ln -sfn "$SHARED_DIR/uploads" "$APP_DIR/uploads"
fi

# Install + build (only if app actually exists; this is fine to skip on empty repo)
INSTALL_OK=true
BUILD_OK=true
if [ -f "$APP_DIR/package.json" ]; then
  log "Detected package.json — installing deps with pnpm"
  if pnpm install --frozen-lockfile 2>&1 | tee -a "$LOG_FILE"; then
    log "Install OK"
  else
    log "Install failed"
    INSTALL_OK=false
  fi

  if [ "$INSTALL_OK" = "true" ] && jq -e '.scripts.build' "$APP_DIR/package.json" >/dev/null 2>&1; then
    log "Building (NEXT_BUILD_STANDALONE=1 so apps/web emits .next/standalone)..."
    # Standalone output is gated on this env var so local Windows dev builds
    # keep working (symlink EPERM). See apps/web/next.config.mjs.
    if NEXT_BUILD_STANDALONE=1 pnpm run build 2>&1 | tee -a "$LOG_FILE"; then
      log "Build OK"
    else
      log "Build failed"
      BUILD_OK=false
    fi
  fi
else
  log "No package.json — skipping pnpm install/build (foundation deploy)"
fi

if [ "$INSTALL_OK" != "true" ] || [ "$BUILD_OK" != "true" ]; then
  log "FATAL: install or build failed"
  exit 6
fi

# Note: the previous "Restart only requested services" block was removed
# in Phase 3. The web app runs under PM2 (not in compose) and the only
# compose service today (`db`) is brought up explicitly below. The
# `services` array in the job JSON is now informational only.

# ============================================================================
# Database — Postgres in Docker, then prisma migrate deploy
# ============================================================================
if [ -f "$APP_DIR/docker-compose.yml" ] && [ -f "$APP_DIR/packages/db/prisma/schema.prisma" ]; then
  # Read POSTGRES_USER from the live env so pg_isready can target the
  # right user. Failure to read is non-fatal; pg_isready still works
  # without -U (it just won't be tied to a real role).
  PG_USER="$(grep -E '^POSTGRES_USER=' "$SHARED_DIR/env/.env" 2>/dev/null \
              | tail -n 1 \
              | sed -E 's/^POSTGRES_USER=//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')"

  log "Bringing up Postgres (docker compose up -d db, project=bvisible)"
  if ! ( cd "$APP_DIR" && docker compose up -d db ) 2>&1 | tee -a "$LOG_FILE"; then
    log "FATAL: docker compose up -d db failed"
    exit 10
  fi

  log "Waiting for Postgres to be ready (up to 60s)"
  PG_READY=false
  for _ in $(seq 1 30); do
    if ( cd "$APP_DIR" && docker compose exec -T db pg_isready ${PG_USER:+-U "$PG_USER"} >/dev/null 2>&1 ); then
      PG_READY=true
      break
    fi
    sleep 2
  done
  if [ "$PG_READY" != "true" ]; then
    log "FATAL: Postgres did not become ready within 60s"
    ( cd "$APP_DIR" && docker compose logs --tail=80 db ) | tee -a "$LOG_FILE"
    exit 10
  fi
  log "Postgres ready"

  # `pnpm --filter @bvisible/db exec` runs the package's local prisma
  # binary in packages/db's cwd. Prisma's auto .env discovery does NOT
  # walk all the way up to $APP_DIR/.env from packages/db/, so we source
  # the shared env in a subshell and let it inherit. Subshell prevents
  # leaking other secrets into the rest of deploy-once.sh.
  #
  # NOTE: DATABASE_URL in .env MUST be double-quoted because the value
  # contains an unquoted `&` (query string) which bash sourcing would
  # otherwise treat as the background operator. The bootstrap script
  # writes it quoted; see DEBUGGING.md.
  log "Running prisma migrate deploy"
  if ! ( set -a && . "$SHARED_DIR/env/.env" && set +a && cd "$APP_DIR" && pnpm --filter @bvisible/db exec prisma migrate deploy ) 2>&1 | tee -a "$LOG_FILE"; then
    log "FATAL: prisma migrate deploy failed"
    exit 10
  fi
  log "Migrations applied"

  # db-verify is the post-migration sanity gate. If the migration
  # silently produced an empty schema or a missing table, this catches
  # it before we flip PM2 onto a runtime that would crash.
  if [ -x "/opt/bvisible/deploy-queue/db-verify.sh" ]; then
    log "Running /opt/bvisible/deploy-queue/db-verify.sh"
    if ! /opt/bvisible/deploy-queue/db-verify.sh 2>&1 | tee -a "$LOG_FILE"; then
      log "FATAL: db-verify failed"
      exit 11
    fi
  else
    log "WARN: /opt/bvisible/deploy-queue/db-verify.sh missing or not executable; skipping post-migration verification"
  fi
else
  log "No docker-compose.yml or no Prisma schema in working tree — skipping DB phase"
fi

# ============================================================================
# Vendor email ingestion timer — installs/upgrades the systemd timer
# that hits /api/internal/email-ingest/tick. Idempotent. The script
# itself lives under /opt/bvisible/cron/ owned by deploy:deploy. Unit
# files go to /etc/systemd/system/ via sudo (deploy has passwordless
# sudo per AUTH_AND_PERMISSIONS.md).
# ============================================================================
INGEST_SRC="$APP_DIR/server-scripts/cron"
if [ -d "$INGEST_SRC" ]; then
  log "Installing vendor email ingestion timer"
  sudo install -d -o deploy -g deploy -m 750 /opt/bvisible/cron 2>&1 | tee -a "$LOG_FILE" || true
  sudo install -o deploy -g deploy -m 750 \
    "$INGEST_SRC/bvisible-ingest-tick.sh" \
    /opt/bvisible/cron/bvisible-ingest-tick.sh 2>&1 | tee -a "$LOG_FILE" || true
  sudo install -o root -g root -m 644 \
    "$INGEST_SRC/bvisible-ingest-tick.service" \
    /etc/systemd/system/bvisible-ingest-tick.service 2>&1 | tee -a "$LOG_FILE" || true
  sudo install -o root -g root -m 644 \
    "$INGEST_SRC/bvisible-ingest-tick.timer" \
    /etc/systemd/system/bvisible-ingest-tick.timer 2>&1 | tee -a "$LOG_FILE" || true
  if sudo systemctl daemon-reload 2>&1 | tee -a "$LOG_FILE" \
     && sudo systemctl enable --now bvisible-ingest-tick.timer 2>&1 | tee -a "$LOG_FILE"; then
    log "bvisible-ingest-tick.timer enabled"
  else
    log "WARN: could not enable bvisible-ingest-tick.timer (non-fatal — runtime will work, polling won't until enabled by hand)"
  fi
else
  log "No server-scripts/cron — skipping ingest timer install"
fi

# ============================================================================
# PM2 + healthcheck — wires the bvisible-web runtime
# ============================================================================
STANDALONE_DIR="$APP_DIR/apps/web/.next/standalone/apps/web"
if [ -f "$STANDALONE_DIR/server.js" ] && [ -f "$APP_DIR/ecosystem.config.cjs" ]; then
  log "Wiring standalone runtime at $STANDALONE_DIR"

  # Note: Next traces only what is actually imported. Workspace packages
  # like @bvisible/db are bundled into .next/standalone/node_modules ONLY
  # when something under apps/web imports them. We do NOT pre-validate
  # specific packages here — the healthcheck below is the real gate. If
  # the runtime crashes at boot resolving a missing dep, healthcheck fails
  # and the deploy is marked failed.

  # Next standalone does NOT include compiled static assets or the public
  # directory — copy them next to the standalone server so /static and /public
  # serve correctly. Replace existing dirs to keep them in sync per release.
  if [ -d "$APP_DIR/apps/web/.next/static" ]; then
    rm -rf "$STANDALONE_DIR/.next/static"
    mkdir -p "$STANDALONE_DIR/.next"
    cp -r "$APP_DIR/apps/web/.next/static" "$STANDALONE_DIR/.next/static"
  fi
  if [ -d "$APP_DIR/apps/web/public" ]; then
    rm -rf "$STANDALONE_DIR/public"
    cp -r "$APP_DIR/apps/web/public" "$STANDALONE_DIR/public"
  fi

  # Prisma's query-engine .so.node binary is dlopen()'d at runtime, so
  # Next's static tracer doesn't include it in the standalone bundle.
  # Result: every Prisma call in the runtime crashes with
  # "Prisma Client could not locate the Query Engine for runtime
  # debian-openssl-3.0.x". Mirror the live workspace's .prisma/client
  # directory (which `prisma generate` populated during build) into the
  # exact .pnpm hash path Next traced @prisma/client to.
  STANDALONE_ROOT="$APP_DIR/apps/web/.next/standalone"
  PRISMA_SRC=$(find "$APP_DIR/node_modules/.pnpm" -maxdepth 5 -type d -path "*@prisma+client*/node_modules/.prisma/client" 2>/dev/null | head -n1 || true)
  if [ -n "$PRISMA_SRC" ] && [ -d "$PRISMA_SRC" ]; then
    # Source path looks like:
    #   /opt/bvisible/app/node_modules/.pnpm/@prisma+client@<hash>/node_modules/.prisma/client
    # Rebuild the same suffix under the standalone tree.
    REL=$(echo "$PRISMA_SRC" | sed "s|^$APP_DIR/||")
    PRISMA_DST="$STANDALONE_ROOT/$REL"
    mkdir -p "$(dirname "$PRISMA_DST")"
    rm -rf "$PRISMA_DST"
    cp -r "$PRISMA_SRC" "$PRISMA_DST"
    ENGINES=$(ls "$PRISMA_DST" 2>/dev/null | grep -E '\.so\.node$|\.dll$' | tr '\n' ' ')
    log "Prisma client mirrored into standalone: $PRISMA_DST (engines: $ENGINES)"
  else
    log "WARN: could not find source .prisma/client to mirror into standalone bundle (Prisma runtime will fail)"
  fi

  # Standalone Next reads .env from process.cwd at boot. Symlink the shared
  # env into the standalone cwd so the runtime sees the same secrets the
  # build environment did.
  rm -f "$STANDALONE_DIR/.env"
  if [ -f "$SHARED_DIR/env/.env" ]; then
    ln -s "$SHARED_DIR/env/.env" "$STANDALONE_DIR/.env"
  fi

  # PM2 logs live in the shared tree so they survive release swaps.
  install -d -o deploy -g deploy -m 755 "$SHARED_DIR/logs" "$SHARED_DIR/logs/pm2"

  # IMPORTANT: invoke pm2 inside a login shell. We're already running as
  # `deploy` (the worker's systemd User), so `su - deploy -c` would prompt
  # for a password. `bash -lc` gets the same login-shell environment that
  # PM2 needs without a privilege transition. (`sudo -u` and bare `runuser`
  # both fail on Ubuntu 24.04 with `spawn /usr/bin/node EACCES` — the daemon
  # spawn is blocked. See DEBUGGING.md.)
  log "Reloading PM2 (startOrReload bvisible-web)"
  if bash -lc "pm2 startOrReload $APP_DIR/ecosystem.config.cjs --update-env" 2>&1 | tee -a "$LOG_FILE"; then
    log "PM2 reload OK"
  else
    log "FATAL: pm2 startOrReload failed"
    exit 8
  fi

  # Persist the process list so pm2-deploy.service resurrects it on reboot.
  if bash -lc 'pm2 save --force' 2>&1 | tee -a "$LOG_FILE"; then
    log "PM2 save OK"
  else
    log "WARN: pm2 save failed (non-fatal — runtime is up; reboot resurrect may miss)"
  fi

  # Brief settle so a freshly-started process has a chance to bind :3000.
  sleep 2

  # Healthcheck: the gate that decides whether this deploy succeeded.
  HC_SCRIPT="/opt/bvisible/deploy-queue/healthcheck.sh"
  if [ -x "$HC_SCRIPT" ]; then
    log "Running $HC_SCRIPT"
    if "$HC_SCRIPT" 2>&1 | tee -a "$LOG_FILE"; then
      log "Healthcheck OK"
    else
      log "FATAL: healthcheck failed; deploy marked failed"
      exit 9
    fi
  else
    log "FATAL: $HC_SCRIPT missing or not executable; refusing to mark deploy successful without runtime verification"
    exit 9
  fi
else
  if [ ! -f "$APP_DIR/ecosystem.config.cjs" ]; then
    log "No ecosystem.config.cjs at $APP_DIR — skipping PM2 wiring (foundation-only deploy)"
  else
    log "No standalone server.js at $STANDALONE_DIR — skipping PM2 wiring (build did not produce standalone output)"
  fi
fi

log "==== deploy-once SUCCESS ===="
exit 0
