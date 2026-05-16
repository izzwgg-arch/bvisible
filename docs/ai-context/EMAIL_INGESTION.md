# EMAIL_INGESTION — B Visible

How vendor email becomes structured PO data.

The pipeline runs **in-process** inside the existing `bvisible-web`
PM2 app. There is no separate worker container, no IDLE/push, no
queue daemon. A `systemd` timer pokes an internal Next.js route every
60 seconds; the route claims a per-tenant soft lease, polls IMAP,
parses, matches, persists, and (when matched) materializes onto the
PO timeline.

## Architecture

```
systemd timer (60s)
   ↓ POST x-bvisible-ingest-secret
Next.js /api/internal/email-ingest/tick
   ↓
runIngestForTenant(tenantId)            (apps/web/lib/email-ingest/run.ts)
   ├─ claim lease via TenantEmailInbox.lastPolledAt UPDATE
   ├─ open IMAP (imapflow)              (apps/web/lib/email-ingest/client.ts)
   ├─ fetch UNSEEN
   │    ↓ for each message
   │    parse RFC822 (mailparser)        (apps/web/lib/email-ingest/parse.ts)
   │    upsert IngestedEmail on (tenantId, messageId)   ← R-MAIL-01
   │    persist allowlisted attachments  (apps/web/lib/email-ingest/storage.ts)
   │    matchEmail(...)                  (apps/web/lib/email-ingest/match.ts)
   │    if match:
   │      materializeOnPo(...) → VENDOR_REPLY POEvent + EMAIL_ATTACHMENT POAttachments
   │      runVendorPriceExtractionAfterMaterialize(...) (apps/web/lib/vendor-pricing/persist.ts)
   │        → deterministic regex on subject + body snippet + filenames; see § Vendor pricing extraction
   │    mark IMAP message \Seen          ← only after row commits
   └─ release lease + log EmailIngestRun
```

### Verification script (schema + code anchors + Vitest)

From repo root (Linux/macOS/Git Bash):

`bash server-scripts/db/.verify-email-ingestion-flow.sh`

Confirms **`@@unique([tenantId, messageId])`**, ingest upsert references **`tenantId, messageId`**, deterministic matcher markers, inbound **`MAX_UPLOAD_BYTES`** enforcement before disk write, **`VENDOR_REPLY`** materialize short-circuit, OCR enqueue wiring, **`manualLinkEmailToPoAction`**, then runs **`pnpm --filter @bvisible/web run verify:email-ingestion`**.

## Mailbox setup (Gmail / Workspace)

1. Create a dedicated user (e.g. `ingest@yourdomain.com`).
2. Enable 2-Step Verification on that account.
3. Google Account → Security → **App passwords** → generate one for
   "Mail" / "Other (B Visible Ingest)".
4. **In-app (recommended).** As SUPER_ADMIN, open
   `/admin/tenants/<tenantId>/email-inbox` (or `Inboxes` from the
   sidebar → `Configure`). Fill the host / port / mailbox / username
   fields, paste the app password, hit **Test connection** to verify
   IMAP can authenticate and the mailbox exists, then **Save inbox**.
   The plaintext password is sealed with AES-256-GCM
   (`apps/web/lib/email-ingest/crypto.ts:sealSecret`) before the row
   is written; the form never echoes it back on subsequent loads.
5. **Env-var fallback (single-tenant bootstrap).** If you have not yet
   reached the in-app form, populate
   `/opt/bvisible/shared/env/.env`:

   ```dotenv
   IMAP_HOST=imap.gmail.com
   IMAP_PORT=993
   IMAP_TLS=true
   IMAP_USER=ingest@yourdomain.com
   IMAP_PASSWORD=xxxxxxxxxxxxxxxx
   IMAP_MAILBOX=INBOX
   IMAP_POLL_INTERVAL_SECONDS=60
   INGEST_SECRET=<32+ chars of entropy>
   INGEST_TICK_SECRET=<32+ chars of entropy>
   ```

   The first tenant in `Tenant.createdAt ASC` is used as the
   `tenantId` for env-fallback ingestion. `INGEST_SECRET` and
   `INGEST_TICK_SECRET` remain required regardless of which path you
   pick — the first encrypts the in-DB password, the second
   authenticates the systemd timer to the internal tick route.

