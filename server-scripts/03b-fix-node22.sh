#!/usr/bin/env bash
# Upgrade Node 20 -> Node 22 LTS so latest pnpm works.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "===== Removing Node 20 setup, installing Node 22 LTS ====="
rm -f /etc/apt/sources.list.d/nodesource.list
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

echo "===== Re-enable corepack & activate pnpm ====="
corepack enable
corepack prepare pnpm@latest --activate

echo "===== Versions ====="
node -v
npm -v
pnpm -v
