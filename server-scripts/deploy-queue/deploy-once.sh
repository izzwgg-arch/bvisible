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
    log "Building..."
    if pnpm run build 2>&1 | tee -a "$LOG_FILE"; then
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

# Restart only requested services (no-op on foundation, app provides compose later)
if [ -n "$SERVICES" ] && [ -f "$APP_DIR/docker-compose.yml" ]; then
  log "Restarting compose services: $SERVICES"
  IFS=',' read -ra SVC_ARR <<< "$SERVICES"
  ( cd "$APP_DIR" && docker compose up -d --no-deps "${SVC_ARR[@]}" ) 2>&1 | tee -a "$LOG_FILE"
fi

# Health check (optional; non-blocking placeholder until app exists)
if [ -x "$APP_DIR/scripts/healthcheck.sh" ]; then
  log "Running healthcheck.sh"
  "$APP_DIR/scripts/healthcheck.sh" 2>&1 | tee -a "$LOG_FILE" || { log "Healthcheck failed"; exit 7; }
else
  log "No healthcheck.sh — skipping (foundation phase)"
fi

log "==== deploy-once SUCCESS ===="
exit 0
