# API_STRUCTURE — B Visible

The web app uses **Next.js server actions** for in-app calls and **REST routes**
under `/api/v1/*` for the mobile app and external integrations.

## Conventions

- Server actions live in `apps/web/app/_actions/<feature>.ts` and are imported
  directly by client components. Inputs validated with `zod`.
- REST routes live in `apps/web/app/api/v1/<resource>/route.ts`.
- Public JSON health check: `GET /api/health` (no cookie, no Bearer).
- **`/api/v1/*`** mobile routes use `Authorization: Bearer <access JWT>` — no
  `bv_session` cookie. Tenant comes from the JWT + DB session row; clients
  never send `tenantId`.

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

## Currently shipped (foundation + auth + estimates + purchase orders + email ingestion + vendor pricing alerts)

### REST routes

| Path | Method | Behavior |
|---|---|---|
| `/api/health` | `GET` | Returns `{"status":"ok","service":"bvisible-web"}`. Marked `dynamic = 'force-dynamic'` and `runtime = 'nodejs'`. No auth, no DB. Used by deploy healthchecks and uptime monitors. |
| `/api/po/[id]/attachments/[attachmentId]` | `GET` | Tenant-gated PO attachment download. Resolves the row under `(tenantId, purchaseOrderId)`, validates the on-disk path stays inside the per-PO directory (`apps/web/lib/po/uploads.ts:resolveAttachmentPath`), reads the first bytes off disk to **re-detect** the MIME via magic-byte sniff (the recorded `mimeType` is a hint only), then streams the file with `Content-Type: <re-detected>`, `Content-Disposition: attachment; filename="..."` (RFC 5987-encoded for non-ASCII names), and `X-Content-Type-Options: nosniff`. Returns 404 for cross-tenant, soft-deleted, missing-on-disk, or unrecognized-magic-byte requests. |
| `/api/email-ingest/[id]/attachments/[attachmentId]` | `GET` | Tenant-gated download of an `IngestedEmailAttachment`. Same magic-byte re-detection + path-traversal guard as the PO download route, but resolves under the per-tenant email storage root (`apps/web/lib/email-ingest/storage.ts:resolveEmailAttachmentPath`). Used by the operator review UI for unmatched messages. |
| `/api/internal/email-ingest/tick` | `POST` | Internal-only tick endpoint hit by the systemd timer. Auth is a constant-time compare against `INGEST_TICK_SECRET` in the `x-bvisible-ingest-secret` header (NOT a session). Iterates every enabled `TenantEmailInbox`, claims a soft lease via `lastPolledAt`, polls IMAP via `imapflow`, parses with `mailparser`, and runs the matching pipeline. Returns `{ ok, runs: [{ tenantId, scanned, ingested, matched, errors, durationMs }] }`. Never returns email bodies or credentials. |
| `/api/internal/ocr/tick` | `POST` | Internal-only OCR worker tick. Auth is constant-time compare against `OCR_TICK_SECRET` (header `x-bvisible-ocr-secret`), falling back to `INGEST_TICK_SECRET` only when `OCR_TICK_SECRET` is unset. Processes up to **3** pending `OcrDocument` jobs (`apps/web/lib/ocr/worker.ts`): claim → local text extraction / OCR → `REVIEW_REQUIRED`. Never exposes attachment URLs publicly or logs raw OCR blobs. |
| `/api/internal/email-ingest/test` | `POST` | Internal-only IMAP test endpoint. Same shared-secret auth posture as `/tick` (`INGEST_TICK_SECRET` constant-time compare; 503 if unset, 401 on mismatch). Body: `{ tenantId?, host, port, secure, mailbox, username, password? }`. If `password` is omitted and `tenantId` is supplied, the route decrypts the stored sealed cipher for that tenant and uses it. Opens IMAP, lists folders, checks the configured mailbox exists, returns `{ ok: true|false, kind?, message?, mailboxCount?, mailboxExists?, durationMs }`. **Never** mutates the DB, marks messages `\Seen`, returns the password, or logs it. The middleware whitelists this path so loopback POSTs work without a session cookie. |
| `/api/v1/auth/login` | `POST` | Mobile login (JSON `{ email, password, deviceLabel? }`). Returns `{ accessToken, refreshToken, expiresIn, tokenType }`. Requires `MOBILE_JWT_SECRET` on the server. |
| `/api/v1/auth/refresh` | `POST` | JSON `{ refreshToken }`; rotates refresh hash in `mobile_sessions`. |
| `/api/v1/auth/logout` | `POST` | Bearer access JWT; revokes `mobile_sessions` row. |
| `/api/v1/purchase-orders` | `GET` | Bearer; lists tenant POs (not deleted). |
| `/api/v1/purchase-orders/[id]` | `GET` | Bearer; PO detail + attachments + recent `POEvent`s. |
| `/api/v1/uploads/presign` | `POST` | Bearer; JSON `{ purchaseOrderId, kind, originalFilename, declaredSizeBytes }`. Creates `mobile_pending_upload`. |
| `/api/v1/uploads/[id]/bytes` | `PUT` | Bearer; raw body, size must match declared bytes. |
| `/api/v1/uploads/complete` | `POST` | Bearer; JSON `{ uploadId }`; magic-byte finalize → `POAttachment` + `ATTACHMENT_ADDED`. **Idempotent:** successful replays return `data.idempotentReplay: true` and the same `attachmentId` without duplicating rows or timeline events. |

