# EMAIL_INGESTION — B Visible

How vendor email becomes structured PO data. Worker lives in
`workers/email-ingest/`.

## Mailbox setup (Google Workspace)

1. Create a dedicated user (e.g. `ingest@yourdomain.com`).
2. Enable 2-Step Verification on that account.
3. In the user's Google Account → Security → **App passwords**, generate one
   for "Mail" / "Other (B Visible Ingest)".
4. Put the 16-character app password in `.env`:
   - `IMAP_USER=ingest@yourdomain.com`
   - `IMAP_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx`
   - Same for SMTP if outbound mail is needed.
5. Optional: create a Gmail filter that labels expected vendor mail
   (`label:vendors`) so the worker can scan a smaller scope.

## Connectivity tests

Run from the server (`deploy` user):

```bash
# IMAP test (login + folder listing)
python3 - <<'PY'
import imaplib, os
m = imaplib.IMAP4_SSL("imap.gmail.com", 993)
m.login(os.environ["IMAP_USER"], os.environ["IMAP_APP_PASSWORD"])
print(m.list())
m.logout()
PY

# SMTP test (send a 1-line email to yourself)
python3 - <<'PY'
import smtplib, ssl, os
msg = "Subject: B Visible SMTP test\n\nHello from the server."
with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context()) as s:
    s.login(os.environ["SMTP_USER"], os.environ["SMTP_APP_PASSWORD"])
    s.sendmail(os.environ["SMTP_USER"], [os.environ["SMTP_USER"]], msg)
print("sent")
PY
```

If either fails, see `DEBUGGING.md` → "email ingestion failures".

## Inbox scan loop

The worker:

1. Connects via IMAP (idle if available, otherwise polls every 60s).
2. Lists `UNSEEN` messages in the configured folder.
3. For each message:
   - Compute `messageId` (the RFC822 `Message-ID` header).
   - **Duplicate guard:** if a row exists in `IngestedEmail` with
     `(tenantId, messageId)`, skip (R-MAIL-01).
   - Parse subject + body for a QBO PO number.
   - Resolve vendor by sender email → domain → alias (R-VEN-02).
   - Save the email record + attachments under
     `/opt/bvisible/shared/uploads/<tenantId>/email/<yyyy>/<mm>/<messageId>/`
     (R-MAIL-02).
   - If vendor + PO are confident, attach to the PO as a `vendor_reply` event.
   - Otherwise enqueue a review-queue item.
4. Marks the message `\Seen` (or moves to a "Processed" label).

## Attachment handling

- Strip Windows path separators, control chars, and leading dots from
  filenames.
- Reject filenames that, after sanitization, are empty.
- Store with the original extension; never `chmod +x`.
- Compute and store SHA-256 to deduplicate identical PDFs across emails.

## Vendor document parsing

- PDFs: text extraction first (pdfminer / pdf-parse). Fall back to OCR
  (tesseract) when text extraction returns < 200 chars.
- Look for: line items, unit prices, totals, vendor PO number.
- Compare detected unit prices to the current `VendorPrice`. If lower, hand
  off to `VENDOR_PRICE_ENGINE.md` (creates a manual-dismiss notification —
  R-VEN-03).

## Review queue

Anything with low confidence goes here, never to live PO data. Reviewers can:

- Pick a PO and attach.
- Pick a vendor and create a new alias (`ItemAlias` / vendor alias).
- Discard (logged).

## Logging

- **Never log full email bodies or app passwords.** Log
  `{ messageId, fromDomain, subject, hasAttachments, parseConfidence }`.
- Errors include the messageId for cross-reference.
