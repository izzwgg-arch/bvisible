#!/usr/bin/env bash
# Print deploy queue status.
set -euo pipefail
QUEUE_ROOT="/opt/bvisible/deploy-queue"

echo "===== Currently running ====="
ls -1 "$QUEUE_ROOT/running"/*.json 2>/dev/null || echo "(none)"
echo
echo "===== Queued (oldest first) ====="
ls -1tr "$QUEUE_ROOT/jobs"/*.json 2>/dev/null || echo "(none)"
echo
echo "===== Last 5 done ====="
ls -1t "$QUEUE_ROOT/done"/*.json 2>/dev/null | head -n 5 || echo "(none)"
echo
echo "===== Last 5 failed ====="
ls -1t "$QUEUE_ROOT/failed"/*.json 2>/dev/null | head -n 5 || echo "(none)"
echo
LATEST_LOG="$(ls -1t "$QUEUE_ROOT/logs"/*.log 2>/dev/null | head -n 1 || true)"
echo "===== Latest log ====="
echo "${LATEST_LOG:-(none)}"
