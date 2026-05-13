# CODING_STANDARDS — B Visible

## Language + tooling

- TypeScript only. No JavaScript files in `apps/`, `packages/`, or `workers/`.
- `pnpm` is the only package manager. Never run `npm install` or `yarn`.
- Node 22 LTS in production (matches the server).
- Lint with `eslint`, format with `prettier`. Both run in CI; do not bypass.

## Naming

- React components: `PascalCase` files (`InvoiceTable.tsx`).
- Hooks: `useCamelCase` (`useEstimate.ts`).
- Server actions: verbs, kebab folders (`app/_actions/create-estimate.ts`).
- DB columns: `camelCase` in Prisma → snake-case in SQL via `@map`.
- IDs: `cuid()` unless there is a strong reason for a UUID.

## Database & queries

- Use Prisma. No raw SQL unless wrapped in a comment that explains why.
- **Every tenant-scoped query must include `tenantId`** in the `where` clause.
  See `SECURITY_RULES.md`.
- Use transactions for any multi-row write that must be atomic.
- Pagination: cursor-based with `id` ordering, default page size 50.

## Money & numbers

- Store money as integer cents (`Int` in Prisma). Never as `Float`.
- Convert to/from dollars at the UI boundary only.
- Round at presentation. Never round in the middle of an estimate calculation.

## Validation

- Every server action input parsed by a `zod` schema in `packages/shared`.
- Reject early. Return typed errors, not 500s.

## Errors & logging

- Throw typed errors (`class Foo extends Error`) inside the engines.
- Log with structured fields: `{ level, msg, tenantId, requestId, ... }`.
- **Never log secrets, app passwords, raw auth tokens, or full email bodies.**

## Comments

- Comments explain *why*, not *what*. Code already says what it does.
- Avoid narrative comments like `// Loop through items`.
- Add a comment at the top of any non-obvious formula or business rule and
  link to the doc that defines it (e.g. `// see ESTIMATE_ENGINE.md §banner`).

## Git hygiene

- Small, scoped commits. One feature per commit when possible.
- Commit message style: `area: short imperative`, e.g.
  `estimates: add banner overage rule`.
- **Always push before deploying.** See the always-apply rule
  `.cursor/rules/git-push-before-deploy.mdc`.
