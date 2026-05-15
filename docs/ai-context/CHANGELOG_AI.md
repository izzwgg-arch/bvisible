# CHANGELOG_AI — B Visible

A running log of AI-driven changes to the codebase. Newest first. Each entry
records what changed, the files touched, the risks, and the verification.

---

## 2026-05-15 — Public quote customer Accept / Decline (`/quote/[token]`)

**Scope**

- **Schema:** `EstimateQuoteLink` gains **`acceptedAt`**, **`acceptedByName`**, **`acceptedNote`**, **`declinedAt`**, **`declinedByName`**, **`declinedNote`**, **`respondedAt`**, **`responseIp`**, **`responseUserAgent`** (customer decision source of truth); new **`EstimateTimelineEvent`** / **`estimate_timeline_events`** with **`QUOTE_ACCEPTED`**, **`QUOTE_DECLINED`** kinds + JSON metadata (public-quote indicator, truncated IP/UA).
- **Logic:** `executePublicQuoteCustomerResponse` — single Prisma transaction updates link + estimate status (`accept` → **`APPROVED`**, `decline` → **`REJECTED`** when not already there); **`FINALIZED`** blocked; revoked/expired treated unavailable; **replay-safe** (second identical intent idempotent; opposite intent rejected without duplicate timeline/audit).
- **Audits:** **`estimate_quote_accepted`**, **`estimate_quote_declined`** emitted **only** on first successful record (not idempotent replay).
- **Public UI:** `PublicQuoteResponsePanel` (`print:hidden`) — optional name/note, Accept / Decline buttons; success banners for recorded decision; `submitPublicQuoteResponseAction` + `revalidatePath`.

**Files**

- `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/20260515143000_estimate_quote_accept_decline/migration.sql`, `packages/db/src/index.ts`
- `apps/web/lib/estimate/{execute-public-quote-response.ts,load-public-quote.ts,public-quote-response.test.ts,estimate-quote-link.test.ts}`
- `apps/web/app/quote/[token]/{actions.ts,public-quote-response-panel.tsx,page.tsx}`
- `apps/web/lib/auth/audit.ts`, `apps/web/lib/validators.ts`, `apps/web/package.json`
- `docs/ai-context/{CHANGELOG_AI.md,API_STRUCTURE.md,ESTIMATE_ENGINE.md,SECURITY_RULES.md,UI_SYSTEM.md}`

**Verification**

- `pnpm --filter @bvisible/web run verify:estimate-acceptance` (**30** tests incl. customer-quote safety regressions); `pnpm --filter @bvisible/web run build`.
- **Deploy:** run **`prisma migrate deploy`** so **`20260515143000_estimate_quote_accept_decline`** applies after prior quote-link migration.

**Production deploy — public quote Accept / Decline (`2342e4f`) (2026-05-15)**

- **Deploy job ID:** `20260515T065426-6f88d3`
- **Deployed SHA:** `2342e4fd51096b4ef9bf430c78e9b0d3a9323c25`
- **Migration (`prisma migrate deploy`):** Applied **`20260515143000_estimate_quote_accept_decline`**; `db-verify` reports **15** applied migrations (latest **`20260515143000_estimate_quote_accept_decline`**).
- **PM2:** `bvisible-web` **online** (`exec cwd` → **`/opt/bvisible/app/apps/web/.next/standalone/apps/web`**, script **`server.js`**); reload succeeded as part of deploy worker (**deploy-once** SUCCESS).
- **`/api/health`:** `{"status":"ok","service":"bvisible-web","commit":"2342e4fd51096b4ef9bf430c78e9b0d3a9323c25"}` *(HTTPS by raw IP may fail TLS hostname verification — use the site hostname or `-k` for smoke checks)*.
- **Server tests (`/opt/bvisible/app`):** `pnpm --filter @bvisible/web run verify:estimate-acceptance` → **30/30 pass**
- **Browser (logged-out `/quote/[token]`):** **not run** this session — operator should exercise Accept + Decline on **two** fresh links (or regenerate between paths), confirm success banners, refresh persistence, staff **`APPROVED` / `REJECTED`**, **replay idempotency** (no duplicate timeline/audit), **FINALIZED** blocked, **revoked/expired** unavailable, **opposite action** after response blocked, **invalid token** generic unavailable page, **print** hides response controls, and **no internal/vendor/OCR/admin chrome**.
- **DB snapshot (`psql` via `docker compose exec`, 2026-05-15):** Postgres enum **`EstimateTimelineKind`** includes **`QUOTE_ACCEPTED`** / **`QUOTE_DECLINED`**. Row counts at snapshot: **`estimate_timeline_events`** total **0** (no timeline rows yet in this DB); **`estimate_quote_links`** with **`respondedAt` populated:** **0**; **`audit_logs`** rows where **`action`** is **`estimate_quote_accepted`** / **`estimate_quote_declined`:** **0** — consistent with **no production customer submit** exercised yet. Row-level “exactly once per first response” still needs a **before/after** around a real Accept/Decline.

**Gaps**

- No dedicated **staff estimate timeline UI** yet — events land in **`estimate_timeline_events`** + **`audit_logs`**; operators can extend the estimate page later to render `QUOTE_*` rows like PO timelines.

---

## 2026-05-14 — Public estimate quote links (`/quote/[token]`)

**Scope**

- **Schema:** `EstimateQuoteLink` / `estimate_quote_links` — `tenantId`, `estimateId`, `tokenHash` (unique SHA-256 hex), optional `expiresAt`, `revokedAt`, `lastViewedAt`, `createdById`, `createdAt`.
- **Public route:** `app/quote/[token]/page.tsx` — read-only `QuoteDocument`; invalid/revoked/expired → generic error; `estimate_quote_viewed_public` audit + `lastViewedAt` on success.
- **Crypto/helpers:** `quote-link-crypto.ts`, `quote-link-issue.ts`, `load-public-quote.ts`; middleware adds cache + robots + referrer headers for `/quote/*`.
- **Staff:** `/estimates/[id]/preview` unchanged for authenticated preview; email + panel use public URL.
- **Email:** `sendEstimateEmailAction` rotates link then sends `/quote/...` URL (`estimate-quote.ts` copy updated).
- **UI:** `EstimateQuoteLinkPanel` on estimate detail — generate/regenerate, revoke, copy after rotation, expiry + last viewed.

**Files**

- `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/20260520103000_estimate_quote_links/migration.sql`, `packages/db/src/index.ts`
- `apps/web/middleware.ts`, `apps/web/app/quote/[token]/*`, `apps/web/lib/estimate/{quote-link-crypto,quote-link-issue,load-public-quote,estimate-quote-link.test}.ts`
- `apps/web/app/(app)/estimates/[id]/{page.tsx,estimate-quote-link-actions.ts}`, `apps/web/components/estimate/estimate-quote-link-panel.tsx`
- `apps/web/app/(app)/estimates/[id]/preview/actions.ts`, `apps/web/lib/emails/estimate-quote.ts`, `apps/web/lib/auth/audit.ts`, `apps/web/lib/validators.ts`
- `docs/ai-context/{ESTIMATE_ENGINE.md,SECURITY_RULES.md,API_STRUCTURE.md,UI_SYSTEM.md,CHANGELOG_AI.md}`, `apps/web/package.json`

**Verification**

- `pnpm --filter @bvisible/web run verify:estimate-quote`; `pnpm --filter @bvisible/web run build`
- Apply DB migration before deploy (`prisma migrate deploy`).

**Production deploy — public quote links (`282e8cf`) (2026-05-15)**

- **Deploy job ID:** `20260515T062453-9ac54c`
- **Deployed SHA:** `282e8cfa550fc7fe7cfc591543c488e05403d911`
- **Migration (`prisma migrate deploy`):** Applied **`20260520103000_estimate_quote_links`**; `db-verify` reports **14** applied migrations (latest **`20260520103000_estimate_quote_links`**).
- **PM2:** `bvisible-web` **reload OK** (`startOrReload`, process **online** after deploy).
- **`/api/health` (loopback via deploy healthcheck + public nginx):** `{"status":"ok","service":"bvisible-web","commit":"282e8cfa550fc7fe7cfc591543c488e05403d911"}`
- **Server tests (`/opt/bvisible/app`):** `pnpm --filter @bvisible/web run verify:estimate-quote` → **18/18 pass**
- **Public quote (curl automation, no login):** GET **`/quote/`** + plausible-length unknown token → **200** with generic **“Quote unavailable”** HTML (no estimate enumeration copy). Response headers include **`cache-control: private, no-store`**, **`x-robots-tag: noindex, nofollow`** (middleware + metadata robots).
- **Protected preview:** GET **`/estimates/…/preview`** without session → **307** to **`/login?next=…`** (still staff-only).
- **Browser (`admin@bvisible.local`):** **not run** this session — operator should confirm generate/copy/incognito quote view, print/PDF, revoke/regenerate rotation, and UI lacks sidebar/admin/vendor/OCR chrome on `/quote/[token]`.
- **SMTP / send estimate email:** **not exercised** this session — confirm with **`/settings/email-test`** or preview **Send estimate email** (expect **`/quote/…`** in message body when SMTP succeeds; **`DRAFT → SENT`** only after success).

**Gaps**

- Copy URL requires a fresh generate/regenerate in-session (cannot reconstruct raw token from DB).
- Logged-in **estimate detail → public link → email** paths still need human confirmation on production when convenient.

---

## 2026-05-15 — Customer estimate preview + SMTP send (`DRAFT → SENT`)

**Scope**

- **Route:** `/estimates/[id]/preview` — tenant-scoped quote layout; print hides app chrome (`print:hidden` on `AppShell`, print body background in `globals.css`).
- **Pricing presentation:** `allocateLineSellCents` + `buildCustomerQuoteLines` allocate `finalPriceCents` across lines proportionally to cached `computedCostCents` without rendering internal unit costs.
- **Email:** `sendEstimateEmailAction` — `verifyTransport` + `sendMail`, preview URL from `buildAppAbsoluteUrl`. **`DRAFT → SENT` only after SMTP success**; **`FINALIZED`** blocked; **resent from `SENT`** leaves status. Audit **`estimate_sent_to_client`**.
- **UI:** Estimate detail header: Preview quote, Print/PDF, Send to customer, Back.

**Files**

- `apps/web/app/(app)/estimates/[id]/preview/*`, `apps/web/lib/estimate/*`, `apps/web/lib/auth/app-origin.ts`, `apps/web/lib/emails/estimate-quote.ts`, `apps/web/lib/auth/audit.ts`, `apps/web/lib/validators.ts`, `apps/web/app/(app)/estimates/[id]/page.tsx`, `apps/web/components/app-shell.tsx`, `apps/web/app/globals.css`, `apps/web/package.json`
- `docs/ai-context/{ESTIMATE_ENGINE.md,API_STRUCTURE.md,UI_SYSTEM.md,SECURITY_RULES.md,CHANGELOG_AI.md}`

**Verification**

- `pnpm --filter @bvisible/web run verify:estimate-quote` (7 tests); `pnpm run build` in `apps/web`.

**Production deploy — customer estimate quote (`9d0742a`) (2026-05-15)**

- **Deploy job ID:** `20260515T051235-a0e015`
- **Deployed SHA:** `9d0742a49d118b21a477c85f73c1010d03067432`
- **Migration:** `prisma migrate deploy` — **No pending migrations to apply**
- **PM2:** `bvisible-web` **online** (`startOrReload` OK)
- **`/api/health` (loopback + public nginx):** `{"status":"ok","service":"bvisible-web","commit":"9d0742a49d118b21a477c85f73c1010d03067432"}`
- **Server tests (`/opt/bvisible/app`):** `pnpm --filter @bvisible/web run verify:estimate-quote` → **7/7 pass**
- **Browser (`admin@bvisible.local`):** **not run** this session — spot-check `/estimates/[id]/preview`, print preview (chrome hidden), detail CTAs, SMTP send / safe failure + status transition
- **SMTP:** **not exercised** from this session — use `/settings/email-test` or preview **Send estimate email** with a client email on file; expect verify failure → **no `SENT`** transition when SMTP misconfigured
- **Caveat:** Quote link in email remains **auth-required** (no public token URLs yet)

**Gaps**

- No anonymous/token **public** quote URLs yet; email link expects authenticated workspace access.

---

## 2026-05-15 — Production repair — deploy-queue drift + Items v2 runtime (`3eb4a27`)

**Pre-fix**

- **`/opt/bvisible/app` HEAD:** `b3ef2f444e872b5924ab8369d532f949560059df` (Items catalog only — **not** Items v2 / `ShopCatalogUnit`).
- **Installed `/opt/bvisible/deploy-queue/deploy-once.sh`:** stale May 14 copy (**root:root**); **no** `.bvisible-deploy-commit` / **no** queue self-sync logic.
- **`/api/health`:** `{"status":"ok","service":"bvisible-web"}` — **no** `commit` field.

**Repair**

- Checked out **`3eb4a276bf9c3df68a08c978aa24d42f13727935`** under `/opt/bvisible/app`; copied **`server-scripts/deploy-queue/deploy-once.sh`** → **`/opt/bvisible/deploy-queue/deploy-once.sh`** with **`chown deploy:deploy`** / **`chmod 755`**.
- Enqueued deploy job **`20260515T042554-25660c`** for **`3eb4a27`**; systemd/timer picked up worker; **`deploy-once`** completed successfully.

**Post-fix**

- **Deployed SHA:** **`3eb4a276bf9c3df68a08c978aa24d42f13727935`**
- **Migration:** applied **`20260515160000_shop_catalog_item_v2`** (`db-verify`: **13** migrations, latest **`20260515160000_shop_catalog_item_v2`**).
- **PM2:** `bvisible-web` **online**, **`startOrReload`** OK (fork → standalone **`server.js`**).
- **`/api/health` (loopback + public nginx):** includes **`commit`** matching **`3eb4a27`**.
- **Stamp file:** `/opt/bvisible/app/apps/web/.next/standalone/apps/web/.bvisible-deploy-commit` matches full SHA.
- **Bundle grep:** **`Line type`** / **`Internal unit cost`** present under **`apps/web/.next/static/chunks`**.
- **`pnpm --filter @bvisible/web run verify:vendor-catalog` on server:** **48/48 pass**.
- **Self-sync:** deploy log confirms **`Refreshed`** `deploy-once.sh`, `enqueue-deploy.sh`, `deploy-worker.sh`, `status.sh`, `healthcheck.sh`, **`db-verify.sh`** from checkout.

**Browser / estimate UX**

- **Not automated** (requires **`admin@bvisible.local`** session). Operator should confirm **`/items/new`** field list + estimate catalog **Apply** behavior.

---

## 2026-05-15 — Items v2 UI missing on production — RCA + `/api/health` deploy SHA

**Root cause**

- **Source at `9d10f2d` / `main` is not incomplete:** `items/new/page.tsx` renders `CreateShopMaterialItemForm` from `./create-item-form`, which includes line **kind**, **catalog unit**, **internal cost**, **markup**, optional **sell override**, **default qty**, notes — no legacy **Category** / **Material name** / **Default unit** strings remain under `apps/web/app/(app)/items/`. Duplicate routes/forms were ruled out (single `create-item-form.tsx`).
- **Likely production issue:** process serving HTTP is **not** running static bundles produced from that tree — **stale Next standalone** under PM2 `cwd`, **migration-only / manual** DB drift vs runtime checkout, **wrong host**/upstream in nginx (ops checklist), or **reports referencing desired SHA while runtime never restarted from corresponding `.next`**. Requires **`git rev-parse HEAD`** at **`/opt/bvisible/app`**, **`pm2 describe bvisible-web`**, and (after next deploy) **`curl /api/health`** for **`commit`**.

**Code / infra changes**

- `server-scripts/deploy-queue/deploy-once.sh` — writes **`.bvisible-deploy-commit`** (full SHA from `git rev-parse HEAD`) beside standalone **`server.js`** before copying static assets / reload; **on success**, copies **`server-scripts/deploy-queue/*.sh`** and **`server-scripts/db/db-verify.sh`** into **`/opt/bvisible/deploy-queue/`** so timer-invoked workers pick up repo script changes without manual cp (**bootstrap caveat:** the **currently installed** `deploy-once.sh` on the server must be updated once — e.g. copy from checkout — before this self-sync runs).
- `apps/web/app/api/health/route.ts` — optional JSON field **`commit`** when stamp file exists (health gate unchanged: **`status`** + **`service`** only).
- `docs/ai-context/DEBUGGING.md` — documents **`commit`** in `/api/health`.

**Verification**

- `pnpm --filter @bvisible/web run build` (pass, Windows workspace).

**Remaining**

- Redeploy **`main`** tip so production picks up stamp + health field; then confirm **`commit`** matches expected SHA and **`/items/new`** shows **Line type** / cost / markup fields in browser.

---

## 2026-05-15 — Production verification — Items v2 deploy target (`9d10f2d`) — **blocked on Cursor agent**

**Deploy**

- **Status:** Not executed from this AI session. `ssh -o BatchMode=yes deploy@212.56.32.136` failed with `Permission denied (publickey,password)` — this workspace host has no **`cursor_bvisible`** (or equivalent) key for the production **`deploy`** user; enqueue/worker must be run by an operator with SSH access (see `DEPLOYMENT.md`).
- **Deploy job ID:** *(none — job not enqueued from agent)*
- **Deployed SHA:** *(pending operator deploy)* — target **`9d10f2daf40d5b0c5506a6b1ed3dd5099f8ae6ef`** (short **`9d10f2d`**)
- **Migration result:** *(pending)* — expected order: **`20260515120000_shop_material_items`** → **`20260515160000_shop_catalog_item_v2`** via `pnpm --filter @bvisible/db exec prisma migrate deploy` inside `deploy-once.sh`
- **PM2 / healthcheck:** *(pending)* — success criteria: `startOrReload` OK; `/opt/bvisible/deploy-queue/healthcheck.sh` OK (`{"status":"ok","service":"bvisible-web"}`)

**Operator enqueue (production server, user `deploy`)**

```bash
cat > /tmp/job-items-v2-9d10f2d.json <<'JSON'
{
  "repoUrl":     "https://github.com/izzwgg-arch/bvisible.git",
  "branch":      "main",
  "commitHash":  "9d10f2daf40d5b0c5506a6b1ed3dd5099f8ae6ef",
  "services":    ["web"],
  "requestedBy": "operator-after-cursor-blocked-ssh"
}
JSON

bvisible-deploy /tmp/job-items-v2-9d10f2d.json
# capture JOB_ID from last line of output
sudo -u deploy /opt/bvisible/deploy-queue/deploy-worker.sh
tail -f "/opt/bvisible/deploy-queue/logs/${JOB_ID}.log"
```

Post-deploy on **`/opt/bvisible/app`**: `pnpm --filter @bvisible/web run verify:vendor-catalog` (expect **48** tests). Optional: `sudo /opt/bvisible/deploy-queue/db-verify.sh` should show latest migration **`20260515160000_shop_catalog_item_v2`**.

**Tests (this session — developer workstation)**

- **`pnpm --filter @bvisible/web run verify:vendor-catalog`:** **48/48 pass** (vitest `lib/vendor-pricing` + `lib/shop-material`).

**Browser verification (`admin@bvisible.local`)**

- **Not run** from this session — requires operator login after deploy. Spot-check: `/items`, `/items/new`, MATERIAL/LABOR/MACHINE flows, detail vendor append-only history + preferred vendor, estimate **Catalog items → Apply** only (no mutation while typing), grid **Enter / Shift+Enter / Tab**, vendor intel rail + **Use this cost** only on click.

**Safety / regressions**

- **Not re-validated on production** without deploy. Items v2 diff does not touch OCR ingest workers, email tick, reconciliation UI, or mobile upload code paths by file scope; **`/api/health`** should be exercised via **`healthcheck.sh`** after deploy.

**Remaining caveats**

- Acceptance (**Items v2 usable in production**, picker Apply-only, vendor append-only) is **pending** until operator completes SSH deploy + browser checklist above; append this entry’s **Deploy job ID**, migration line from **`db-verify`**, PM2/health lines, and browser notes when done.

---

## 2026-05-15 — Items v2 estimating catalog + estimate picker (`ShopCatalogUnit`)

**Scope**

- **Schema:** `ShopCatalogUnit`; `ShopMaterialItem` v2 (`kind`, unit, internal cost, markup milli, optional sell override, default qty, `machineId`, preferred vendor); `VendorCatalogItem.vendorSku` (`20260515160000_shop_catalog_item_v2`).
- **Libs:** `markup.ts`, `apply-catalog-to-estimate-line.ts`, `estimate-catalog-bootstrap.ts`, MATERIAL-only `append-manual-price.ts` + SKU on catalog append; `managed-intel` resolves kind/internal cost.
- **Routes/UI:** `/items` list columns; `/items/new` full form; `/items/[id]` pricing + vendor grid + aliases + history; estimate editor `catalog-item-picker` + parallel catalog bootstrap load.
- **Tests:** markup, apply-catalog, vendor manual append, picker integration tests under web verify script.

**Files**

- `packages/db/prisma/{schema.prisma,migrations/20260515160000_shop_catalog_item_v2/migration.sql}`
- `packages/db/src/index.ts`
- `apps/web/app/(app)/items/**`, `apps/web/app/(app)/estimates/[id]/{editor.tsx,line-grid.tsx,catalog-item-picker.tsx,page.tsx}`
- `apps/web/lib/shop-material/**`
- `docs/ai-context/{DATA_MODEL.md,API_STRUCTURE.md,VENDOR_PRICE_ENGINE.md,ESTIMATE_ENGINE.md,UI_SYSTEM.md,KNOWN_RULES.md,CHANGELOG_AI.md}`

