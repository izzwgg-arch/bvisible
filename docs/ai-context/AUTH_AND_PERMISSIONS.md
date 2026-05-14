# AUTH_AND_PERMISSIONS — B Visible

## Status

Auth + tenant foundation is shipped (Phase 4). Email/password login,
session cookies, middleware, role helpers, admin user/tenant management,
invite flow, password reset flow, and audit log are live. Mobile JWT,
SSO, and granular per-resource permissions land later.

## Identity

- **Email + password** for the web. Passwords hashed with Argon2id
  (`@node-rs/argon2`, memoryCost 64 MiB, timeCost 3, parallelism 1).
  See `apps/web/lib/auth/password.ts`.
- **Mobile** will use the same accounts via REST + JWT (short-lived
  access token, rotating refresh token). Not implemented yet.
- **No OAuth, no Google login, no magic links** in this phase.

## Session model — DB-backed sessions

- A login creates a `Session` row in Postgres with a SHA-256 hash of an
  opaque 256-bit random token. The raw token lives **only** in the
  user's cookie jar.
- Cookie: name `bv_session`, attributes `HttpOnly; Secure (prod); SameSite=Lax; Path=/; Max-Age=30d`.
- Logout sets `Session.revokedAt` and clears the cookie. The next
  request that presents a revoked or missing token is treated as
  unauthenticated.
- Password change revokes all sessions EXCEPT the current one.
- Password reset revokes ALL sessions for the user (including current).
- `Session.lastSeenAt` is updated opportunistically (at most once per
  minute per session) so we have a soft "active devices" signal.

The session token never leaves the cookie. We never store it in
`localStorage`, never put it in URL params, and never log it.

## Auth resolution flow

```
request → middleware (Edge: cookie present?) → page RSC (Node: requireUser())
                       │                              │
                       └─ no cookie → /login          └─ DB lookup → user or 401-redirect
```

- **Edge middleware** (`apps/web/middleware.ts`) does only a cookie
  presence check. It can't use Prisma. Public routes (`/`, `/login`,
  `/forgot`, `/reset/*`, `/invite/*`, `/api/health`) bypass the gate.
- **Server-side resolution** (`apps/web/lib/auth/current-user.ts`) uses
  Prisma to look up the session row, validate expiry/revocation, and
  return `{ id, email, name, role, tenantId, tenant, sessionId }`.
  Wrapped in React `cache()` so multiple components on the same render
  share one DB round-trip.

## Roles

| Role | Tenant scope | Can do |
|---|---|---|
| `SUPER_ADMIN` | `tenantId = NULL` | Manage tenants, view all users system-wide, invite ADMIN/USER into a tenant when attached to one. |
| `ADMIN` | required | Manage users in own tenant (invite, list). Tenant-app routes. |
| `USER` | required | Tenant-app routes only. |

A user belongs to exactly one tenant — no cross-tenant accounts.
SUPER_ADMIN is the one exception (`tenantId` nullable). The DB enforces
a partial unique index on `users(email) WHERE tenantId IS NULL` so two
SUPER_ADMINs cannot share an email (regular `@@unique([tenantId, email])`
treats NULLs as distinct in Postgres).

The aspirational 6-role taxonomy from earlier docs (`owner`, `estimator`,
`purchasing`, `installer`, `viewer`) is deferred until the product
features that need them land. The 3-role model covers everything in this
phase and is forward-compatible — splitting `USER` into role specializations
is a non-destructive migration when the time comes.

## Reusable helpers (`apps/web/lib/auth/current-user.ts`)

| Helper | Throws | Returns |
|---|---|---|
| `getCurrentUser()` | never | `CurrentUser \| null` |
| `requireUser(redirectTo='/login')` | redirect when null | `CurrentUser` |
| `requireRole(...roles)` | redirect to `/dashboard?error=forbidden` if role mismatch | `CurrentUser` |
| `requireSuperAdmin()` | as above for SUPER_ADMIN | `CurrentUser` |
| `requireTenantId()` | redirect to `/dashboard?error=no-tenant` when no tenant | `CurrentUser & { tenantId, tenant }` |

These are the **only** sanctioned ways to read the session inside a page
RSC or server action. Do not parse the cookie yourself; do not reach
into Prisma for the user behind the helpers.

## Public vs protected routes

