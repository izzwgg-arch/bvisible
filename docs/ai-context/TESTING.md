# TESTING — B Visible

## Test layers

| Layer | Tool | Where |
|---|---|---|
| Pure logic (estimate, vendor pricing) | `vitest` | next to the code, `*.test.ts` |
| Server actions / API | `vitest` + Prisma test DB | `apps/web/__tests__` |
| End-to-end web | `playwright` | `apps/web/e2e` |
| Mobile smoke | `expo` test util | `apps/mobile/__tests__` |

## What MUST have tests

- `packages/pricing/` — every formula in `ESTIMATE_ENGINE.md` (materials,
  machine rates, banner rule, channel-letter formula). Pure code, easy to test.
- Tenant isolation — at least one test per tenant-scoped server action proving
  that another tenant's data is not returned.
- Email parser — at least one parsed-fixture test per supported vendor format.

## What does NOT need exhaustive tests

- One-off scripts in `server-scripts/` (manual on the box).
- Pure UI tweaks (rely on Playwright happy-path).

## Running tests

```bash
pnpm -r test            # all packages, vitest
pnpm --filter web test  # web only
pnpm --filter web e2e   # playwright (needs the dev server)
```

## CI

CI runs lint + unit tests on every push. E2E runs on PRs to `main`. Failing
tests block merge. Do not skip with `it.skip` without a tracking issue.