6. Optional: create a Gmail filter that labels expected vendor mail
   (`label:vendors`) and set the mailbox field to `vendors` so the
   poll scans a smaller scope.

### Rotating IMAP credentials

In the in-app form, **leave the password field blank** to keep the
existing sealed cipher; type a new value to rotate. Save writes the
new cipher and clears `lastErrorAt` / `lastErrorMessage` so a stale
"auth failed" doesn't keep flagging the row in the diagnostics
sidebar. Audit log: `tenant_inbox_saved` with
`{ passwordRotated: true, senderDomain }`.

### Disabling an inbox

Toggle **Enabled** off and Save. The next tick skips the tenant
entirely (the tick endpoint enumerates `enabled = true` rows). To
purge the credentials entirely, click **Delete inbox**; the audit
trail is preserved and the env-var fallback resumes if it is set.

## Connectivity test (in-app, recommended)

The per-tenant inbox page (`/admin/tenants/[id]/email-inbox`) has a
**Test connection** button next to **Save**. The button calls
`testInboxConnectionAction` (SUPER_ADMIN, cookie-authenticated) which
opens IMAP, authenticates, lists folders, checks the configured
mailbox exists, and returns one of:

| Outcome              | UI message                                                                |
|----------------------|----------------------------------------------------------------------------|
| `ok`                 | `Connected. <N> mailboxes visible. Selected mailbox "<name>" exists.`     |
| `auth_failed`        | `Authentication failed. Check the username and password.`                 |
| `mailbox_not_found`  | `Connected, but the configured mailbox/folder does not exist on the server.` |
| `connect_failed`     | `Could not reach the IMAP server. Check host, port, and TLS.`             |
| `tls_error`          | `TLS handshake failed. Check the TLS toggle and the port.`                |
| `unknown`            | Generic message; the (sanitized) detail goes to the audit log only.       |

The test never marks messages `\Seen`, never writes to
`IngestedEmail`, and never bumps `lastPolledAt`. Audit:
`tenant_inbox_test_run` with `{ host, port, secure, mailbox,
senderDomain, ok, kind, durationMs }`. The password itself is never
included.

If the password field is left blank, the action decrypts the stored
sealed cipher for the tenant and tests with that — useful when
rotating only the host/mailbox.

## Connectivity test (on the deploy box, never logging the password)

```bash
SECRET=$(sudo grep '^INGEST_TICK_SECRET=' /opt/bvisible/shared/env/.env \
         | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')

# Force a tick across every enabled tenant inbox.
curl -fsS -X POST \
  -H "x-bvisible-ingest-secret: ${SECRET}" \
  http://127.0.0.1:3000/api/internal/email-ingest/tick \
  | jq .

# Test a single config without writing to the DB. Pass tenantId to
# decrypt the stored password; pass `password` to test a fresh value.
curl -fsS -X POST \
  -H "x-bvisible-ingest-secret: ${SECRET}" \
  -H "content-type: application/json" \
  --data '{"tenantId":"<TENANT_ID>","host":"imap.gmail.com","port":993,"secure":true,"mailbox":"INBOX","username":"ingest@yourdomain.com"}' \
  http://127.0.0.1:3000/api/internal/email-ingest/test \
  | jq .
```

Expected for `/tick`: `{ ok, data: { processed, reports: [{ tenantId,
scannedCount, ingestedCount, matchedCount, errorCount, durationMs }] } }`.
Expected for `/test`: `{ ok, data: { ok: true|false, kind?, message?,
mailboxCount?, mailboxExists?, durationMs } }`.

A `503` from either route means `INGEST_TICK_SECRET` is unset on the
server. A `401` means the secret on disk doesn't match the value being
sent.

If `runs[].errors > 0`, tail PM2 stderr for `"emailIngest":true`
lines — see `DEBUGGING.md § 9` for the `errorKind` table.

## Message processing

For each `UNSEEN` message:

1. Compute `messageId` from the RFC 5322 `Message-ID:` header (or, if
   absent, a deterministic SHA-256 of `from + date + subject` so the
   row is still idempotent).
2. **Duplicate guard:** insert into `IngestedEmail` with
   `(tenantId, messageId)`. The unique constraint short-circuits any
   re-processing (R-MAIL-01).