| Path | Public? | Notes |
|---|---|---|
| `/api/health` | yes | Used by deploy + uptime. No auth, no DB. |
| `/login` | yes | Reads `?next=` (same-origin only). |
| `/forgot` | yes | Always responds OK regardless of email existence. |
| `/reset/[token]` | yes | Token validity gates form rendering. |
| `/invite/[token]` | yes | Token validity gates form rendering. |
| `/` | open page; redirects | RSC redirects to `/dashboard` or `/login` based on session. |
| `/dashboard` | protected | Any role. |
| `/settings` | protected | Any role. Self-service password change + logout. |
| `/admin/users` | protected | ADMIN or SUPER_ADMIN. |
| `/admin/tenants` | protected | SUPER_ADMIN only. |
| `/clients`, `/clients/new` | protected | Tenant user (any role with a `tenantId`). Gated by `requireTenantId()`. |
| `/estimates`, `/estimates/new`, `/estimates/[id]` | protected | Tenant user. The editor is read-write for both ADMIN and USER (per the Phase 6 spec). Soft-delete (the danger-zone button) is restricted to ADMIN / SUPER_ADMIN — the button is not rendered for USER. The "Unfinalize" button on a FINALIZED estimate is also ADMIN+ only. |
| `/vendors`, `/vendors/new` | protected | Tenant user. Per-tenant unique on vendor `name`. |
| `/purchase-orders`, `/purchase-orders/new`, `/purchase-orders/[id]` | protected | Tenant user. The editor + meta panel + attachments + timeline note are read-write for both ADMIN and USER. Soft-delete is ADMIN+ only (button hidden for USER). |
| `/api/po/[id]/attachments/[attachmentId]` | protected | Tenant user. Joins on `(tenantId, purchaseOrderId)` and refuses cross-tenant or soft-deleted POs. Returns 404 (not 403) on mismatch so the route does not leak whether the id exists in another tenant. |
| `/admin/email-ingestion` | protected | ADMIN or SUPER_ADMIN with a tenant. Operator review surface for inbound vendor email. |
| `/api/email-ingest/[id]/attachments/[attachmentId]` | protected | ADMIN or SUPER_ADMIN with a tenant. Tenant-gated download of an `IngestedEmailAttachment`; same magic-byte re-detection + 404-on-mismatch posture as the PO download route. |
| `/api/internal/email-ingest/tick` | internal | NOT session-authenticated. Constant-time compare against `INGEST_TICK_SECRET` in the `x-bvisible-ingest-secret` header. Used only by the systemd timer; UFW + the `127.0.0.1` bind keep it off the public internet. |

## Server actions for auth

All auth mutations are **Next 15 server actions** (POST, same-origin
enforced by Next). Server actions get CSRF protection for free.

