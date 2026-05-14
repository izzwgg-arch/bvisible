# apps/web/scripts

Operational scripts run by hand on the production server (under the
`deploy` user, from `/opt/bvisible/app`).

## bootstrap-super-admin.ts

Creates the very first SUPER_ADMIN. Refuses to run if any
`User.role = SUPER_ADMIN` already exists. Password is hashed with
Argon2id; plaintext is never logged.

### Required env vars

| Var | Required | Notes |
|---|---|---|
| `BOOTSTRAP_ADMIN_EMAIL` | yes | Lowercased, RFC-shaped. |
| `BOOTSTRAP_ADMIN_PASSWORD` | yes | 12-128 chars. |
| `BOOTSTRAP_ADMIN_NAME` | no | Display name. |
| `DATABASE_URL` | yes | Comes from `/opt/bvisible/shared/env/.env`. |

### One-shot command

```bash
cd /opt/bvisible/app
( set -a; . /opt/bvisible/shared/env/.env; set +a; \
  BOOTSTRAP_ADMIN_EMAIL='you@example.com' \
  BOOTSTRAP_ADMIN_PASSWORD='strong-passphrase-here' \
  BOOTSTRAP_ADMIN_NAME='Your Name' \
  pnpm --filter @bvisible/web run bootstrap:super-admin )
```

The `set -a` / `set +a` wrapper sources `DATABASE_URL` from the shared
env file without committing the secret to your shell history. The
`BOOTSTRAP_ADMIN_*` vars are passed inline so they only exist in the
script's process.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | SUPER_ADMIN created, audit log row written. |
| `1` | Unhandled error (DB connection, etc). |
| `2` | Missing or invalid env var. |
| `3` | A SUPER_ADMIN already exists. Refusing to run. |

### After bootstrap

1. Visit `https://vmi3270817.contaboserver.net/login`.
2. Sign in with the email/password you used.
3. Create your first admin invite under **Users** (scoped to the **B Visible** company).
4. Invite the tenant's admin from **Users**. The invite link is
   displayed inline (email is not yet wired).

## reset-super-admin-password.ts

Rotates the password for an **existing** `SUPER_ADMIN` (Argon2id hash via
`hashPassword`). Refuses when **zero** SUPER_ADMIN rows exist (use bootstrap
instead). When **multiple** SUPER_ADMIN rows exist, requires
`RESET_SUPER_ADMIN_EMAIL` to choose the target. Deletes all browser **`Session`**
rows for that user (JWT/mobile untouched).

Plaintext password is **never** logged.

### Required env vars

| Var | Required | Notes |
|---|---|---|
| `RESET_SUPER_ADMIN_PASSWORD` | yes | 12–128 chars (`passwordSchema`). |
| `RESET_SUPER_ADMIN_EMAIL` | if ambiguous | Required when more than one SUPER_ADMIN exists. |
| `CLEAR_SUPER_ADMIN_DISABLED` | no | Set to `1` to clear `disabledAt` during reset. |
| `DATABASE_URL` | yes | From `/opt/bvisible/shared/env/.env`. |

### Example

```bash
cd /opt/bvisible/app/apps/web
( set -a; . /opt/bvisible/shared/env/.env; set +a; \
  RESET_SUPER_ADMIN_PASSWORD='new-strong-passphrase-here' \
  pnpm exec tsx scripts/reset-super-admin-password.ts )
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Password updated, sessions cleared, audit row written. |
| `1` | Unhandled error. |
| `2` | Missing/invalid env. |
| `4` | No SUPER_ADMIN exists (use bootstrap). |
| `5` | Multiple SUPER_ADMIN without `RESET_SUPER_ADMIN_EMAIL`. |
| `6` | Email filter did not match. |
| `7` | Target has no `passwordHash`. |
| `8` | Target disabled and `CLEAR_SUPER_ADMIN_DISABLED` not set. |
