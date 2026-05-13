#!/usr/bin/env bash
# Pick the oldest queued job and run it under an exclusive flock.
# Designed to be invoked by a systemd timer every 30s. Idempotent and
# safe to run concurrently — flock guarantees only one job at a time.
set -euo pipefail

QUEUE_ROOT="/opt/bvisible/deploy-queue"
JOBS_DIR="$QUEUE_ROOT/jobs"
RUN_DIR="$QUEUE_ROOT/running"
DONE_DIR="$QUEUE_ROOT/done"
FAIL_DIR="$QUEUE_ROOT/failed"
LOG_DIR="$QUEUE_ROOT/logs"
LOCK_FILE="$QUEUE_ROOT/deploy.lock"
DEPLOY_ONCE="$QUEUE_ROOT/deploy-once.sh"

mkdir -p "$JOBS_DIR" "$RUN_DIR" "$DONE_DIR" "$FAIL_DIR" "$LOG_DIR"

# Acquire non-blocking exclusive lock. If a deploy is already running,
# we exit cleanly so the timer can try again later.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -u +%FT%TZ)] another deploy is in progress — exiting"
  exit 0
fi

# Pick the oldest queued job (alphabetic = chronological by ID prefix)
JOB=""
for f in $(ls -1 "$JOBS_DIR"/*.json 2>/dev/null | sort); do
  JOB="$f"
  break
done

if [ -z "$JOB" ]; then
  exit 0
fi

JOB_ID="$(basename "$JOB" .json)"
LOG_FILE="$LOG_DIR/${JOB_ID}.log"
RUNNING_PATH="$RUN_DIR/${JOB_ID}.json"

echo "[$(date -u +%FT%TZ)] picking up $JOB_ID" | tee -a "$LOG_FILE"
mv "$JOB" "$RUNNING_PATH"

set +e
"$DEPLOY_ONCE" "$RUNNING_PATH" "$LOG_FILE"
RC=$?
set -e

if [ "$RC" = "0" ]; then
  mv "$RUNNING_PATH" "$DONE_DIR/${JOB_ID}.json"
  echo "[$(date -u +%FT%TZ)] $JOB_ID -> done" | tee -a "$LOG_FILE"
else
  mv "$RUNNING_PATH" "$FAIL_DIR/${JOB_ID}.json"
  echo "[$(date -u +%FT%TZ)] $JOB_ID -> failed (rc=$RC)" | tee -a "$LOG_FILE"
fi
exit 0