### Server actions (web only)

Auth and admin mutations are Next 15 server actions, NOT REST routes.
Server actions get same-origin POST enforcement (CSRF) for free.
`/api/v1/*` is the JSON REST surface for the Expo client (`MOBILE_APP.md`);
handlers authenticate Bearer JWTs — no browser cookie.

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
| `sendEstimateEmailAction` | `app/(app)/estimates/[id]/preview/actions.ts` | tenant user. Verifies SMTP (`verifyTransport`), **issues a new public quote token** (hash-only storage; revokes prior active links for the estimate), sends **`/quote/...`** URL via `sendMail`, audit `estimate_sent_to_client`. Updates **`DRAFT → SENT` only after SMTP success**; **FINALIZED** rejected; **resent from `SENT`** does not touch status (each send rotates the public URL). Requires client email. |
| `issueEstimateQuoteLinkAction` | `app/(app)/estimates/[id]/estimate-quote-link-actions.ts` | tenant user. Validates estimate; transaction revokes active links + inserts `estimate_quote_links` row; returns one-time absolute **`/quote/...`** URL for clipboard. |
| `revokeEstimateQuoteLinkAction` | `app/(app)/estimates/[id]/estimate-quote-link-actions.ts` | tenant user. Revokes all active quote links for the estimate (`revokedAt`). |
| `submitPublicQuoteResponseAction` | `app/quote/[token]/actions.ts` | **Public** (no session). Validates token + zod payload; calls **`executePublicQuoteCustomerResponse`** — transactional link patch + **`Estimate.status`** update + timeline row + conditional audit (`estimate_quote_accepted` / `estimate_quote_declined`) **only on first record**; **`FINALIZED`**, revoked/expired, and opposite-intent replays rejected safely. |
| `createVendorAction` | `app/(app)/vendors/actions.ts` | tenant user (ADMIN, USER). Per-tenant unique on `name`; conflicts return a sanitized "already exists" message. |
| `createShopMaterialItemAction` | `app/(app)/items/actions.ts` | ADMIN, SUPER_ADMIN (`requireRoleWithEffectiveCompany`). Creates `ShopMaterialItem` with deterministic `nameNormalized`; captures kind/unit/pricing defaults (`EstimateLineKind`, `ShopCatalogUnit`, internal cost, markup, optional sell override, optional machine); redirects to `/items/[id]`. |
| `updateShopMaterialItemAttributesAction` | `app/(app)/items/actions.ts` | ADMIN, SUPER_ADMIN. Updates estimating metadata (`kind`, `catalogUnit`, internal cost, markup, default sell override, default qty, machine link, notes). Canonical display name + normalized key remain immutable after create to avoid orphaning linked `VendorCatalogItem` rows. |
| `setShopMaterialPreferredVendorAction` | `app/(app)/items/actions.ts` | ADMIN, SUPER_ADMIN. |
| `setShopMaterialActiveAction` | `app/(app)/items/actions.ts` | ADMIN, SUPER_ADMIN. |
| `addShopMaterialAliasAction` | `app/(app)/items/actions.ts` | ADMIN, SUPER_ADMIN. Tenant-wide alias (`ShopMaterialItemAlias`); duplicates rejected via unique `(tenantId, aliasNormalized)`. |
| `removeShopMaterialAliasAction` | `app/(app)/items/actions.ts` | ADMIN, SUPER_ADMIN. |
| `appendManualShopMaterialPriceAction` | `app/(app)/items/actions.ts` | ADMIN, SUPER_ADMIN. **MATERIAL items only.** Appends `VendorPriceHistory` with `extractionMethod = MANUAL`, fresh dedupe nonce; upserts/links `VendorCatalogItem` under the item's normalized key; optional `vendorSku` updates the catalog row. Audits `shop_material_manual_price_recorded`. |
| `linkVendorCatalogToShopItemAction` | `app/(app)/items/actions.ts` | ADMIN, SUPER_ADMIN. **MATERIAL items only.** Sets `VendorCatalogItem.shopMaterialItemId` when `nameNormalized` matches and the row is not already tied to another item. |
| `createBlankPoAction` | `app/(app)/purchase-orders/actions.ts` | tenant user. Allocates `PO-NNNNNN` per tenant via `nextPoNumber` + advisory lock inside the create transaction. Optional `estimateId` and `vendorId` are tenant-validated before the row is written. Emits a `CREATED` POEvent. |
| `createPoFromEstimateAction` | `app/(app)/purchase-orders/actions.ts` | tenant user. **Requires `Estimate.status === APPROVED`** (accepted quotes only — rejects earlier statuses with a clear error). Copies all estimate lines into `po_line_items`, seeds `subtotalCents` from cached estimate line costs, never mutates the source estimate, emits a `CREATED_FROM_ESTIMATE` POEvent. Returns `{ purchaseOrderId }` on success. |
| `savePurchaseOrderAction` | `app/(app)/purchase-orders/[id]/actions.ts` | tenant user. Replaces all PO lines + meta in one transaction; recomputes `subtotalCents` server-side (integer arithmetic). Emits `LINES_SAVED`. |
| `updatePoStatusAction` | `app/(app)/purchase-orders/[id]/actions.ts` | tenant user. Writes `STATUS_CHANGED` (or `CANCELED` if transitioning to `CANCELED`) POEvent. |
| `setPoQboNumberAction` | `app/(app)/purchase-orders/[id]/actions.ts` | tenant user. Validates `[A-Za-z0-9_-]{1,40}`. Emits `QBO_NUMBER_ASSIGNED`. |
| `setPoVendorAction` | `app/(app)/purchase-orders/[id]/actions.ts` | tenant user. Validates the vendor under the caller's tenant. Emits `VENDOR_ASSIGNED`. |
| `addPoNoteAction` | `app/(app)/purchase-orders/[id]/actions.ts` | tenant user. Emits a `NOTE_ADDED` POEvent without changing PO state. |
| `uploadPoAttachmentAction` | `app/(app)/purchase-orders/[id]/actions.ts` | tenant user. Receives a `FormData` blob; refuses size > 25 MB; sniffs magic bytes for the allowlist (PDF / JPEG / PNG / WEBP); writes bytes under `/opt/bvisible/shared/uploads/<tenantId>/po/<poId>/<storageKey>` with mode 0640; inserts metadata + `ATTACHMENT_ADDED` POEvent in one transaction. |
| `deletePoAttachmentAction` | `app/(app)/purchase-orders/[id]/actions.ts` | tenant user. Removes the row, then best-effort `unlink` of the on-disk file. Emits `ATTACHMENT_DELETED`. |
| `deletePurchaseOrderAction` | `app/(app)/purchase-orders/[id]/actions.ts` | ADMIN, SUPER_ADMIN — soft delete. |
| `createInvoiceFromEstimateAction` | `app/(app)/invoices/actions.ts` | tenant user. **`Estimate.status` must be `APPROVED`**; rejects duplicates (`@@unique([tenantId, estimateId])`). Allocates **`finalPriceCents`** across copied lines, writes **`INVOICE_CREATED_FROM_ESTIMATE`** timeline row + **`invoice_created_from_estimate`** audit — never auto-finalizes or auto-pays. |
| `markInvoicePaidAction` | `app/(app)/invoices/actions.ts` | tenant user. **`UNPAID` → `PAID`** + **`paidAt`** + **`invoice_marked_paid`** audit — explicit operator action only. |
| `manualLinkEmailToPoAction` | `app/(app)/admin/email-ingestion/actions.ts` | ADMIN, SUPER_ADMIN. Validates that the chosen `purchaseOrderId` belongs to the caller's tenant, then calls `materializeIngestedEmailOnPo` (idempotent) to create the `VENDOR_REPLY` POEvent, promote allowlisted attachments into `po_attachments` with `kind = EMAIL_ATTACHMENT` + `sourceEmailId`, and flip the email's status to `MATCHED` with `matchReason = MANUAL`. Logs `email_ingest_manual_link`. |
| `retryEmailAction` | `app/(app)/admin/email-ingestion/actions.ts` | ADMIN, SUPER_ADMIN. Re-runs the deterministic match for an `UNMATCHED` or `FAILED` email without re-fetching from IMAP. If a match is found the email is materialized; otherwise it is left in its current state with `retriedAt` set. Logs `email_ingest_manual_retry`. |
| `dismissEmailAction` | `app/(app)/admin/email-ingestion/actions.ts` | ADMIN, SUPER_ADMIN. Sets the email's status to `DISMISSED` and stamps `processedAt`. Bytes on disk are retained (operator can still download for audit). Logs `email_ingest_manual_dismiss`. |
| `dismissVendorPriceNotificationAction` | `lib/vendor-pricing/actions.ts` | tenant user (`USER`, `ADMIN`). Validates `notificationId` belongs to the caller's tenant; sets `VendorPriceNotification.dismissedAt = now()`; audit `vendor_price_notification_dismissed`; `revalidatePath` for `/dashboard` and `/vendors/[id]`. Does not mutate PO lines or estimates. |
| `saveTenantInboxAction` | `app/(app)/admin/tenants/[id]/email-inbox/actions.ts` | SUPER_ADMIN. Upserts the per-tenant `TenantEmailInbox` row. `password` is optional on update — empty/omitted keeps the existing sealed cipher; a non-empty value is sealed via `sealSecret(plain)` (AES-256-GCM, key derived from `INGEST_SECRET`) before write. On create the password is required. Resets `lastErrorAt` / `lastErrorMessage` on save so a stale auth-failed message does not keep flagging the new row. Audit `tenant_inbox_saved` with `{ host, port, secure, mailbox, enabled, pollIntervalSeconds, senderDomain, created, passwordRotated }` — never the password value. |
| `deleteTenantInboxAction` | `app/(app)/admin/tenants/[id]/email-inbox/actions.ts` | SUPER_ADMIN. Deletes the `TenantEmailInbox` row. The next tick falls back to env-vars for that tenant if they are set; otherwise the tenant stops ingesting. Audit `tenant_inbox_deleted`. |
| `testInboxConnectionAction` | `app/(app)/admin/tenants/[id]/email-inbox/actions.ts` | SUPER_ADMIN. Calls the same `testImapConnection(profile)` library used by the `/api/internal/email-ingest/test` route. If the form's password field is blank, decrypts the stored sealed cipher and uses it (lets the operator test only the host/mailbox/username after a credential rotation). Returns the sanitized `TestImapResult` (`ok | auth_failed | mailbox_not_found | connect_failed | tls_error | unknown`) plus `durationMs`. Audit `tenant_inbox_test_run` with `{ host, port, secure, mailbox, senderDomain, ok, kind, durationMs }` — never the password. |

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
| `/dashboard` | protected | Greeting + role/tenant cards + **`getDashboardMetrics`** KPI tiles + recent audits + quick actions + **quote attention columns** (`getDashboardQuoteAttention` — awaiting **`SENT`** responses with active links, plus distinct estimates surfaced by newest **`QUOTE_ACCEPTED`** / **`QUOTE_DECLINED`** timeline hits linking `/estimates/[id]`) + **estimate→PO fulfillment rails** (`getDashboardEstimatePoFlow` — approved estimates still missing any linked PO, recent PO rows with `estimateId`, approved estimates that already have PO coverage, and estimate-linked POs whose latest `POReconciliation` status is non-terminal) + **estimate→invoice fulfillment rails** (`getDashboardEstimateInvoiceFlow` — approved estimates missing invoices, unpaid invoices tied to approved estimates, recently paid estimate-linked invoices using **`Invoice.status`** / **`paidAt`** only). Operational rails reuse **`getDashboardOperationalFeed`** for estimates/PO queues + merged ADMIN attention prompts (still backed strictly by DB counts/lists — nothing synthesized beyond aggregated summaries already documented elsewhere). |
| `/settings` | protected | Account info, change-password, sign-out. |
| `/admin/users` | protected (ADMIN, SUPER_ADMIN) | List + invite. Sends invite email via SMTP; falls back to inline link on SMTP failure. |
| `/admin/tenants` | protected (SUPER_ADMIN) | List + create. New tenants get the default `Machine` catalog seeded (Colex, laser, flatbed, roll-to-roll). |
| `/settings/email-test` | protected (SUPER_ADMIN) | SMTP diagnostics + send-test-email. Runs `verify()` then `sendMail()` from `apps/web/lib/mailer.ts`. Sanitized error display — no credentials leak to UI. |
| `/clients` | protected (tenant user) | Tenant client list + "New client" CTA. |
| `/clients/new` | protected (tenant user) | Create-client form (companyName required; contact, email, phone, notes optional). |
| `/estimates` | protected (tenant user) | Tenant estimate list with cached cost + sell totals + status pills. |
| `/estimates/new` | protected (tenant user) | Pick client + title; redirects to the editor. |
| `/estimates/[id]` | protected (tenant user) | Spreadsheet-style line-item editor. Header CTAs: **Preview quote**, **Print / PDF** (opens preview), **Send to customer** (preview `#customer-send`), **Back**. Above the editor: **`EstimateFulfillmentPanel`** — **`EstimateOperationalStepRail`** + **`EstimateRelationshipFlowStrip`** + status-aware hints, explicit **Create invoice** when **`APPROVED`** without a linked invoice, linked invoice chip/paid banner, anchored PO CTAs, linked PO chips with reconciliation/OCR summaries derived only from persisted rows — then **`EstimateQuoteResponseSummary`** + **`EstimateTimelineSection`** + **`EstimateQuoteLinkPanel`** (`loadEstimateQuoteStaffUi` bundles timeline merges + panel badges showing newest-link lifecycle phase — regenerate guarded once `respondedAt` is set). Uses the reusable grid keyboard helper at `apps/web/lib/keyboard/grid-nav.ts`. Cmd/Ctrl+S saves; Enter / Shift+Enter move vertically inside the grid; per-row × / ↑ / ↓ buttons. Totals panel exposes the anchored **Linked POs** section (`#estimate-linked-pos`), **Create PO from estimate** (`#estimate-create-po`, **`APPROVED` only**, mirrors server gate), optional **Link existing PO** (`/purchase-orders/new?estimateId=…`), and the R-EST-04-gated Finalize button (with a sanitized blocked-reason hint when the gate refuses). |
| `/estimates/[id]/preview` | protected (tenant user) | Staff-facing quote: allocated sell per line, totals, notes + standard terms; **no internal costs**. Toolbar: print/PDF, jump-to-send, back to editor. Between toolbar + document the **same quote response summary + link management panel** as the estimate editor (`EstimateQuoteResponseSummary`, enhanced **`EstimateQuoteLinkPanel`**). **Send estimate email** form (`sendEstimateEmailAction`) — SMTP + audit + conditional status transition; email contains **public** `/quote/...` link. |
| `/quote/[token]` | yes (unauthenticated) | Customer quote + **Accept / Decline** (`PublicQuoteResponsePanel`, **`print:hidden`**). Invalid/expired/revoked → generic error. **`FINALIZED`** estimates show quote but decisions blocked if never responded. Responses not cached; robots noindex. |
| `/items` | protected (tenant user) | Items catalog list (type, internal/sell hints, markup, vendor aggregates for MATERIAL rows). |
| `/items/new` | protected (ADMIN, SUPER_ADMIN) | Full create form (`EstimateLineKind`, units, internal cost, markup/sell defaults, optional machine). |
| `/items/[id]` | protected (tenant user) | Detail: pricing overview, vendor SKU column, aliases, MATERIAL-only manual vendor pricing & duplicate linking, estimate-picker guidance. |
| `/vendors` | protected (tenant user) | Tenant vendor list + "New vendor" CTA + per-vendor PO count. |
| `/vendors/new` | protected (tenant user) | Create-vendor form (name required; email/phone/notes optional). Per-tenant unique on name. |
| `/purchase-orders` | protected (tenant user) | Tenant PO list with vendor + linked-estimate + QBO number + status pill + cached subtotal. |
| `/purchase-orders/new` | protected (tenant user) | Pick optional vendor + optional linked estimate (`?estimateId=` seeds the combobox); redirects to the editor. Blank POs never copy estimate lines — use **`APPROVED`** estimate workspace CTAs for line-for-line conversion (`createPoFromEstimateAction`). |
| `/purchase-orders/[id]` | protected (tenant user) | When `estimateId` is populated, a **`PoEstimateOriginSection`** card (above the operational rail) links back to `/estimates/[id]` and embeds the same **`EstimateQuoteResponseSummary`** bundle from `loadEstimateQuoteStaffUi` so quote/customer response context stays beside fulfillment work. Spreadsheet-style PO line editor that reuses the grid primitives + keyboard helper from the estimate editor. Right-side panels: subtotal/save, QBO PO number (commits on blur), vendor picker, linked estimate, status (six-button grid), danger zone (ADMIN+ only). Left side: notes card, line grid, attachments panel (kind picker + file input; allowed: PDF, JPEG, PNG, WEBP; max 25 MB; email-ingested rows are flagged with an "✉" badge linking back to the source email), timeline (newest-first POEvents + inline note input; `VENDOR_REPLY` rows render with the mail icon). |
| `/purchase-orders/[id]/reconciliation` | protected (ADMIN, SUPER_ADMIN) | Accounting-grade reconciliation workspace for the latest `POReconciliation` snapshot: variance badges, manual merge of unmatched PO/receipt rows, operator confirmations, PO reconciled stamp. |
| `/invoices` | protected (tenant user) | Tenant invoice list (client, linked estimate, status pill, sell subtotal, updated timestamp). |
| `/invoices/[id]` | protected (tenant user) | Invoice detail: status summary + sell total + **Mark paid** when **`UNPAID`** (`markInvoicePaidAction`), line items (allocated sell cents), notes. When **`estimateId`** present, renders **`InvoiceEstimateOriginSection`** (embedded **`EstimateQuoteResponseSummary`**, linked PO count, workspace links). |
| `/admin/ocr-review` | protected (ADMIN, SUPER_ADMIN) | Receipt OCR queue + detail (`OcrDocument` / `OcrLineItem`). Operators approve selected lines into `VendorPriceHistory` (`OCR_APPROVED`), which triggers a replay-safe reconciliation snapshot for that batch. |
| `/admin/reconciliation` | protected (ADMIN, SUPER_ADMIN) | Cross-PO inbox for open `SpendAlert` rows + recent snapshots with deep links back to PO reconciliation detail. |
| `/admin/email-ingestion` | protected (ADMIN, SUPER_ADMIN) | Operator review queue. Top: inbox config card (host / port / mailbox / `lastPolledAt` / `lastErrorAt` / `lastErrorMessage`; password is **never** displayed even in masked form). Bottom: filterable table of recent `IngestedEmail` rows with status / match-reason chips, a row-expand panel showing the body snippet + per-attachment list with download links, plus inline forms for manual linking (PO combobox), retry, and dismiss. SUPER_ADMIN sees a "Configure inbox" CTA in the page header. |
| `/admin/email-ingestion/inboxes` | protected (SUPER_ADMIN) | System-wide list of every tenant + inbox status (configured / healthy / errored / disabled chips, `lastPolledAt`, masked username). Each row links to that tenant's `/admin/tenants/[id]/email-inbox`. |
| `/admin/tenants/[id]/email-inbox` | protected (SUPER_ADMIN) | Per-tenant IMAP inbox configuration. Form fields: host, port, mailbox, username, password (always blank on render — empty = keep existing sealed cipher), poll interval seconds, TLS toggle, enabled toggle. Inline buttons: Save, Test connection (server action; sanitized error or success message), Delete (with confirm). Sidebar: diagnostics (masked username, `lastPolledAt`, `lastErrorAt`, status counts), recent ticks, recent ingested emails. The plaintext password is sealed before it lands in the DB and is never echoed back. |

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
| `mobile/uploads` | `POST /api/v1/uploads/presign` + `PUT .../bytes` + `POST /api/v1/uploads/complete` |

## Versioning

- Path-versioned (`/api/v1/...`). New incompatible shape ⇒ `/api/v2`.
- Add fields freely. Removing a field requires a deprecation period and a note
  in `CHANGELOG_AI.md`.

## Where to look in code

- Auth middleware: `apps/web/middleware.ts`
- Mobile JWT + refresh rotation: `apps/web/lib/mobile/*`
- Tenant resolution helper: `apps/web/lib/tenant.ts`
- Zod schemas: `apps/web/lib/validators.ts` (mobile: `mobile*` schemas)
- PO reconciliation server actions + forms: `apps/web/lib/reconciliation/actions.ts`
  (paired with `match.ts`, `run.ts`, `aggregate.ts`, `thresholds.ts`).