| Action | File | Behavior |
|---|---|---|
| `loginAction` | `app/(auth)/login/actions.ts` | Validate, throttle, verify Argon2id, create session, audit. |
| `logoutAction` | `app/(app)/settings/actions.ts` | Revoke session, clear cookie, audit. Used by sidebar logout button. |
| `requestResetAction` | `app/(auth)/forgot/actions.ts` | Issue token (hashed), audit. Always responds OK. |
| `completeResetAction` | `app/(auth)/reset/[token]/actions.ts` | Validate token, set new hash, revoke ALL sessions, auto-login, audit. |
| `acceptInviteAction` | `app/(auth)/invite/[token]/actions.ts` | Validate invite, create/activate user, set hash, auto-login, audit. |
| `inviteUserAction` | `app/(app)/admin/users/actions.ts` | Issue invite token (hashed), audit. Inline-displayed link. |
| `createTenantAction` | `app/(app)/admin/tenants/actions.ts` | SUPER_ADMIN creates a tenant. Slug unique. Audit. Seeds the per-tenant default `Machine` rows. |
| `changePasswordAction` | `app/(app)/settings/actions.ts` | Verify current, set new hash, revoke other sessions, audit. |
| `createClientAction` | `app/(app)/clients/actions.ts` | Tenant user. `requireTenantId()` enforces tenant scope. Audit `client_created`. |
| `createEstimateAction` | `app/(app)/estimates/actions.ts` | Tenant user. Verifies the chosen `clientId` belongs to the caller's tenant. Allocates `EST-NNNNNN` per tenant inside the create transaction. Audit `estimate_created`. |
| `saveEstimateAction` | `app/(app)/estimates/[id]/actions.ts` | Tenant user. Validates ownership of the estimate AND every referenced `machineId`. Reruns `@bvisible/pricing` server-side and writes cached totals atomically. Audits `estimate_saved` and (when the multiplier changed) `estimate_multiplier_overridden`. |
| `updateEstimateStatusAction` | `app/(app)/estimates/[id]/actions.ts` | Tenant user. Audit `estimate_status_changed`. |
| `deleteEstimateAction` | `app/(app)/estimates/[id]/actions.ts` | ADMIN or SUPER_ADMIN. Soft delete (`deletedAt`); audit `estimate_deleted`. |
| `finalizeEstimateAction` | `app/(app)/estimates/[id]/actions.ts` | Tenant user. R-EST-04 gate (linked PO + qboPoNumber). Audit `estimate_finalized`. |
| `unfinalizeEstimateAction` | `app/(app)/estimates/[id]/actions.ts` | ADMIN or SUPER_ADMIN. Audit `estimate_unfinalized`. |
| `createVendorAction` | `app/(app)/vendors/actions.ts` | Tenant user. `requireTenantId()`. Audit `vendor_created`. |
| `createBlankPoAction` | `app/(app)/purchase-orders/actions.ts` | Tenant user. Verifies `estimateId` + `vendorId` (when supplied) belong to the tenant. Allocates `PO-NNNNNN` per tenant inside the create transaction. Audit `po_created`. |
| `createPoFromEstimateAction` | `app/(app)/purchase-orders/actions.ts` | Tenant user. Verifies estimate + optional vendor under the tenant. Copies estimate lines into PO lines without mutating the estimate. Audit `po_created_from_estimate`. |
| `savePurchaseOrderAction` | `app/(app)/purchase-orders/[id]/actions.ts` | Tenant user. Replaces lines + recomputes cached `subtotalCents` server-side. Audit `po_saved`. |
| `updatePoStatusAction` | `app/(app)/purchase-orders/[id]/actions.ts` | Tenant user. Audit `po_status_changed`. |
| `setPoQboNumberAction` | `app/(app)/purchase-orders/[id]/actions.ts` | Tenant user. Audit `po_qbo_number_set`. |
| `setPoVendorAction` | `app/(app)/purchase-orders/[id]/actions.ts` | Tenant user. Verifies vendor under the caller's tenant. Audit `po_vendor_set`. |
| `addPoNoteAction` | `app/(app)/purchase-orders/[id]/actions.ts` | Tenant user. Audit `po_note_added`. |
| `uploadPoAttachmentAction` | `app/(app)/purchase-orders/[id]/actions.ts` | Tenant user. Server-side magic-byte sniff before persisting. Audit `po_attachment_added`. |
| `deletePoAttachmentAction` | `app/(app)/purchase-orders/[id]/actions.ts` | Tenant user. Audit `po_attachment_deleted`. |
| `deletePurchaseOrderAction` | `app/(app)/purchase-orders/[id]/actions.ts` | ADMIN or SUPER_ADMIN. Soft delete (`deletedAt`). Audit `po_deleted`. |
| `manualLinkEmailToPoAction` | `app/(app)/admin/email-ingestion/actions.ts` | ADMIN or SUPER_ADMIN with a tenant. Verifies the chosen PO is non-deleted and tenant-owned, then materializes the email onto it (idempotent on `(purchaseOrderId, sourceEmailId)`). Audit `email_ingest_manual_link`. |
| `retryEmailAction` | `app/(app)/admin/email-ingestion/actions.ts` | ADMIN or SUPER_ADMIN with a tenant. Resets the row to `PENDING` so the next tick re-runs the deterministic matcher. Audit `email_ingest_retried`. |
| `dismissEmailAction` | `app/(app)/admin/email-ingestion/actions.ts` | ADMIN or SUPER_ADMIN with a tenant. Sets the row to `DISMISSED`. Bytes on disk are retained for audit; the operator queue filters dismissed rows out. Audit `email_ingest_dismissed`. |

## Permission model

- Coarse role check at the route boundary via `requireRole(...)`.
- Tenant scope applied automatically in queries — every SELECT against a
  tenant-scoped table includes `tenantId` from the session. See
  `SECURITY_RULES.md`.
- Fine-grained per-resource ownership checks (e.g. installer sees only
  POs assigned to them) come with the relevant feature.

## Bootstrap (first SUPER_ADMIN)

Because the DB starts empty, there's no UI-driven way to create the
first admin. Use the CLI script:

```bash
cd /opt/bvisible/app
( set -a; . /opt/bvisible/shared/env/.env; set +a; \
  BOOTSTRAP_ADMIN_EMAIL='you@example.com' \
  BOOTSTRAP_ADMIN_PASSWORD='strong-passphrase-here' \
  BOOTSTRAP_ADMIN_NAME='Your Name' \
  pnpm --filter @bvisible/web run bootstrap:super-admin )
```

Rules enforced by the script:

- Refuses to run if any `User.role = SUPER_ADMIN` already exists
  (exit 3).
- Validates email + password (12-128 chars) before doing any DB work
  (exit 2).
