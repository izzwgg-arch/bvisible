#!/usr/bin/env bash
# Enqueue a deploy job from a JSON payload.
# Usage:
#   enqueue-deploy.sh <path-to-job.json>
#   cat job.json | enqueue-deploy.sh -
set -euo pipefail

QUEUE_ROOT="/opt/bvisible/deploy-queue"
JOBS_DIR="$QUEUE_ROOT/jobs"

if [ "${1:-}" = "" ]; then
  echo "usage: $0 <job.json|->" >&2
  exit 64
fi

mkdir -p "$JOBS_DIR"

if [ "$1" = "-" ]; then
  TMP=$(mktemp); cat - > "$TMP"; SRC="$TMP"
else
  SRC="$1"
fi

# Validate JSON
if ! jq -e . "$SRC" >/dev/null 2>&1; then
  echo "FATAL: invalid JSON" >&2
  exit 65
fi

# Validate required fields
for k in repoUrl branch commitHash; do
  if [ "$(jq -r ".$k // empty" "$SRC")" = "" ]; then
    echo "FATAL: missing required field: $k" >&2
    exit 66
  fi
done

# Stamp createdAt if absent
if [ "$(jq -r '.createdAt // empty' "$SRC")" = "" ]; then
  TMP2=$(mktemp)
  jq --arg t "$(date -u +%FT%TZ)" '. + {createdAt:$t}' "$SRC" > "$TMP2"
  SRC="$TMP2"
fi

JOB_ID="$(date -u +%Y%m%dT%H%M%S)-$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
DEST="$JOBS_DIR/${JOB_ID}.json"
cp "$SRC" "$DEST"
chown deploy:deploy "$DEST" 2>/dev/null || true
echo "Enqueued: $DEST"
echo "$JOB_ID"
