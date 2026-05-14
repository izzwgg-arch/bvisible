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
   │    mark IMAP message \Seen          ← only after row commits
   └─ release lease + log EmailIngestRun
```

## Mailbox setup (Gmail / Workspace, the bootstrap path)

1. Create a dedicated user (e.g. `ingest@yourdomain.com`).
2. Enable 2-Step Verification on that account.
3. Google Account → Security → **App passwords** → generate one for
   "Mail" / "Other (B Visible Ingest)".
4. Either populate the env-var fallback in
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

   …or insert a `TenantEmailInbox` row directly via psql with the
   password sealed by `apps/web/lib/email-ingest/crypto.ts:sealSecret()`
   (today there is no in-app form; the per-tenant config form is the
   recommended next step).

5. Optional: create a Gmail filter that labels expected vendor mail
   (`label:vendors`) and set `IMAP_MAILBOX=vendors` (or the per-tenant
   equivalent) so the poll scans a smaller scope.

## Connectivity test (on the deploy box, never logging the password)

```bash
SECRET=$(sudo grep '^INGEST_TICK_SECRET=' /opt/bvisible/shared/env/.env \
         | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')
curl -fsS -X POST \
  -H "x-bvisible-ingest-secret: ${SECRET}" \
  http://127.0.0.1:3000/api/internal/email-ingest/tick \
  | jq .
```

Expected: a JSON summary `{ ok, runs: [{ tenantId, scanned, ingested,
matched, errors, durationMs }] }`. A `503` means
`INGEST_TICK_SECRET` is unset on the server. A `401` means the secret
on disk doesn't match the value the timer is sending.

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
7. Mark the IMAP message `\Seen`. Only happens AFTER the DB transaction
   for the row commits — a crash before this point replays the message
   on the next tick, the unique constraint prevents duplicates.

## Matching ladder (deterministic, no AI)

Order of attempts. First hit wins; the chosen rule is recorded in
`IngestedEmail.matchReason`.

| Rule | `matchReason` | Hint stored in `matchHint` |
|---|---|---|
| 1. Exact match on `qboPoNumber` in subject or first 8 KB of plain-text body | `QBO_NUMBER` | The matched `qboPoNumber` |
| 2. Exact match on internal `PurchaseOrder.number` (e.g. `PO-000123`) in subject or body | `PO_NUMBER` | The matched `number` |
| 3. `From:` address matches a vendor that has **exactly one** non-canceled PO updated in the last 90 days | `VENDOR_AND_RECENT` | The vendor name |
| 4. Operator manually links via `/admin/email-ingestion` | `MANUAL` | The PO number |
| Otherwise | `NONE` (status `UNMATCHED`) | n/a |

Explicitly **not** implemented:

- AI / LLM matching.
- Fuzzy embeddings, probabilistic scoring.
- Attachment filename hint matching (operator manually links instead).
- Vendor pricing intelligence (`VendorPrice`, `VendorPriceHistory`).

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
- **Materialization idempotency:** `materializeIngestedEmailOnPo()` is
  keyed on `(purchaseOrderId, sourceEmailId)`. Re-running it for an
  already-materialized email writes nothing.
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
- Per-row expand panel: status / match reason chips, sender + subject,
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
  `IngestedEmailAttachment`, `TenantEmailInbox`, and `EmailIngestRun`
  carries `tenantId` from the resolved inbox row (or, in the operator
  UI, from `requireRole(ADMIN, SUPER_ADMIN).tenantId`).
- **No public attachment serving.** The download route
  (`/api/email-ingest/[id]/attachments/[attachmentId]`) re-detects
  MIME from disk, refuses anything outside the allowlist, and is
  ADMIN+ only.
- **Sanitization.** Subject + sender pass through React's default
  escaping in the UI; the body snippet renders inside `<pre>` only;
  filenames are the `[A-Za-z0-9._-]{1,200}` value used for PO uploads.

## What's intentionally NOT here yet

- OCR or invoice parsing (`pdfminer`, `tesseract`, table extraction).
- Vendor pricing intelligence (`VendorPrice`, `VendorPriceHistory`,
  R-VEN-03 manual-dismiss notifications).
- Auto-marking invoices `received` / `paid`.
- AI / LLM matching.
- IMAP IDLE / push / Gmail API webhooks.
- Background queue infrastructure beyond the 60 s systemd timer + soft
  lease.
- Per-tenant inbox configuration UI (today: env-var fallback or hand-
  crafted SQL insert; the form is the recommended next step).