- Argon2id-hashes the password.
- Writes an `AuditLog` row with `action = 'super_admin_bootstrapped'`
  containing the new user's id and email — never the password.

See `apps/web/scripts/README.md` for full env-var docs.

## Invite flow (current state)

- `inviteUserAction` creates a `UserInvite` row keyed by SHA-256(token).
  TTL: 7 days. The raw token is generated once and used immediately to
  assemble the invite link — it is NEVER stored, logged, or persisted
  in plaintext.
- The invite link is **emailed to the invitee** via the SMTP mailer
  (`apps/web/lib/mailer.ts`, branded template at
  `apps/web/lib/emails/invite.ts`). The admin sees a green
  "Invite email sent to X" toast at `/admin/users?sent=<email>`.
- **SMTP failure fallback:** if the mailer returns an error, the page
  switches to an amber panel with a copy-pastable invite link
  (`/admin/users?invite=<token>&mailErr=<kind>`) so the admin is never
  blocked by a transient SMTP outage. The token is single-use and the
  fallback path keeps the same security envelope as the pre-SMTP
  state. The audit log captures the delivery result via
  `metadata.mailDelivery` (`sent` | `failed_<kind>` | `failed_no_config`).
- The invitee opens `/invite/<token>`, sets a name + password (12-128
  chars), and is auto-signed-in. The invite is marked `acceptedAt`.
- An accepted invite cannot be reused (the `acceptedAt` check in the
  page query gates this).

## Password reset flow (current state)

- `requestResetAction` always responds OK regardless of whether the
  email exists OR whether SMTP delivery succeeds. Deliberate: the
  public form must not let an attacker enumerate accounts and must
  not leak that mail is misconfigured. SMTP failures are visible via
  `audit_logs.metadata.mailDelivery` and via the SUPER_ADMIN
  `/settings/email-test` page, never via the public form.
- A `PasswordResetToken` row is created with SHA-256(token); TTL 30
  minutes; one-shot (`usedAt` blocks reuse).
- When the email exists, the reset link is **emailed via the SMTP
  mailer** (template at `apps/web/lib/emails/reset.ts`). No inline
  link surface — the public form returns the same generic OK message
  in every code path.
- `completeResetAction` validates the token, sets the new password
  hash, marks the token used, **revokes all sessions for the user**,
  and signs the user back in with a fresh session.

## Failed-login throttling

- 5 failed `login_failure` audit rows for the same email within 15
  minutes locks subsequent attempts with a generic "too many attempts"
  message.
- This is a single-process counter (audit-table COUNT). Distributed
  rate limiting (per-IP, cross-process) needs Redis and lands when the
  app spans multiple processes.

## What never authenticates a request

- Headers from the client (`X-Tenant-Id`, etc.) — ignored.
- URL params for `tenantId` — ignored.
- Anything not signed by our session layer.

## Audit log

Every auth-relevant event writes an `AuditLog` row via
`apps/web/lib/auth/audit.ts`. Allowed actions:

`login_success`, `login_failure`, `logout`, `password_changed`,
`password_reset_requested`, `password_reset_completed`,
`invite_created`, `invite_accepted`, `user_disabled`, `user_enabled`,
`tenant_created`, `super_admin_bootstrapped`, `client_created`,
`estimate_created`, `estimate_saved`, `estimate_status_changed`,
`estimate_multiplier_overridden`, `estimate_deleted`,
`estimate_finalized`, `estimate_unfinalized`, `vendor_created`,
`po_created`, `po_created_from_estimate`, `po_saved`,
`po_status_changed`, `po_qbo_number_set`, `po_vendor_set`,
`po_attachment_added`, `po_attachment_deleted`, `po_note_added`,
`po_deleted`, `email_ingest_tick`, `email_ingest_message_ingested`,
`email_ingest_message_matched`, `email_ingest_message_failed`,
`email_ingest_manual_link`, `email_ingest_dismissed`,
`email_ingest_retried`, `tenant_inbox_configured`.

Rules for what goes in `metadata`:

- Email addresses for login/invite/reset events: OK (already
  user-identifying for audit).
- Plaintext passwords or password hashes: NEVER.
- Raw invite/reset tokens or token hashes: NEVER.
- IP and user-agent live in dedicated columns (already hashed/truncated
  to safe lengths in `request-context.ts`).

There is no audit-log UI yet. Query via psql — see `DEBUGGING.md § 14`.

## Mobile-specific

Mobile auth lands separately. The plan: same `User` row + a refresh
token model, with the access token in `Authorization: Bearer ...` and
the refresh-token rotation handled server-side. See `MOBILE_APP.md`.
