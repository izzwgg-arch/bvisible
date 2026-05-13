#!/usr/bin/env bash
# Phase 1 of the production runtime foundation for B Visible.
#
# Installs PM2 globally, wires PM2 to systemd as the `deploy` user, replaces
# the placeholder Nginx site with the real reverse proxy, and (only if DNS
# resolves to this server) issues a Let's Encrypt cert for the Contabo
# hostname. Idempotent: re-running is a no-op for steps already done.
#
# Run as root on the server. Usage:
#   scp this file + server-scripts/nginx/bvisible.conf to /root/
#   ssh root@<host> 'bash /root/setup-pm2-and-nginx.sh'
#
# Does NOT touch:
#   - SSH (port 22 stays untouched)
#   - UFW rules
#   - any application code or deploy-once.sh
#   - Prisma / database
set -euo pipefail

EXPECTED_IP="212.56.32.136"
CERT_HOSTNAME="vmi3270817.contaboserver.net"
DEPLOY_USER="deploy"
DEPLOY_HOME="/home/${DEPLOY_USER}"
ENV_DIR="/opt/bvisible/shared/env"
ENV_FILE="${ENV_DIR}/.env"
NGINX_SRC="$(cd "$(dirname "$0")" && pwd)/nginx/bvisible.conf"
NGINX_AVAILABLE="/etc/nginx/sites-available/bvisible"
NGINX_PLACEHOLDER_AVAILABLE="/etc/nginx/sites-available/bvisible.placeholder"
NGINX_ENABLED="/etc/nginx/sites-enabled/bvisible"
NGINX_PLACEHOLDER_ENABLED="/etc/nginx/sites-enabled/bvisible.placeholder"

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
fail() { printf '[%s] FATAL: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || fail "must run as root"

# Allow running this script from /root/ with the conf file alongside it.
if [ ! -f "$NGINX_SRC" ]; then
  ALT="$(dirname "$0")/bvisible.conf"
  if [ -f "$ALT" ]; then
    NGINX_SRC="$ALT"
  else
    fail "cannot locate bvisible.conf (looked at: $NGINX_SRC and $ALT)"
  fi
fi

# 1. PM2 global install --------------------------------------------------------
if command -v pm2 >/dev/null 2>&1; then
  log "PM2 already installed: $(pm2 -v)"
else
  log "Installing PM2 globally via npm"
  npm install -g pm2@latest
  log "PM2 installed: $(pm2 -v)"
fi

# 2. Initialize the deploy user's PM2 home --------------------------------------
# NOTE: use `su - deploy -c` (login shell) instead of `sudo -u` or `runuser`.
# On Ubuntu 24.04, PM2 fails with `spawn /usr/bin/node EACCES` under sudo /
# runuser when daemonizing, but works under a login shell via su.
log "Initializing ${DEPLOY_HOME}/.pm2 (no-op if already present)"
su - "${DEPLOY_USER}" -c 'pm2 ping' >/dev/null

# 3. Install systemd unit so PM2 survives reboot --------------------------------
PM2_UNIT="pm2-${DEPLOY_USER}.service"
PM2_UNIT_FILE="/etc/systemd/system/${PM2_UNIT}"

if [ -f "${PM2_UNIT_FILE}" ]; then
  log "${PM2_UNIT} already installed at ${PM2_UNIT_FILE}"
else
  log "Generating PM2 systemd unit for user '${DEPLOY_USER}'"
  # When run as root with -u, pm2 either installs the unit directly OR
  # prints a sudo command we need to run. Capture and handle both.
  TMP="$(mktemp)"
  if ! env PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
        pm2 startup systemd -u "${DEPLOY_USER}" --hp "${DEPLOY_HOME}" 2>&1 | tee "$TMP"; then
    fail "pm2 startup command failed; see output above"
  fi
  if [ ! -f "${PM2_UNIT_FILE}" ]; then
    INSTALL_CMD="$(grep -oE 'sudo env PATH=[^ ]+ +pm2 startup [^"]*' "$TMP" | head -n 1 || true)"
    if [ -n "${INSTALL_CMD}" ]; then
      log "Executing pm2-printed install command"
      eval "${INSTALL_CMD#sudo }"
    fi
  fi
  rm -f "$TMP"
  [ -f "${PM2_UNIT_FILE}" ] || fail "PM2 systemd unit (${PM2_UNIT_FILE}) was not installed"
fi

systemctl daemon-reload

systemctl enable "${PM2_UNIT}" >/dev/null 2>&1 || true
log "${PM2_UNIT} status: $(systemctl is-enabled "${PM2_UNIT}" 2>/dev/null || echo unknown)"

# 4. Empty PM2 dump so a reboot before any process is added is safe -------------
su - "${DEPLOY_USER}" -c 'pm2 save --force' >/dev/null

