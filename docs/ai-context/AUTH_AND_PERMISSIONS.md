# AUTH_AND_PERMISSIONS — B Visible

## Identity

- Email + password (Argon2id hash) for the web.
- Mobile uses the same accounts via REST + JWT (short-lived access token,
  rotating refresh token).
- Optional Google OAuth for staff that already use Google Workspace.

## Session

- Web: encrypted httpOnly cookie holding the session ID.
- Mobile: JWT in `Authorization: Bearer ...`.
- Every request resolves `{ userId, tenantId, role }` once at the edge and
  passes it down via a typed context — never re-derive from the cookie inside
  feature code.

## Roles

| Role | Can do |
|---|---|
| `owner` | Everything in their tenant, including billing + user admin |
| `admin` | Everything except billing |
| `estimator` | Create/edit estimates, read POs, read vendors |
| `purchasing` | Create/edit POs, attach vendor docs, edit vendor prices |
| `installer` | Read assigned POs, upload receipts/photos via mobile |
| `viewer` | Read-only |

Roles are stored on `User.role` per tenant. A user belongs to exactly one
tenant — no cross-tenant accounts.

## Permission model

- Coarse role check at the route/server-action boundary.
- Fine-grained ownership check inside the action (e.g. installer can only see
  POs assigned to them).
- **Tenant check is not optional and not a permission** — it's a load-time
  filter applied to every query. See `SECURITY_RULES.md`.

## What never authenticates a request

- Headers from the client (`X-Tenant-Id`, etc.) — ignored.
- URL params for `tenantId` — ignored.
- Anything not signed by our session/JWT layer.

## Password reset

- Email a single-use token valid 30 minutes.
- Tokens stored hashed; never log the plaintext token.

## Mobile-specific

- See `MOBILE_APP.md` for the device pairing/refresh flow.
