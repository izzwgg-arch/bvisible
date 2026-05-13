#!/bin/bash
# Enqueue the auth-foundation deploy and tail the worker until done.
# Run as deploy on the server.

set -euo pipefail

SHA="${1:?usage: $0 <commit-sha>}"
SHORT="${SHA:0:6}"
ID="$(date -u +%Y%m%dT%H%M%S)-${SHORT}"
JOB="/tmp/job-$ID.json"

cat > "$JOB" <<EOF
{
  "repoUrl": "https://github.com/izzwgg-arch/bvisible.git",
  "branch": "main",
  "commitHash": "$SHA",
  "services": ["web"],
  "requestedBy": "cursor-agent-phase4",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "--- enqueueing job $ID for SHA $SHA"
/opt/bvisible/deploy-queue/enqueue-deploy.sh "$JOB"

echo "--- triggering worker"
/opt/bvisible/deploy-queue/deploy-worker.sh || true

# Poll for terminal state
LOG="/opt/bvisible/deploy-queue/logs/${ID}.log"
for i in $(seq 1 90); do
  if [ -f "/opt/bvisible/deploy-queue/done/${ID}.json" ]; then
    echo "--- DEPLOY DONE"
    break
  fi
  if [ -f "/opt/bvisible/deploy-queue/failed/${ID}.json" ]; then
    echo "--- DEPLOY FAILED"
    break
  fi
  sleep 2
done

echo "--- last 80 lines of log:"
tail -n 80 "$LOG" 2>/dev/null || echo "(no log file)"

echo "--- queue status:"
/opt/bvisible/deploy-queue/status.sh 2>/dev/null || true
