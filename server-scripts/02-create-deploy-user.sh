#!/usr/bin/env bash
# Create deploy user with sudo + SSH key access.
# IMPORTANT: We do NOT touch /etc/ssh/sshd_config. Root SSH stays exactly as it is.
set -euo pipefail

DEPLOY_USER="deploy"

echo "===== Creating user: $DEPLOY_USER ====="
if id "$DEPLOY_USER" &>/dev/null; then
  echo "User $DEPLOY_USER already exists — skipping create."
else
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi

echo "===== Adding $DEPLOY_USER to sudo group ====="
usermod -aG sudo "$DEPLOY_USER"

echo "===== Passwordless sudo for deploy (deploy automation) ====="
echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-deploy
chmod 440 /etc/sudoers.d/90-deploy
visudo -cf /etc/sudoers.d/90-deploy

echo "===== Copying root's authorized_keys -> $DEPLOY_USER ====="
DEPLOY_HOME="/home/$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
if [ -f /root/.ssh/authorized_keys ]; then
  cp /root/.ssh/authorized_keys "$DEPLOY_HOME/.ssh/authorized_keys"
  chown "$DEPLOY_USER":"$DEPLOY_USER" "$DEPLOY_HOME/.ssh/authorized_keys"
  chmod 600 "$DEPLOY_HOME/.ssh/authorized_keys"
  echo "Copied $(wc -l < /root/.ssh/authorized_keys) key line(s)."
else
  echo "WARNING: /root/.ssh/authorized_keys not found — deploy user has NO SSH key yet."
fi

echo "===== Verification ====="
id "$DEPLOY_USER"
sudo -l -U "$DEPLOY_USER" | tail -n 5
ls -la "$DEPLOY_HOME/.ssh"
echo "Done. Root SSH is unchanged."
