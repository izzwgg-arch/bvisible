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


## Bid Estimator

| Layer | Command | Covers |
|---|---|---|
| Unit | `pnpm --filter @bvisible/web run verify:bid-estimator` | takeoff parsing (headings / repeated headers / subtotals / tax / totals excluded, rows retained, quantities combined), standard-sign matching (key / name / alias / fuzzy, ambiguous, missing price-critical fields), pricing (per sign / set / sq ft / character / hour / day, minimum charge, waste, rate ladder, markup-exempt, unpriced instead of silent $0), design + installation calculators, checklist gating, QBME line-by-line + reconciliation + sanitation, sales tax / terms / stale-company-info guards, standard-sign sync (duplicate prevention, deactivate-not-delete, app rows untouched, missing tab is a no-op). |
| Browser | `pnpm --filter @bvisible/web run smoke:bid-estimator` | Complete seven-step run against the real app + DB: start → project autosave → upload xlsx + PDF → import summary → review table (auto-priced / office questions / 1 set → 11 characters) → answer three office questions → design → installation → customer estimate (Harriman info, PO number, tax) → QBME (one line per estimate line, allowed items, empty AMOUNT, Σ qty × rate = pre-tax subtotal) → leave, resume from the list at the saved step → preview / PDF / QBME page / read-only classic editor. Screenshots land in `smoke/output/bid-estimator/`. |
| Browser (regression) | `node ../../node_modules/.pnpm/@playwright+test@1.60.0/node_modules/@playwright/test/cli.js test smoke/estimate-classic-regression.spec.ts` | Classic estimate still works end to end: guided create + Excel import → editor → preview + PDF → QBME → approve → PO → finalize gate → list. |

Prerequisites for the browser specs: the local dev server (`.claude/launch.json` → `web`),
`DEV_LOGIN_*` in `apps/web/.env.local`, `UPLOAD_DIR` pointing somewhere writable, and the
local standard-sign catalog: `npx tsx smoke/fixtures/seed-bid-standard-signs.ts`
(APP-source rows; the Sheet sync never touches them). Regenerate the fixtures with
`node smoke/fixtures/build-bid-fixtures.mjs`.

**Playwright CLI note:** `npx playwright` resolves 1.61 while the specs import
`@playwright/test` 1.60 — run the matching CLI directly
(`node ../../node_modules/.pnpm/@playwright+test@1.60.0/node_modules/@playwright/test/cli.js test ...`).

## CI

CI runs lint + unit tests on every push. E2E runs on PRs to `main`. Failing
tests block merge. Do not skip with `it.skip` without a tracking issue.
