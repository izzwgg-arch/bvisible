#!/usr/bin/env bash
# Enqueue a real deploy for the scaffold commit and wait for it to complete.
set -uo pipefail

COMMIT="${1:?usage: $0 <commitHash>}"
JOB_FILE=$(mktemp)
cat > "$JOB_FILE" <<JSON
{
  "repoUrl":     "https://github.com/izzwgg-arch/bvisible.git",
  "branch":      "main",
  "commitHash":  "${COMMIT}",
  "services":    [],
  "requestedBy": "cursor-agent: scaffold-foundation"
}
JSON

echo "--- job json ---"; cat "$JOB_FILE"
echo
echo "--- enqueue ---"
JOB_ID=$(/opt/bvisible/deploy-queue/enqueue-deploy.sh "$JOB_FILE" | tail -n 1)
echo "JOB_ID=$JOB_ID"

echo
echo "--- triggering worker now (instead of waiting up to 30s for the timer) ---"
sudo -u deploy /opt/bvisible/deploy-queue/deploy-worker.sh

echo
echo "--- final status ---"
/opt/bvisible/deploy-queue/status.sh

echo
echo "--- final job placement ---"
for d in done failed running jobs; do
  if [ -f "/opt/bvisible/deploy-queue/$d/${JOB_ID}.json" ]; then
    echo "JOB ${JOB_ID} -> $d"
  fi
done

echo
echo "--- last 80 log lines ---"
tail -n 80 "/opt/bvisible/deploy-queue/logs/${JOB_ID}.log" 2>/dev/null || echo "no log file yet"