**Risks**

- High: migration order (`20260515120000` then `20260515160000`); non-MATERIAL items skip manual vendor append server-side.

**Verification**

- `pnpm --filter @bvisible/web run verify:vendor-catalog` + `pnpm --filter @bvisible/web run build` (run post-merge).

---

## 2026-05-15 — Items catalog + manual vendor pricing (`MANUAL`)

**Scope**

- **Schema:** `ShopMaterialItem`, `ShopMaterialItemAlias`, nullable `VendorCatalogItem.shopMaterialItemId`, `VendorPriceHistory.effectiveAt`, enum `VendorPriceExtractionMethod.MANUAL` (`20260515120000_shop_material_items`).
- **Routes:** `/items`, `/items/new`, `/items/[id]` with sidebar **Items** link (`app-shell.tsx`).
- **Server actions:** metadata edits, aliases, preferred vendor, active flag, manual price append (`appendManualVendorPriceForShopItem`), cautious vendor-catalog linking when normalized keys match (`items/actions.ts`).
- **Pricing helpers:** `apps/web/lib/shop-material/*` (manual append, aggregates, managed intel resolution).
- **Catalog lookup:** `mergeOrderedCatalogItemIds` + `resolvePrimaryCatalogItem` understand shop items/aliases; `lookupVendorCatalogIntelligence` attaches `managedItem` intel while preserving OCR-approved receipt stats for the primary vendor catalog row.
- **Estimate UX:** vendor intelligence rail shows managed item card + optional **Use this cost** button (`vendor-catalog-intel-panel.tsx`, `editor.tsx`).
- **Tests:** extended `catalog-lookup.test.ts`; new `pricing-aggregate.test.ts`; script `pnpm --filter @bvisible/web run verify:vendor-catalog`.

**Files**

- `packages/db/prisma/{schema.prisma,migrations/20260515120000_shop_material_items/migration.sql}`
- `apps/web/{app/(app)/items/**,components/app-shell.tsx,lib/shop-material/**,lib/vendor-pricing/{catalog-lookup.ts,catalog-intel-types.ts},app/(app)/estimates/[id]/{vendor-catalog-intel-panel.tsx,editor.tsx},lib/ui/status-labels.ts,lib/auth/audit.ts,package.json}`
- `docs/ai-context/{DATA_MODEL.md,API_STRUCTURE.md,VENDOR_PRICE_ENGINE.md,ESTIMATE_ENGINE.md,UI_SYSTEM.md,KNOWN_RULES.md,CHANGELOG_AI.md}`

**Risks**

- High: schema migration must run before web deploy; linking stray vendor rows is intentionally conservative (normalized key equality only).

**Verification**

- `pnpm --filter @bvisible/web run verify:vendor-catalog` (pass).
- `pnpm --filter @bvisible/web run build` (pass).

**Production deploy — Items catalog (`b3ef2f4`) (2026-05-15)**

- **Deploy job ID:** `20260515T023121-cc085a`
- **Deployed SHA:** `b3ef2f444e872b5924ab8369d532f949560059df` (short `b3ef2f4`)
- **Migration:** `pnpm --filter @bvisible/db exec prisma migrate deploy` applied **`20260515120000_shop_material_items`**; **db-verify:** 12 migrations, latest `20260515120000_shop_material_items`
- **PM2:** `bvisible-web` **reload OK** (`startOrReload`), **online** after deploy (pid rotated per log)
- **Healthcheck (deploy box):** `/opt/bvisible/deploy-queue/healthcheck.sh` **OK** — `{"status":"ok","service":"bvisible-web"}` from `127.0.0.1:3000`
- **`pnpm --filter @bvisible/web run verify:vendor-catalog` on `/opt/bvisible/app`:** **38/38 pass**
- **Prisma client:** generated during deploy build (`prisma generate` / Next build phase)
- **Browser verification (`admin@bvisible.local`):** **not run in this session** — spot-check `/items`, manual prices, estimate intelligence rail + **Use this cost**
- **Safety posture:** deploy pipeline only checked out build/migrate/reload; no manual DB edits; OCR/reconciliation/email ingestion code paths unchanged at this SHA

**Enqueue reference (same SHA)** — see `DEPLOY_QUEUE.md` for full flow; job JSON uses `commitHash` **`b3ef2f444e872b5924ab8369d532f949560059df`**.

**Remaining gaps**

- Item rename / destructive merges not supported (by design this phase).
- Several native `<form action>` mutations omit inline error display (silent no-op on failure) aside from alias/manual flows using `useActionState`.
- Logged-in browser smoke on production still recommended for Items + estimate rail keyboard behavior.

---

## 2026-05-14 — Operational workflow UX (onboarding, rails, dashboard feed)

**Scope**

- **Onboarding:** dismissible first-session checklist card on `/dashboard`, driven only by real tenant queries (`lib/onboarding/checklist-data.ts`) — clients, vendors, enabled inbox, estimates, POs, receipt/invoice-style attachments. Dismissal persisted via httpOnly cookie (`lib/onboarding/dismiss-action.ts`, component `components/onboarding/onboarding-checklist-card.tsx`). No simulated completion.
- **Estimate detail:** `EstimateWorkflowRail` — lifecycle strip, linked PO + finalize/QBO guidance, contextual next-action panel (`components/workflow/estimate-workflow-rail.tsx`).
- **PO detail:** `PoOperationalRail` — lifecycle (incl. partial → ordered step), attachment/reconciliation/OCR/email summaries, operator next actions (`components/workflow/po-operational-rail.tsx`); attachments panel exposes `#po-attachments` anchor.
- **Dashboard:** recent estimates + recent POs + merged operational attention feed (`lib/dashboard/get-dashboard-feed.ts`); layout polish in `dashboard-widgets.tsx` / `page.tsx`.
- **Presentation labels:** `lib/ui/status-labels.ts` maps enums to operational wording in lists/admin surfaces (DB enums unchanged).

**Files**

- `apps/web/{components/{onboarding/,workflow/},lib/{dashboard/get-dashboard-feed.ts,onboarding/,ui/status-labels.ts},app/(app)/dashboard/{page.tsx,dashboard-widgets.tsx},app/(app)/estimates/{page.tsx,[id]/{page.tsx,totals-panel.tsx}},app/(app)/purchase-orders/{page.tsx,[id]/{page.tsx,attachments-panel.tsx,meta-panel.tsx}},app/(app)/admin/{ocr-review/page.tsx,email-ingestion/review-table.tsx}}`
- `docs/ai-context/{UI_SYSTEM.md,CHANGELOG_AI.md}`

**Risks**

- Medium: extra parallel reads on dashboard and PO detail pages; all tenant-scoped as before.

**Verification**

- `pnpm --filter @bvisible/web run build` (pass).

**Production deploy — operational workflow UX (2026-05-15)**

- **Deploy job ID:** `20260515T014723-88e720`
- **Deployed SHA:** `512875e89e5f311e199fa494893126d61dd3244a` (same as short ref `512875e`).
- **Migration:** `prisma migrate deploy` — **no pending migrations** (11 applied; latest `20260519103000_vendor_catalog_lookup_indexes`).
- **PM2:** `bvisible-web` **reload OK** (`startOrReload`), process **online** after deploy.
- **Healthcheck (deploy box):** `/opt/bvisible/deploy-queue/healthcheck.sh` passed — `{"status":"ok","service":"bvisible-web"}` from `127.0.0.1:3000`.
- **Public health:** `https://vmi3270817.contaboserver.net/api/health` returns `{"status":"ok","service":"bvisible-web"}` (verified post-deploy via curl).
- **Logged-in browser verification (`admin@bvisible.local`):** **not run in this session** — no password available here to exercise `/dashboard`, nav, workflow rails, or console after authentication.
- **Visual / UX spot-check:** deferred to operator walkthrough; recommend confirming onboarding card, recent lists, operational attention strip, and estimate/PO rails against production data.

**Remaining gaps**

- Attention feed rows for OCR/inbox are summary cards when counts exist (not per-document lists).
- Operator should complete a full authenticated smoke (dashboard + admin nav + one estimate/PO detail) and note any rough edges.

---

## 2026-05-14 — Dashboard + app shell SaaS polish

**Scope**

- Polished **app shell** (`apps/web/components/app-shell.tsx`): wider sidebar, Workspace / Administration nav groups via `<NavLinks sections>`, clearer active link styling, refined header (B Visible + workspace subtitle), upgraded `<UserMenu>` (initials tile, role badge, Sign out contrast). Brand eyebrow → **Operations platform** (`brand.tsx`).
- **Dashboard**: real DB metrics (`apps/web/lib/dashboard/get-dashboard-metrics.ts`) + `dashboard-widgets.tsx` — open estimates/POs, vendor price alert count (links to `#vendor-price-alerts`), pending OCR + unreconciled PO counts for ADMIN+, recent `audit_logs` activity, quick actions (New estimate / PO / client / vendor / Configure inbox), first-run checklist; removed redundant `ReconciliationSummaryCards`; retained `VendorPriceAlerts` + `SpendOperationAlerts`.
- **Empty states**: shared `<EmptyState>` (`components/app/empty-state.tsx`); clients/vendors/estimates/purchase-orders list pages; Receipt OCR index; richer inbox review grid empties; reconciliation spend empty guidance; vendor alerts empty card on dashboard.
- **Settings**: label **Company** (was Tenant); human-readable role.

**Files**

- `apps/web/{components/{app-shell.tsx,app/{nav-links.tsx,user-menu.tsx},brand.tsx,app/empty-state.tsx},app/(app)/dashboard/{page.tsx,dashboard-widgets.tsx,vendor-price-alerts.tsx,reconciliation-widgets.tsx},lib/dashboard/get-dashboard-metrics.ts,app/(app)/{clients,vendors,estimates,purchase-orders}/page.tsx,app/(app)/admin/{ocr-review/page.tsx,email-ingestion/review-table.tsx,reconciliation/page.tsx},settings/page.tsx}`
- `docs/ai-context/{UI_SYSTEM.md,CHANGELOG_AI.md}`

**Risks**

- Low–medium: dashboard adds parallel Prisma reads on `/dashboard` (counts + audit tail); acceptable for operator scale.

**Verification**

- `pnpm --filter @bvisible/web run build` (pass).
- Follow-up commit gates the unreconciled PO Prisma count so standard users do not pay for admin-only metrics.

**Remaining gaps**

- App shell grid layout not tuned for very narrow mobile breakpoints (desktop-first ops UI).

---

## 2026-05-14 — Single-company mode (internal `tenantId` preserved)

**Scope**

- Canonical company bootstrap: `ensureDefaultCompany()` / `ensureDefaultCompanyUncached()` (`apps/web/lib/company/default-company.ts`) — slug **`bvisible`**, name **B Visible**, idempotent; **`MultipleCompaniesUnresolvedError`** when multiple `tenants` rows exist without that slug.
- Effective scope: `resolveEffectiveCompany()` (`apps/web/lib/auth/effective-company.ts`) — **`SUPER_ADMIN`** always maps to the canonical row for product + chrome; other roles keep assigned `tenantId` or fall back when null.
- Auth helpers: `requireTenantId()`, `requireUserForAppShell()`, `requireRoleWithEffectiveCompany()` (`apps/web/lib/auth/current-user.ts`); dashboard **`multi-company`** banner.
- Mobile: `POST /api/v1/auth/login` + `rotateMobileRefreshToken` + `requireMobileBearer` align JWT `tid` with canonical company for **`SUPER_ADMIN`** / missing `tenantId`.
- UI: sidebar **Company settings**, dashboard **Company: B Visible**, admin copy updates; `/admin/tenants` route unchanged (labels only).
- Tests: `pnpm --filter @bvisible/web run verify:single-company` (Vitest). Ops script: `server-scripts/db/.verify-single-company-mode.sh` (Postgres via docker compose).

**Docs**

- `docs/ai-context/{CURSOR_START_HERE,ARCHITECTURE,DATA_MODEL,AUTH_AND_PERMISSIONS,KNOWN_RULES,UI_SYSTEM,MOBILE_APP,EMAIL_INGESTION,SECURITY_RULES}.md`

**Risks**

- Hosts with **multiple** `tenants` rows and **no** `bvisible` slug will hit **`/dashboard?error=multi-company`** until data is fixed.
- Creating extra company rows via **Company settings** re-introduces ambiguity — verification script fails when `COUNT(tenants) > 1`.

**Verification**

- `pnpm --filter @bvisible/web exec tsc --noEmit`
- `pnpm --filter @bvisible/web run verify:single-company`
- Production DB check (on server): `bash server-scripts/db/.verify-single-company-mode.sh` from `/opt/bvisible/app`

**Production deploy — single-company mode (2026-05-14)**

- **Deploy job ID:** `20260514T204117-2df17d`
- **Deployed SHA:** `0ce4ca6add674ee1eada0a8074872590bbd46e3a`
- **Prisma migrate deploy:** no pending migrations (`db-verify` OK).
- **PM2:** `bvisible-web` **online** (fork, cwd standalone `server.js`).
- **Healthcheck:** OK — `{"status":"ok","service":"bvisible-web"}` on localhost after deploy; public `https://vmi3270817.contaboserver.net/api/health` OK.
- **`server-scripts/db/.verify-single-company-mode.sh`:** first run failed (`slug=bvisible` missing — sole tenant was `qa-est-12344`). Ops ran **`ensureDefaultCompanyUncached()`** once via `pnpm exec tsx` from `apps/web` (idempotent normalize). Re-run: **`[verify-single-company] OK tenants_total=1 slug_bvisible_rows=1 name='B Visible'`**.
- **Prod data snapshot (post-bootstrap):** one tenant row **`B Visible` / `bvisible`**; **`admin@bvisible.local`** is **`SUPER_ADMIN`** with **`tenantId` NULL** in DB (expected — effective company resolved at runtime/mobile JWT).
- **Browser verification (logged-in UX):** **not run** in this session — no credential available here to exercise `/login` and admin surfaces end-to-end.
- **Mobile/API smoke (`SUPER_ADMIN` JWT):** **not run** here (requires password + `MOBILE_JWT_SECRET` configuration exercise).
- **Caveat:** production had a **single non-canonical tenant slug** before deploy; bootstrap **renamed slug/name in place** (same primary key). If multiple tenants had existed without `bvisible`, manual resolution would have been required.

---

## 2026-05-19 — Estimate editor vendor catalog intelligence rail

**Scope**

- Deterministic `lookupVendorCatalogIntelligence` service (`apps/web/lib/vendor-pricing/catalog-lookup.ts`): normalized exact / alias / prefix catalog matching + capped `OCR_APPROVED` history reads per tenant.
- Trend helpers (`apps/web/lib/vendor-pricing/trends.ts`): spike vs 90d avg/prev + volatility via coefficient of variation (basis-point gates).
- Estimate UX: debounced read-only panel under the material grid; focuses tracked via optional cell hooks (`CellInput` / `NumericCell`) without changing spreadsheet navigation.
- Performance indexes: `(tenantId, nameNormalized)` on `vendor_catalog_items`, `(tenantId, aliasNormalized)` on `vendor_item_aliases`.

**Migration:** `packages/db/prisma/migrations/20260519103000_vendor_catalog_lookup_indexes/migration.sql`.

**Verification**

- `pnpm --filter @bvisible/web run verify:vendor-catalog`

**Production deploy — vendor catalog intelligence rail (2026-05-14)**

- **Deploy job ID:** `20260514T183407-f21f45`
- **Deployed SHA:** `4e0755a1680767a918d52438a141e0ca17e1a445`
- **Migration:** `20260519103000_vendor_catalog_lookup_indexes` applied successfully (`prisma migrate deploy`; `db-verify` reported latest migration name match).
- **PM2:** `bvisible-web` **reload OK** (process online immediately after deploy).
- **Healthcheck (deploy box):** `/opt/bvisible/deploy-queue/healthcheck.sh` passed — `{"status":"ok","service":"bvisible-web"}` after one attempt.
- **DB / indexes (production SQL):** confirmed via `pg_indexes` rows  
  `vendor_catalog_items_tenant_name_normalized_idx` and  
  `vendor_item_aliases_tenant_alias_normalized_idx`; existing uniqueness indexes  
  `vendor_catalog_items_tenantId_vendorId_nameNormalized_key` and  
  `vendor_item_aliases_tenantId_vendorId_aliasNormalized_key` still present (**no uniqueness regression** observed).
- **Keyboard / estimate UX:** **not browser-verified in this session** — deploy automation does not exercise the spreadsheet; keyboard semantics were unchanged in `grid-nav.ts` / `makeGridKeyHandler` for this feature (rail uses passive `onCellFocus` callbacks only). Operators should confirm Enter ↓, Shift+Enter ↑, and Tab on a real estimate after deploy.
- **Performance:** **not measured under real typing load in this session**; implementation uses **320ms debounce** and **capped Prisma reads** per `catalog-lookup.ts`. Recommend a quick Network-tab spot check (one request burst after pause, not per keystroke).
- **Tenant isolation:** enforced in code via `requireTenantId()` + `tenantId` on every lookup query — **not multi-tenant SQL-tested here**; optional spot-check with two tenant sessions.

**Files**

- `apps/web/lib/vendor-pricing/{catalog-lookup.ts,catalog-intel-types.ts,trends.ts}`
- `apps/web/lib/vendor-pricing/{catalog-lookup.test.ts,trends.test.ts}`
- `apps/web/lib/estimate/vendor-catalog-intel-action.ts`
- `apps/web/app/(app)/estimates/[id]/{vendor-catalog-intel-panel.tsx,line-grid.tsx,editor.tsx}`
- `apps/web/components/grid/cell-input.tsx`
- `apps/web/package.json`, `packages/db/prisma/schema.prisma`, migration `20260519103000_vendor_catalog_lookup_indexes`

**Docs**

- `ESTIMATE_ENGINE.md`, `VENDOR_PRICE_ENGINE.md`, `UI_SYSTEM.md`, `DATA_MODEL.md`, `DEBUGGING.md`

---

## 2026-05-18 — SpendAlert `SUPERSEDED` lifecycle + stale OPEN closure

**Migration:** `packages/db/prisma/migrations/20260518140000_spend_alert_superseded_lifecycle/migration.sql`.

**Behavior**

- `SpendAlertStatus`: `OPEN`, `DISMISSED`, `SUPERSEDED` (legacy `RESOLVED` migrated to `SUPERSEDED`).
- Columns: `identityKey`, `supersededAt`, `supersededByReconciliationId`. Operator dismiss remains `DISMISSED` + `dismissedAt` (never auto-reopened).
- On each new `POReconciliation` snapshot for a PO: supersede prior **`OPEN` alerts with `poReconciliationId` set**, then `createMany` current-condition alerts (replay-safe `dedupeKey`).

**Files**

- `packages/db/prisma/schema.prisma`, migration above
- `apps/web/lib/reconciliation/{alert-identity.ts,supersede-open-recon-alerts.ts,run.ts}`
- `apps/web/lib/reconciliation/{alert-identity.test.ts,supersede-open-recon-alerts.test.ts}`
- `apps/web/app/(app)/purchase-orders/[id]/reconciliation/page.tsx`
- `apps/web/package.json` (`verify:reconciliation-alerts`)
- Docs: `DATA_MODEL.md`, `VENDOR_PRICE_ENGINE.md`, `UI_SYSTEM.md`, `DEBUGGING.md`

**Verification**

- Local / CI: `pnpm --filter @bvisible/web run verify:reconciliation-alerts`
- Full deterministic reconciliation suite: `pnpm --filter @bvisible/web run verify:reconciliation`

**Production verification runbook (target commit `b9e6f0e888d8c5c0bf298d5b5a54a8b545c18680`)**

1. **Enqueue deploy** (SSH as `deploy` on `212.56.32.136`; see `DEPLOY_QUEUE.md`):

   - Job JSON requires `repoUrl`, `branch`, `commitHash` (full 40-char SHA above — no floating tip).
   - `bvisible-deploy /tmp/job.json` — **record `JOB_ID`** from the last line of stdout.
   - Either wait for `bvisible-deploy-worker.timer` (≤30s) or run  
     `sudo -u deploy /opt/bvisible/deploy-queue/deploy-worker.sh` once.
   - Follow `/opt/bvisible/deploy-queue/logs/${JOB_ID}.log` until  
     `==== deploy-once SUCCESS ====`.

2. **Migration / PM2 / healthcheck** (same log + shell):

   - Expect: `prisma migrate deploy` success (migration  
     `20260518140000_spend_alert_superseded_lifecycle` applied once),  
     `PM2 reload OK`, then healthcheck exit 0.
   - `bash -lc 'pm2 list'` → `bvisible-web` **online**.
   - Loopback gate: `/opt/bvisible/deploy-queue/healthcheck.sh` or  
     `curl -fsS http://127.0.0.1:3000/api/health` →  
     `{"status":"ok","service":"bvisible-web"}`.

3. **Schema — enum + columns** (from `/opt/bvisible/app`, after  
   `set -a; . /opt/bvisible/shared/env/.env; set +a`):

   ```bash
   docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
   SELECT e.enumlabel
   FROM pg_enum e
   JOIN pg_type t ON e.enumtypid = t.oid
   WHERE t.typname = 'SpendAlertStatus'
   ORDER BY e.enumsortorder;
   "
   docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
   SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'spend_alerts'
     AND column_name IN ('identityKey','supersededAt','supersededByReconciliationId')
   ORDER BY column_name;
   "
   ```

   Expect enum labels: `OPEN`, `DISMISSED`, `SUPERSEDED`. Expect three rows for  
   the new columns (`identityKey` not null after migration).

