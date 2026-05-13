#!/usr/bin/env bash
# Read-only reconnaissance — never changes server state.
set +e
echo "===== OS ====="
cat /etc/os-release 2>/dev/null | head -n 6
echo
echo "===== Kernel ====="
uname -a
echo
echo "===== Disk ====="
df -h --total | grep -E "Filesystem|/$|total"
echo
echo "===== RAM ====="
free -h
echo
echo "===== CPU ====="
lscpu | grep -E "Model name|^CPU\(s\)|Architecture" | head -n 5
echo
echo "===== Users (login-capable) ====="
awk -F: '$7 !~ /(nologin|false)$/ {print $1, $3, $7}' /etc/passwd
echo
echo "===== Open listening ports ====="
ss -tulpn 2>/dev/null | head -n 40
echo
echo "===== UFW status ====="
which ufw && ufw status verbose 2>/dev/null || echo "ufw not installed"
echo
echo "===== Docker ====="
which docker && docker --version || echo "docker not installed"
which docker && docker compose version 2>/dev/null || echo "docker compose plugin not installed"
echo
echo "===== Node / npm / pnpm ====="
which node && node -v || echo "node not installed"
which npm && npm -v || echo "npm not installed"
which pnpm && pnpm -v || echo "pnpm not installed"
which corepack && corepack --version || echo "corepack not installed"
echo
echo "===== Nginx ====="
which nginx && nginx -v 2>&1 || echo "nginx not installed"
systemctl is-active nginx 2>/dev/null || echo "nginx service not active"
echo
echo "===== fail2ban ====="
which fail2ban-client && fail2ban-client --version 2>&1 | head -n 1 || echo "fail2ban not installed"
echo
echo "===== Git ====="
which git && git --version || echo "git not installed"
echo
echo "===== sshd config (key bits) ====="
grep -Ei "^(Port|PermitRootLogin|PasswordAuthentication|PubkeyAuthentication)" /etc/ssh/sshd_config 2>/dev/null
echo
echo "===== Done ====="
