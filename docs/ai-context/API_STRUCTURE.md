# API_STRUCTURE — B Visible

The web app uses **Next.js server actions** for in-app calls and **REST routes**
under `/api/v1/*` for the mobile app and external integrations.

## Conventions

- Server actions live in `apps/web/app/_actions/<feature>.ts` and are imported
  directly by client components. Inputs validated with `zod`.
- REST routes live in `apps/web/app/api/v1/<resource>/route.ts`.
- All endpoints require auth (see `AUTH_AND_PERMISSIONS.md`) except
  `/api/v1/health`.
- All endpoints attach `tenantId` from the session — clients never send it.

## Standard response envelopes

```ts
// success
{ ok: true, data: T }

// failure
{ ok: false, error: { code: string, message: string, details?: unknown } }
```

HTTP status codes follow the usual rules: 200 ok, 400 validation, 401 not
authenticated, 403 not authorized (e.g. wrong tenant), 404 not found, 409
conflict, 422 business-rule violation, 500 server error.

## Currently shipped (foundation + auth)

### REST routes

| Path | Method | Behavior |
|---|---|---|
| `/api/health` | `GET` | Returns `{"status":"ok","service":"bvisible-web"}`. Marked `dynamic = 'force-dynamic'` and `runtime = 'nodejs'`. No auth, no DB. Used by deploy healthchecks and uptime monitors. |

### Server actions (web only)

Auth and admin mutations are Next 15 server actions, NOT REST routes.
Server actions get same-origin POST enforcement (CSRF) for free. The
`/api/v1/*` REST surface is reserved for the mobile app and external
integrations and lands later.

| Action | Module | Roles |
|---|---|---|
| `loginAction` | `app/(auth)/login/actions.ts` | public |
| `logoutAction` | `app/(app)/settings/actions.ts` | any signed-in |
| `requestResetAction` | `app/(auth)/forgot/actions.ts` | public |
| `completeResetAction` | `app/(auth)/reset/[token]/actions.ts` | public (token-gated) |
| `acceptInviteAction` | `app/(auth)/invite/[token]/actions.ts` | public (token-gated) |
| `inviteUserAction` | `app/(app)/admin/users/actions.ts` | ADMIN, SUPER_ADMIN |
| `createTenantAction` | `app/(app)/admin/tenants/actions.ts` | SUPER_ADMIN — also seeds the per-tenant default `Machine` rows. |
| `changePasswordAction` | `app/(app)/settings/actions.ts` | any signed-in |
| `sendTestEmailAction` | `app/(app)/settings/email-test/actions.ts` | SUPER_ADMIN |
| `createClientAction` | `app/(app)/clients/actions.ts` | tenant user (ADMIN, USER) |
| `createEstimateAction` | `app/(app)/estimates/actions.ts` | tenant user. Allocates `EST-NNNNNN` per tenant via advisory lock + `nextEstimateNumber` inside the create transaction; verifies the chosen `clientId` belongs to the caller's tenant. |
| `saveEstimateAction` | `app/(app)/estimates/[id]/actions.ts` | tenant user. Replaces all line items + meta in one transaction; reruns the central pricing engine (`@bvisible/pricing`) so cached `subtotalCostCents` / `finalPriceCents` match the editor's display. Logs `estimate_multiplier_overridden` whenever the multiplier deviates from the row's prior value. |
| `updateEstimateStatusAction` | `app/(app)/estimates/[id]/actions.ts` | tenant user |
| `deleteEstimateAction` | `app/(app)/estimates/[id]/actions.ts` | ADMIN, SUPER_ADMIN — soft delete (sets `deletedAt`). |

Each action validates input with a `zod` schema from
`apps/web/lib/validators.ts`, audits the result via
`apps/web/lib/auth/audit.ts`, and never accepts `tenantId` from the
client (it always comes from the session).

### Pages

| Path | Public? | RSC behavior |
|---|---|---|
| `/` | yes | Redirects to `/dashboard` if signed in, else `/login`. |
| `/login` | yes | Login form. Reads `?next=<safe-relative-path>`. |
| `/forgot` | yes | Request-reset form; always-OK response. |
| `/reset/[token]` | yes | Set-new-password (token validity gated). |
| `/invite/[token]` | yes | Set name + password (token validity gated). |
| `/dashboard` | protected | Greeting + role/tenant cards. |
| `/settings` | protected | Account info, change-password, sign-out. |
| `/admin/users` | protected (ADMIN, SUPER_ADMIN) | List + invite. Sends invite email via SMTP; falls back to inline link on SMTP failure. |
| `/admin/tenants` | protected (SUPER_ADMIN) | List + create. New tenants get the default `Machine` catalog seeded (Colex, laser, flatbed, roll-to-roll). |
| `/settings/email-test` | protected (SUPER_ADMIN) | SMTP diagnostics + send-test-email. Runs `verify()` then `sendMail()` from `apps/web/lib/mailer.ts`. Sanitized error display — no credentials leak to UI. |
| `/clients` | protected (tenant user) | Tenant client list + "New client" CTA. |
| `/clients/new` | protected (tenant user) | Create-client form (companyName required; contact, email, phone, notes optional). |
| `/estimates` | protected (tenant user) | Tenant estimate list with cached cost + sell totals + status pills. |
| `/estimates/new` | protected (tenant user) | Pick client + title; redirects to the editor. |
| `/estimates/[id]` | protected (tenant user) | Spreadsheet-style line-item editor. Uses the reusable grid keyboard helper at `apps/web/lib/keyboard/grid-nav.ts`. Cmd/Ctrl+S saves; Enter / Shift+Enter move vertically inside the grid; per-row × / ↑ / ↓ buttons. |

## Resource sketch (target)

| Resource | Routes |
|---|---|
| `clients` | `GET /api/v1/clients`, `POST`, `GET /:id`, `PATCH /:id` |
| `estimates` | `GET`, `POST`, `GET /:id`, `PATCH /:id`, `POST /:id/finalize` |
| `purchase-orders` | `GET`, `POST`, `GET /:id`, `PATCH /:id`, `POST /:id/receipts` |
| `vendors` | `GET`, `POST`, `GET /:id`, `PATCH /:id` |
| `vendor-prices` | `GET /vendors/:id/prices`, `POST` (insert + history append) |
| `email-ingest` | `POST /api/v1/email-ingest/scan` (admin only) |
| `notifications` | `GET`, `POST /:id/dismiss` |
| `mobile/uploads` | `POST /api/v1/mobile/uploads` (presigned + finalize) |

## Versioning

- Path-versioned (`/api/v1/...`). New incompatible shape ⇒ `/api/v2`.
- Add fields freely. Removing a field requires a deprecation period and a note
  in `CHANGELOG_AI.md`.

## Where to look in code

- Auth middleware: `apps/web/middleware.ts`
- Tenant resolution helper: `apps/web/lib/tenant.ts`
- Zod schemas: `packages/shared/src/schemas/`