4. **Reconciliation supersede** (replace `<tenant_id>` / `<po_id>`; use a PO with  
   at least one existing reconciliation snapshot and OPEN alerts):

   ```sql
   SELECT id, status, kind, "poReconciliationId", "supersededByReconciliationId",
          "supersededAt", "dismissedAt", "identityKey"
   FROM spend_alerts
   WHERE "tenantId" = '<tenant_id>' AND "purchaseOrderId" = '<po_id>'
   ORDER BY "createdAt" DESC;
   ```

   Trigger **Recompute snapshot** on `/purchase-orders/<po_id>/reconciliation`.  
   Re-run the query: prior OPEN rows with non-null `"poReconciliationId"` should  
   become `SUPERSEDED` with `"supersededAt"` and `"supersededByReconciliationId"`  
   set to the **new** reconciliation id; current problems appear as **new** OPEN  
   rows (new `"dedupeKey"`).

5. **Dismiss + rerun**: dismiss one alert in the UI; rerun reconciliation; same  
   SQL — row stays `DISMISSED`; automation must not flip it to OPEN or insert a  
   duplicate OPEN row for the same condition (`dedupeKey` uniqueness still applies  
   per snapshot).

6. **Replay safety**: repeat an action that uses the **same**  
   `triggerDedupeKey` as an existing `POReconciliation` (e.g. same OCR approve  
   batch). Runner should skip creating a second snapshot; no extra OPEN alerts  
   from that skipped run.

7. **UI**: dashboard + vendor surfaces — OPEN only; PO reconciliation detail —  
   chips for OPEN / SUPERSEDED / DISMISSED on the spend alerts table.

**Agent-run checks (deployment prep session)**

- `pnpm --filter @bvisible/web run verify:reconciliation-alerts`: **passed** (8 tests).
- Public HTTPS health (nginx hostname):  
  `curl -fsSL -k https://vmi3270817.contaboserver.net/api/health` →  
  `{"status":"ok","service":"bvisible-web"}` (**runtime healthy**; does **not**  
  prove deployed Git SHA without `git rev-parse HEAD` on the server).

**Gap / caveat**

- **Deploy job ID, migrate output, PM2 status, and schema SQL results** must be  
  captured by an operator with SSH to `212.56.32.136`. Automated enqueue from this  
  Cursor environment was **not** completed (SSH connect timed out).

---

## 2026-05-14 — Phase 14: PO reconciliation + spend intelligence foundation

**Migration:** `packages/db/prisma/migrations/20260517143000_po_reconciliation_foundation/migration.sql`.

**Production deploy:** not run from this chat session.

**Scope**

- Append-only `POReconciliation` snapshots with replay-safe `@@unique([tenantId, triggerDedupeKey])`.
- `POReconciliationLine` rows pair `POLineItem` expectations vs `VendorPriceHistory` observations where `extractionMethod = OCR_APPROVED` and `sourcePoAttachment` belongs to the PO.
- Deterministic normalized-label bucketing; uneven counts ⇒ ambiguous lines + `SpendAlert` (`RECONCILIATION_AMBIGUOUS`).
- `SpendAlert` kinds for price/qty drift, missing receipt coverage, unmatched receipt SKUs, PO total guardrail — copy uses **normalized labels + ids**, never raw OCR blobs.
- Operator workflows (server actions in `apps/web/lib/reconciliation/actions.ts`): dismiss alerts, confirm pairs, accept variance, reject mapping, manual merge PO/receipt rows, recompute snapshot, stamp PO reconciled.
- Env thresholds: `RECON_PRICE_TOLERANCE_BPS`, `RECON_ABSOLUTE_PRICE_TOLERANCE_CENTS`, `RECON_QTY_TOLERANCE_BPS`.

**Files created**

- `packages/db/prisma/migrations/20260517143000_po_reconciliation_foundation/migration.sql`
- `apps/web/lib/reconciliation/{dedupe.ts,dedupe.test.ts,match.ts,match.test.ts,thresholds.ts,run.ts,aggregate.ts,actions.ts}`
- `apps/web/app/(app)/admin/reconciliation/page.tsx`
- `apps/web/app/(app)/purchase-orders/[id]/reconciliation/page.tsx`
- `apps/web/app/(app)/dashboard/reconciliation-widgets.tsx`

**Files modified**

- `packages/db/prisma/schema.prisma`, `packages/db/src/index.ts`
- `apps/web/lib/vendor-pricing/persist.ts`, `apps/web/app/(app)/admin/ocr-review/actions.ts`
- `apps/web/lib/auth/audit.ts`
- `apps/web/app/(app)/dashboard/page.tsx`, `apps/web/app/(app)/purchase-orders/[id]/page.tsx`, `apps/web/app/(app)/vendors/[id]/page.tsx`
- `apps/web/components/app-shell.tsx`, `apps/web/package.json`
- Docs: `CHANGELOG_AI.md`, `DATA_MODEL.md`, `PO_SYSTEM.md`, `VENDOR_PRICE_ENGINE.md`, `EMAIL_INGESTION.md`, `API_STRUCTURE.md`, `UI_SYSTEM.md`, `SECURITY_RULES.md`, `DEBUGGING.md`, `KNOWN_RULES.md`

**Verification**

- `pnpm --filter @bvisible/web run verify:reconciliation` (15 tests in this session).

**Risks**

- Spend alerts from older snapshots may linger until dismissed manually after merges.
- SUPER_ADMIN users still need a tenant assignment to load tenant-scoped reconciliation queries (same constraint as other tenant pages).

---

## 2026-05-14 — Phase 13: local OCR + receipt understanding foundation

**Migration:** `packages/db/prisma/migrations/20260516120000_ocr_receipt_foundation/migration.sql`.
**Deploy:** not run from this session.

**Scope**

- Tenant-scoped `OcrDocument` / `OcrLineItem` queue with bounded retries (`FAILED` after cap).
- Local extraction: `pdf-parse`, **`tesseract` CLI** + `sharp`, optional `pdftoppm` for scanned PDFs.
- Deterministic header guesses + `OCR_TEXT_REGEX` line candidates (`normalizeVendorItemName` reused).
- ADMIN review UI `/admin/ocr-review/*`; **`VendorPriceHistory` only after approve** (`OCR_APPROVED`).
- Nullable email FK on pricing rows + optional OCR provenance columns.
- Internal tick `POST /api/internal/ocr/tick` (`OCR_TICK_SECRET` or `INGEST_TICK_SECRET` fallback).

**Files created**

- `packages/db/prisma/migrations/20260516120000_ocr_receipt_foundation/migration.sql`
- `apps/web/lib/ocr/{enqueue.ts,extract-plain-text.ts,parse-receipt.ts,parse-receipt.test.ts,enqueue.test.ts,worker.ts}`
- `apps/web/app/api/internal/ocr/tick/route.ts`
- `apps/web/app/(app)/admin/ocr-review/{page.tsx,[id]/page.tsx,actions.ts,ocr-approval-form.tsx}`
- `apps/web/lib/vendor-pricing/dedupe-key.test.ts`
- `server-scripts/db/.verify-ocr-receipt-parse.sh`

**Files modified**

- `packages/db/prisma/schema.prisma`, `packages/db/src/index.ts`
- `apps/web/lib/vendor-pricing/{extract.ts,persist.ts}`
- `apps/web/lib/email-ingest/run.ts`, `apps/web/lib/mobile/finalize-mobile-upload.ts`
- `apps/web/app/(app)/purchase-orders/[id]/actions.ts`
- `apps/web/app/(app)/dashboard/vendor-price-alerts.tsx`, `apps/web/app/(app)/vendors/[id]/page.tsx`
- `apps/web/components/app-shell.tsx`, `apps/web/next.config.mjs`, `apps/web/package.json`
- `package.json` (`pnpm.onlyBuiltDependencies` for `sharp`)
- Docs: `DATA_MODEL.md`, `API_STRUCTURE.md`, `SECURITY_RULES.md`, `DEBUGGING.md`, `KNOWN_RULES.md`, `EMAIL_INGESTION.md`, `VENDOR_PRICE_ENGINE.md`, `MOBILE_APP.md`, `PO_SYSTEM.md`, `UI_SYSTEM.md`, `pnpm-lock.yaml`

**Verification**

- `pnpm --filter @bvisible/web exec vitest run`
- `pnpm --filter @bvisible/web run build` (with `MOBILE_JWT_SECRET`)
- `bash server-scripts/db/.verify-ocr-receipt-parse.sh`

**Risks**

- **`tesseract` + Poppler** must exist on the production host for image / scanned-PDF OCR.
- OCR CPU spikes under heavy queues — keep tick concurrency low (default **3** jobs) and schedule like ingest timer.

---

## 2026-05-14 — Mobile upload reliability + offline hardening

**Migration:** none (extends mobile `/api/v1` foundation).
**Deploy:** not run from this session.

**Scope**

- Idempotent `/api/v1/uploads/complete` (`finalize-mobile-upload.ts`, `data.idempotentReplay`).
- Expo persisted upload queue + NetInfo + AppState resume + backoff + XMLHttpRequest PUT progress.
- Refresh token prefers Expo SecureStore; parallel `/auth/refresh` single-flight mutex.
- Auto logout callback when refresh cannot recover after HTTP 401.
- Raster image resize/JPEG pipeline before upload (`expo-image-manipulator`); PDFs unchanged.

**Files created**

- `apps/web/lib/mobile/finalize-mobile-upload.ts`, `finalize-mobile-upload.test.ts`
- `apps/mobile/lib/auth-events.ts`, `refresh-lock.ts`
- `apps/mobile/lib/upload-queue/types.ts`, `backoff.ts`, `backoff.test.ts`, `storage.ts`, `prepare-file.ts`, `xhr-upload.ts`, `processor.ts`, `context.tsx`
- `apps/mobile/components/UploadQueuePanel.tsx`
- `apps/mobile/vitest.config.ts`

**Files modified**

- `apps/web/app/api/v1/uploads/complete/route.ts`
- `apps/web/lib/mobile/jwt.ts`, `jwt.test.ts` — `Role` from `@prisma/client` (avoids loading Prisma in JWT unit tests); `apps/web/package.json` adds explicit `@prisma/client`; `vitest.config.ts` `testTimeout` for CI stability
- `apps/mobile/package.json`, `apps/mobile/app/_layout.tsx`, `apps/mobile/app/purchase-order/[id].tsx`, `apps/mobile/lib/api.ts`, `apps/mobile/lib/session.ts`
- `server-scripts/db/.verify-mobile-api.sh`
- `docs/ai-context/{MOBILE_APP,API_STRUCTURE,SECURITY_RULES,DEBUGGING,KNOWN_RULES,CHANGELOG_AI}.md`
- `pnpm-lock.yaml`

**Verification**

- `pnpm --filter @bvisible/web exec vitest run` (full suite)
- `pnpm --filter @bvisible/mobile run test`
- `pnpm --filter @bvisible/web run build` with `MOBILE_JWT_SECRET` set

**Risks**

- Expired pending-upload rows should be pruned — see `DEBUGGING.md` §11e example SQL.
- Image manipulate dependency major line must stay aligned with Expo SDK over time.

---

## 2026-05-14 — Mobile `/api/v1` foundation (Bearer JWT + PO uploads)

**Migration:** `packages/db/prisma/migrations/20260515083000_mobile_upload_foundation/migration.sql` (`POAttachmentKind` values + `mobile_sessions`, `mobile_pending_uploads`).
**Deploy:** not run from this session (commit below must be pushed before deploy per workspace rule).

**Scope**

Production-safe mobile REST: login / refresh / logout, tenant-scoped PO read APIs,
two-phase uploads reusing `apps/web/lib/po/uploads.ts` + shared
`insertPoAttachmentAndTimelineEvent`. Expo app scaffold with login, PO list/detail,
and attachment picker. Vitest + `server-scripts/db/.verify-mobile-api.sh`.

**Files created**

- `apps/web/lib/api/v1/envelope.ts`, `parse-json-body.ts`
- `apps/web/lib/mobile/constants.ts`, `jwt.ts`, `mobile-session.ts`, `require-mobile-bearer.ts`, `request-meta.ts`, `upload-kind.ts`
- `apps/web/lib/mobile/*.test.ts`
- `apps/web/app/api/v1/auth/login/route.ts`, `refresh/route.ts`, `logout/route.ts`
- `apps/web/app/api/v1/purchase-orders/route.ts`, `[id]/route.ts`
- `apps/web/app/api/v1/uploads/presign/route.ts`, `[id]/bytes/route.ts`, `complete/route.ts`
- `apps/mobile/*` (Expo Router app + `lib/api.ts`, `lib/session.ts`)
- `server-scripts/db/.verify-mobile-api.sh`

- `.gitignore` — `/uploads/` root-only so `apps/web/app/api/v1/uploads/` routes are tracked
- `apps/web/lib/validators.ts`, `apps/web/lib/auth/audit.ts`
- `apps/web/app/(app)/purchase-orders/[id]/attachments-panel.tsx`
- `packages/db/src/index.ts` — export `MobileSession`, `MobilePendingUpload` types
- `docs/ai-context/{MOBILE_APP,API_STRUCTURE,SECURITY_RULES,PO_SYSTEM,DATA_MODEL,DEBUGGING,KNOWN_RULES,ENVIRONMENT_VARIABLES}.md`

**Risks**

- Postgres migration uses multiple `ALTER TYPE ... ADD VALUE` in one transaction — OK on PG16; if a host pinned older PG, split per Postgres rules.
- Mobile client `fetch(uri)→blob→PUT` varies by platform — verify on device.

**Verification**

- `pnpm prisma:generate` (with `DATABASE_URL` set)
- `pnpm --filter @bvisible/web run build` (with `MOBILE_JWT_SECRET` set)
- `pnpm --filter @bvisible/web run test` (25 tests)

---

## 2026-05-14 — Vendor pricing tests + verification script (stabilization)

**Commit message:** `test: stabilize vendor pricing intelligence` (hash: see `git rev-parse HEAD` at deploy time).
**Migration:** none.
**Deploy:** TBD.

**Scope**

Vitest coverage for `normalizeVendorItemName`, regex extraction (`extract.ts`),
and `runVendorPriceExtractionAfterMaterialize` with a mocked Prisma client
(notification + `VENDOR_LOWER_PRICE` + dedupe paths). Added deterministic DB
script `server-scripts/db/.verify-vendor-pricing.sh` + `apps/web/scripts/verify-vendor-pricing.ts`
(no IMAP). Rewrote `VENDOR_PRICE_ENGINE.md` to match shipped behavior. Deleted
accidental `server-scripts/.enqueue-phase9.sh` and gitignored `server-scripts/.enqueue-*.sh`
for future local helpers.

**What changed (repo)**

Added:

- `apps/web/vitest.config.ts`
- `apps/web/lib/vendor-pricing/normalize.test.ts`
- `apps/web/lib/vendor-pricing/extract.test.ts`
- `apps/web/lib/vendor-pricing/persist.test.ts`
- `apps/web/scripts/verify-vendor-pricing.ts`
- `server-scripts/db/.verify-vendor-pricing.sh`

Modified:

- `apps/web/package.json`, root `package.json`, `pnpm-lock.yaml` — Vitest + `pnpm run test`.
- `.gitignore` — ignore local enqueue helpers.
- `apps/web/lib/sequence/lock.ts` — explicit integer casts for `pg_advisory_xact_lock` (needed after verification script exercised `nextPoNumber` against Postgres 16).
- `docs/ai-context/{VENDOR_PRICE_ENGINE,DEBUGGING,API_STRUCTURE,UI_SYSTEM,EMAIL_INGESTION,CHANGELOG_AI}.md`

Removed:

- `server-scripts/.enqueue-phase9.sh` (duplicate/untracked helper; pattern now gitignored).

**Risks**

- Mocked persist tests can drift from real Prisma behavior — mitigated by the DB verification script on staging/prod-like databases.
- Verify script briefly creates/deletes tenant `vendor-pricing-verify`; do not run concurrent copies against the same DB.

**Verification**

- Local: `pnpm install --frozen-lockfile`, `pnpm run test`, `pnpm run build`.
- Server: run `.verify-vendor-pricing.sh` after deploy with PM2 healthy (script calls `nextPoNumber`; ensure advisory-lock SQL uses `$n::integer` casts — see `apps/web/lib/sequence/lock.ts`).

---

## 2026-05-14 — Vendor pricing intelligence foundation (Phase 10)

**Commit message:** `feat: add vendor pricing intelligence foundation` (hash: see `git rev-parse HEAD` at deploy time).
**Migration:** `20260514190000_vendor_pricing_intelligence`.
**Deploy:** TBD.

**Scope**

Deterministic vendor pricing pipeline: after a matched vendor email
materializes onto a PO (`materializeOnPo` transaction succeeds), the ingest
runner invokes `runVendorPriceExtractionAfterMaterialize` inside an isolated
try/catch. Regex extraction runs over email subject, sanitized plain-text
snippet, and sanitized attachment filenames only — no PDF parsers, OCR,
LLM, or embedding matching. Observations append to `VendorPriceHistory`
(integer cents, confidence + extraction method enums, `dedupeKey` UNIQUE per
tenant for replay safety). Catalog rows (`VendorCatalogItem` /
`VendorItemAlias`) resolve via normalized names only. Strictly lower prices
vs the prior history row create `VendorPriceNotification`, `POEventKind.
VENDOR_LOWER_PRICE`, and audit metadata — operators dismiss alerts manually;
nothing auto-reprices.

Did NOT add: OCR, invoice PDF parsing, fuzzy SKU AI, auto vendor switching,
auto PO line updates, or changes to the estimate engine.

**What changed (repo)**

Added:

- `packages/db/prisma/migrations/20260514190000_vendor_pricing_intelligence/migration.sql` — enums/tables + `VENDOR_LOWER_PRICE` PO event kind.
- `apps/web/lib/vendor-pricing/normalize.ts` — `normalizeVendorItemName`.
- `apps/web/lib/vendor-pricing/extract.ts` — line/subject/filename regex extraction + money parsing.
- `apps/web/lib/vendor-pricing/persist.ts` — catalog resolution, dedupe insert, lower-price side effects, structured log `vendor_price_extraction`.
- `apps/web/lib/vendor-pricing/actions.ts` — `dismissVendorPriceNotificationAction`.
- `apps/web/app/(app)/dashboard/vendor-price-alerts.tsx` — dashboard banner.

Modified:

- `packages/db/prisma/schema.prisma` — vendor pricing models + enums + relations.
- `packages/db/src/index.ts` — export `VendorPriceConfidence`, `VendorPriceExtractionMethod`, related model types.
- `apps/web/lib/email-ingest/run.ts` — post-materialize extraction hook.
- `apps/web/lib/validators.ts`, `apps/web/lib/auth/audit.ts` — dismiss schema + audit strings.
- `apps/web/app/(app)/dashboard/page.tsx`, `apps/web/app/(app)/vendors/page.tsx`, `apps/web/app/(app)/vendors/[id]/page.tsx`, `apps/web/app/(app)/purchase-orders/[id]/timeline-panel.tsx`.
- `docs/ai-context/{EMAIL_INGESTION,PO_SYSTEM,DATA_MODEL,KNOWN_RULES,SECURITY_RULES,UI_SYSTEM,DEBUGGING}.md` — Phase 10 behavior.

**Risks**

- Regex false positives (random numbers interpreted as prices); mitigated by
  letter-heavy item heuristic + phone-line skip + narrow patterns.
- Comparable-price logic is "latest prior row for same catalog item" — no
  unit/qty tier normalization yet.
- `VendorPriceNotification` is tenant-visible on the dashboard, not per-user.

**Verification**

- Local: `pnpm install --frozen-lockfile`, `pnpm --filter @bvisible/db exec prisma generate`, `pnpm --filter @bvisible/web build` (green).
- Deploy: run after push per `DEPLOY_QUEUE.md` — confirm migration apply, PM2 healthy, `/api/health`.

---

## 2026-05-13 — Tenant inbox configuration UI (Phase 9)

**Commit:** TBD (`feat: add tenant inbox configuration UI`).
**Migration:** none — UI + API only against the existing
`TenantEmailInbox` schema.
**Deploy:** TBD.

**Scope**

Operational layer over the Phase 8 IMAP ingestion engine. SUPER_ADMIN
can now configure per-tenant inboxes, rotate IMAP credentials, and
verify connectivity entirely through the web UI without touching SQL,
env vars, or PM2. The plaintext password lives only in process memory
for the lifetime of one server-action invocation; it is sealed via
AES-256-GCM (key derived from `INGEST_SECRET`) before it lands in the
database, and the UI never echoes it back. A new internal route
`/api/internal/email-ingest/test` mirrors the `/tick` auth posture
(constant-time compare against `INGEST_TICK_SECRET`) for service-to-
service callers.

Did NOT add: OCR, invoice parsing, AI extraction, vendor intelligence,
Gmail OAuth, queue infrastructure, mailbox sync UI, or changes to the
deterministic matching ladder.

**What changed (repo)**

Added:

- `apps/web/lib/email-ingest/test.ts` — pure `testImapConnection`
  library: opens IMAP with `imapflow` (logger off, 8 s greeting / 15 s
  socket bounds), lists folders, checks the configured mailbox
  exists, returns one of `{ ok: true, mailboxCount, mailboxExists,
  mailbox, durationMs }` or `{ ok: false, kind, message, durationMs }`
  with `kind ∈ { auth_failed | mailbox_not_found | connect_failed |
  tls_error | unknown }`. Never logs the password, never re-throws
  raw connection errors.
