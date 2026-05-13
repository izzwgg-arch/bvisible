# ARCHITECTURE — B Visible

High-level shape of the system. Read `FILE_STRUCTURE.md` for paths and
`DATA_MODEL.md` for entities.

## Components

```
┌──────────────────────────────────────────────────────────────────┐
│  Web app (Next.js, multi-tenant)                                 │
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

## Tenancy model

- One Postgres database, **row-level isolation** by `tenantId` column on every
  tenant-scoped table.
- The session/auth layer attaches `tenantId` to every request; queries that
  forget it are bugs (see `SECURITY_RULES.md`).

## Why this shape

- One server keeps ops simple while the team is small.
- Git-first deploy keeps the audit trail on GitHub.
- Workers are separate processes (compose services) so a stuck IMAP ingest does
  not block the web UI.
