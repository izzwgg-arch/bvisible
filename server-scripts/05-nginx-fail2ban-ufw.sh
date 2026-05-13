#!/usr/bin/env bash
# Nginx placeholder + fail2ban + (safely) enable UFW.
set -euo pipefail

echo "===== Nginx: placeholder site (HTTP only, no proxy yet) ====="
cat >/etc/nginx/sites-available/bvisible.placeholder <<'NGINX'
# B Visible — placeholder. Real proxy config added once app ports are known.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    access_log /var/log/nginx/bvisible.placeholder.access.log;
    error_log  /var/log/nginx/bvisible.placeholder.error.log;

    # Lets-Encrypt challenge dir (used later by certbot --nginx)
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        add_header Content-Type text/plain;
        return 200 "B Visible: server prep complete. App not yet deployed.\n";
    }
}
NGINX

# Replace default site safely
ln -sfn /etc/nginx/sites-available/bvisible.placeholder /etc/nginx/sites-enabled/bvisible.placeholder
rm -f /etc/nginx/sites-enabled/default
mkdir -p /var/www/html
nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "===== fail2ban: enable + sshd jail ====="
cat >/etc/fail2ban/jail.d/sshd.local <<'F2B'
[sshd]
enabled = true
port    = ssh
backend = systemd
maxretry = 5
findtime = 10m
bantime  = 1h
F2B
systemctl enable --now fail2ban
systemctl restart fail2ban
fail2ban-client status sshd || true

echo "===== Backups dir ownership ====="
install -d -o deploy -g deploy -m 750 /opt/bvisible/backups

echo "===== UFW: list staged rules, then enable (SAFETY) ====="
echo "--- Pending rules ---"
ufw status numbered || true

# SAFETY GUARD: refuse to enable UFW unless an SSH allow rule is present.
if ufw status | grep -Eq "(^|[[:space:]])(22/tcp|OpenSSH)[[:space:]]+ALLOW"; then
  echo "SSH allow rule confirmed. Enabling UFW now."
  ufw --force enable
else
  echo "FATAL: no SSH allow rule found. Refusing to enable UFW (would lock you out)."
  exit 10
fi

echo "===== Final UFW status ====="
ufw status verbose

echo "===== Listening ports ====="
ss -tulpn | grep LISTEN
