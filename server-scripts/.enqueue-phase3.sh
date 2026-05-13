#!/usr/bin/env bash
# One-off: enqueue the Phase 3 deploy via the real queue, immediately
# trigger the worker (instead of waiting for the systemd timer), and
# tail the log until the job leaves running/.
set -euo pipefail

SHA="${1:?commit sha required}"

cat > /tmp/job-phase3.json <<JSON
{
  "repoUrl":     "https://github.com/izzwgg-arch/bvisible.git",
  "branch":      "main",
  "commitHash":  "${SHA}",
  "services":    ["web"],
  "requestedBy": "cursor-agent-phase3"
}
JSON

JOB_ID=$(sudo -u deploy /opt/bvisible/deploy-queue/enqueue-deploy.sh /tmp/job-phase3.json | tail -n 1)
echo "JOB_ID=${JOB_ID}"

# Fire the worker now so we don't wait up to 30s for the timer.
sudo -u deploy /opt/bvisible/deploy-queue/deploy-worker.sh || true

LOG="/opt/bvisible/deploy-queue/logs/${JOB_ID}.log"
echo "--- tail ${LOG} ---"
for _ in $(seq 1 60); do
  if [ -f "/opt/bvisible/deploy-queue/done/${JOB_ID}.json" ] || [ -f "/opt/bvisible/deploy-queue/failed/${JOB_ID}.json" ]; then
    break
  fi
  sleep 2
done

tail -n 120 "$LOG" || true
echo "--- final status ---"
if [ -f "/opt/bvisible/deploy-queue/done/${JOB_ID}.json" ]; then
  echo "RESULT=done"
elif [ -f "/opt/bvisible/deploy-queue/failed/${JOB_ID}.json" ]; then
  echo "RESULT=failed"
else
  echo "RESULT=still-running"
fi
echo "JOB_ID=${JOB_ID}"
