# Portable restore bundle

Move B Visible to a new server, or rebuild it after losing one.

The bundle carries **state**: the database, the uploads, and the shape of the
config. It deliberately does **not** carry application code — `restore.sh`
clones the repo at a pinned commit, so the code that gets deployed is auditable
and the bundle stays around 120 MB instead of a gigabyte.

## Making a bundle

On the server being retired, as root:

```bash
bash /opt/bvisible/app/server-scripts/backup/make-backup.sh
```

Writes `/opt/bvisible/backups/bvisible-restore-<timestamp>.tar.gz` and prints
its SHA-256. Download it and check the hash matches before trusting it:

```bash
scp -i ~/.ssh/<key> root@<old-server>:/opt/bvisible/backups/bvisible-restore-*.tar.gz .
sha256sum bvisible-restore-*.tar.gz
```

## Restoring onto a fresh host

Fresh Ubuntu 24.04, root access, DNS ideally already pointing at it:

```bash
tar -xzf bvisible-restore-<timestamp>.tar.gz
cd bvisible-restore-<timestamp>
sudo ./restore.sh --domain app.example.com --ssh-allow 50.48.0.0/15
```

The first run stops early and writes `env.filled`, because two secrets cannot be
carried over and must be reissued from their providers:

| Variable | What to do |
|---|---|
| `SMTP_PASSWORD` | Change the mailbox password, paste the new one |
| `SHEETS_WRITEBACK_SA_KEY` | Delete the old Google service-account key, create a new one, paste as **one line with literal `\n` escapes** |

`POSTGRES_PASSWORD`, `INGEST_SECRET`, `INGEST_TICK_SECRET` and `DATABASE_URL`
are generated for you — leave them blank. Fill in the two above, then run the
same command again and it goes end to end.

## What restore.sh does

1. Verifies bundle checksums, reads repo/commit from `MANIFEST.txt`
2. Installs Docker, Node 22, pnpm, nginx, and the Chromium libs Playwright needs
3. Creates the `deploy` user with the same sudo rights as the original
4. Clones the repo and checks out the pinned commit
5. Builds the `/opt/bvisible` layout and deploy queue
6. Writes `.env` (640 `deploy:deploy`) with fresh generated secrets
7. Starts `postgres:16-alpine` as `bvisible-db`, bound to `127.0.0.1:5432`
8. `pg_restore`s the database and unpacks the uploads
9. Installs nginx + systemd timers, builds the app through the normal deploy
   worker, issues a TLS cert with certbot
10. Hardens: key-only SSH, ufw, fail2ban, sysstat enabled

Then it health-checks `127.0.0.1:3000/api/health` and fails loudly if the app
did not come up.

## Before you log out of the new server

Password login is switched **off** at step 10. Add your public key to
`/root/.ssh/authorized_keys` **while you still have a session open**, or your
only way back in is the provider's console.

## Notes

- `restore.sh` re-runs safely. If the database already has tables it skips the
  restore rather than doubling data — drop the `bvisible_pgdata` volume if you
  want a genuinely clean reload.
- The bundle contains the full customer database. Keep it encrypted at rest and
  off shared drives.
- `--skip-certbot` sets up port 80 only, for when DNS has not cut over yet.
  Re-run `certbot --nginx -d <domain>` afterwards.
