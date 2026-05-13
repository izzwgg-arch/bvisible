#!/usr/bin/env bash
set -e
J=$(mktemp)
cat > "$J" <<JSON
{
  "repoUrl": "https://github.com/izzwgg-arch/bvisible.git",
  "branch": "main",
  "commitHash": "FAKE_DEAD_COMMIT",
  "services": [],
  "requestedBy": "manual-test"
}
JSON
echo '--- valid json:'
jq . "$J"
echo '--- run enqueue (full stdout):'
OUT=$(/opt/bvisible/deploy-queue/enqueue-deploy.sh "$J")
printf '%s\n' "$OUT"
echo '--- last line only:'
printf '%s\n' "$OUT" | tail -n 1
echo '--- jobs dir:'
ls -la /opt/bvisible/deploy-queue/jobs/
