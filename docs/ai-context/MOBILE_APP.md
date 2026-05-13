# MOBILE_APP — B Visible

A small Expo / React Native app for shop and field staff. Lives in
`apps/mobile/`.

## Audience

- **Installers** in the field — capture install photos, sign-offs, receipts.
- **Shop staff** — quick PO lookup, mark items received, attach packing slips.

## Scope (do not creep)

- View **assigned POs** only (not the full list).
- Upload receipts and photos against a PO by scanning a QR or typing the
  QuickBooks PO number.
- Mark a PO line item as received (with quantity + notes).
- See push notifications for newly assigned POs.
- That's it. No estimating on mobile. No vendor-price management on mobile.

## Auth

- Login with the same email/password as the web app, or magic-link via
  ingest mailbox.
- Issues short-lived JWT (15 min) + rotating refresh token.
- Refresh token revoked when the user logs out, or when an admin revokes the
  device under the User detail screen on the web.
- Failed-login backoff per device.

## Uploads

- App requests a presigned URL from
  `POST /api/v1/mobile/uploads` with `{ poId, mimeType, sizeBytes }`.
- Uploads directly to the storage path on the server, then calls
  `POST /api/v1/mobile/uploads/:id/finalize` with metadata.
- Server places the file under
  `/opt/bvisible/shared/uploads/<tenantId>/po/<poId>/<uploadId>/...`.
- Uploads time out at 60s; the app retries with exponential backoff and
  surfaces a clear error if it gives up.
- Photos are downsized client-side to ≤ 2048px on the long edge before
  upload.

## Offline

- The app caches the assigned-PO list and last-viewed details for 24h.
- Receipts/photos taken offline are queued and uploaded automatically when the
  device is back online.
- The queue is visible to the user with retry/discard controls.

## Push

- Expo push tokens stored on the user, scoped to the tenant.
- Tokens rotate on app reinstall; old tokens are pruned when push delivery
  fails twice.

## Build + release

- Expo EAS build, two channels: `staging` and `production`.
- Production updates require a tagged commit on `main` and an OTA push
  approval.
- Crash reporting via Sentry (DSN in `.env`).

## What ties back to the web

- Every receipt/photo creates a `POEvent` and a `POAttachment` (or
  `POReceipt`).
- The web detail drawer shows mobile-uploaded items inline, with thumbnails
  and the uploader's name.
