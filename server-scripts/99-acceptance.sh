#!/usr/bin/env bash
# Acceptance test suite for B Visible foundation.
set -uo pipefail

PASS=0; FAIL=0
ok()   { echo "PASS: $*"; PASS=$((PASS+1)); }
bad()  { echo "FAIL: $*"; FAIL=$((FAIL+1)); }

echo "===== A. SSH port 22 still listening ====="
ss -tulpn | grep -q ":22 " && ok "port 22 listening" || bad "port 22 NOT listening"

echo "===== B. deploy user exists ====="
id deploy >/dev/null 2>&1 && ok "deploy user exists" || bad "deploy user missing"

echo "===== C. Docker works ====="
docker --version >/dev/null && ok "docker installed" || bad "docker missing"
docker compose version >/dev/null && ok "docker compose plugin" || bad "compose missing"
sudo -u deploy docker info >/dev/null 2>&1 && ok "deploy can run docker" || echo "INFO: deploy may need re-login for docker group"

echo "===== D. Node + pnpm work ====="
node -v >/dev/null && ok "node: $(node -v)" || bad "node missing"
pnpm -v >/dev/null && ok "pnpm: $(pnpm -v)" || bad "pnpm missing"

echo "===== E. nginx installed and running ====="
systemctl is-active nginx >/dev/null && ok "nginx active" || bad "nginx not active"
curl -sf http://127.0.0.1/ | grep -q "B Visible" && ok "placeholder serves" || bad "placeholder not serving"

echo "===== F. UFW does NOT block SSH ====="
ufw status | grep -Eq "(22/tcp|OpenSSH)\s+ALLOW" && ok "ufw allows SSH" || bad "ufw missing SSH rule"

echo "===== G. Deploy queue scripts present + executable ====="
for f in deploy-once.sh enqueue-deploy.sh deploy-worker.sh status.sh; do
  [ -x "/opt/bvisible/deploy-queue/$f" ] && ok "$f exists" || bad "$f missing"
done

echo "===== H. systemd timer active ====="
systemctl is-active bvisible-deploy-worker.timer >/dev/null && ok "timer active" || bad "timer not active"

echo "===== I. Enqueue a real test job (foundation deploy: empty repo) ====="
JOB=$(mktemp)
cat > "$JOB" <<EOF
{
  "repoUrl": "https://github.com/izzwgg-arch/bvisible.git",
  "branch": "main",
  "commitHash": "FAKE_COMMIT_DOES_NOT_EXIST",
  "services": [],
  "requestedBy": "acceptance-test"
}
EOF
JOB_ID=$(/opt/bvisible/deploy-queue/enqueue-deploy.sh "$JOB" | tail -n 1)
echo "Enqueued JOB_ID: $JOB_ID"
[ -f "/opt/bvisible/deploy-queue/jobs/${JOB_ID}.json" ] && ok "job file in jobs/" || bad "job not in jobs/"

echo "===== J. Run the worker once (should fail because repo is empty -> commit not found) ====="
sudo -u deploy /opt/bvisible/deploy-queue/deploy-worker.sh
sleep 1
if [ -f "/opt/bvisible/deploy-queue/failed/${JOB_ID}.json" ]; then
  ok "failed job preserved (expected — fake commit)"
else
  bad "expected failed job not found"
fi
[ -f "/opt/bvisible/deploy-queue/logs/${JOB_ID}.log" ] && ok "log written for job" || bad "log missing"

echo "===== K. Two-jobs-at-once test (flock serialization) ====="
# Enqueue two jobs, hold the lock externally, then run two workers in
# parallel. Both must exit cleanly without ever running the deploy.
J1=$(mktemp); J2=$(mktemp)
for J in "$J1" "$J2"; do
  cat > "$J" <<EOF
{ "repoUrl":"https://github.com/izzwgg-arch/bvisible.git",
  "branch":"main", "commitHash":"DEAD0001",
  "services":[], "requestedBy":"acceptance-flock" }
EOF
done
ID1=$(/opt/bvisible/deploy-queue/enqueue-deploy.sh "$J1" | tail -n 1)
ID2=$(/opt/bvisible/deploy-queue/enqueue-deploy.sh "$J2" | tail -n 1)

# Hold the lock from outside, then start two workers concurrently.
( flock -x 200; sleep 4 ) 200>/opt/bvisible/deploy-queue/deploy.lock &
HOLDER=$!
sleep 0.5
W1_OUT=$(sudo -u deploy /opt/bvisible/deploy-queue/deploy-worker.sh 2>&1 || true)
W2_OUT=$(sudo -u deploy /opt/bvisible/deploy-queue/deploy-worker.sh 2>&1 || true)
echo "$W1_OUT" | grep -q "another deploy is in progress" && ok "worker1 saw lock" || bad "worker1 did not see lock"
echo "$W2_OUT" | grep -q "another deploy is in progress" && ok "worker2 saw lock" || bad "worker2 did not see lock"
wait "$HOLDER" 2>/dev/null || true

# Now drain both queued jobs (they will fail because commit doesn't exist; that's fine).
sudo -u deploy /opt/bvisible/deploy-queue/deploy-worker.sh >/dev/null 2>&1 || true
sudo -u deploy /opt/bvisible/deploy-queue/deploy-worker.sh >/dev/null 2>&1 || true
[ -f "/opt/bvisible/deploy-queue/failed/${ID1}.json" ] && ok "flock job 1 -> failed" || bad "flock job 1 missing in failed/"
[ -f "/opt/bvisible/deploy-queue/failed/${ID2}.json" ] && ok "flock job 2 -> failed" || bad "flock job 2 missing in failed/"

echo "===== L. status.sh runs ====="
/opt/bvisible/deploy-queue/status.sh >/dev/null && ok "status.sh runs cleanly" || bad "status.sh failed"

echo
echo "================ SUMMARY ================"
echo "PASS: $PASS"
echo "FAIL: $FAIL"
exit $FAIL
