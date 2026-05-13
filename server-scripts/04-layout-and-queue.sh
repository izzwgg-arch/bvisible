#!/usr/bin/env bash
# Create /opt/bvisible layout, install deploy-queue scripts and systemd units.
set -euo pipefail

ROOT="/opt/bvisible"
QUEUE="$ROOT/deploy-queue"
DEPLOY_USER="deploy"
DEPLOY_GROUP="deploy"

echo "===== Creating directory layout under $ROOT ====="
install -d -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 755 \
  "$ROOT" \
  "$ROOT/app" \
  "$ROOT/releases" \
  "$ROOT/shared" \
  "$ROOT/shared/env" \
  "$ROOT/shared/uploads" \
  "$ROOT/shared/logs" \
  "$ROOT/backups" \
  "$QUEUE" \
  "$QUEUE/jobs" \
  "$QUEUE/running" \
  "$QUEUE/done" \
  "$QUEUE/failed" \
  "$QUEUE/logs"

# shared/env should be tighter (will hold .env)
chmod 750 "$ROOT/shared/env"

echo "===== Installing deploy-queue scripts ====="
for f in deploy-once.sh enqueue-deploy.sh deploy-worker.sh status.sh; do
  cp "/root/deploy-queue/$f" "$QUEUE/$f"
  sed -i 's/\r$//' "$QUEUE/$f"
  chmod 755 "$QUEUE/$f"
  chown "$DEPLOY_USER":"$DEPLOY_GROUP" "$QUEUE/$f"
done

echo "===== Creating empty lock file ====="
touch "$QUEUE/deploy.lock"
chown "$DEPLOY_USER":"$DEPLOY_GROUP" "$QUEUE/deploy.lock"
chmod 644 "$QUEUE/deploy.lock"

echo "===== Installing systemd units ====="
cp /root/deploy-queue/bvisible-deploy-worker.service /etc/systemd/system/
cp /root/deploy-queue/bvisible-deploy-worker.timer   /etc/systemd/system/
sed -i 's/\r$//' /etc/systemd/system/bvisible-deploy-worker.service
sed -i 's/\r$//' /etc/systemd/system/bvisible-deploy-worker.timer
systemctl daemon-reload
systemctl enable --now bvisible-deploy-worker.timer

echo "===== Convenience symlinks ====="
ln -sfn "$QUEUE/enqueue-deploy.sh" /usr/local/bin/bvisible-deploy
ln -sfn "$QUEUE/status.sh"         /usr/local/bin/bvisible-status

echo "===== Tree ====="
find "$ROOT" -maxdepth 3 -printf "%M %u:%g %p\n" | sort

echo "===== Timer status ====="
systemctl status bvisible-deploy-worker.timer --no-pager | head -n 15
echo
echo "Layout + queue + systemd installed."