# 5. Empty .env at /opt/bvisible/shared/env/.env --------------------------------
if [ ! -d "$ENV_DIR" ]; then
  log "Creating ${ENV_DIR}"
  install -d -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" -m 0750 "$ENV_DIR"
fi
if [ ! -e "$ENV_FILE" ]; then
  log "Creating empty ${ENV_FILE} (mode 640, ${DEPLOY_USER}:${DEPLOY_USER})"
  install -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" -m 0640 /dev/null "$ENV_FILE"
else
  log "${ENV_FILE} already exists — leaving contents alone"
fi

# 6. Install Nginx site config --------------------------------------------------
if [ -f "$NGINX_AVAILABLE" ] && cmp -s "$NGINX_SRC" "$NGINX_AVAILABLE"; then
  log "${NGINX_AVAILABLE} already current"
else
  log "Installing nginx config to ${NGINX_AVAILABLE}"
  install -o root -g root -m 0644 "$NGINX_SRC" "$NGINX_AVAILABLE"
fi

# 7. Enable bvisible site, disable placeholder ----------------------------------
if [ -L "$NGINX_PLACEHOLDER_ENABLED" ] || [ -e "$NGINX_PLACEHOLDER_ENABLED" ]; then
  log "Disabling placeholder symlink ${NGINX_PLACEHOLDER_ENABLED}"
  rm -f "$NGINX_PLACEHOLDER_ENABLED"
fi
if [ -L "$NGINX_ENABLED" ]; then
  log "${NGINX_ENABLED} symlink already present"
else
  log "Enabling site: ${NGINX_ENABLED} -> ${NGINX_AVAILABLE}"
  ln -s "$NGINX_AVAILABLE" "$NGINX_ENABLED"
fi

# 8. Test config; reload only if test passes ------------------------------------
log "Running 'nginx -t' before reload"
if ! nginx -t; then
  log "nginx -t FAILED — restoring placeholder to avoid broken state"
  rm -f "$NGINX_ENABLED"
  if [ -f "$NGINX_PLACEHOLDER_AVAILABLE" ] && [ ! -e "$NGINX_PLACEHOLDER_ENABLED" ]; then
    ln -s "$NGINX_PLACEHOLDER_AVAILABLE" "$NGINX_PLACEHOLDER_ENABLED"
  fi
  fail "nginx config test failed; rolled back to placeholder"
fi
log "Reloading nginx"
systemctl reload nginx

# 9. Certbot — only if DNS resolves to this host --------------------------------
log "Resolving ${CERT_HOSTNAME} via 1.1.1.1"
RESOLVED="$(dig +short A "${CERT_HOSTNAME}" @1.1.1.1 | head -n 1 || true)"
log "${CERT_HOSTNAME} -> ${RESOLVED:-<no answer>}"

if [ "${RESOLVED}" = "${EXPECTED_IP}" ]; then
  if [ -d "/etc/letsencrypt/live/${CERT_HOSTNAME}" ]; then
    log "Cert for ${CERT_HOSTNAME} already exists; skipping issuance. Renewals run via the certbot.timer systemd unit."
  else
    log "Issuing Let's Encrypt cert for ${CERT_HOSTNAME} via certbot --nginx"
    certbot --nginx \
      -d "${CERT_HOSTNAME}" \
      --non-interactive \
      --agree-tos \
      --register-unsafely-without-email \
      --redirect \
      --no-eff-email
  fi
  log "Verifying nginx -t after certbot"
  nginx -t
  log "Certbot path complete. Cert files under /etc/letsencrypt/live/${CERT_HOSTNAME}/"
else
  log "DNS does NOT resolve ${CERT_HOSTNAME} to ${EXPECTED_IP} (got: ${RESOLVED:-none}). SKIPPING certbot."
  log "When DNS is corrected, re-run this script OR:"
  log "  certbot --nginx -d <hostname> --redirect --agree-tos --register-unsafely-without-email --no-eff-email"
fi

# 10. Final status snapshot -----------------------------------------------------
# `systemctl is-active` writes "inactive" to stdout AND exits non-zero, so
# capture both the value and any failure path before logging.
PM2_ENABLED="$(systemctl is-enabled "${PM2_UNIT}" 2>/dev/null || true)"
PM2_ACTIVE="$(systemctl is-active  "${PM2_UNIT}" 2>/dev/null || true)"
log "Final status:"
log "  pm2 version:       $(pm2 -v)"
log "  pm2 unit enabled:  ${PM2_ENABLED:-unknown}"
log "  pm2 unit active:   ${PM2_ACTIVE:-unknown}"
log "  nginx -t:          $(nginx -t 2>&1 | tail -n 1)"
log "  sites-enabled:     $(ls /etc/nginx/sites-enabled/)"
log "  env file:          $(stat -c '%n %a %U:%G %s bytes' "$ENV_FILE" 2>/dev/null || echo missing)"
log "Phase 1 complete."
