# DEPLOY_QUEUE — B Visible

Serialized, file-based deploy queue protecting production from concurrent
deploys. Implementation is on disk at `/opt/bvisible/deploy-queue/` and in
this repo at `server-scripts/deploy-queue/`.

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
| `deploy-once.sh <jobJson> <log>` | Fetches origin, fails if `commitHash` missing, fails if working tree dirty, checks out detached commit, snapshots release, links `shared/env/.env` and `shared/uploads`, runs `pnpm install --frozen-lockfile` + `pnpm run build` if `package.json` exists, restarts requested compose services, runs `scripts/healthcheck.sh` if present. |
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

## Things to remember

- **Push first, deploy second.** This is enforced by the project rule
  `.cursor/rules/git-push-before-deploy.mdc` and by `deploy-once.sh` rejecting
  unknown commits.
- **Never edit `/opt/bvisible/app` by hand.** It will be overwritten by the
  next deploy and a dirty working tree will hard-fail the deploy.
- **Touching the worker counts as deploy-pipeline change** → bump risk to
  high/extreme and update this file.
