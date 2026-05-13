# FILE_STRUCTURE — B Visible

Where things live. Update this file when you add a top-level folder.

## Repo layout (target)

```
.
├── apps/
│   ├── web/                  Next.js web app (server actions + UI)
│   └── mobile/               React Native (Expo) employee app
├── packages/
│   ├── db/                   Prisma schema + migrations + client
│   ├── shared/               Cross-package types + zod schemas
│   ├── ui/                   Shared design-system components
│   └── pricing/              Estimate + vendor price engines (pure TS)
├── workers/
│   ├── email-ingest/         IMAP fetcher + parser
│   └── vendor-price/         Lower-price detector
├── server-scripts/           Server prep + deploy queue scripts (already in repo)
├── docs/
│   ├── ai-context/           This system. Routing starts at CURSOR_START_HERE.md
│   └── prompts/              Prompt templates
├── .cursor/
│   └── rules/                Project-wide Cursor rules (always-apply)
├── docker-compose.yml        Production compose (web, workers, db, redis, nginx)
├── package.json              pnpm workspace root
└── pnpm-workspace.yaml
```

## Where to put a new file (cheat sheet)

| You are adding… | Put it in… |
|---|---|
| A new Prisma model | `packages/db/prisma/schema.prisma` then `pnpm db:migrate` |
| A new web page | `apps/web/app/(area)/<page>/page.tsx` |
| A new server action | `apps/web/app/_actions/<feature>.ts` |
| Pure pricing math | `packages/pricing/src/<rule>.ts` (no I/O) |
| A reusable UI primitive | `packages/ui/src/<component>.tsx` |
| Email/IMAP code | `workers/email-ingest/src/...` |
| Vendor lower-price logic | `workers/vendor-price/src/...` |
| A server-side script | `server-scripts/...` and document it in `DEPLOYMENT.md` |
| AI context docs | `docs/ai-context/` only |

## Things that DO NOT belong in the repo

- `.env` files (live in `/opt/bvisible/shared/env/.env` on the server)
- Vendor SDK keys, Google app passwords, OAuth secrets
- User-uploaded files (live in `/opt/bvisible/shared/uploads/` on the server,
  symlinked into `app/uploads`)
- Local DB dumps
