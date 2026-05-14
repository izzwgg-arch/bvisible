# ARCHITECTURE — B Visible

High-level shape of the system. Read `FILE_STRUCTURE.md` for paths and
`DATA_MODEL.md` for entities.

## Components

```
┌──────────────────────────────────────────────────────────────────┐
│  Web app (Next.js, single-company UI, internal tenantId scope)   │
│   - Server actions / API routes                                  │
│   - SaaS UI (sidebar + drawers, see UI_SYSTEM.md)                │
└─────────────┬──────────────────────────┬─────────────────────────┘
              │                          │
              ▼                          ▼
┌────────────────────────┐    ┌─────────────────────────────────┐
│ PostgreSQL (Prisma)    │    │ Background workers              │
│  - tenants, users      │    │  - email ingestion (IMAP)       │
│  - clients, vendors    │    │  - vendor price evaluator       │
│  - estimates, POs      │    │  - notification dispatcher      │
│  - VendorPrice(History)│    └─────────────────────────────────┘
└────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────┐
│ Mobile app (employee)                              │
│  - PO receipt capture, install/photo uploads       │
│  - hits the same API as the web app                │
└────────────────────────────────────────────────────┘
```

## Deployment topology

- **Single VPS** at `212.56.32.136` (Ubuntu 24.04 LTS) hosts everything in
  Docker (web, workers, Postgres, Redis).
- Nginx is the only public listener; Postgres and Redis are bound to the Docker
  internal network.
- Deploys are pull-from-Git only, serialized through a flock-protected queue.
- See `DEPLOYMENT.md` and `DEPLOY_QUEUE.md`.

## Company scope (`tenantId`)

- One Postgres database, **row-level isolation** by `tenantId` on every
  tenant-scoped table (internal **company** boundary; Prisma model `Tenant`).
- Production targets **one** primary company row (`slug = bvisible`, name **B Visible**),
  bootstrapped via `ensureDefaultCompany()` (`apps/web/lib/company/default-company.ts`).
- The session/auth layer resolves an effective company id for product pages
  (`resolveEffectiveCompany`, `requireTenantId`, `requireUserForAppShell`); queries that
  omit `tenantId` are still bugs (see `SECURITY_RULES.md`).
- If multiple `tenants` rows exist without a canonical `bvisible` slug, startup-style
  helpers **throw** until an operator resolves ambiguity (no silent merges).

## Why this shape

- One server keeps ops simple while the team is small.
- Git-first deploy keeps the audit trail on GitHub.
- Workers are separate processes (compose services) so a stuck IMAP ingest does
  not block the web UI.