- `apps/web/app/api/internal/email-ingest/test/route.ts` — internal
  POST endpoint guarded by the same `INGEST_TICK_SECRET` constant-
  time compare as `/tick`. JSON body: `{ tenantId?, host, port,
  secure, mailbox, username, password? }`. If `password` is omitted
  and `tenantId` is supplied, decrypts the stored sealed cipher and
  uses it. Returns the sanitized `TestImapResult`. Never writes to
  the DB, never marks `\Seen`, never returns the password.
- `apps/web/app/(app)/admin/tenants/[id]/email-inbox/page.tsx` —
  SUPER_ADMIN per-tenant inbox config page. Two-column layout: form
  on the left, diagnostics + recent ticks + recent ingested emails
  on the right.
- `apps/web/app/(app)/admin/tenants/[id]/email-inbox/inbox-form.tsx`
  — client component with the form, **Test connection** button,
  inline result panel (sanitized friendly messages), and a
  destructive **Delete inbox** button (with confirm). Password input
  is **always blank on render**; an empty submit keeps the existing
  sealed cipher.
- `apps/web/app/(app)/admin/tenants/[id]/email-inbox/actions.ts` —
  three server actions: `saveTenantInboxAction` (upsert),
  `deleteTenantInboxAction` (delete), `testInboxConnectionAction`
  (calls `testImapConnection` directly — does NOT round-trip through
  the internal HTTP route). All SUPER_ADMIN-only, all zod-validated,
  all audit-logged.
- `apps/web/app/(app)/admin/email-ingestion/inboxes/page.tsx` —
  SUPER_ADMIN system-wide list of every tenant + inbox status with a
  per-row link into that tenant's inbox config page. Stat strip:
  configured / healthy / errored / disabled counts.

Modified:

- `apps/web/lib/validators.ts` — added `saveTenantInboxSchema`,
  `deleteTenantInboxSchema`, `testInboxConnectionSchema`,
  `internalTestInboxSchema`, plus the underlying field-level zod
  helpers (`imapHostnameSchema`, `imapPortSchema`,
  `pollIntervalSchema`, `imapMailboxSchema`, `imapUsernameSchema`,
  `imapPasswordSchema`).
- `apps/web/lib/auth/audit.ts` — appended `tenant_inbox_saved`,
  `tenant_inbox_deleted`, `tenant_inbox_test_run` to the
  `AuditAction` union.
- `apps/web/middleware.ts` — whitelisted
  `/api/internal/email-ingest/test` so the loopback POST is not
  redirected to `/login`.
- `apps/web/components/app-shell.tsx` — added an **Inboxes** entry
  to the SUPER_ADMIN nav pointing at `/admin/email-ingestion/inboxes`.
- `apps/web/app/(app)/admin/tenants/page.tsx` — added an "Inbox"
  status column with the same chip palette and a per-row "Email
  inbox" link.
- `apps/web/app/(app)/admin/email-ingestion/page.tsx` — added a
  "Configure inbox" CTA in the page header for SUPER_ADMIN viewers.

Docs:

- `docs/ai-context/EMAIL_INGESTION.md` — rewrote the mailbox-setup
  section to lead with the in-app form, added rotation + disable
  flows, replaced the connectivity-test section with the dual
  in-app / curl approach, added a "SUPER_ADMIN inbox surfaces"
  table, removed "no in-app form" from the deferred list.
- `docs/ai-context/SECURITY_RULES.md` — added rules for the
  internal `/test` endpoint and the SUPER_ADMIN-only
  save/delete/test server actions, including the empty-password-
  preserves-cipher contract.
- `docs/ai-context/ENVIRONMENT_VARIABLES.md` — clarified that the
  env-var fallback is now strictly bootstrap-only once a
  `TenantEmailInbox` row exists for the first tenant.
- `docs/ai-context/API_STRUCTURE.md` — added the new internal
  route, the three new server actions, and the two new admin
  pages.
- `docs/ai-context/UI_SYSTEM.md` — added the per-tenant inbox
  config page, the all-inboxes overview, the email-ingestion
  review surface description (now that it has a SUPER_ADMIN CTA),
  and the new SUPER_ADMIN nav entry.
- `docs/ai-context/DEBUGGING.md` — added a "Test connection"
  section with the friendly-message → fix table and the
  service-to-service curl recipe for `/api/internal/email-
  ingest/test`.
- `docs/ai-context/AUTH_AND_PERMISSIONS.md` — added the new pages,
  the new server actions, the internal `/test` endpoint, and the
  three new audit actions to the audit list.

**Risks**

- Test connection takes a real IMAP round-trip and can take 1–8 s
  depending on the provider. Bounded with `greetingTimeout: 8_000`
  and `socketTimeout: 15_000` in `imapflow` so the form never hangs
  beyond the action's natural Next.js 30 s `maxDuration`. A misbehav-
  ing provider can still slow the page; SUPER_ADMIN-only access
  caps blast radius.
- The internal `/test` route accepts an arbitrary host/port/user/
  password from the body. Misuse would let a holder of
  `INGEST_TICK_SECRET` use the deploy box as an IMAP-test gateway.
  This is the same trust posture as the existing `/tick` route and
  is still gated by 127.0.0.1 binding + UFW + the secret.
- The form's password value is held in client-side React state for
  the lifetime of the page. We never persist it to localStorage and
  the autocomplete is `new-password` so the browser doesn't fill
  saved values. After a successful save the value is wiped from the
  React state.
- Plaintext IMAP passwords briefly traverse the wire to the server
  via Next.js server-action POST. The transport is HTTPS at the
  Nginx ingress (no plain port is exposed). Within the deploy box
  PM2 sees the body as a normal action argument; it is not logged.

**Verification performed**

- Local: `pnpm install --frozen-lockfile`, `prisma generate`,
  `pnpm --filter @bvisible/web build` — all clean. New routes
  appear in the build report:
  `/admin/email-ingestion/inboxes`,
  `/admin/tenants/[id]/email-inbox`,
  `/api/internal/email-ingest/test`.
- Lints clean across all touched files.

**Recommended next step**

Wire vendor catalog + price intelligence (Phase 10) so matched
vendor email can power "lower price detected" notifications using
attachment data instead of just timeline noise.

---

## 2026-05-13 — Vendor email ingestion foundation (Phase 8)

**Commit:** TBD (`feat: add vendor email ingestion foundation`).
**Migration:** `20260514005509_email_ingestion_foundation`.
**Deploy:** TBD.

**Scope**

Inbound vendor email is now pulled by an IMAP poller, parsed,
matched to a Purchase Order via a strict deterministic ladder (QBO PO
number → internal PO number → vendor + recent PO heuristic →
otherwise unmatched), and surfaced on the PO timeline as
`VENDOR_REPLY` events with allowlisted attachments promoted into the
PO's attachment store. Idempotency is the unique
`(tenantId, messageId)` constraint on `IngestedEmail`; an IMAP message
is only marked `\Seen` after the row commits, so PM2 restarts mid-tick
replay safely. Operators triage matched / unmatched / failed /
dismissed buckets at `/admin/email-ingestion`. The poller runs in the
existing `bvisible-web` PM2 process — a systemd timer hits an
internal-only `/api/internal/email-ingest/tick` route every 60 s
authenticated by a constant-time compare against `INGEST_TICK_SECRET`.
Per-tenant IMAP passwords are encrypted at rest via AES-256-GCM keyed
on `INGEST_SECRET`. The single-tenant fallback path reads
`IMAP_HOST` / `IMAP_PORT` / `IMAP_USER` / `IMAP_PASSWORD` /
`IMAP_TLS` / `IMAP_MAILBOX` / `IMAP_POLL_INTERVAL_SECONDS`.

Did NOT add: OCR, invoice parsing, AI matching, fuzzy embeddings,
auto-marking invoices received/paid, vendor pricing intelligence,
background queue infrastructure beyond the 60 s timer + soft lease,
IMAP push / IDLE / webhooks.

**What changed (repo)**

Schema (`packages/db`):

- `prisma/schema.prisma` — adds enums `EmailIngestStatus`
  (`PENDING/UNMATCHED/MATCHED/FAILED/DISMISSED`) and `EmailMatchReason`
  (`NONE/QBO_NUMBER/PO_NUMBER/VENDOR_AND_RECENT/MANUAL`); adds
  `EMAIL_ATTACHMENT` to `POAttachmentKind` and `VENDOR_REPLY` to
  `POEventKind`; adds models `TenantEmailInbox` (1:1 per tenant —
  encrypted IMAP creds + poll bookkeeping), `IngestedEmail` (UNIQUE
  `(tenantId, messageId)` per R-MAIL-01), `IngestedEmailAttachment`
  (per-attachment metadata + SHA-256 + skip-reason), `EmailIngestRun`
  (per-tick stats); adds nullable `sourceEmailId` (FK SET NULL) to
  `POAttachment` and `POEvent`; back-relations on `Tenant`, `Vendor`,
  `PurchaseOrder`.
- `prisma/migrations/20260514005509_email_ingestion_foundation/` —
  generated via the shadow-Postgres script on the deploy box.
- `src/index.ts` — re-exports `EmailIngestStatus`, `EmailMatchReason`,
  `TenantEmailInbox`, `IngestedEmail`, `IngestedEmailAttachment`,
  `EmailIngestRun` types.

Web app (`apps/web`):

- `package.json` — adds `imapflow`, `mailparser`, `@types/mailparser`.
- `lib/email-ingest/crypto.ts` — AES-256-GCM seal/open + constant-time
  secret compare. Key is SHA-256(`INGEST_SECRET`).
- `lib/email-ingest/storage.ts` — persists email attachments under
  `/opt/bvisible/shared/uploads/<tenantId>/email/<emailId>/<storageKey>`
  using the same magic-byte allowlist + path-traversal guard as PO
  uploads; `promoteEmailAttachmentToPo()` copies bytes into the per-PO
  directory when the email is matched.
- `lib/email-ingest/config.ts` — `loadResolvedInbox(tenantId)` and
  `loadInboxDiag(tenantId)`. DB row first, env-var fallback second.
- `lib/email-ingest/client.ts` — thin `imapflow` wrapper. Disables the
  library's internal logger to prevent credential leakage; bounded
  connect/socket timeouts.
- `lib/email-ingest/parse.ts` — `mailparser` wrapper that returns a
  message with sanitized header strings, a body text snippet (first
  ~2 KB of plain text), and per-attachment buffers + filenames.
- `lib/email-ingest/match.ts` — deterministic four-rule matcher.
- `lib/email-ingest/run.ts` — `runIngestForTenant(tenantId)`:
  claims a soft lease via conditional `lastPolledAt` UPDATE, opens
  IMAP, fetches `UNSEEN`, parses + persists each, runs the matcher,
  and (on match) materializes onto the PO. `materializeIngestedEmailOnPo`
  is also called from the manual-link action.
- `app/api/internal/email-ingest/tick/route.ts` — internal POST
  endpoint with `INGEST_TICK_SECRET` constant-time compare. Iterates
  enabled `TenantEmailInbox` rows.
- `app/api/email-ingest/[id]/attachments/[attachmentId]/route.ts` —
  ADMIN+ tenant-gated download with magic-byte re-detection.
- `app/(app)/admin/email-ingestion/{page,actions,review-table,inbox-config-card}.tsx`
  — operator review UI. Filterable buckets (unmatched / matched /
  failed / dismissed / all), expand-row body snippet + attachment
  download links, manual link / retry / dismiss.
- `lib/auth/audit.ts` — adds `email_ingest_tick`,
  `email_ingest_message_ingested`, `email_ingest_message_matched`,
  `email_ingest_message_failed`, `email_ingest_manual_link`,
  `email_ingest_dismissed`, `email_ingest_retried`,
  `tenant_inbox_configured`.
- `lib/validators.ts` — adds `manualLinkEmailSchema`,
  `retryEmailSchema`, `dismissEmailSchema` + types.
- `components/app-shell.tsx` — adds **Email ingestion** to the admin
  nav for ADMIN+.
- `app/(app)/purchase-orders/[id]/timeline-panel.tsx` — adds icon for
  `VENDOR_REPLY`.
- `app/(app)/purchase-orders/[id]/attachments-panel.tsx` +
  `page.tsx` — surfaces an "✉" badge for attachments with
  `sourceEmailId`.

Server scripts:

- `cron/bvisible-ingest-tick.timer` (`OnUnitActiveSec=60s`),
  `bvisible-ingest-tick.service` (`oneshot`, runs as `deploy`),
  `bvisible-ingest-tick.sh` (curl with `x-bvisible-ingest-secret`).
- `deploy-queue/deploy-once.sh` — installs the unit files + script
  on every deploy, daemon-reloads, enables the timer.

Docs:

- `docs/ai-context/EMAIL_INGESTION.md` — rewritten to match the
  shipped pipeline (see below).
- `PO_SYSTEM.md`, `DATA_MODEL.md`, `API_STRUCTURE.md`,
  `SECURITY_RULES.md`, `ENVIRONMENT_VARIABLES.md`, `DEBUGGING.md`,
  `DEPLOYMENT.md`, `AUTH_AND_PERMISSIONS.md`, `KNOWN_RULES.md`
  (R-MAIL-01) — updated.

**Risks**

- **First production IMAP credentials.** Until the operator pastes
  per-tenant IMAP creds (or sets the `IMAP_*` env-var fallback) the
  poller is a no-op every 60 s. There is no Slack-style alarm yet —
  the operator is expected to check `/admin/email-ingestion` after a
  deploy that touches the inbox config.
- **Lease is per-tenant only.** Two ticks for the same tenant
  serialize via `lastPolledAt`; two tenants do not contend. If a single
  tenant has thousands of unread messages, a long tick can run beyond
  the 60 s window — the next tick will short-circuit harmlessly.
- **Disk quota.** Email attachments live under
  `/opt/bvisible/shared/uploads/<tenantId>/email/`. The 25 MB per-file
  cap from the PO foundation applies, but there is no per-tenant
  quota. A spam wave with large attachments could fill `/`.
- **MIME allowlist intentionally narrow.** `.docx`, `.xlsx`, `.zip`
  are NOT accepted today — they land as `IngestedEmailAttachment`
  rows with `skipped = true` + `skipReason = 'mime_not_allowed'`. The
  body of the email is still captured and matchable.
- **Sender spoofing.** We do not check SPF/DKIM/DMARC alignment yet.
  Match by `From:` is heuristic only (rule 3). A spoofed sender
  matched to the wrong PO must be reverted by the operator using the
  retry / dismiss flow + manual link.

**Verification**

- `pnpm install --frozen-lockfile` clean. `pnpm prisma generate` clean.
  `pnpm run build` produces standalone bundle, no warnings beyond the
  pre-existing pricing engine warnings.
- Linter: clean across all new and edited files.
- Migration generated against shadow Postgres on the deploy box and
  copied back; no schema drift.
- Functional verification done locally with a test mailbox: end-to-end
  poll → parse → match → materialize → PO timeline → operator review
  with manual link, retry, and dismiss. Idempotency verified by
  re-running the same UID twice (no duplicate row, no duplicate
  attachment, no duplicate POEvent).
- Production deploy + ingestion verification: TBD.

**Recommended next step**

Build the per-tenant inbox configuration form (super-admin scoped)
that writes to `TenantEmailInbox` with the password sealed via
`INGEST_SECRET`. Today the only paths to a working inbox are (a) the
env-var fallback or (b) a hand-crafted SQL insert via psql. The form
is small and removes the only operational sharp edge in the Phase 8
foundation.

---

## 2026-05-13 — Purchase order foundation (Phase 7)

**Commit:** `51c5369eaf9c2f0dae6548faa7c1f88410e113ab` (`feat: add purchase order foundation`).
**Migration:** `20260513234614_purchase_orders_and_finalize`.
**Deploy:** `20260514T000821-9643c4` → `done`. Migration applied,
`db-verify.sh` OK (4 migrations, latest = the new one), PM2 reload OK,
healthcheck OK on first attempt. Verified from the workstation:
`/api/health` returns the expected payload over HTTPS, and every new
gated route (`/purchase-orders`, `/purchase-orders/new`, `/vendors`,
`/vendors/new`, `/api/po/<id>/attachments/<id>`) 307s to
`/login?next=...`. Production schema verified: 5 new tables
(`vendors`, `purchase_orders`, `po_line_items`, `po_attachments`,
`po_events`), `EstimateStatus` enum now ends in `FINALIZED`, all four
new PO enums are present, `purchase_orders` carries the expected
`(tenantId, number)` UNIQUE + the four `(tenantId, ...)` btree
indexes, and the FKs on `estimateId` / `vendorId` correctly use
`ON DELETE SET NULL` while the line / attachment / event children use
`ON DELETE CASCADE`. The `/opt/bvisible/shared/uploads` shared dir is
present and owned by `deploy:deploy` as expected.

**Scope**

The operational handoff layer between Estimate → Purchase Order →
Vendor execution. Adds vendors (minimal), purchase orders (full editor
+ status/timeline/attachments/QBO number), the "Create PO from estimate"
flow that copies estimate lines into PO lines without mutating the
source estimate, and the R-EST-04 Finalize gate (an estimate cannot
move to `FINALIZED` unless at least one linked, non-deleted PO carries
a `qboPoNumber`). All money + quantities follow the Phase 6 integer-cent
/ milli-quantity convention; per-tenant `PO-NNNNNN` numbers are issued
under a Postgres advisory lock that's been refactored into the shared
`acquireTenantSequenceLock(tx, tenantId, kind)` helper (estimate
numbering reuses it). Attachments are stored under
`/opt/bvisible/shared/uploads/<tenantId>/po/<poId>/<storageKey>` with
server-side magic-byte MIME validation on both upload AND download,
randomised filenames, path-traversal protection, a 25 MB cap, and a
tenant-gated route handler that re-detects the MIME from disk before
streaming.

Did NOT add: vendor email ingestion, OCR / invoice parsing, vendor AI /
recommendations, accounting sync, mobile receipt uploads, approval
workflow complexity, or any background queues / workers.

**What changed (repo)**

Schema (`packages/db`):

- `prisma/schema.prisma` — adds enums `POStatus`
  (`DRAFT/SENT/ORDERED/PARTIALLY_RECEIVED/RECEIVED/CANCELED`),
  `POLineKind` (mirror of `EstimateLineKind`), `POAttachmentKind`
  (`RECEIPT/INVOICE/VENDOR_DOC/DRAWING/OTHER`), and `POEventKind` (10
  values: `CREATED`, `CREATED_FROM_ESTIMATE`, `LINES_SAVED`,
  `STATUS_CHANGED`, `QBO_NUMBER_ASSIGNED`, `VENDOR_ASSIGNED`,
  `ATTACHMENT_ADDED`, `ATTACHMENT_DELETED`, `NOTE_ADDED`, `CANCELED`).
  Adds `EstimateStatus.FINALIZED`. Adds models `Vendor`,
  `PurchaseOrder`, `POLineItem`, `POAttachment`, `POEvent` — all
  tenant-scoped with composite `(tenantId, …)` indexes; money in `Int`
  cents; quantities in `qtyMilli`; soft delete via `deletedAt` on
  `Vendor` and `PurchaseOrder`; unique on `(tenantId, name)` for
  vendors and `(tenantId, number)` for POs.
- `src/index.ts` — re-exports the new enums and model types.
- `prisma/migrations/20260513234614_purchase_orders_and_finalize/migration.sql`
  generated against a shadow Postgres on the server (Prisma's
  transactional `ALTER TYPE ADD VALUE` works on Postgres 16, so the
  `FINALIZED` value lands cleanly in the same migration).

Web app (`apps/web`):

- `lib/sequence/lock.ts` (new) — generic
  `acquireTenantSequenceLock(tx, tenantId, kind)` advisory-lock helper.
  Estimate numbering refactored to use it.
- `lib/po/number.ts` (new) — `nextPoNumber(tx, tenantId)`; allocates
  `PO-NNNNNN` per tenant, concurrency-safe via the lock helper.
- `lib/po/uploads.ts` (new) — storage path resolution, randomised
  `storageKey` generation, magic-byte MIME detection (PDF / JPEG / PNG
  / WEBP), path-traversal-safe `resolveAttachmentPath`, and a 25 MB
  upper bound.
- `lib/auth/audit.ts` — extends `AuditAction` with `vendor_created`,
  `po_created`, `po_created_from_estimate`, `po_saved`,
  `po_status_changed`, `po_qbo_number_set`, `po_vendor_set`,
  `po_attachment_added`, `po_attachment_deleted`, `po_note_added`,
  `po_deleted`, `estimate_finalized`, `estimate_unfinalized`.
- `lib/validators.ts` — adds `createVendorSchema`,
  `createPurchaseOrderSchema`, `createPoFromEstimateSchema`,
  `poLineSchema`, `savePurchaseOrderSchema`, `updatePoStatusSchema`,
  `setPoQboNumberSchema` (regex-validated), `setPoVendorSchema`,
  `addPoNoteSchema`, `uploadAttachmentMetaSchema`,
  `deleteAttachmentSchema`, `finalizeEstimateSchema`. Replaces
  `optional()` with `nullish()` on shared helpers (`longText`,
  `optionalEmail`, `optionalShort`, `nullableIdRef`) so empty form
  values consistently transform to `null`. Removes the `.refine()`
  from `updateEstimateStatusSchema` so the action body owns the
  FINALIZED-rejection rule (keeps the inferred type wide enough for
  the editor to call it with any `EstimateStatus`).
- `next.config.mjs` — `experimental.serverActions.bodySizeLimit:
  '25mb'` to match the attachment cap.
- `components/app-shell.tsx` — adds `Purchase orders` and `Vendors`
  to `BASE_NAV`.
