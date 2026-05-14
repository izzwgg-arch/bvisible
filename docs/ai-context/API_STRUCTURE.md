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

## Currently shipped (foundation + auth + estimates + purchase orders + email ingestion)

### REST routes

| Path | Method | Behavior |
|---|---|---|
| `/api/health` | `GET` | Returns `{"status":"ok","service":"bvisible-web"}`. Marked `dynamic = 'force-dynamic'` and `runtime = 'nodejs'`. No auth, no DB. Used by deploy healthchecks and uptime monitors. |
| `/api/po/[id]/attachments/[attachmentId]` | `GET` | Tenant-gated PO attachment download. Resolves the row under `(tenantId, purchaseOrderId)`, validates the on-disk path stays inside the per-PO directory (`apps/web/lib/po/uploads.ts:resolveAttachmentPath`), reads the first bytes off disk to **re-detect** the MIME via magic-byte sniff (the recorded `mimeType` is a hint only), then streams the file with `Content-Type: <re-detected>`, `Content-Disposition: attachment; filename="..."` (RFC 5987-encoded for non-ASCII names), and `X-Content-Type-Options: nosniff`. Returns 404 for cross-tenant, soft-deleted, missing-on-disk, or unrecognized-magic-byte requests. |
| `/api/email-ingest/[id]/attachments/[attachmentId]` | `GET` | Tenant-gated download of an `IngestedEmailAttachment`. Same magic-byte re-detection + path-traversal guard as the PO download route, but resolves under the per-tenant email storage root (`apps/web/lib/email-ingest/storage.ts:resolveEmailAttachmentPath`). Used by the operator review UI for unmatched messages. |
| `/api/internal/email-ingest/tick` | `POST` | Internal-only tick endpoint hit by the systemd timer. Auth is a constant-time compare against `INGEST_TICK_SECRET` in the `x-bvisible-ingest-secret` header (NOT a session). Iterates every enabled `TenantEmailInbox`, claims a soft lease via `lastPolledAt`, polls IMAP via `imapflow`, parses with `mailparser`, and runs the matching pipeline. Returns `{ ok, runs: [{ tenantId, scanned, ingested, matched, errors, durationMs }] }`. Never returns email bodies or credentials. |

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
| `updateEstimateStatusAction` | `app/(app)/estimates/[id]/actions.ts` | tenant user. Refuses `FINALIZED` (R-EST-04 gate is `finalizeEstimateAction`); refuses any change while the estimate is already FINALIZED (use `unfinalizeEstimateAction`). |
| `deleteEstimateAction` | `app/(app)/estimates/[id]/actions.ts` | ADMIN, SUPER_ADMIN — soft delete (sets `deletedAt`). |
| `finalizeEstimateAction` | `app/(app)/estimates/[id]/actions.ts` | tenant user. R-EST-04 gate: requires ≥1 linked, non-deleted PO and ≥1 of those POs to have a non-null `qboPoNumber`. Returns typed errors `not_found`, `already_finalized`, `no_linked_po`, `no_qbo_number`, `invalid`; UI maps to sanitized strings. Logs `estimate_finalized`. |
| `unfinalizeEstimateAction` | `app/(app)/estimates/[id]/actions.ts` | ADMIN, SUPER_ADMIN. Returns the estimate to APPROVED. Logs `estimate_unfinalized`. |
| `createVendorAction` | `app/(app)/vendors/actions.ts` | tenant user (ADMIN, USER). Per-tenant unique on `name`; conflicts return a sanitized "already exists" message. |
| `createBlankPoAction` | `app/(app)/purchase-orders/actions.ts` | tenant user. Allocates `PO-NNNNNN` per tenant via `nextPoNumber` + advisory lock inside the create transaction. Optional `estimateId` and `vendorId` are tenant-validated before the row is written. Emits a `CREATED` POEvent. |
| `createPoFromEstimateAction` | `app/(app)/purchase-orders/actions.ts` | tenant user. Copies all estimate lines into `po_line_items`, seeds `subtotalCents` from cached estimate line costs, never mutates the source estimate, emits a `CREATED_FROM_ESTIMATE` POEvent. Returns `{ purchaseOrderId }` on success. |
| `savePurchaseOrderAction` | `app/(app)/purchase-orders/[id]/actions.ts` | tenant user. Replaces all PO lines + meta in one transaction; recomputes `subtotalCents` server-side (integer arithmetic). Emits `LINES_SAVED`. |
| `updatePoStatusAction` | `app/(app)/purchase-orders/[id]/actions.ts` | tenant user. Writes `STATUS_CHANGED` (or `CANCELED` if transitioning to `CANCELED`) POEvent. |
| `setPoQboNumberAction` | `app/(app)/purchase-orders/[id]/actions.ts` | tenant user. Validates `[A-Za-z0-9_-]{1,40}`. Emits `QBO_NUMBER_ASSIGNED`. |
| `setPoVendorAction` | `app/(app)/purchase-orders/[id]/actions.ts` | tenant user. Validates the vendor under the caller's tenant. Emits `VENDOR_ASSIGNED`. |
| `addPoNoteAction` | `app/(app)/purchase-orders/[id]/actions.ts` | tenant user. Emits a `NOTE_ADDED` POEvent without changing PO state. |
| `uploadPoAttachmentAction` | `app/(app)/purchase-orders/[id]/actions.ts` | tenant user. Receives a `FormData` blob; refuses size > 25 MB; sniffs magic bytes for the allowlist (PDF / JPEG / PNG / WEBP); writes bytes under `/opt/bvisible/shared/uploads/<tenantId>/po/<poId>/<storageKey>` with mode 0640; inserts metadata + `ATTACHMENT_ADDED` POEvent in one transaction. |
| `deletePoAttachmentAction` | `app/(app)/purchase-orders/[id]/actions.ts` | tenant user. Removes the row, then best-effort `unlink` of the on-disk file. Emits `ATTACHMENT_DELETED`. |
| `deletePurchaseOrderAction` | `app/(app)/purchase-orders/[id]/actions.ts` | ADMIN, SUPER_ADMIN — soft delete. |
| `manualLinkEmailToPoAction` | `app/(app)/admin/email-ingestion/actions.ts` | ADMIN, SUPER_ADMIN. Validates that the chosen `purchaseOrderId` belongs to the caller's tenant, then calls `materializeIngestedEmailOnPo` (idempotent) to create the `VENDOR_REPLY` POEvent, promote allowlisted attachments into `po_attachments` with `kind = EMAIL_ATTACHMENT` + `sourceEmailId`, and flip the email's status to `MATCHED` with `matchReason = MANUAL`. Logs `email_ingest_manual_link`. |
| `retryEmailAction` | `app/(app)/admin/email-ingestion/actions.ts` | ADMIN, SUPER_ADMIN. Re-runs the deterministic match for an `UNMATCHED` or `FAILED` email without re-fetching from IMAP. If a match is found the email is materialized; otherwise it is left in its current state with `retriedAt` set. Logs `email_ingest_manual_retry`. |
| `dismissEmailAction` | `app/(app)/admin/email-ingestion/actions.ts` | ADMIN, SUPER_ADMIN. Sets the email's status to `DISMISSED` and stamps `processedAt`. Bytes on disk are retained (operator can still download for audit). Logs `email_ingest_manual_dismiss`. |

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
| `/estimates/[id]` | protected (tenant user) | Spreadsheet-style line-item editor. Uses the reusable grid keyboard helper at `apps/web/lib/keyboard/grid-nav.ts`. Cmd/Ctrl+S saves; Enter / Shift+Enter move vertically inside the grid; per-row × / ↑ / ↓ buttons. Totals panel exposes the "Linked POs" section, "Create PO from estimate" flow, and the R-EST-04-gated Finalize button (with a sanitized blocked-reason hint when the gate refuses). |
| `/vendors` | protected (tenant user) | Tenant vendor list + "New vendor" CTA + per-vendor PO count. |
| `/vendors/new` | protected (tenant user) | Create-vendor form (name required; email/phone/notes optional). Per-tenant unique on name. |
| `/purchase-orders` | protected (tenant user) | Tenant PO list with vendor + linked-estimate + QBO number + status pill + cached subtotal. |
| `/purchase-orders/new` | protected (tenant user) | Pick optional vendor + optional linked estimate; redirects to the editor. (For copying estimate lines, use the estimate page's "Create PO from estimate" instead — the New page only stores the link.) |
| `/purchase-orders/[id]` | protected (tenant user) | Spreadsheet-style PO line editor that reuses the grid primitives + keyboard helper from the estimate editor. Right-side panels: subtotal/save, QBO PO number (commits on blur), vendor picker, linked estimate, status (six-button grid), danger zone (ADMIN+ only). Left side: notes card, line grid, attachments panel (kind picker + file input; allowed: PDF, JPEG, PNG, WEBP; max 25 MB; email-ingested rows are flagged with an "✉" badge linking back to the source email), timeline (newest-first POEvents + inline note input; `VENDOR_REPLY` rows render with the mail icon). |
| `/admin/email-ingestion` | protected (ADMIN, SUPER_ADMIN) | Operator review queue. Top: inbox config card (host / port / mailbox / `lastPolledAt` / `lastErrorAt` / `lastErrorMessage`; password is **never** displayed even in masked form). Bottom: filterable table of recent `IngestedEmail` rows with status / match-reason chips, a row-expand panel showing the body snippet + per-attachment list with download links, plus inline forms for manual linking (PO combobox), retry, and dismiss. |

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
