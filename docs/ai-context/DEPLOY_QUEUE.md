# DEPLOY_QUEUE — B Visible

Serialized, file-based deploy queue protecting production from concurrent
deploys. Implementation is on disk at `/opt/bvisible/deploy-queue/` and in
this repo at `server-scripts/deploy-queue/` (tracked since commit
`60978fe` — `chore: add server foundation scripts and gitignore`).

## Why it exists

- Multiple AI/dev agents may push and request a deploy at the same time.
- Deploy steps mutate the working tree, restart services, and run migrations.
- Two of those at once will corrupt state.
- The queue + `flock` guarantee **only one deploy runs at a time**.

## Folders

```
/opt/bvisible/deploy-queue/
├── jobs/        Queued JSON jobs, oldest filename = next to run
├── running/     The currently-executing job (max 1)
├── done/        Successful jobs (archived)
├── failed/      Failed jobs (preserved for inspection)
├── logs/        One log file per job, named <jobId>.log
└── deploy.lock  Single flock target (mode 644)
```

Owner everywhere: `deploy:deploy`.

## Scripts

| Script | What it does |
|---|---|
| `enqueue-deploy.sh <job.json|->` | Validates JSON, requires `repoUrl/branch/commitHash`, stamps `createdAt`, writes job into `jobs/`. Outputs `JOB_ID` on the last line. |
| `deploy-worker.sh` | Acquires non-blocking `flock`, picks oldest queued job, moves it to `running/`, calls `deploy-once.sh`, routes result to `done/` or `failed/`, releases lock. Safe to invoke twice in parallel — second invocation exits cleanly with "another deploy is in progress". |
| `deploy-once.sh <jobJson> <log>` | Fetches origin, fails if `commitHash` missing, fails if working tree dirty, checks out detached commit, snapshots release, links `shared/env/.env` and `shared/uploads`, runs `pnpm install --frozen-lockfile` + `NEXT_BUILD_STANDALONE=1 pnpm run build`. After build: copies `.next/static` into the standalone tree, symlinks `.env` into standalone cwd, ensures `/opt/bvisible/shared/logs/pm2/` exists, runs `bash -lc 'pm2 startOrReload .../ecosystem.config.cjs --update-env'`, `bash -lc 'pm2 save --force'`, sleeps 2s, then runs `/opt/bvisible/deploy-queue/healthcheck.sh`. Failed healthcheck → `exit 9`. Missing healthcheck → `exit 9` (refuses to mark a deploy successful without runtime verification). |
| `healthcheck.sh` | Curl-with-retry against `http://127.0.0.1:3000/api/health` for up to 30s. Requires JSON `status:"ok"` and `service:"bvisible-web"`. On failure prints `pm2 list`, `pm2 jlist`, last 50 lines of PM2 stdout/stderr, and `ss -tlnp` for `:3000`. Exit 0 only on healthy. |
| `status.sh` | Prints running, queued, last 5 done, last 5 failed, latest log path. |

Convenience symlinks installed in `/usr/local/bin`:

| Command | Target |
|---|---|
| `bvisible-deploy` | `/opt/bvisible/deploy-queue/enqueue-deploy.sh` |
| `bvisible-status` | `/opt/bvisible/deploy-queue/status.sh` |

## Job JSON shape

```json
{
  "repoUrl":     "https://github.com/izzwgg-arch/bvisible.git",
  "branch":      "main",
  "commitHash":  "<full-sha-of-an-already-pushed-commit>",
  "services":    ["web", "email-ingest"],
  "requestedBy": "cursor-agent",
  "createdAt":   "auto-stamped if absent (ISO 8601 UTC)"
}
```

Required: `repoUrl`, `branch`, `commitHash`. The deploy fails fast if
`commitHash` does not exist on the remote — no floating-tip deploys.

## How to enqueue (from the server, as `deploy`)

```bash
cat > /tmp/job.json <<'JSON'
{
  "repoUrl":     "https://github.com/izzwgg-arch/bvisible.git",
  "branch":      "main",
  "commitHash":  "0123456789abcdef0123456789abcdef01234567",
  "services":    ["web"],
  "requestedBy": "cursor-agent"
}
JSON

bvisible-deploy /tmp/job.json
# stdin form:
# cat /tmp/job.json | bvisible-deploy -
```

The command's last line is the `JOB_ID`. The systemd timer picks it up
within 30 seconds. To trigger immediately:

```bash
sudo -u deploy /opt/bvisible/deploy-queue/deploy-worker.sh
```

## How to check status

```bash
bvisible-status
tail -f /opt/bvisible/deploy-queue/logs/<JOB_ID>.log
ls /opt/bvisible/deploy-queue/failed/
```

## systemd timer + service

- `bvisible-deploy-worker.timer` — `OnBootSec=30s`, `OnUnitActiveSec=30s`,
  `AccuracySec=5s`. Fires every 30 seconds.
- `bvisible-deploy-worker.service` — `Type=oneshot`, runs as `deploy:deploy`,
  `ExecStart=/opt/bvisible/deploy-queue/deploy-worker.sh`.
- Files: `/etc/systemd/system/bvisible-deploy-worker.{service,timer}`.

## Failure handling

- A failed job stays in `failed/` indefinitely with its log under `logs/`.
- Operators inspect, fix, re-enqueue with a new `commitHash`.
- If a process leaves the lock held (worker hard-killed), the next worker
  invocation will see the lock as released as soon as the holder exits — bare
  `flock -n` does not require explicit release.

## Acceptance tests already run

- 23/23 PASS, recorded during the foundation task.
- Includes the parallel-worker test that proves only one job runs at a time.

## Runtime integration (live as of Phase 2)

`deploy-once.sh` now performs the full deploy flow:

```
checkout → install → build (NEXT_BUILD_STANDALONE=1)
  → wire .next/static + .env into standalone tree
  → bash -lc 'pm2 startOrReload .../ecosystem.config.cjs --update-env'
  → bash -lc 'pm2 save --force'
  → sleep 2s
  → /opt/bvisible/deploy-queue/healthcheck.sh
  → success / fail
```

Exit codes added in Phase 2:

- `8` — PM2 wiring failed (`pm2 startOrReload` non-zero).
- `9` — healthcheck failed (or healthcheck script missing/non-executable).

Note: there is no pre-runtime sanity check on which workspace packages
ended up in `.next/standalone/node_modules`. Next's tracing only includes
packages that are actually imported, so a foundation app that doesn't yet
use `@bvisible/db` will (correctly) not have it in the bundle. The
healthcheck is the canonical gate.

A failed deploy at exit 8/9 leaves PM2 in whatever state it reached. The
previous-good process may still be serving (PM2 reload swaps the
process); the failed job lands in `failed/` and operators can re-enqueue
the previous good `commitHash` (see `DEBUGGING.md` "13. Recovery posture").

Queue serialization (`flock` on `deploy.lock`) is unchanged.

## Things to remember

- **Push first, deploy second.** This is enforced by the project rule
  `.cursor/rules/git-push-before-deploy.mdc` and by `deploy-once.sh` rejecting
  unknown commits.
- **Never edit `/opt/bvisible/app` by hand.** It will be overwritten by the
  next deploy and a dirty working tree will hard-fail the deploy.
- **Touching the worker counts as deploy-pipeline change** → bump risk to
  high/extreme and update this file.