3. Parse with `mailparser`. Captured: `from`, `to`, `subject`,
   `receivedAt`, the first ~2 KB of plain-text body (sanitized), and
   the per-attachment buffer + filename.
4. Persist allowlisted attachments (PDF / JPEG / PNG / WEBP) under
   `/opt/bvisible/shared/uploads/<tenantId>/email/<ingestedEmailId>/<storageKey>`
   with mode `0640`. Anything else lands as an
   `IngestedEmailAttachment` row with `skipped = true` +
   `skipReason` (e.g. `mime_not_allowed`, `size_exceeded`); bytes are
   NOT written.
5. Run the matcher (next section).
6. If matched, materialize:
   - one `POEvent` of kind `VENDOR_REPLY` with metadata
     `{ messageId, fromDomain, attachmentCount, subject }` and a
     non-null `sourceEmailId`,
   - one `POAttachment` per accepted attachment with
     `kind = EMAIL_ATTACHMENT`, `sourceEmailId` set, bytes copied
     into the per-PO directory.
7. **Vendor pricing extraction (Phase 10).** After the materialization
   transaction commits successfully, the ingest runner calls
   `runVendorPriceExtractionAfterMaterialize` in a separate `try/catch`.
   It scans the email **subject**, stored **plain-text body snippet**
   (`bodyTextSnippet`), and **sanitized attachment filenames** only.
   Regex-extracted prices become append-only `VendorPriceHistory` rows
   (integer cents, tenant-scoped, idempotent via `dedupeKey`). Failures
   log `vendor_price_extraction_failed` and do **not** fail ingestion.
   See `DATA_MODEL.md` and `SECURITY_RULES.md` for boundaries (no PDF
   parsing, no OCR, no LLM).
   **PO reconciliation (Phase 14)** intentionally compares PO lines to receipt observations
   created via **`OCR_APPROVED`** after attachment OCR review — not to the Phase 10 email-regex
   extractions from this step (those remain operational signals only).
8. Mark the IMAP message `\Seen`. Only happens AFTER the DB transaction
   for the row commits — a crash before this point replays the message
   on the next tick, the unique constraint prevents duplicates.

## Matching ladder (deterministic, no AI)

Order of attempts. First hit wins; the chosen rule is recorded in
`IngestedEmail.matchReason`.

| Rule | `matchReason` | Hint stored in `matchHint` |
|---|---|---|
| 1. Exact match on internal `PurchaseOrder.number` token `\bPO-\d{4,8}\b` in subject, plain-text body snippet, **or stored attachment original filenames** (single DB row only — if multiple different internal numbers resolve to rows, **none** match) | `PO_NUMBER` | The matched `number` |
| 2. Exact match on `qboPoNumber` among capped QBO-like tokens extracted from the same haystack (first **24** unique tokens after dedupe; if multiple different `qboPoNumber` values hit rows, **none** match) | `QBO_NUMBER` | The matched `qboPoNumber` |
| 3. `From:` address matches a vendor that has **exactly one** open PO (`SENT`, `ORDERED`, `PARTIALLY_RECEIVED`) with `updatedAt` in the last **30 days** | `VENDOR_AND_RECENT` | The sender email address |
| 4. Operator manually links via `/admin/email-ingestion` | `MANUAL` | Operator-provided hint |
| Otherwise | `NONE` (status `UNMATCHED`) | May include comma-separated tokens or sender when helpful |

When rule 1 or 2 yields **more than one** candidate PO, the email stays **`UNMATCHED`** with `matchReason = NONE` and (when possible) `matchedVendorId` from the sender so the review queue can pre-filter.

Explicitly **not** implemented:

- AI / LLM matching.
- Fuzzy embeddings, probabilistic scoring.
- Vendor pricing from attachment **contents** (PDF bytes, OCR, tables).

## Attachment handling

- Allowlist: PDF, JPEG, PNG, WEBP — same set as PO uploads.
- Magic-byte sniff (`detectMimeFromBytes()` in
  `apps/web/lib/po/uploads.ts`); the `Content-Type` MIME header in the
  email is **never trusted**.
- Filename sanitization: `[A-Za-z0-9._-]{1,200}`, fallback to `file`.
  Used only for display — the on-disk filename is the random
  `storageKey`.
