#!/usr/bin/env bash
# Wrap DATABASE_URL value in double quotes if it isn't already, so that
# bash sourcing of .env handles the unquoted `&` in the connection
# string. Idempotent.
set -euo pipefail
ENV_FILE=/opt/bvisible/shared/env/.env

python3 - "$ENV_FILE" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
lines = p.read_text().splitlines()
out = []
for line in lines:
    if line.startswith("DATABASE_URL="):
        val = line[len("DATABASE_URL="):]
        # Strip any existing surrounding quotes, then re-wrap.
        if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
            val = val[1:-1]
        out.append(f'DATABASE_URL="{val}"')
    else:
        out.append(line)
p.write_text("\n".join(out) + "\n")
print("rewrote DATABASE_URL with double quotes")
PY

echo '--- .env keys (values redacted) ---'
sed -E 's/=.*/=***/' "$ENV_FILE"
