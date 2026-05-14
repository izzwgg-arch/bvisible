# MOBILE_APP — B Visible

Expo / React Native client in `apps/mobile/`. This doc reflects what is
**shipped today**; speculative features stay labeled as future work.

## Audience

- Field staff — receipts, install photos, vendor invoices, field documents on a PO.
- Shop staff — quick PO lookup.

## Shipped (mobile API foundation)

### Auth

- Same email/password as the web app (`POST /api/v1/auth/login`).
- **No browser cookies.** Short-lived access JWT (~15 min,
  `MOBILE_JWT_SECRET`, HS256) plus opaque **rotating** refresh token stored
  only as SHA-256 in `mobile_sessions`.
- `POST /api/v1/auth/refresh` rotates refresh; old refresh is rejected.
- `POST /api/v1/auth/logout` with `Authorization: Bearer <access>` revokes
  the session row → subsequent API calls fail even before JWT expiry.
- `SUPER_ADMIN` (no `tenantId`) cannot use mobile login.

### Data

- `GET /api/v1/purchase-orders` — list POs for the JWT tenant.
- `GET /api/v1/purchase-orders/:id` — detail + attachments + recent timeline.

### Uploads (two-phase)

1. `POST /api/v1/uploads/presign` — validates PO access + kind; creates
   `mobile_pending_uploads` + server `storageKey`; returns `uploadId` and
   absolute `uploadUrl` for step 2 (same Next origin).
2. `PUT uploadUrl` — raw body, size **must** equal `declaredSizeBytes`
   (≤ 25 MB). Writes via `persistAttachmentBytes` (existing PO upload helper).
3. `POST /api/v1/uploads/complete` — magic-byte MIME re-check; transaction:
   mark pending complete + `insertPoAttachmentAndTimelineEvent` (`ATTACHMENT_ADDED`);
   audits `mobile_upload_*` + `po_attachment_added`.

Supported kinds (mobile picker): `RECEIPT`, `INSTALL_PHOTO`,
`FIELD_DOCUMENT`, `VENDOR_INVOICE`. Allowlisted MIME: PDF, JPEG, PNG, WEBP.

### Client configuration

- Set `EXPO_PUBLIC_API_BASE_URL` to the HTTPS origin of the web app (no path).
- Middleware adds CORS for `/api/v1` so device clients can send Bearer tokens.

## Future (not shipped)

- Assigned-PO-only scope, QR flow, line-level receiving.
- Client-side photo resize, offline queue, push notifications.
- Magic-link-only login via ingest mailbox.

## Build

- From repo root: `pnpm --filter @bvisible/mobile start` (after install).