- `IngestedEmailAttachment.sha256` is captured on every accepted blob
  for downstream dedupe / forensics.
- Maximum size: 25 MB per attachment (matches the PO upload cap and
  the Next.js `bodySizeLimit`). Larger attachments land as
  `skipped = true` with `skipReason = 'size_exceeded'`.
- When the email matches a PO, `promoteEmailAttachmentToPo()` copies
  the bytes into the per-PO directory and creates a `POAttachment`
  with `kind = EMAIL_ATTACHMENT` + `sourceEmailId`.

## Idempotency, leases, and PM2 restarts

- **Row-level idempotency:** `IngestedEmail (tenantId, messageId)` is
  UNIQUE. The IMAP message is only marked `\Seen` after the row
  commits. Crashing mid-tick is safe: the next tick re-fetches and
  the unique constraint short-circuits the second write.
- **Materialization idempotency:** if a `POEvent` of kind `VENDOR_REPLY`
  already exists for the `IngestedEmail.id` (`sourceEmailId`), `materializeOnPo()`
  returns immediately (no duplicate promotions or OCR enqueue from a replay).
  Manual link / retry paths call the same helper.
- **Vendor price history idempotency:** `VendorPriceHistory` rows use
  unique `(tenantId, dedupeKey)` so retries after a successful insert
  no-op instead of duplicating observations.
- **Per-tenant lease:** `runIngestForTenant()` claims a soft lease by
  conditionally setting `TenantEmailInbox.lastPolledAt = now()`
  WHERE the previous `lastPolledAt` is older than `pollIntervalSeconds`.
  Two ticks for the same tenant become a no-op for the second; two
  tenants do not contend.