- `app/(app)/vendors/page.tsx`, `vendors/actions.ts`,
  `vendors/new/page.tsx`, `vendors/new/vendor-form.tsx` — vendor
  list + create.
- `app/(app)/purchase-orders/page.tsx`,
  `purchase-orders/actions.ts`, `purchase-orders/new/page.tsx`,
  `purchase-orders/new/new-po-form.tsx` — PO list + new-PO + the two
  creation actions (`createBlankPoAction`,
  `createPoFromEstimateAction`).
- `app/(app)/purchase-orders/[id]/page.tsx`, `editor.tsx`,
  `line-grid.tsx`, `meta-panel.tsx`, `timeline-panel.tsx`,
  `attachments-panel.tsx`, `actions.ts` — full PO detail editor.
  Reuses the shared `<CellInput>` / `<NumericCell>` cell primitives
  and the `makeGridKeyHandler` keyboard helper from the estimate
  editor (no new keyboard logic). Server actions:
  `savePurchaseOrderAction`, `updatePoStatusAction`,
  `setPoQboNumberAction`, `setPoVendorAction`, `addPoNoteAction`,
  `uploadPoAttachmentAction`, `deletePoAttachmentAction`,
  `deletePurchaseOrderAction`.
- `app/api/po/[id]/attachments/[attachmentId]/route.ts` (new) —
  tenant-gated download; re-detects MIME from disk before streaming;
  emits `Content-Disposition: attachment` with RFC 5987 encoding +
  `X-Content-Type-Options: nosniff`.
- `app/(app)/estimates/[id]/actions.ts` — adds `finalizeEstimateAction`
  (R-EST-04 gate, returns typed errors `not_found`,
  `already_finalized`, `no_linked_po`, `no_qbo_number`, `invalid`)
  and `unfinalizeEstimateAction` (ADMIN+ only).
  `updateEstimateStatusAction` now refuses `FINALIZED` directly and
  refuses any change while the estimate is already FINALIZED.
- `app/(app)/estimates/[id]/page.tsx` — bootstraps `linkedPos` +
  `vendors` for the editor.
- `app/(app)/estimates/[id]/editor.tsx` and `totals-panel.tsx` —
  surface "Linked POs", "Create PO from estimate" (with optional
  vendor pick), and Finalize / Unfinalize controls. Finalize button
  is disabled with a sanitized reason hint when R-EST-04 isn't yet
  satisfied. The status-change buttons are disabled while the
  estimate is FINALIZED.

Documentation:

- `docs/ai-context/PO_SYSTEM.md` — rewritten to reflect the shipped
  foundation vs the still-deferred items.
- `docs/ai-context/DATA_MODEL.md` — adds the Phase 7 enums + models +
  migration row.
- `docs/ai-context/API_STRUCTURE.md` — adds the new actions, the
  attachment download REST route, and the PO/vendor pages.
- `docs/ai-context/UI_SYSTEM.md` — adds the PO editor / vendor list
  UX notes.
- `docs/ai-context/AUTH_AND_PERMISSIONS.md` — adds the per-action
  role table for Phase 7 and the new page entries.
- `docs/ai-context/KNOWN_RULES.md` — re-anchors R-EST-04, adds
  R-PO-01 / R-PO-04 / R-PO-05.
- `docs/ai-context/SECURITY_RULES.md` — adds the "Attachment posture"
  section as the canonical pattern for every future upload.
- `docs/ai-context/DEBUGGING.md` — adds § 11d "Purchase orders /
  vendors / attachments" runbook.
- `docs/ai-context/ENVIRONMENT_VARIABLES.md` — clarifies `UPLOAD_ROOT`
  layout for PO attachments (no new keys).
- `docs/ai-context/DEPLOYMENT.md` — notes the 25 MB nginx /
  serverActions alignment and confirms the existing
  `/opt/bvisible/shared/uploads` symlink covers PO attachments
  unchanged.

**Risks**

- **Soft-delete semantics are unilateral**. `deletePurchaseOrderAction`
  sets `deletedAt`. There is no UI to undelete; recovery requires a
  manual `UPDATE` against the DB. ADMIN+ only — USER cannot trigger
  this.
- **Attachments are not garbage-collected** on PO soft delete. The
  on-disk files remain under `/opt/bvisible/shared/uploads/...`. This
  is intentional for now (recoverability) but adds disk-pressure risk
  if many POs are created and deleted at scale. Pruning is a future
  maintenance script.
- **MIME allowlist is small** (PDF / JPEG / PNG / WEBP). Receipts that
  arrive as HEIC, TIFF, or DOCX will be rejected. Adding more types
  means extending the magic-byte table in `apps/web/lib/po/uploads.ts`
  AND adjusting the `accept` filter on the upload input AND
  documenting it here.
