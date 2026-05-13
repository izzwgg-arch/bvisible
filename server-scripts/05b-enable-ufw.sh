#!/usr/bin/env bash
# Safely enable UFW with explicit (re)allow of SSH first.
set -euo pipefail

echo "===== Re-adding SSH/HTTP/HTTPS allow rules (idempotent) ====="
ufw allow OpenSSH
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp

echo "===== Rules currently added (visible even when inactive) ====="
ufw show added

# Verify the SSH rule is actually present in the staged ruleset.
if ufw show added | grep -Eq "(OpenSSH|22/tcp)"; then
  echo "SSH allow rule confirmed in staged rules. Enabling UFW now."
  ufw --force enable
else
  echo "FATAL: SSH allow rule missing. Refusing to enable."
  exit 10
fi

echo "===== UFW final status ====="
ufw status verbose

echo "===== fail2ban status ====="
systemctl restart fail2ban
sleep 2
systemctl is-active fail2ban
fail2ban-client status sshd || true