- **PM2 restart:** the process can die at any point in the loop. On
  the next timer firing the new process re-claims the lease (the old
  one's `lastPolledAt` is stale at this point) and re-fetches.
  Anything already persisted is short-circuited by the unique key.

## Operator review (`/admin/email-ingestion`, ADMIN+)

- Filterable buckets: **Unmatched** (default), **Matched**, **Failed**,
  **Dismissed**, **All**. Each bucket shows count badges.
- Per-row expand panel: status / match reason chips, compact **guidance chips**
  (skipped attachments, vendor-known vs unknown), sender + subject,
  body snippet (rendered as plain text in `<pre>` — never
  `dangerouslySetInnerHTML`), per-attachment list with download links
  (skipped attachments show the skip reason instead).
- Inline actions:
  - **Link** to a chosen PO (combobox of recent non-deleted POs in the
    tenant) → calls `manualLinkEmailToPoAction` which materializes the
    email (idempotent) and writes `email_ingest_manual_link` to the
    audit log.
  - **Retry** → resets the row to `PENDING` so the next tick re-runs
    the deterministic matcher. Audit `email_ingest_retried`.
  - **Dismiss** → sets the row to `DISMISSED`. Bytes on disk are
    retained (audit). Audit `email_ingest_dismissed`.
- Sidebar: **Inbox config card** (host / port / mailbox / `lastPolledAt`
  / `lastErrorAt` / `lastErrorMessage`; password is **never**
  displayed, even in masked form) and **Recent ticks** (last five
  `EmailIngestRun` rows with scanned / ingested / matched / errors /
  durationMs).
- Promoted attachments create `POAttachment` rows as today — receipt-like kinds
  additionally enqueue **async local OCR** (`apps/web/lib/ocr/enqueue.ts`) without
  blocking ingestion (`DEBUGGING.md` §11f + `/admin/ocr-review`).

## Logging discipline

Allowed fields on every ingestion log line (one JSON object per line,
prefixed `"emailIngest":true`):

`tenantId`, `messageId`, `fromDomain` (the `@…` part of the sender,
lower-cased), `attachmentCount`, `matchReason`, `durationMs`,
`errorKind` (one of `imap_connect`, `imap_auth`, `imap_fetch`,
`parse_failed`, `persist_failed`).

Forbidden everywhere — including the `EmailIngestRun.errorMessage`
column which is sanitized before insert: the IMAP password, the full
raw RFC822 source, attachment bytes or hashes of attachment bytes
paired with sender PII, and any serialized `imapflow` auth object.

## Security envelope

- **IMAP credentials at rest.** Per-tenant `passwordCipher` is
  base64(IV ‖ tag ‖ ciphertext) from AES-256-GCM keyed on
  `INGEST_SECRET` (SHA-256-derived to 32 bytes). Plaintext password
  lives only in process memory for the lifetime of one connection.
- **Internal endpoint authentication.**
  `/api/internal/email-ingest/tick` uses constant-time
  `safeCompareSecret()` against `INGEST_TICK_SECRET`. No session
  cookie. Returns `503` if the secret is unset (no silent 200), `401`
  if the comparison fails.
- **Cross-tenant safety.** Every query against `IngestedEmail`,
  `IngestedEmailAttachment`, `TenantEmailInbox`, `EmailIngestRun`,
  `VendorCatalogItem`, `VendorItemAlias`, `VendorPriceHistory`, and
  `VendorPriceNotification`
  carries `tenantId` from the resolved inbox row (or, in the operator
  UI, from `requireRoleWithEffectiveCompany(...).tenantId` / effective company resolution).
- **No public attachment serving.** The download route
  (`/api/email-ingest/[id]/attachments/[attachmentId]`) re-detects
  MIME from disk, refuses anything outside the allowlist, and is
  ADMIN+ only.
- **Sanitization.** Subject + sender pass through React's default
  escaping in the UI; the body snippet renders inside `<pre>` only;
  filenames are the `[A-Za-z0-9._-]{1,200}` value used for PO uploads.

## SUPER_ADMIN inbox surfaces

| Route                                     | Who           | Purpose                                                                                  |
|-------------------------------------------|---------------|------------------------------------------------------------------------------------------|
| `/admin/email-ingestion/inboxes`          | SUPER_ADMIN   | System-wide list of every tenant + inbox status. Stat chips: configured / healthy / errored / disabled. |
| `/admin/tenants/[id]/email-inbox`         | SUPER_ADMIN   | Per-tenant configure / edit / test / delete + per-tenant diagnostics + recent ticks + recent ingested emails. |
| `/admin/email-ingestion`                  | ADMIN+        | Operator review of inbound mail (unmatched / matched / failed / dismissed). SUPER_ADMIN sees a "Configure inbox" CTA in the page header. |

The per-tenant page never serializes the IMAP password into the
response body. The form's password input is always rendered empty
(blank means "keep existing sealed value"); the displayed username is
masked to `<first>***<last>@<domain>`; the diagnostics card surfaces
`lastPolledAt`, `lastErrorAt`, `lastErrorMessage`, status counts, and
recent `EmailIngestRun` rows but never the cipher.

## Vendor pricing extraction (deterministic)

- **Inputs:** `subject`, `bodyTextSnippet` (already sanitized at parse
  time), and `originalFilename` for each attachment row (skipped blobs
  are ignored for filename parsing).
- **Not inputs:** PDF/HTML bodies, image OCR, LLM, embeddings, or any
  execution of attachment payloads.
- **Idempotency:** each observation uses a SHA-256 `dedupeKey`; unique
  `(tenantId, dedupeKey)` prevents duplicate history rows on replay.
- **Lower price:** when a new row is strictly cheaper than the latest
  prior price for the same `VendorCatalogItem`, the system creates a
  `VendorPriceNotification` (manual dismiss), a `POEvent` of kind
  `VENDOR_LOWER_PRICE`, and an audit row — **no auto-repricing**.
- **Regression check:** `bash server-scripts/db/.verify-vendor-pricing.sh`
  (or `pnpm --filter @bvisible/web exec tsx --tsconfig tsconfig.json scripts/verify-vendor-pricing.ts`
  with `DATABASE_URL`) exercises the persist path without IMAP — see
  `DEBUGGING.md` § 9.

## What's intentionally NOT here yet

- OCR or invoice parsing (`pdfminer`, `tesseract`, table extraction).
- Parsing prices from inside PDF/image attachments.
- Auto-marking invoices `received` / `paid`.
- AI / LLM matching.
- IMAP IDLE / push / Gmail API webhooks.
- Gmail OAuth (today: app passwords only).
- Background queue infrastructure beyond the 60 s systemd timer + soft
  lease.
- Multiple inboxes per tenant (today: one row per tenant; editing
  replaces).
