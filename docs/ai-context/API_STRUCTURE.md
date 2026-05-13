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
