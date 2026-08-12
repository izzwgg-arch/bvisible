#!/usr/bin/env bash
# Base packages + runtimes. Safe & idempotent.
# DOES NOT enable ufw, DOES NOT change sshd_config.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

log() { echo; echo "===== $* ====="; }

log "apt update"
apt-get update -y

log "Installing base packages"
apt-get install -y --no-install-recommends \
  git curl wget unzip build-essential ca-certificates gnupg lsb-release \
  jq htop fail2ban nginx certbot python3-certbot-nginx software-properties-common \
  apt-transport-https acl rsync ufw

# Shared libraries headless chromium needs, for the estimate PDF
# renderer (apps/web/lib/estimate/estimate-pdf.ts). The browser itself
# is downloaded per deploy by deploy-once.sh, which runs unprivileged
# as `deploy` and so cannot apt-install these. Without them the browser
# is present but fails to launch, and PDF export answers 500.
log "Installing headless chromium libraries (estimate PDF export)"
apt-get install -y --no-install-recommends \
  libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libnss3 libnspr4 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxkbcommon0 \
  libpango-1.0-0 libcairo2 libasound2t64 || \
apt-get install -y --no-install-recommends libasound2 || true

log "UFW: ADD rules ONLY (do NOT enable yet)"
# WARNING: ufw enable would otherwise drop SSH if rules are missing.
# We add the allow rules first; enabling happens only at the end and only
# after we verify SSH rule is present.
ufw allow OpenSSH    || true
ufw allow 22/tcp     || true
ufw allow 80/tcp     || true
ufw allow 443/tcp    || true
echo "--- Pending ufw rules (status numbered) ---"
ufw status numbered || true
echo "--- ufw is intentionally still: $(ufw status | head -n1) ---"

log "Docker repo + engine + compose plugin"
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

log "Add deploy user to docker group"
usermod -aG docker deploy || true

log "Node LTS via NodeSource (20.x)"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

log "Enable corepack and prepare pnpm"
corepack enable
corepack prepare pnpm@latest --activate

log "Verification"
echo "git:    $(git --version)"
echo "docker: $(docker --version)"
echo "compose: $(docker compose version)"
echo "node:   $(node -v)"
echo "npm:    $(npm -v)"
echo "pnpm:   $(pnpm -v)"
echo "nginx:  $(nginx -v 2>&1)"
echo "fail2ban: $(fail2ban-client --version 2>&1 | head -n1)"
echo "ufw:    $(ufw --version | head -n1) — current state: $(ufw status | head -n1)"
echo
echo "Base + runtime install COMPLETE. Firewall rules staged but UFW still inactive."