- **`createPoFromEstimateAction` snapshots line costs at the time of
  conversion**. Subsequent edits to the source estimate do NOT
  propagate to already-converted POs. This is the spec'd behaviour
  ("don't mutate the original estimate" + "operational PO is the
  source of truth for purchasing") but it can confuse users who edit
  an estimate after creating a PO.
- **R-EST-04 is one-way at the UI level**. Finalize unlocks once any
  linked PO has a QBO number, but if the user later clears the QBO
  number on that PO the estimate remains FINALIZED (unfinalize is an
  explicit ADMIN+ action). This is intentional — finalize is a
  business commitment, not a live derived state — but worth knowing
  for support questions.
- **Per-tenant PO numbering depends on the advisory lock + unique
  index**. Both must remain in place. Dropping
  `purchase_orders_tenantId_number_key` would silently allow
  collisions even though the lock is held during allocation
  (concurrent transactions in DIFFERENT tenants don't contend).

**Verification performed**

Local:

- `pnpm install --frozen-lockfile` — clean.
- `pnpm --filter @bvisible/db generate` — Prisma client regenerated
  with the new models / enums.
- `pnpm run build` — full monorepo build passes (Next standalone
  build included). No new TypeScript errors after the validator
  refactor.
- Shadow-Postgres migration generation on the server produces a
  single `20260513234614_purchase_orders_and_finalize` migration that
  includes `ALTER TYPE "EstimateStatus" ADD VALUE 'FINALIZED'` plus
  the five new tables. Copied back into the repo.

Functional (planned for the deploy / verify step):

- Create vendor → list / detail.
- Create blank PO → editor renders → save → reload preserves lines +
  notes + cached subtotal.
- Create PO from estimate → estimate is unchanged, PO carries the
  copied lines, PO timeline shows `CREATED_FROM_ESTIMATE`.
- Set QBO number on the PO → audit + timeline events appear; the
  source estimate's Finalize button unlocks.
- Finalize the estimate → status flips to FINALIZED; further status
  changes are refused by `updateEstimateStatusAction` until ADMIN+
  unfinalizes.
- Upload PDF / PNG / JPEG / WEBP attachments — each appears in the
  attachments list with the correct re-detected MIME on download.
- Upload a `.txt` renamed to `.pdf` → rejected at upload time
  (magic-byte sniff).
- Cross-tenant access: estimate / PO / attachment ids from another
  tenant return 404 from every action and from the download route.
- Auth, mailer, and `/api/health` continue to behave (no changes to
  those code paths).

---

## 2026-05-13 — Estimate foundation (Phase 6)

**Commit:** `de568ed` (`feat: add estimate foundation`).
**Migration:** `20260513221527_estimates_clients_machines`.
**Deploy:** `20260513T223220-996cb1` → `done`. Migration applied,
`db-verify.sh` OK, PM2 reload OK, healthcheck OK.

**Scope**

The first product surface for the platform: clients, estimates, line
items, a centralized pricing engine, a spreadsheet-style editor with
keyboard navigation, and an admin-style estimate list. All formulas
from `ESTIMATE_ENGINE.md` are implemented in a new pure-TypeScript
package `@bvisible/pricing` and called from both the editor (every
keystroke) and the save action (server-side, inside the same Prisma
transaction that writes line items). Tenant isolation is enforced on
every query. Money is integer cents end-to-end; quantities are
integer milli-units (`qtyMilli = qty × 1000`); the multiplier is an
integer milli-multiplier (`multiplierMilli`). The editor never floats.

Did NOT add: purchase orders, vendor email ingestion, channel-letter
calculator, banner-calculator UI, drag-and-drop reorder, snapshot /
revision model, accounting exports, approvals/workflows, AI quoting,
or notifications.

**What changed (repo)**

Schema (`packages/db`):

- `prisma/schema.prisma` — adds enums `EstimateStatus`
  (`DRAFT/SENT/APPROVED/REJECTED`) and `EstimateLineKind`
  (`MATERIAL/MACHINE/LABOR/DESIGN/INSTALL/MISC`); adds models
  `Client`, `Machine`, `Estimate`, `EstimateLineItem`; adds reverse
  relations on `Tenant` and `User`. Per the Phase 6 spec, every
  product table carries a non-nullable `tenantId` and a composite
  index `(tenantId, …)` on every commonly queried column. Money is
  `Int` cents; quantity is `qtyMilli` `Int`. `Estimate` has a unique
  `(tenantId, number)` and cached `subtotalCostCents` /
  `finalPriceCents` columns.
- `src/index.ts` — re-export the new enums and types
  (`Client`, `Machine`, `Estimate`, `EstimateLineItem`,
  `EstimateStatus`, `EstimateLineKind`).
- `prisma/migrations/20260513221527_estimates_clients_machines/migration.sql`
  — generated against shadow Postgres on the server with
  `server-scripts/db/.shadow-migrate.sh`. Pure DDL: 2 enums, 4 tables,
  10 indexes, 7 foreign keys. No partial-index hand-edits required.

New workspace package (`@bvisible/pricing`):

- `packages/pricing/package.json`, `tsconfig.json`, `src/index.ts` —
  zero-runtime-deps TypeScript-only package, included via pnpm
  workspace.
- `src/types.ts` — `LineKind`, `LineInput`, `EstimateInput`,
  `EstimateOutput`, `BreakdownByKind`. Pure shapes, no Prisma imports.
- `src/money.ts` — `roundCents`, `formatMoney`, `parseMoney`. Money is
  integer cents; the parser accepts `12`, `12.50`, `$12.50`, `1,234.56`.
- `src/qty.ts` — `qtyToMilli`, `qtyFromMilli`, `formatQty`, `parseQty`.
- `src/sqft.ts` — R-EST-02 (`sqft = w_in × h_in / 144`).
- `src/banner.ts` — R-EST-03 (banner pricing with $4/sf base, $3/sf
  over 200, $0.50/grommet, $45 minimum) returning `{cents, baseCents,
  overCents, grommetCents, appliedMinimum}` so the calculator UI can
  show the breakdown.
- `src/line.ts` — `computeLineCostCents({qtyMilli, unitCostCents}) =
  round(qty × cost / 1000)`. One formula, used by every kind of line.
- `src/estimate.ts` — `computeEstimate({multiplierMilli,
  designFlatCents, lines})` runs once per render in the editor and
  once per save on the server. Returns `{lineCosts (by id), breakdown
  (by kind), subtotalCostCents, finalPriceCents}`. R-EST-01 lives
  here.

Validators + helpers (`apps/web`):

- `lib/validators.ts` — adds `createClientSchema`,
  `createEstimateSchema`, `estimateLineSchema`, `saveEstimateSchema`,
  `updateEstimateStatusSchema`. Numeric fields are bounded to keep a
  fat-fingered keystroke from 100×-multiplying a $50 k subtotal
  (`multiplierMilli ≤ 10000`, line cost `≤ 100,000,000_00`).
- `lib/auth/audit.ts` — extends `AuditAction` with
  `client_created`, `estimate_created`, `estimate_saved`,
  `estimate_status_changed`, `estimate_multiplier_overridden`,
  `estimate_deleted`.
- NEW `lib/estimate/number.ts` — `nextEstimateNumber(tx, tenantId)`
  allocates `EST-NNNNNN` per tenant under a Postgres advisory lock
  inside the create transaction so two concurrent creates can never
  collide on `unique(tenantId, number)`.
- NEW `lib/estimate/seed-machines.ts` — `ensureDefaultMachines(tenantId)`
  upserts the four default machine rows (`Colex SCC CNC`,
  `Laser cutter`, `Flatbed printer`, `Roll-to-roll printer`) at the
  rates from `ESTIMATE_ENGINE.md`. Idempotent via
  `createMany({skipDuplicates: true})` against `unique(tenantId, name)`.
  Called by `createTenantAction`.
- NEW `lib/estimate/defaults.ts` — `defaultUnitCostCents(kind)` and
  `defaultDescription(kind)` so newly added rows pre-fill with the
  shop's standard rates ($50/hr labor, $150/hr install, $150 design).
- NEW `lib/estimate/format.ts` — re-exports money/qty formatters from
  `@bvisible/pricing` plus `kindLabel(kind)` and `qtyHint(kind)`.
- NEW `lib/keyboard/grid-nav.ts` — `makeGridKeyHandler(opts)` returns
  one `onKeyDown` for an entire grid. Handles Enter (down + auto-append)
  and Shift+Enter (up); Tab is left to the browser; arrow keys are
  intentionally NOT hijacked (would break caret nav inside text inputs).
  Cells opt in by setting `data-cell-row`, `data-cell-col`,
  `data-cell-grid`. The handler is React-free for unit testing.

Reusable grid primitives:

- NEW `apps/web/components/grid/cell-input.tsx` — exports `<CellInput>`
  (text) and `<NumericCell>` (money/qty/multiplier). `<NumericCell>`
  keeps an internal "raw" string so the user can type intermediate
  invalid states (`1.`); on blur, parse → snap-back-on-garbage →
  reformat-on-success. `select()` on focus mirrors Excel.

Clients UI:

- NEW `app/(app)/clients/page.tsx`, `actions.ts` (`createClientAction`),
  `new/page.tsx`, `new/client-form.tsx`. Tenant-scoped via
  `requireTenantId()`.

Estimates UI:

- NEW `app/(app)/estimates/page.tsx` — list with cached cost + sell
  totals + status pills. Empty-state CTAs differ depending on whether
  the tenant has any clients yet.
- NEW `app/(app)/estimates/actions.ts` — `createEstimateAction`
  (allocates the per-tenant `EST-NNNNNN` number and verifies the
  picked client belongs to the caller's tenant).
- NEW `app/(app)/estimates/new/{page.tsx,new-estimate-form.tsx}`.
- NEW `app/(app)/estimates/[id]/page.tsx` — RSC bootstrap that loads
  the estimate, machines, and clients in parallel.
- NEW `app/(app)/estimates/[id]/editor.tsx` — top-level client
  component (useReducer over a small action set, dirty tracking via
  JSON snapshot, Cmd/Ctrl+S to save).
- NEW `app/(app)/estimates/[id]/line-grid.tsx` — the spreadsheet:
  one `<table>`, per-cell `data-cell-*` attrs, single `onKeyDown`
  on the grid root. Per-row × / ↑ / ↓ buttons.
- NEW `app/(app)/estimates/[id]/totals-panel.tsx` — sticky breakdown
  + design-flat-fee + multiplier (with override warning) + final
  sell price + Save / status / soft-delete.
- NEW `app/(app)/estimates/[id]/actions.ts` — `saveEstimateAction`
  (replaces all line items + meta in one transaction; reruns
  `@bvisible/pricing` server-side; cached `subtotalCostCents` /
  `finalPriceCents` are written in the same tx; logs `estimate_saved`
  and conditionally `estimate_multiplier_overridden`),
  `updateEstimateStatusAction`, `deleteEstimateAction` (ADMIN /
  SUPER_ADMIN only, soft delete).

Wiring:

- `apps/web/components/app-shell.tsx` — adds `Estimates` and `Clients`
  to `BASE_NAV`. SUPER_ADMIN-without-tenant clicks redirect via
  `requireTenantId()` to `/dashboard?error=no-tenant`.
- `apps/web/app/(app)/admin/tenants/actions.ts` — calls
  `ensureDefaultMachines(tenantId)` after `tenant.create(...)`. Errors
  during seeding are logged but do not block tenant creation; the
  admin can re-seed by adding machines manually.
- `apps/web/package.json` — adds `@bvisible/pricing` workspace dep.

Migration tooling:

- `server-scripts/db/.shadow-migrate.sh` — adds an
  `--append-superadmin-index` flag (default off). Previously the
  script unconditionally appended the SUPER_ADMIN partial unique
  index to every new migration's SQL, which meant any post-Phase-4
  migration would fail validation with `42P07` ("relation already
  exists"). The flag is now opt-in and is documented in-script.

Docs:

- `DATA_MODEL.md` — adds the Phase-6 model definitions and migration row.
- `ESTIMATE_ENGINE.md` — adds the implementation map and notes that
  multiplier overrides write to `audit_logs` automatically.
- `API_STRUCTURE.md` — documents the new pages and actions.
- `UI_SYSTEM.md` — documents the editor, the grid primitives, the
  keyboard helper, and the new sidebar nav items.
- `AUTH_AND_PERMISSIONS.md` — adds the new routes and actions to the
  permissions tables.
- `KNOWN_RULES.md` — links R-EST-01..03 to their concrete
  implementation files; clarifies that R-EST-04 finalize gating still
  ships with the PO module.
- `DEBUGGING.md` — new § 11c "Estimates / pricing" with `psql`
  queries to verify cached totals, audit lookups for multiplier
  overrides, and a one-shot for back-seeding machines on
  pre-existing tenants.

**Risks**

- **Pricing math drift**: solved by integer-only inputs, integer-only
  intermediate state, and a single rounding step at line-cost time.
  The same `computeEstimate(...)` runs in the browser and the server
  on every save so the cached totals can never diverge from what the
  editor showed.
- **Tenant isolation**: every product query passes `tenantId` from
  `requireTenantId()`. `saveEstimateAction` re-validates ownership of
  the estimate AND of every referenced `machineId` before writing.
- **Save-burst races**: a tenant-scoped Postgres advisory lock
  serializes per-tenant `EST-NNNNNN` allocation. The unique
  `(tenantId, number)` index is a belt-and-suspenders second line.
- **Editor scale**: `saveEstimateSchema` caps lines at 500 (the spec
  expects 10–30). At 500 the delete-all + create-all save strategy is
  still ~tens of ms; at 5 000 we'd need a diff-based save and probably
  drag-and-drop.
- **Machine catalog fragility**: tenants created BEFORE this phase
  have no machines. The DEBUGGING runbook documents the back-fill
  one-liner. Future tenants get the seed automatically.
- **No vitest harness yet**: the engine is small enough that the
  editor exercises every formula on every keystroke (visual smoke
  test). Adding `vitest` is a separate test-infrastructure task.

**Local verification**

- `pnpm install --frozen-lockfile` — clean.
- `pnpm --filter @bvisible/db exec prisma generate` — clean
  (Prisma 6.19.3, includes new models).
- `pnpm --filter @bvisible/web run build` — green;
  bundles `/estimates`, `/estimates/new`, `/estimates/[id]`,
  `/clients`, `/clients/new` alongside the existing routes; the
  editor weighs in at `~6.8 KB / 137 KB First Load JS`.
- Standalone build (`NEXT_BUILD_STANDALONE=1`) runs on the Linux
  deploy host; locally on Windows it always fails on `EPERM symlink`
  per the comment in `apps/web/next.config.mjs`.
- Shadow Postgres on the server validates the new migration cleanly
  (`--- shadow-migrate: SUCCESS`).

**Server verification (deploy)**

Run via `server-scripts/db/.reset-and-verify-estimates.sh` against
`https://vmi3270817.contaboserver.net`. Bash output (excerpt):

```
--- 1. Unauthenticated /clients and /estimates -> 307
  /clients -> 307                  middleware gate OK
  /estimates -> 307
  /clients/new -> 307
  /estimates/new -> 307
--- 2. Login as SUPER_ADMIN
  login OK
--- 3. Authenticated /estimates and /clients return 200
  /estimates -> 307 (location: /dashboard?error=no-tenant)
    expected for SUPER_ADMIN without tenant   (requireTenantId redirect)
  /clients -> 307 (location: /dashboard?error=no-tenant)
    expected for SUPER_ADMIN without tenant
--- 4. Database sanity — new tables exist with the right columns
  table clients exists
  table machines exists
  table estimates exists
  table estimate_line_items exists
  enums OK                                     (EstimateStatus + EstimateLineKind)
  unique(tenantId,number) present
--- 5. Tenant + machine catalog status                tenants=0 machines=0
--- 6. End-to-end: create a tenant via SUPER_ADMIN UI, verify machines seeded
  create-tenant -> /admin/tenants?created=qa-est-12344
  tenant created
  tenant row: cmp4nel450006kmulfmq2n5s7|qa-est-12344
  machines for qa-est-12344 (4 rows):
    Colex Sharp Cut Cutter — CNC @ 9078c
    Flatbed printer @ 3345c
    Laser cutter @ 6877c
    Roll-to-roll printer @ 4421c
  default machine catalog seeded with documented rates
--- 7. Sanity grep — no /estimates page leaks credentials in HTML
ALL ESTIMATE-FOUNDATION CHECKS PASSED
```

The pricing engine determinism check was also run locally via
`tsx -e "..."` against `@bvisible/pricing` and produced exact matches
for material / machine / labor / install / misc / design / subtotal /
final-at-3.000× for the canonical input — see commit message + the
test in `.verify-estimates.sh` § 6 algebra notes.

The remaining "create estimate + add lines + save + reload + see
matching cached totals" check requires a tenant USER session (not the
tenant-less SUPER_ADMIN) and is a real-shop UI smoke test rather
than an automated curl flow. Recommended manual smoke before turning
the platform on for a real estimator: invite a tenant ADMIN, accept
the invite, create a client, create an estimate, type a line, hit
Save, refresh, confirm `/estimates` shows the cached cost / sell.

---

## 2026-05-13 — SMTP mailer foundation (Phase 5)

**Commit:** `9e57aae` (`feat: add SMTP mailer foundation`) → followed
by `904e20d` (`fix(mailer): log when smtp_verify is skipped due to
missing config; save phase5 verify scripts`). The fix-up is
queued for the next deploy along with whenever SMTP credentials get
filled in. The deployed-and-verified code is at `9e57aae`.

**Scope**

Adds the outbound mailer surface so invite + password-reset flows
deliver real email instead of surfacing tokenized links inline. New
provider-agnostic SMTP wrapper around Nodemailer (no provider SDK
hard-wired), three branded email templates, a SUPER_ADMIN-only
diagnostic page (`/settings/email-test`) that runs `verify()` then
sends a test message, and audit-log enrichment that records the
delivery outcome on every invite/reset row. Did NOT add email
ingestion, vendor parsing, queues/workers, a notification center, or
provider SDK lock-in; SMTP send is inline in the server action with a
10 s socket-timeout cap so the worst case is bounded.

**What changed (repo)**

- NEW `apps/web/lib/mailer.ts` — provider-agnostic façade. Exports:
  `loadSmtpConfig()` (zod-validated, cached), `verifyTransport()`,
  `sendMail({to,subject,html,text})`, `diagnosticsFor()`, `maskUser()`,
  typed errors (`MailerConfigError`, `MailerSendError` with `kind ∈
  {connect,auth,timeout,recipient,sender,unknown}`). Honors legacy
  `SMTP_APP_PASSWORD` as a fallback for `SMTP_PASSWORD`. Cached pooled
  transport (max 2 connections, max 50 messages per process). All
  `connection`/`greeting`/`socket` timeouts pinned at 10 s. Error
  messages are run through a `sanitize()` that scrubs
  `pass(word)?[=:]\S+` and `\bauth\s+\S+`. Logging discipline: every
  line carries `{mailer:true, host, port, secure, maskedUser, ...}`,
  NEVER the password.
- NEW `apps/web/lib/emails/render.ts` — shared `wrapBranded()` returning
  `{html, text}`. Plain HTML, inline styles, no MJML. Brand mark + slate
  accent + plaintext fallback. ~3 KB per email.
- NEW `apps/web/lib/emails/invite.ts` — `renderInviteEmail({inviteLink,
  role, tenantName, invitedByEmail})`.
- NEW `apps/web/lib/emails/reset.ts` — `renderResetEmail({resetLink,
  expiresInMinutes})`.
- NEW `apps/web/lib/emails/test.ts` — `renderTestEmail({recipientEmail,
  sentByEmail})` for the diagnostic page.
- NEW `apps/web/app/(app)/settings/email-test/page.tsx` — SUPER_ADMIN
  only via `requireSuperAdmin()`. Renders host/port/secure/maskedUser/
  from/replyTo (passwords NEVER displayed) and a single-input form.
  Shows a clear amber panel when SMTP isn't configured.
- NEW `apps/web/app/(app)/settings/email-test/actions.ts` —
  `sendTestEmailAction`. Re-checks `requireSuperAdmin()` inside the
  action body, validates input with `testEmailSchema`, runs SMTP
  `verify()` first, then `sendMail()`. Returns sanitized
  `{ok, error, diagnostics, detail:{code,responseCode}, messageId}`.
- NEW `apps/web/app/(app)/settings/email-test/test-email-form.tsx` —
  client form with `useActionState`. Renders FormError/FormNotice and
  the SMTP error code/responseCode block on failure.
- `apps/web/app/(auth)/forgot/actions.ts` — drops the `devLink` from
  `RequestResetState`. After creating the `PasswordResetToken`, calls
  `sendMail` with `renderResetEmail`. Audit metadata gains
  `mailDelivery: 'sent' | 'failed_<kind>' | 'failed_no_config' |
  'skipped_no_user'`. The action ALWAYS returns the same generic OK
  regardless of email existence or mail success — public form must not
  enumerate accounts or leak SMTP misconfiguration.
- `apps/web/app/(auth)/forgot/forgot-form.tsx` — removes the
  copy-the-link block. Just renders the success notice.
- `apps/web/app/(app)/admin/users/actions.ts` — after `userInvite.create`,
  calls `sendMail` with `renderInviteEmail`. On success, redirects to
  `?sent=<email>` (green toast). On failure, redirects to
  `?invite=<token>&invitedEmail=<email>&mailErr=<kind>` so the admin
  can deliver the link manually (single-use token, same security
  envelope as pre-mailer state). Audit `invite_created` gains
  `mailDelivery`.
- `apps/web/app/(app)/admin/users/page.tsx` — replaces the pre-mailer
  green "copy this link manually" panel with: green "Invite email sent
  to X" toast on success; amber panel with sanitized error label +
  fallback link on `mailErr`. New `MAIL_ERR_LABELS` lookup maps
  `kind → user-readable string`.
- `apps/web/lib/validators.ts` — adds `testEmailSchema` + `TestEmailInput`.
- `apps/web/components/app-shell.tsx` — adds `{href:'/settings/email-test',
  label:'Email test', hint:'smtp'}` to `SUPER_ADMIN_NAV`.
- `apps/web/package.json` — adds `nodemailer ^8.0.7` (dep) and
  `@types/nodemailer ^8.0.0` (devDep). Nodemailer is plain JS — no
  `allowBuilds` entry needed, no native binaries to mirror into the
  standalone tree.

**Migration name**

None. The `mailDelivery` flag lives in `audit_logs.metadata` JSONB.

**Env vars added (in `/opt/bvisible/shared/env/.env`)**

| Var | Required |
|---|---|
| `SMTP_HOST` | yes |
| `SMTP_PORT` | yes |
| `SMTP_USER` | yes |
| `SMTP_PASSWORD` | yes (legacy `SMTP_APP_PASSWORD` honored as fallback) |
| `SMTP_FROM` | yes |
| `SMTP_SECURE` | no (auto-inferred from port: 465 → true) |
| `SMTP_REPLY_TO` | no |

**Risks**

- **Nodemailer not bundled into standalone.** Plain JS with no
  `dlopen`, so Next's tracer should pick it up automatically — but if a
  future Next minor regresses tracing, the symptom is `Cannot find
  module 'nodemailer'` in PM2 err log. Recovery is the same pattern as
  the Prisma engine mirror in `deploy-once.sh`. DEBUGGING § 11b
  documents the fix.
- **Inline SMTP send blocks the server-action handler.** Bounded by
  three 10 s timeouts in the transport, so worst case the user sees a
  ≤ 10 s "Sending..." button. If SMTP latency becomes a problem we
  move sends to a background queue — out of scope here.
- **Failure surface for invites is amber, not red.** The admin still
  gets a working invite link in the amber panel, so the action never
  hard-fails in a way that blocks team operations. Audit log captures
  the failure for ops correlation.
- **Public forgot form never reveals SMTP failures.** Deliberate (no
  account enumeration, no infra fingerprinting) but means a misconfigured
  SMTP for password reset is invisible from the public side. Detection
  paths: the diagnostic page, audit log, mailer log lines.
- **Gmail with 2FA needs an app password, not the account password.**
  `SMTP_PASSWORD` should be the 16-char app password. `SECURITY_RULES.md`
  lists this; ops doc covers it in DEBUGGING § 11b.
- **Brand templates are hand-written inline-style HTML.** No MJML
  toolchain; if templates need to evolve substantially we revisit. The
  three currently-shipped templates are short enough that a hand-edit
  is faster than any DSL.

**Local verification**

- `pnpm --filter @bvisible/web add nodemailer` + `add -D @types/nodemailer`
  — clean, no `allowBuilds` warnings.
- `pnpm --filter @bvisible/web run build` — green. Routes:
  `/settings/email-test 1.74 kB / 116 kB`. Middleware unchanged at
  34.3 kB. No new lints.

**Verification performed (server)**

- Deploy job ID: `20260513T205934-f21fde` at SHA `9e57aae`. Reached
  `done`. Deploy log shows: build OK (11 routes including new
  `/settings/email-test 1.74 kB / 116 kB`), `prisma migrate deploy`
  no-op (no schema change), `db-verify` OK, Prisma engine mirror
  succeeded (`libquery_engine-debian-openssl-3.0.x.so.node`,
  `libquery_engine-linux-musl-openssl-3.0.x.so.node`), PM2 reload OK,
  healthcheck OK.
- E2E auth regression run (`server-scripts/db/.verify-auth.sh`):
  all 10 checks PASS — login still sets `bv_session` (HttpOnly,
  Secure, SameSite=lax), `/dashboard` reachable with cookie, logout
  revokes session, audit log records `login_success` + `logout`,
  Postgres still 127.0.0.1-only.
- E2E mailer foundation run (`server-scripts/db/.verify-mailer.sh`):
  all 7 checks PASS:
  1. `/settings/email-test` without cookie → 307 (middleware-gated)
  2. SUPER_ADMIN login OK
  3. `/settings/email-test` with cookie → 200
  4. Page renders the "SMTP is not configured" amber panel (expected
     halfway state — env keys are placeholders pending credentials)
  5. No credential-shaped value in page body (no argon2 hashes, no
     leaked password values)
  6. POST the test-email form → 200 (no 500, no Set-Cookie, no
     redirect — action ran cleanly and returned the typed config
     error, page re-rendered with the error block)
  7. `/admin/users` still 200 with the SUPER_ADMIN cookie (no
     regression in the existing surface)
- `pm2 logs bvisible-web --err`: no Prisma errors, no mailer
  exceptions, no unhandled rejections. The mailer module imported
  cleanly at boot (no nodemailer bundling issue in the standalone
  tree).

**Deferred until SMTP credentials are filled in**

The user opted to populate `SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM`
themselves in `/opt/bvisible/shared/env/.env` (mode 640,
`deploy:deploy`). When that happens, redeploy (or `bash -lc 'pm2
reload bvisible-web --update-env'` to flush the cached transport)
and run the actual round-trip checks via the in-app diagnostic page
at **Settings → Email test**. The page runs SMTP `verify()` first,
then sends a branded test message; sanitized errors print without
leaking credentials. Once green, the invite + reset flows
automatically use SMTP — no further code change required.

The `SMTP_HOST=smtp.gmail.com` and `SMTP_PORT=465` defaults are
already in `.env`. For Gmail / Workspace, `SMTP_PASSWORD` MUST be a
16-character App Password
(<https://myaccount.google.com/apppasswords>) — the regular account
password will not work with SMTP if 2FA is on.

---

## 2026-05-13 — Auth + tenant foundation (Phase 4)

**Commit:** `56cdd14` (`feat: add auth and tenant foundation`) → followed
by `0c9ccfc` (`fix(auth): include prisma engine in standalone bundle and
fix middleware redirect host`). The fix commit is the SHA that actually
deployed green; see "Follow-up runtime fixes" below.

**Scope**

Adds the first real auth surface to B Visible: email/password login
with Argon2id, DB-backed sessions, role helpers (SUPER_ADMIN/ADMIN/
USER), Edge middleware + page-RSC `requireUser()`, a CLI bootstrap for
the first SUPER_ADMIN, an admin invite flow (link displayed inline
because SMTP is not yet wired), a password reset flow (same stub-link
display), a per-tenant audit log, and a SaaS-style logged-in shell
with sidebar nav, user menu, and sign-out. Did NOT add product
features (estimates, POs, vendors, email ingestion), mobile JWT, OAuth,
or change firewall / queue serialization / nginx / PM2 config.

**What changed (repo)**

- NEW migration
  `packages/db/prisma/migrations/20260513192157_auth_and_invites/`.
  Adds 4 columns on `users` (`lastLoginAt`, `disabledAt`, `invitedAt`,
  `inviteAcceptedAt`); adds 4 tables (`sessions`, `user_invites`,
  `password_reset_tokens`, `audit_logs`) with all indexes and FKs;
  appends a hand-written partial unique index `users_email_super_admin_key`
  on `users(email) WHERE "tenantId" IS NULL` to close the SUPER_ADMIN
  email-collision hole that the composite `@@unique([tenantId, email])`
  leaves open (Postgres treats NULLs as distinct). Generated against a
  shadow Postgres on the server so production was never touched until
  the deploy ran `migrate deploy` — see
  `server-scripts/db/.shadow-migrate.sh`.
- NEW `server-scripts/db/.shadow-migrate.sh` — bring up a temporary
  Postgres on `127.0.0.1:5433` (compose project `bvisible-shadow`),
  apply existing migrations, run `prisma migrate dev --create-only`
  with a supplied schema, append hand-written SQL, validate, tear
  down. Reusable for future migrations.
- `packages/db/prisma/schema.prisma` — extended with new fields and
  models. Schema-language partial-unique limitation noted in a
  comment on `User`.
- `packages/db/src/index.ts` — re-exports `Prisma` (value, for
  `Prisma.PrismaClientKnownRequestError`) and adds type re-exports
  for `Session`, `UserInvite`, `PasswordResetToken`, `AuditLog`.
- `pnpm-workspace.yaml` — added `esbuild: true` to `allowBuilds`
  because `tsx` (used by the bootstrap CLI) pulls it in and pnpm v11
  refuses to run install scripts without an entry. (`@node-rs/argon2`
  needs no entry — it ships prebuilt napi binaries with no postinstall
  script.)
- `apps/web/package.json` — added deps `@node-rs/argon2`, `zod`;
  devDep `tsx`; npm script `bootstrap:super-admin`.
- NEW `apps/web/middleware.ts` — Edge cookie-presence check;
  redirects to `/login?next=<safe-relative>` for protected routes.
  Public routes: `/`, `/login`, `/forgot`, `/reset/*`, `/invite/*`,
  `/api/health`. Static assets and Next internals skipped via the
  matcher regex.
- NEW `apps/web/lib/auth/password.ts` — Argon2id hash/verify
  (memoryCost 64 MiB, timeCost 3, parallelism 1). Hardcodes
  `algorithm: 2` because `Algorithm.Argon2id` is an ambient const enum
  and `isolatedModules` forbids referencing its members.
- NEW `apps/web/lib/auth/tokens.ts` — 256-bit base64url token
  generator + SHA-256 hasher.
- NEW `apps/web/lib/auth/session.ts` — cookie name `bv_session`;
  TTL 30 d; `HttpOnly; Secure (prod); SameSite=Lax; Path=/`. DB-backed
  via `Session` table. Logout sets `revokedAt` and clears the cookie.
- NEW `apps/web/lib/auth/current-user.ts` — `getCurrentUser`
  (React-`cache`d), `requireUser`, `requireRole`, `requireSuperAdmin`,
  `requireTenantId`. The ONLY sanctioned way to read the session
  inside RSC / server actions.
- NEW `apps/web/lib/auth/audit.ts` — `writeAuditLog()`. 12 allowed
  actions. Best-effort: a DB error logs to stderr but never breaks
  the underlying action.
- NEW `apps/web/lib/auth/rate-limit.ts` — per-email failed-login
  throttle (5 in 15 min) using `audit_logs` row count.
- NEW `apps/web/lib/validators.ts` — zod schemas for login, request-
  reset, complete-reset, accept-invite, change-password, invite-user,
  create-tenant. Email/password rules in one place.
- NEW `apps/web/lib/request-context.ts` — extracts
  `x-forwarded-for` + `user-agent` from `headers()` (truncated for
  audit safety).
- NEW `app/(auth)/{login,forgot,reset/[token],invite/[token]}/`
  pages + actions + client form components. Centered card layout via
  NEW `apps/web/components/auth/auth-card.tsx`; reusable
  `<FormError>` / `<FormNotice>` at
  `apps/web/components/auth/form-error.tsx`. Login form at
  `apps/web/components/auth/login-form.tsx`.
- NEW `app/(app)/layout.tsx` — `requireUser()` then renders the
  `AppShell`.
- NEW `app/(app)/{dashboard,settings,admin/users,admin/tenants}/`
  pages + actions + client form components.
- `apps/web/components/app-shell.tsx` — refactored to take a `user`
  prop, render role-aware nav via the NEW
  `apps/web/components/app/nav-links.tsx`, render the NEW
  `apps/web/components/app/user-menu.tsx` at sidebar bottom, and
  expose a reusable `<PageHeader>` for per-page titles.
- `apps/web/app/page.tsx` — root now redirects to `/dashboard` (signed
  in) or `/login` (anonymous). The previous static welcome page is
  gone — its content moved into `/dashboard`.
- NEW `apps/web/scripts/bootstrap-super-admin.ts` + `README.md`. Run
  via `pnpm --filter @bvisible/web run bootstrap:super-admin` with
  inline env vars. Refuses if any SUPER_ADMIN exists. Argon2id-hashes
  password. Writes `super_admin_bootstrapped` audit row.

**What changed (server)**

- New migration applied via the deploy's `prisma migrate deploy` step.
- First SUPER_ADMIN created via the CLI bootstrap script (post-deploy,
  one-shot).
- No nginx, PM2, firewall, certbot, compose, or deploy-queue script
  changes.

**Files touched**

- `packages/db/prisma/schema.prisma` (modified)
- `packages/db/prisma/migrations/20260513192157_auth_and_invites/migration.sql` (new)
- `packages/db/src/index.ts` (modified)
- `pnpm-workspace.yaml` (modified)
- `server-scripts/db/.shadow-migrate.sh` (new)
- `apps/web/package.json` (modified)
- `apps/web/middleware.ts` (new)
- `apps/web/lib/auth/password.ts` (new)
- `apps/web/lib/auth/tokens.ts` (new)
- `apps/web/lib/auth/session.ts` (new)
- `apps/web/lib/auth/current-user.ts` (new)
- `apps/web/lib/auth/audit.ts` (new)
- `apps/web/lib/auth/rate-limit.ts` (new)
- `apps/web/lib/validators.ts` (new)
- `apps/web/lib/request-context.ts` (new)
- `apps/web/app/page.tsx` (modified)
- `apps/web/app/(auth)/layout.tsx` (new)
- `apps/web/app/(auth)/login/{page,actions}.ts(x)` (new)
- `apps/web/app/(auth)/forgot/{page,actions,forgot-form}.ts(x)` (new)
- `apps/web/app/(auth)/reset/[token]/{page,actions,reset-form}.ts(x)` (new)
- `apps/web/app/(auth)/invite/[token]/{page,actions,invite-form}.ts(x)` (new)
- `apps/web/app/(app)/layout.tsx` (new)
- `apps/web/app/(app)/dashboard/page.tsx` (new)
- `apps/web/app/(app)/settings/{page,actions,change-password-form}.ts(x)` (new)
- `apps/web/app/(app)/admin/users/{page,actions,invite-user-form}.ts(x)` (new)
- `apps/web/app/(app)/admin/tenants/{page,actions,create-tenant-form}.ts(x)` (new)
- `apps/web/components/app-shell.tsx` (modified — refactor + PageHeader export)
- `apps/web/components/auth/auth-card.tsx` (new)
- `apps/web/components/auth/form-error.tsx` (new)
- `apps/web/components/auth/login-form.tsx` (new)
- `apps/web/components/app/nav-links.tsx` (new)
- `apps/web/components/app/user-menu.tsx` (new)
- `apps/web/scripts/bootstrap-super-admin.ts` (new)
- `apps/web/scripts/README.md` (new)
- `docs/ai-context/AUTH_AND_PERMISSIONS.md` (rewrite)
- `docs/ai-context/DATA_MODEL.md` (modified)
- `docs/ai-context/API_STRUCTURE.md` (modified)
- `docs/ai-context/UI_SYSTEM.md` (modified)
- `docs/ai-context/SECURITY_RULES.md` (modified)
- `docs/ai-context/ENVIRONMENT_VARIABLES.md` (modified)
- `docs/ai-context/DEBUGGING.md` (modified — § 11a auth runbook)
- `docs/ai-context/DEPLOYMENT.md` (modified — bootstrap step)
- `docs/ai-context/CHANGELOG_AI.md` (this entry)

**Risks**

- **Lock-out window.** Until the SUPER_ADMIN is bootstrapped, the auth
  wall has nobody who can sign in. `/login` accepts no creds, no UI
  path forwards. Mitigated by: (a) `/api/health` stays public so
  uptime stays green; (b) the bootstrap is a single CLI command
  documented in `apps/web/scripts/README.md` and `DEPLOYMENT.md`
  ("First-time SUPER_ADMIN bootstrap"); (c) public routes (`/login`,
  `/forgot`, `/reset/*`, `/invite/*`) still render so the path back in
  exists once the SUPER_ADMIN runs the bootstrap.
- **Migration ordering.** `prisma migrate deploy` runs BEFORE PM2
  reload. If the migration fails, the new app code never goes live —
  good. If the migration succeeds but the new app code crashes at
  boot, the healthcheck catches it and the deploy lands in `failed/`.
  Rollback: re-enqueue the previous good `commitHash`. The new auth
  tables remain (additive only — no data loss).
- **Email stub.** Invite + reset links are NOT emailed; they are
  displayed inline to the inviting/requesting user. SMTP wiring is a
  separate task. Documented in AUTH_AND_PERMISSIONS.md and
  apps/web/scripts/README.md.
- **Per-process rate limiting.** Failed-login throttle counts
  audit-log rows (5 in 15 min for an email). Single-process correct;
  not yet distributed (would need Redis).
- **Argon2 native binary.** `@node-rs/argon2` ships prebuilds for
  linux-x64-gnu (server) and win32-x64 (Windows dev). No prebuild for
  alpine-musl, but PM2 runs on Ubuntu host glibc — irrelevant.
- **Partial unique index in raw SQL.** Hand-edited migration SQL is a
  drift risk if a future `migrate diff` is run. The risk is bounded:
  the index is documented, comment-tagged in the SQL, and re-validated
  by re-applying to the shadow before commit.
- **Session cookie does not carry CSRF token.** Server actions use
  Next 15's same-origin POST check. When we add REST routes that
  accept cookie-auth (mobile uses Bearer instead, so this is mostly
  hypothetical), we'll add a CSRF column to `Session` and validate
  it.

**Verification performed (local)**

- `pnpm install --frozen-lockfile` — clean. New deps: `@node-rs/argon2`,
  `zod`, `tsx` (with esbuild prebuild downloaded via the new
  `allowBuilds` entry).
- `pnpm --filter @bvisible/db exec prisma generate` — Prisma Client
  v6.19.3 regenerated with the new types.
- `pnpm --filter @bvisible/web run build` — green. 11 routes
  including all new pages + middleware (34.3 kB). Static gen 4
  prerendered, 7 server-rendered on demand.
- Migration generated against shadow Postgres on the server, validated
  by re-application, scp'd back, committed alongside the schema
  change. Production DB never touched at this stage.

**Verification performed (server)**

- Deploy job IDs:
  - `20260513T193505-ac5b38` — first auth deploy at SHA `56cdd14`. Job
    reached `done`, migration applied, healthcheck OK, but the running
    process crashed at the FIRST Prisma call with
    `PrismaClientInitializationError: Prisma Client could not locate
    the Query Engine for runtime "debian-openssl-3.0.x"`. Login POST
    returned 500 (no `bv_session` cookie). Middleware was also
    constructing redirects against `req.nextUrl.host`, which behind
    nginx is `127.0.0.1:3000`, so /dashboard redirected to
    `https://localhost:3000/login?next=...` from the browser's
    perspective.
  - `20260513T195014-5bd3d9` — fix deploy at SHA `0c9ccfc`. Reached
    `done`. Standalone Prisma engine mirror succeeded
    (`libquery_engine-debian-openssl-3.0.x.so.node` +
    `libquery_engine-linux-musl-openssl-3.0.x.so.node` present in the
    bundle). Healthcheck OK.
- E2E auth verification (`server-scripts/db/.verify-auth.sh`, against
  `https://vmi3270817.contaboserver.net`):
  1. `/api/health` public both upstream + via nginx — `{"status":"ok"}`
  2. `/login` reachable as 200
  3. `/dashboard` without cookie → 307 to
     `https://vmi3270817.contaboserver.net/login?next=%2Fdashboard`
     (PUBLIC host, NOT localhost — confirms middleware fix)
  4. `/admin/users` without cookie → 307 (gated)
  5. Login via no-JS form POST (forwarding all 4 hidden inputs Next
     emits for `useActionState`: `$ACTION_REF_1`, `$ACTION_1:0`,
     `$ACTION_1:1`, `$ACTION_KEY`) → 303, `Set-Cookie: bv_session=…;
     Path=/; Expires=…; Secure; HttpOnly; SameSite=lax`,
     `Location: /dashboard`
  6. `/dashboard` with the cookie → 200, body mentions the admin email
  7. `/admin/tenants` with the SUPER_ADMIN cookie → 200
  8. Logout via the argument-less form on `/settings` → 303,
     `Set-Cookie: bv_session=; Max-Age=0; …`, `Location: /login`. The
     same cookie value sent to `/dashboard` afterwards → 307 (DB
     session row revoked).
  9. `audit_logs` shows ordered `login_success` (×2) and `logout` rows
     for the SUPER_ADMIN with `ipAddress=127.0.0.1` (loopback because
     the verify ran from the box itself; real external clients will
     log their forwarded IP via `request-context.ts`).
  10. Postgres still bound `127.0.0.1:5432` only.

**Follow-up runtime fixes (commit `0c9ccfc`)**

- `apps/web/middleware.ts` — redirect URL is now built from
  `x-forwarded-host` + `x-forwarded-proto` headers (with `host` and
  `req.nextUrl.host` as fallbacks), not from `req.nextUrl`. Behind
  nginx, `req.nextUrl.host` is `127.0.0.1:3000` (the value nginx
  forwards as `Host` by default), so absolute redirect Locations were
  pointing the browser at `localhost`. Trusting `x-forwarded-host` is
  safe here because port 3000 binds to 127.0.0.1 only — the only
  thing that can hit this Node process is nginx.
- `server-scripts/deploy-queue/deploy-once.sh` — after wiring the
  standalone runtime and copying `.next/static` + `public/`, the
  script now `find`s the live workspace's
  `node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client`
  directory (populated by `prisma generate` during the build) and
  copies it to the matching path under
  `apps/web/.next/standalone/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/`.
  Next's static tracer doesn't follow `dlopen()` calls, so the
  `libquery_engine-*.so.node` binaries are otherwise omitted from the
  standalone bundle and Prisma crashes the first time any handler
  runs `prisma.user.findUnique`. The deploy log line to look for is
  `Prisma client mirrored into standalone: …`. If this line is
  missing from a future deploy, every Prisma call will throw
  `PrismaClientInitializationError`. Both the in-repo copy
  (`server-scripts/deploy-queue/deploy-once.sh`) and the on-disk copy
  at `/opt/bvisible/deploy-queue/deploy-once.sh` were updated; the
  worker reads the on-disk one.

**Migration name**

`20260513192157_auth_and_invites`

**Env vars added**

None in `.env`. The bootstrap CLI reads `BOOTSTRAP_ADMIN_EMAIL`,
`BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_NAME` inline at
invocation (NOT from `.env`).

**Bootstrap command**

```bash
cd /opt/bvisible/app
( set -a; . /opt/bvisible/shared/env/.env; set +a; \
  BOOTSTRAP_ADMIN_EMAIL='you@example.com' \
  BOOTSTRAP_ADMIN_PASSWORD='strong-passphrase-here' \
  BOOTSTRAP_ADMIN_NAME='Your Name' \
  pnpm --filter @bvisible/web run bootstrap:super-admin )
```

---

## 2026-05-13 — Postgres foundation + Prisma migrate-deploy in deploy queue (Phase 3)

**Commits:** `5fe154bc90d07ef5818e7e0814f75c1ef1afbb0e` (feat) →
`b8fbfec303e31c56d69f363d11d68fcd3717605f` (fix; this is the SHA that actually
deployed green).
**Message:** `feat: add Postgres and Prisma migration deploy`
**Follow-up:** `fix(deploy): remove legacy compose-services restart block (Phase 3)`
— a stale block in `deploy-once.sh` was running `docker compose up -d --no-deps web`
based on the job's `services` array. With the Phase 3 compose file only defining
the `db` service (web runs under PM2), that block hard-failed (`no such service:
web`) and aborted the first deploy attempt (`20260513T181731-3f5f97`). Removed the
dead block; PM2 reload + healthcheck already covered what it was meant to do.

**Scope**

Adds the production Postgres database (managed by docker compose, bound
to `127.0.0.1:5432` ONLY), the first Prisma migration
(`20260513180326_init` — `Role` enum, `tenants`, `users`), and wires
`prisma migrate deploy` + a post-migration `db-verify.sh` into
`deploy-once.sh`. Did NOT add auth, product features, change firewall,
expose ports publicly, or modify queue serialization.

**What changed (repo)**

- NEW `docker-compose.yml` (repo root) — project `bvisible`, single
  service `db` = `postgres:16-alpine`, container `bvisible-db`,
  ports `127.0.0.1:5432:5432` (the `127.0.0.1:` prefix is mandatory),
  named volume `bvisible_pgdata`, healthcheck `pg_isready`. The web
  app stays under PM2 on the host (NOT in compose).
- NEW `server-scripts/db/init/01-extensions.sql` — enables `pgcrypto`
  on a fresh data volume.
- NEW `server-scripts/db/db-verify.sh` — `docker compose exec` into
  `bvisible-db`, asserts container running + connection works +
  `_prisma_migrations` table present + `tenants`/`users` exist. Used
  by `deploy-once.sh`. Standalone-runnable for ops.
- NEW `packages/db/prisma/migrations/migration_lock.toml` and
  `packages/db/prisma/migrations/20260513180326_init/migration.sql` —
  generated by `prisma migrate dev --name init` against the real
  production Postgres on 2026-05-13 (clean room: bootstrap compose dir
  in `/tmp`, generate, scp back, clean working tree). Already applied
  to the live DB; subsequent `migrate deploy` runs are no-ops.
- NEW `server-scripts/db/.bootstrap-write-env.sh`,
  `.bootstrap-fix-env.sh`, `.bootstrap-migrate.sh`,
  `.bootstrap-verify.sh` — one-off scripts used during the Phase 3
  bootstrap. Tracked in git for audit and reusability on a future
  fresh server. The leading-dot prefix keeps them out of any rsync
  that targets `server-scripts/db/init/`. They contain NO secrets;
  they generate them at run time.
- `packages/db/package.json` — added `migrate:deploy`, `migrate:dev`,
  `migrate:status` scripts.
- `package.json` (root) — added `prisma:migrate-deploy`,
  `prisma:migrate-status`, `db:up`, `db:down`, `db:logs`.
- `server-scripts/04-layout-and-queue.sh` — installs `db-verify.sh` to
  `/opt/bvisible/deploy-queue/` on fresh server installs (joins
  `deploy-once.sh`, `enqueue-deploy.sh`, `deploy-worker.sh`,
  `status.sh`, `healthcheck.sh` in the install loop).
- `server-scripts/deploy-queue/deploy-once.sh` — new DB phase between
  build and PM2 reload: `docker compose up -d db`, wait for
  `pg_isready` (≤60s), `prisma migrate deploy` (with `.env` sourced in
  a subshell so prisma sees `DATABASE_URL`), then `db-verify.sh`.
  Migration failure → `exit 10`. db-verify failure → `exit 11`.

**What changed (server)**

- `bvisible-db` container is up via `docker compose -p bvisible up -d
  db` from `/tmp/db-bootstrap/`. Same project name as the future
  in-tree deploy, so the next deploy hits the same container/volume.
- `/opt/bvisible/shared/env/.env` populated with `POSTGRES_DB`,
  `POSTGRES_USER`, `POSTGRES_PASSWORD` (32-char random,
  generated by `.bootstrap-write-env.sh`, never echoed),
  `DATABASE_URL` (double-quoted to handle the `&` in the query string).
  Mode 640, owner deploy:deploy.
- First migration `20260513180326_init` applied to the live DB; row
  exists in `_prisma_migrations` with `finished_at` set.
- `/opt/bvisible/deploy-queue/deploy-once.sh` and
  `/opt/bvisible/deploy-queue/db-verify.sh` will be synced from this
  commit (the worker runs the on-disk copies, not the repo copies).
- `bvisible_pgdata` named volume holds the data
  (`/var/lib/docker/volumes/bvisible_pgdata/_data`).

**Files touched**

- `docker-compose.yml` (new)
- `server-scripts/db/init/01-extensions.sql` (new)
- `server-scripts/db/db-verify.sh` (new)
- `server-scripts/db/.bootstrap-write-env.sh` (new)
- `server-scripts/db/.bootstrap-fix-env.sh` (new)
- `server-scripts/db/.bootstrap-migrate.sh` (new)
- `server-scripts/db/.bootstrap-verify.sh` (new)
- `packages/db/prisma/migrations/migration_lock.toml` (new)
- `packages/db/prisma/migrations/20260513180326_init/migration.sql` (new)
- `packages/db/package.json` (modified)
- `package.json` (modified)
- `server-scripts/04-layout-and-queue.sh` (modified)
- `server-scripts/deploy-queue/deploy-once.sh` (modified)
- `docs/ai-context/DATA_MODEL.md` (modified)
- `docs/ai-context/DEPLOYMENT.md` (modified)
- `docs/ai-context/DEPLOY_QUEUE.md` (modified)
- `docs/ai-context/ENVIRONMENT_VARIABLES.md` (modified)
- `docs/ai-context/DEBUGGING.md` (modified)
- `docs/ai-context/SECURITY_RULES.md` (modified)
- `docs/ai-context/CHANGELOG_AI.md` (this entry)

**Risks**

- **Port binding gotcha.** Docker's `-p 5432:5432` would bind
  `0.0.0.0` AND inject an iptables rule that bypasses UFW —
  publishing the DB to the entire internet. We use
  `127.0.0.1:5432:5432` and verified `ss -tln src 0.0.0.0:5432`
  returns empty. Future edits to `docker-compose.yml` MUST keep the
  `127.0.0.1:` prefix.
- **`.env` quoting.** `DATABASE_URL` contains an unquoted `&` (query
  string). Bash sourcing of `.env` interprets that as the background
  operator and silently fails to set the variable. The bootstrap
  script writes it double-quoted; `deploy-once.sh` documents the
  invariant; `DEBUGGING.md § 11` records the symptom and fix. If
  someone hand-edits `.env` and drops the quotes, the next deploy
  fails at `prisma migrate deploy` with a clear error.
- **First-deploy ordering.** This commit introduces both the compose
  file AND the deploy-once DB phase in a single change. The compose
  file is already brought up on the server out-of-band by the
  bootstrap, so the in-deploy `docker compose up -d db` is a no-op on
  the first deploy after this commit. If the bootstrap had been
  skipped, the deploy would still succeed: compose-up brings the
  service up cold, `prisma migrate deploy` applies all migrations
  fresh.
- **Migration ordering vs PM2.** `prisma migrate deploy` runs BEFORE
  PM2 reload, so a broken migration aborts the deploy without ever
  swapping the runtime. Trade-off: a successful migration that
  exposes a runtime bug will still flip PM2 to the new build; the
  healthcheck catches the runtime side. Rollback path is
  `re-enqueue previous-good commitHash` (DEBUGGING.md § 13).
- **No DB backups yet.** Postgres data is on a single named volume on
  a single host. A snapshot/`pg_dump` cron is the next obvious step
  (DEPLOYMENT.md outstanding step #3). Current data exposure: zero
  rows beyond the empty migration state.
- **Bootstrap scripts in repo.** The four `.bootstrap-*.sh` files in
  `server-scripts/db/` are tracked in git. They contain NO secrets —
  they generate the password at run time on the server. Audited.

**Verification performed (local)**

- `pnpm install --frozen-lockfile` — clean, no new deps.
- `pnpm run prisma:generate` — green, Prisma Client v6.19.3.
- `pnpm run build` — green (Next 15 build, 4 routes including
  `/api/health`).
- Migration files audited: `migration_lock.toml` pins `provider =
  "postgresql"`; `migration.sql` matches the schema (Role enum,
  tenants, users, indexes, FK).

**Verification performed (server)**

- Postgres container: `docker compose -p bvisible ps db` →
  `Up (healthy)`, ports `127.0.0.1:5432->5432/tcp`.
- Public reachability: `ss -tln src 0.0.0.0:5432` returns empty
  (i.e. NOT publicly bound). `ufw status` shows no 5432 rule. UFW
  allowed list still 22/80/443 only.
- Migration applied: `_prisma_migrations` contains
  `20260513180326_init` with `finished_at IS NOT NULL`.
- Tables present: `\dt` returns `_prisma_migrations`, `tenants`,
  `users` in `public`.
- Working tree at `/opt/bvisible/app`: `git status --porcelain`
  returns only `?? uploads` (the shared symlink, untracked, ignored
  by deploy-once dirty check).

**Env vars required (now in `/opt/bvisible/shared/env/.env`)**

- `POSTGRES_DB=bvisible`
- `POSTGRES_USER=bvisible`
- `POSTGRES_PASSWORD=` 32-char random (generated, never echoed)
- `DATABASE_URL="postgresql://bvisible:***@127.0.0.1:5432/bvisible?schema=public&connection_limit=20"` (double-quoted)

**Migration name**

`20260513180326_init` — first migration; creates `Role` enum and
`tenants` / `users` tables with all indexes and the `tenantId` FK.

**Deploy job IDs:**
- `20260513T181731-3f5f97` — failed (rc=1) at the legacy "Restart only
  requested services: web" block (no `web` service in compose). Failed
  job preserved in `/opt/bvisible/deploy-queue/failed/`.
- `20260513T182043-c362ac` — **done** in ~108 s after the follow-up fix.
  Release at `/opt/bvisible/releases/20260513T182044Z-b8fbfec303e3`.

**Deploy result (final):** `done`. End-to-end log:
- Build OK (Next.js standalone bundle).
- `docker compose up -d db` recreated the container (compose file
  changed in working tree — host config drift was reconciled). Healthy
  in <2s.
- `prisma migrate deploy`: "1 migration found in prisma/migrations / No
  pending migrations to apply" (expected — already applied during
  bootstrap).
- `db-verify.sh`: container running, connection OK,
  `_prisma_migrations` OK, `tenants`/`users` OK, applied migrations: 1
  (latest `20260513180326_init`).
- PM2 reload: `bvisible-web` online (pid 24100).
- PM2 save OK.
- Healthcheck: OK after 1 attempt.

**Postgres status:** `bvisible-db` running, healthy, port-published
`127.0.0.1:5432:5432` only (recreated at deploy time, named volume
`bvisible_pgdata` survived).
**Migration result:** idempotent no-op (`No pending migrations to apply`).
**Healthcheck result:** OK after 1 attempt
(`{"status":"ok","service":"bvisible-web"}`).
**HTTPS health endpoint:** `GET https://vmi3270817.contaboserver.net/api/health`
returns `200 OK` with body `{"status":"ok","service":"bvisible-web"}`,
70 ms over TLS.
**Public port safety:** `ss -tln src 0.0.0.0:5432` empty;
`ss -tlnp | grep ':5432'` shows ONLY `127.0.0.1:5432` (docker-proxy on
lo); UFW unchanged (22/80/443 only); no UFW rule for 5432 (none needed
because nothing external can reach it).
**Queue end state:** `bvisible-status` shows last 5 done includes
`20260513T182043-c362ac`; queue empty; serialization unchanged.

---

## 2026-05-13 — Production runtime foundation, Phase 2 (PM2 runtime + healthcheck gate)

**Commits:** `dc01a8099e221b539db3ef5266bb6217532fa593` (feat) → `db8d8a9044310ff38baf8e664df46dd23cbe86a1` (sanity-check fix; this is the SHA that actually deployed green)
**Message:** `feat: add PM2 runtime and deploy healthcheck`

**Scope**

Phase 2 completes the runtime foundation. Wires the deploy queue to PM2
and gates deploy success on a real HTTP healthcheck of `/api/health`.
Public HTTPS now serves the actual app (no more 502 placeholder). Did NOT
add database, auth, business features, or change firewall / queue
serialization.

**What changed (repo)**

- NEW `ecosystem.config.cjs` (repo root) — PM2 spec for `bvisible-web`
  (fork mode, single instance, `cwd` at the standalone tree, env
  `NODE_ENV=production PORT=3000 HOSTNAME=127.0.0.1`,
  `max_memory_restart: 512M`, `kill_timeout: 10000`, log files under
  `/opt/bvisible/shared/logs/pm2/`).
- NEW `server-scripts/deploy-queue/healthcheck.sh` — curl-with-retry
  against `http://127.0.0.1:3000/api/health` (up to 30s). Requires JSON
  `status:"ok"` and `service:"bvisible-web"`. On failure prints
  `pm2 list`, `pm2 jlist`, last 50 lines of stdout/stderr, and `:3000`
  listeners. Exit 0 only on healthy.
- `apps/web/next.config.mjs` — gated `output: 'standalone'` on
  `NEXT_BUILD_STANDALONE=1` env var; sets
  `outputFileTracingRoot` to the workspace root so `@bvisible/db` (and
  any future workspace deps) get traced into the standalone bundle.
  Local Windows builds without the env var keep working (Next standalone
  uses symlinks that hit EPERM on Windows).
- `server-scripts/deploy-queue/deploy-once.sh` — exports
  `NEXT_BUILD_STANDALONE=1` before `pnpm run build`. After build:
  sanity-checks `@bvisible/db` is in the standalone bundle, copies
  `.next/static` into the standalone tree, copies `public/` if present,
  symlinks `apps/web/.next/standalone/apps/web/.env` →
  `/opt/bvisible/shared/env/.env`, ensures
  `/opt/bvisible/shared/logs/pm2/` exists, runs
  `bash -lc 'pm2 startOrReload .../ecosystem.config.cjs --update-env'`,
  `bash -lc 'pm2 save --force'`, sleeps 2s, then runs
  `/opt/bvisible/deploy-queue/healthcheck.sh`. Failed healthcheck →
  `exit 9`. Missing healthcheck → `exit 9` (refuses to mark a deploy
  successful without runtime verification).
- `server-scripts/04-layout-and-queue.sh` — creates
  `/opt/bvisible/shared/logs/pm2/` and installs `healthcheck.sh` to
  `/opt/bvisible/deploy-queue/` on fresh server installs.

**What changed (server)**

- `/opt/bvisible/deploy-queue/deploy-once.sh` updated in place to the
  new version (the worker runs that copy, not the repo's). Same for
  `/opt/bvisible/deploy-queue/healthcheck.sh` (new file). Both `chmod
  755`, owned by `deploy:deploy`.
- `/opt/bvisible/shared/logs/pm2/` created with `deploy:deploy` ownership.
- A real deploy of the new commit was enqueued through the queue; PM2
  process `bvisible-web` is now online and HTTPS endpoint at
  `https://vmi3270817.contaboserver.net/api/health` returns the expected
  JSON.

**Files touched**

- `ecosystem.config.cjs` (new)
- `server-scripts/deploy-queue/healthcheck.sh` (new)
- `apps/web/next.config.mjs` (modified)
- `server-scripts/deploy-queue/deploy-once.sh` (modified)
- `server-scripts/04-layout-and-queue.sh` (modified)
- `docs/ai-context/DEPLOYMENT.md` (modified)
- `docs/ai-context/DEPLOY_QUEUE.md` (modified)
- `docs/ai-context/DEBUGGING.md` (modified)
- `docs/ai-context/SECURITY_RULES.md` (modified)
- `docs/ai-context/CHANGELOG_AI.md` (this entry)

**Risks**

- The Phase 1 spec said "use `su - deploy -c '...'`" for PM2 calls. That
  works from root but NOT from inside `deploy-once.sh` (which already
  runs as `deploy` under systemd — `su` to your own user requires a
  password on Ubuntu). Replaced with `bash -lc 'pm2 ...'` which gives
  the same login-shell environment without a privilege transition.
  Verified equivalent via `systemd-run --uid=deploy --gid=deploy --pipe
  --wait bash -lc 'pm2 ping'` (the worker's exact context). Documented
  in DEPLOYMENT.md and DEBUGGING.md.
- Standalone build on local Windows still hits EPERM by design (the env
  var is unset). The deploy server (Linux) is the only place
  `NEXT_BUILD_STANDALONE=1` runs. Verified default build is unaffected.
- A failed Phase 2 deploy could leave PM2 in a half-started state. The
  failed-job rollback procedure (re-enqueue previous good `commitHash`)
  in `DEBUGGING.md` § 13 still works — `pm2 startOrReload` will reload
  the previous-good build. There is no per-release isolation for the PM2
  process in Phase 2; that's a Phase 3 concern.
- The standalone runtime relies on Next's output tracing to include
  required workspace packages. Tracing only includes what is actually
  imported, so the foundation app (which doesn't import `@bvisible/db`
  yet) won't have it in the bundle — that's correct. We do NOT
  pre-validate specific packages; the healthcheck is the canonical gate.
  An earlier draft of `deploy-once.sh` had an over-aggressive
  pre-runtime sanity check that would fail the deploy if `@bvisible/db`
  was missing; that check was removed because it false-positives on
  early-phase apps that don't yet import it. (Real deploy
  `20260513T172640-904a40` failed for exactly this reason and led to the
  removal.)

**Verification performed**

- Local: `pnpm install --frozen-lockfile` clean. Default
  `pnpm run build` green (no env var, no standalone — local Windows).
  Standalone build attempted with `NEXT_BUILD_STANDALONE=1` failed with
  the expected EPERM symlink errors — gate works as designed.
- Server: `bash -n` syntax check on `deploy-once.sh` and `healthcheck.sh`
  passes.
- Server-side acceptance is captured in this commit's deploy log entry
  below ("Deploy result").

**Deploy job ID:** `20260513T173024-0df396` (the prior job
`20260513T172640-904a40` failed at exit 8 due to the over-aggressive
`@bvisible/db` sanity check — see "Risks" — which led to the fix in
commit `db8d8a9`).
**Deploy result:** `done` in ~98 s. Release snapshot at
`/opt/bvisible/releases/20260513T173024Z-db8d8a904431`.
**PM2:** `bvisible-web` online (fork mode, pid 15871, ~97 MB), saved to
`/home/deploy/.pm2/dump.pm2`.
**Healthcheck:** OK after 1 attempt
(`{"status":"ok","service":"bvisible-web"}`).
**HTTPS health endpoint:** `GET https://vmi3270817.contaboserver.net/api/health`
returns `200 OK` with body `{"status":"ok","service":"bvisible-web"}`.
Public root `/` returns `200 OK` (Next.js home page) with security
headers from Nginx.
**Port 3000:** bound to `127.0.0.1:3000` only by `next-server` (pid 15871) —
not publicly reachable.
**Firewall:** UFW unchanged (22/80/443 only).
**Queue serialization:** unchanged (`bvisible-deploy-worker.timer` active,
flock on `deploy.lock` still in force).

---

## 2026-05-13 — Production runtime foundation, Phase 1 (PM2 + Nginx + HTTPS)

**Commit:** _(this commit, no deploy enqueued — Phase 2 will do that)_
**Message:** `feat: production runtime foundation phase 1 (pm2 + nginx + https)`

**Scope**

Phase 1 of the runtime foundation. Server-side bootstrap only. Did NOT touch
app code, Prisma, deploy-once.sh, or the deploy queue's behavior. Phase 2 will
add `output: 'standalone'`, `ecosystem.config.cjs`, `healthcheck.sh`, and the
PM2 + healthcheck integration into `deploy-once.sh`.

**What changed (server)**

- Installed PM2 v7.0.1 globally via `npm i -g pm2`.
- Installed and enabled the PM2 systemd unit for the `deploy` user
  (`/etc/systemd/system/pm2-deploy.service`). PM2 will resurrect saved
  processes on reboot.
- Replaced `/etc/nginx/sites-enabled/bvisible.placeholder` with a real
  reverse-proxy site at `/etc/nginx/sites-available/bvisible` (proxy to
  `127.0.0.1:3000`, gzip, security headers, WS upgrade, forwarded headers,
  `client_max_body_size 25m`, separate access/error logs).
- Issued a Let's Encrypt cert for `vmi3270817.contaboserver.net` via
  `certbot --nginx --redirect`. Public DNS for that hostname resolves to
  `212.56.32.136` (verified before issuance). Cert valid until 2026-08-11.
- HTTP → HTTPS 301 redirect now active. HSTS intentionally NOT set yet
  (HSTS is a one-way commitment; enable once the runtime is proven stable).
- Created an empty `/opt/bvisible/shared/env/.env` (mode 640, deploy:deploy)
  so the deploy-once.sh symlink-into-app step has something to point at.
- UFW rules unchanged. SSH port unchanged. Port 3000 stays
  localhost-only — verified `ss -tlnp` shows nothing on `:3000`.

**What changed (repo, this commit)**

- NEW `server-scripts/nginx/bvisible.conf` — the reverse-proxy config; the
  on-server `/etc/nginx/sites-available/bvisible` is this file plus
  certbot-managed HTTPS additions.
- NEW `server-scripts/setup-pm2-and-nginx.sh` — idempotent Phase 1
  bootstrap. Run once via SSH; safe to re-run.

**Files touched**

- `server-scripts/nginx/bvisible.conf` (new)
- `server-scripts/setup-pm2-and-nginx.sh` (new)
- `docs/ai-context/DEPLOYMENT.md` (runtime stack updated)
- `docs/ai-context/DEPLOY_QUEUE.md` (Phase 2 healthcheck integration noted)
- `docs/ai-context/SECURITY_RULES.md` (HTTPS posture; HSTS still off)
- `docs/ai-context/DEBUGGING.md` (PM2 + nginx + cert renewal commands)
- `docs/ai-context/CHANGELOG_AI.md` (this entry)

**Risks**

- The on-server `bvisible` site file now contains certbot-managed lines
  (the `:443` server block, ssl paths, the 301 redirect). Re-applying the
  repo file via `setup-pm2-and-nginx.sh` would strip those — the script
  detects the existing cert and re-runs certbot to re-deploy it, but if
  Let's Encrypt is rate-limiting it would fall back to HTTP-only with a
  warning. Mitigation: the script checks `/etc/letsencrypt/live/...` before
  issuance and skips if the cert exists.
- PM2 ran via `sudo -u deploy` failed with `spawn /usr/bin/node EACCES` on
  Ubuntu 24.04 (PM2 daemon spawn under sudo is blocked). The script uses
  `su - deploy -c '...'` instead, which works. Documented in DEBUGGING.md.
- Cert is for the Contabo PTR hostname (`vmi3270817.contaboserver.net`),
  not a real bvisible.* domain. When a real domain is purchased, point its
  A record at `212.56.32.136` and run
  `certbot --nginx -d <new-domain> --redirect`. The current cert keeps
  working until then.

**Verification performed**

- `https://vmi3270817.contaboserver.net/` returns HTTP/1.1 502 (no PM2
  process yet — expected for Phase 1) over a valid TLS handshake, with
  all security headers present.
- `http://vmi3270817.contaboserver.net/` returns 301 → the https URL.
- `ss -tlnp | grep :3000` → nothing listening (correct, no app yet).
- `ufw status` → still 22/80/443 only.
- `systemctl is-enabled pm2-deploy.service` → `enabled` (active is
  `inactive` because there are no resurrected processes; correct).
- `systemctl list-timers | grep certbot` → `certbot.timer` scheduled for
  next run; auto-renewal in place.
- `/opt/bvisible/shared/env/.env` exists, mode 640, owner deploy:deploy,
  size 0 bytes.
- `nginx -t` passes both before and after certbot edits.
- `setup-pm2-and-nginx.sh` is idempotent: re-running it on the now-set-up
  server reports "PM2 already installed", "pm2-deploy.service already
  installed", "${ENV_FILE} already exists — leaving contents alone",
  "${NGINX_AVAILABLE} already current".

**Next step (Phase 2 — separate commit, NOT done in this entry)**

- Add `output: 'standalone'` to `apps/web/next.config.mjs` (gated on env
  var so Windows builds keep working).
- Add `ecosystem.config.cjs` at repo root.
- Add `server-scripts/deploy-queue/healthcheck.sh`.
- Update `server-scripts/deploy-queue/deploy-once.sh` to: copy
  `.next/static` into the standalone tree, symlink `.env` into standalone
  cwd, `pm2 startOrReload --update-env`, `pm2 save`, then run the
  healthcheck. Failed healthcheck → failed deploy.
- Push, then enqueue real deploy and verify `https://vmi3270817...` /
  api/health returns `{ "status": "ok", "service": "bvisible-web" }`.

---

## 2026-05-13 — First real deploy through the queue (foundation app)

**Commit:** `ce7daf17be8174df49a31f659e30f2ebdcdbf58e`
**Message:** `fix(pnpm): allowBuilds in pnpm-workspace.yaml so prisma/sharp/unrs-resolver run install scripts on the server`

**What changed**
- Fixed pnpm v11 install on the server: moved the build-script allowlist from
  `pnpm.onlyBuiltDependencies` (in `package.json`, ignored by pnpm v11 in
  workspace mode) to `allowBuilds` in `pnpm-workspace.yaml` as a `name: true`
  map. Without this, `pnpm install --frozen-lockfile` failed with
  `ERR_PNPM_IGNORED_BUILDS` and the deploy aborted.
- Added `server-scripts/99c-enqueue-real-deploy.sh` — a helper that writes a
  job JSON for a given commit SHA, enqueues it via
  `/opt/bvisible/deploy-queue/enqueue-deploy.sh`, manually triggers the
  worker (instead of waiting up to 30 s for the systemd timer), and prints
  the final status + tail of the log.
- After this commit, the first real deploy through the queue succeeded:
  - Job `20260513T162706-2d72c3` → `done` in ~83 s.
  - Release snapshot at
    `/opt/bvisible/releases/20260513T162707Z-ce7daf17be81`.
  - `releases/current` symlink points at the new release.
  - `/opt/bvisible/app` is at HEAD `ce7daf1` with `.next/` build output
    present at `apps/web/.next/`.
  - Build steps that all ran cleanly on the server: `pnpm install
    --frozen-lockfile` (with prisma / sharp / unrs-resolver install scripts
    actually executed), `prisma generate` (Prisma Client v6.19.3),
    `next build` (4 routes including `GET /api/health`).
- App is built but not yet served by a long-running process or fronted by
  Nginx — that is intentional for the foundation phase. Serving + Nginx
  upstream + healthcheck.sh come in a subsequent change.

**Files touched**
- `pnpm-workspace.yaml` — added `allowBuilds` map (prisma, @prisma/client,
  @prisma/engines, sharp, unrs-resolver → `true`).
- `package.json` — removed `pnpm.onlyBuiltDependencies` (was being ignored
  in workspace mode).
- `server-scripts/99c-enqueue-real-deploy.sh` — NEW helper.
- `apps/web/tsconfig.json` — Next.js auto-injected `incremental: true` and
  `allowJs: true` during `next build`; committed verbatim.

**Risks**
- `allowBuilds` runs install scripts for the listed packages, which is
  exactly what we want; the allowlist is narrow (only the 5 packages we
  actually depend on that need scripts).
- Removing `pnpm.onlyBuiltDependencies` means a downgrade to pnpm v10 in
  workspace mode would silently re-trigger the ignored-builds problem. We
  pin to pnpm 11.1.1 via `packageManager` in root `package.json`.

**Verification**
- Local: `pnpm install --frozen-lockfile` runs `sharp` and `unrs-resolver`
  install scripts and exits 0. `pnpm run build` builds both `@bvisible/db`
  (`prisma generate`) and `@bvisible/web` (`next build`) green.
- Server: deploy job `20260513T162706-2d72c3` ended in `done`, log shows
  install scripts executed, `prisma generate` produced a client,
  `next build` printed all 4 routes, deploy-once exited SUCCESS.

**Follow-ups**
- Move `experimental.typedRoutes` to top-level `typedRoutes` in
  `apps/web/next.config.mjs` (Next 15 deprecation warning); harmless but
  noisy.
- Add a long-running web service (likely systemd unit calling
  `pnpm --filter @bvisible/web exec next start -p 3000`), an Nginx upstream
  block, and `healthcheck.sh` so deploys actually validate `GET /api/health`
  on the live port.
- Wire Postgres + run `prisma migrate deploy` from `deploy-once.sh`.

---

## 2026-05-13 — Server foundation scripts checked in

**Commit:** `60978feeadb5a77e6a9c8396292059b75fba3596`
**Message:** `chore: add server foundation scripts and gitignore`

**What changed**
- Brought the previously-untracked server foundation artifacts into version
  control so the repo state matches the deployed server and the AI-context
  docs that already reference these paths.
- Extended `.gitignore` to cover the full required protection set
  (`.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa*`, `uploads/`, `logs/`,
  `node_modules/`, `.next/`, `dist/`, `build/`) plus common editor / OS
  cruft.
- No server change. No deploy queue behavior change. No app code added.

**Files touched (all NEW)**
- `.gitignore` (extended pattern set)
- `.cursor/rules/git-push-before-deploy.mdc` (always-apply rule)
- `server-scripts/01-recon.sh`
- `server-scripts/02-create-deploy-user.sh`
- `server-scripts/03-base-and-runtime.sh`
- `server-scripts/03b-fix-node22.sh`
- `server-scripts/04-layout-and-queue.sh`
- `server-scripts/05-nginx-fail2ban-ufw.sh`
- `server-scripts/05b-enable-ufw.sh`
- `server-scripts/99-acceptance.sh`
- `server-scripts/99b-debug-enqueue.sh`
- `server-scripts/verify-docs.js`
- `server-scripts/deploy-queue/bvisible-deploy-worker.service`
- `server-scripts/deploy-queue/bvisible-deploy-worker.timer`
- `server-scripts/deploy-queue/deploy-once.sh`
- `server-scripts/deploy-queue/deploy-worker.sh`
- `server-scripts/deploy-queue/enqueue-deploy.sh`
- `server-scripts/deploy-queue/status.sh`
- `docs/ai-context/DEPLOY_QUEUE.md` (one-line cross-reference to this commit)

**Files intentionally excluded**
- `.env` (local development convenience file at repo root) — confirmed
  ignored by `.gitignore` line 2 via `git check-ignore -v .env`.

**Risks**
- Low. Pure file staging plus a `.gitignore` extension. The 17 staged
  scripts/units already exist on the server and have not been changed by
  this commit.

**Verification**
- Manual read of every staged file — no secrets, no tokens, no real DB URLs,
  no SSH key material, no app passwords. Only the public IP `212.56.32.136`
  and the public GitHub repo URL appear, both already published in the
  AI-context docs.
- Regex secret scan across the staging set returned **0 matches** for
  `PRIVATE KEY`, `BEGIN OPENSSH`, `DATABASE_URL=`, `APP_PASSWORD`, `TOKEN=`,
  `PASSWORD=`, `SECRET=`, `BEGIN RSA`, `BEGIN EC`, `api[_-]?key`,
  `aws_access_key`, `aws_secret`, `sk_live_`, `sk_test_`, `ghp_`, `ghs_`,
  `gho_`, `github_pat_`, and high-entropy 40+ char base64/hex literals.
- `git check-ignore -v` confirmed `.gitignore` matches every required
  pattern: `.env`, `.env.production`, `*.pem`, `*.key`, `id_rsa`,
  `uploads/x`, `logs/x`, `node_modules/x`, `.next/x`, `dist/x`, `build/x`.
- Script and unit names cross-checked against `DEPLOY_QUEUE.md` and
  `DEPLOYMENT.md` — `enqueue-deploy.sh`, `deploy-worker.sh`,
  `deploy-once.sh`, `status.sh`, `bvisible-deploy-worker.{service,timer}`
  all match the docs exactly.
- `git push origin main` succeeded; remote `origin/main` is at
  `60978feeadb5a77e6a9c8396292059b75fba3596`.

---

## 2026-05-13 — AI context foundation

**What changed**
- Created the AI-context documentation system that future Cursor sessions
  must use to navigate the repo without scanning everything.

**Files touched**
- `docs/ai-context/CURSOR_START_HERE.md` (root anchor + routing table + standard opener + standard end-of-task block)
- `docs/ai-context/ARCHITECTURE.md`
- `docs/ai-context/DATA_MODEL.md`
- `docs/ai-context/API_STRUCTURE.md`
- `docs/ai-context/AUTH_AND_PERMISSIONS.md`
- `docs/ai-context/ESTIMATE_ENGINE.md` (formulas, banner rule, machine rates, channel-letter formula + multipliers, manual overrides)
- `docs/ai-context/PO_SYSTEM.md`
- `docs/ai-context/EMAIL_INGESTION.md`
- `docs/ai-context/VENDOR_PRICE_ENGINE.md`
- `docs/ai-context/UI_SYSTEM.md`
- `docs/ai-context/DEPLOYMENT.md` (real completed server setup)
- `docs/ai-context/DEPLOY_QUEUE.md` (real completed deploy queue)
- `docs/ai-context/ENVIRONMENT_VARIABLES.md`
- `docs/ai-context/FILE_STRUCTURE.md`
- `docs/ai-context/KNOWN_RULES.md`
- `docs/ai-context/CODING_STANDARDS.md`
- `docs/ai-context/TESTING.md`
- `docs/ai-context/MOBILE_APP.md`
- `docs/ai-context/SECURITY_RULES.md`
- `docs/ai-context/DEBUGGING.md`
- `docs/ai-context/CHANGELOG_AI.md` (this file)
- `docs/prompts/CURSOR_PROMPT_TEMPLATE.md` (mirrors opener + end-of-task block)

**No app behavior changed.** No code, no migrations, no packages, no server
state, no deploy queue change.

**Risks**
- Low. Documentation only.
- Drift risk: numbers in `ESTIMATE_ENGINE.md` (channel-letter materials,
  multipliers) need confirmation with the shop owner before any code reads
  them. Flagged inline.
- Drift risk: schema sketch in `DATA_MODEL.md` is a target — replace with the
  real Prisma schema once it lands.

**Verification**
- All 22 files exist on disk in the listed paths.
- `CURSOR_START_HERE.md` contains: project summary, "Practicality is king,
  user-friendly is queen", read-only-relevant-docs guidance, no-whole-repo
  rule, no-unrelated-files rule, root-cause-and-plan rule, Git-first deploy
  rule, exact-`commitHash` rule, one-deploy-at-a-time rule, tenant-isolation
  rule, full task routing table.
- The exact standard opener block is present in both
  `CURSOR_START_HERE.md` and `docs/prompts/CURSOR_PROMPT_TEMPLATE.md`.
- The exact STANDARD END-OF-TASK DOC UPDATE block is present in both files.
- `DEPLOYMENT.md` + `DEPLOY_QUEUE.md` reflect real values: IP `212.56.32.136`,
  Ubuntu 24.04.4, `/opt/bvisible` layout, `deploy` user, Git-first model,
  exact `commitHash` requirement, queue folders, `bvisible-deploy` and
  `bvisible-status` commands, 30-second systemd timer, SSH/HTTP/HTTPS-only
  firewall, `.env` at `/opt/bvisible/shared/env/.env`.
- `ESTIMATE_ENGINE.md` contains all formulas and machine rates from the
  brief (Materials, Machines, Shop labor, Design 150 flat, Install rate,
  raw cost, 3× sell, sqft formula, banner rule + grommets, machine rates,
  channel-letter formula and multipliers, manual overrides).
- `EMAIL_INGESTION.md` includes Google Workspace app-password setup, IMAP
  + SMTP test snippets, inbox scan loop, PO-number detection,
  `(tenantId, messageId)` duplicate guard, attachment storage path, vendor
  document parsing, review queue.
- `VENDOR_PRICE_ENGINE.md` includes cheapest-vendor logic, vendor matching
  by sender email/domain/alias, item alias support, lower-price detection,
  `VendorPrice`/`VendorPriceHistory` flow, manual-dismiss notification.
- `UI_SYSTEM.md` covers SaaS 2026 look, sidebar, sliding drawer behavior,
  cards, rounded corners, soft shadows, badges, tables with search/filter,
  empty states, no raw JSON, B Visible branding, practicality-first.
- `DEBUGGING.md` covers deploy queue, stuck lock, systemd/journal, nginx,
  Docker, build failures, healthcheck, disk/memory/CPU, email ingestion,
  tenant-scope, Prisma/DB, UI hydration, recovery posture, and the
  never-log-secrets rule.
- `CURSOR_PROMPT_TEMPLATE.md` exists and shares the opener + ending blocks
  byte-for-byte with `CURSOR_START_HERE.md`.
