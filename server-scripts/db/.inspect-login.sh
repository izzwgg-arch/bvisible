#!/bin/bash
set -euo pipefail
BASE="${BASE:-https://vmi3270817.contaboserver.net}"
HTML=$(curl -ksS "$BASE/login")
echo "=== <form ... > ==="
printf "%s" "$HTML" | grep -oE '<form[^>]*>' || true
echo
echo "=== hidden inputs (name + value, first 100 chars) ==="
printf "%s" "$HTML" | grep -oE '<input[^>]+>' | grep -oE 'name="[^"]+"|value="[^"]*"' | paste -d ' ' - - | head -20 || true
echo
echo "=== anything mentioning ACTION ==="
printf "%s" "$HTML" | grep -oE '\$ACTION_[A-Z_]+_[a-z0-9]+' | head -5 || true
