# CURSOR START HERE — B Visible

This is the root context file for every AI/Cursor session in this repo.
**Read this file first. Then read only the docs the routing table sends you to.**

---

## Standard opener (paste into every new Cursor task)

Read docs/ai-context/CURSOR_START_HERE.md first.

This task is: [server / deployment / UI / database / estimates / purchase orders / vendors / email ingestion / mobile / notifications / API / security]
Risk level: [low / medium / high / extreme]

Only use the relevant files.
Do not analyze the whole repo.
Do not change unrelated files.
First give root cause and file plan before coding.

---

## Project summary

B Visible is the operations platform for a sign-and-print company. The product covers:

- Estimates (with formulas for materials, machines, labor, design, install)
- Purchase orders (PO is the master file)
- Vendor catalog and price intelligence (cheapest vendor, lower-price detection)
- Email ingestion from Google Workspace (PO replies, vendor docs, receipts)
- Mobile app for field/install/receipt capture
- A SaaS-grade web UI

The app is **multi-tenant**. Every tenant-scoped query MUST include `tenantId`.

## Operating philosophy

> **Practicality is king, user-friendly is queen.**

Build the smallest correct thing the team can use today. Polish what users
actually touch. Skip framework heroics that don't move the needle.

## Hard rules every agent must follow

1. **Read only the docs the routing table sends you to.** Do not skim the whole
   `docs/ai-context/` folder unless explicitly told.
2. **Do not analyze the whole repo.** Use file targeting (Glob, Grep, Read of a
   specific path). The repo will get large; aimless exploration burns context.
3. **Do not change unrelated files.** A change in module X must not edit files
   outside X without an explicit reason in the plan.
4. **Always give root cause + file plan before coding.** No silent multi-file
   edits.
5. **Git-first deploy.** Code that is not on `origin` is not real. Commit and
   `git push` before any deploy step.
6. **Exact `commitHash` required for every deploy.** The server refuses to
   deploy a branch tip — see `DEPLOY_QUEUE.md`.
7. **Only one deploy at a time.** The deploy worker uses `flock` on
   `/opt/bvisible/deploy-queue/deploy.lock`. Never bypass it.
8. **Tenant isolation.** Every database query that reads or writes
   tenant-scoped data MUST include `tenantId` in the WHERE clause. No exceptions.
9. **Never log secrets**, app passwords, OAuth tokens, vendor API keys, raw
   email bodies that may contain credentials, or `.env` contents.

## Task routing table

| If your task is about… | Read these files (in order) |
|---|---|
| server / deployment | `DEPLOYMENT.md`, `DEPLOY_QUEUE.md`, `DEBUGGING.md`, `SECURITY_RULES.md` |
| UI / theme | `UI_SYSTEM.md`, `ARCHITECTURE.md`, `FILE_STRUCTURE.md` |
| database | `DATA_MODEL.md`, `KNOWN_RULES.md`, `CODING_STANDARDS.md` |
| estimates | `ESTIMATE_ENGINE.md`, `DATA_MODEL.md`, `KNOWN_RULES.md` |
| purchase orders | `PO_SYSTEM.md`, `DATA_MODEL.md`, `KNOWN_RULES.md` |
| vendors / pricing | `VENDOR_PRICE_ENGINE.md`, `ESTIMATE_ENGINE.md`, `DATA_MODEL.md` |
| email ingestion | `EMAIL_INGESTION.md`, `VENDOR_PRICE_ENGINE.md`, `DEBUGGING.md`, `SECURITY_RULES.md` |
| notifications | `KNOWN_RULES.md`, `DATA_MODEL.md`, `UI_SYSTEM.md` |
| mobile | `MOBILE_APP.md`, `API_STRUCTURE.md`, `AUTH_AND_PERMISSIONS.md` |
| auth / permissions | `AUTH_AND_PERMISSIONS.md`, `SECURITY_RULES.md` |
| debugging | `DEBUGGING.md`, `DEPLOYMENT.md`, `DEPLOY_QUEUE.md` |

If the task touches more than one area, read each row in order and stop reading
as soon as you have enough context.

## Where the source of truth lives

- **Repo:** https://github.com/izzwgg-arch/bvisible.git
- **Production server:** `212.56.32.136` (Ubuntu 24.04 LTS) — see `DEPLOYMENT.md`
- **App root on server:** `/opt/bvisible/app` — see `DEPLOY_QUEUE.md`
- **Secrets:** `/opt/bvisible/shared/env/.env` on the server, never in Git

---

## STANDARD END-OF-TASK DOC UPDATE:

Before finishing, update documentation:
- Update docs/ai-context/DATA_MODEL.md if models, fields, relationships, or migrations changed.
- Update docs/ai-context/API_STRUCTURE.md if routes, server actions, endpoints, payloads, or response shapes changed.
- Update docs/ai-context/UI_SYSTEM.md if pages, components, layouts, navigation, forms, or UI behavior changed.
- Update docs/ai-context/KNOWN_RULES.md if business rules changed.
- Update the specific feature doc touched.
- Update docs/ai-context/DEPLOYMENT.md or docs/ai-context/DEPLOY_QUEUE.md if deployment behavior changed.
- Update docs/ai-context/SECURITY_RULES.md if auth, secrets, tenant isolation, upload safety, or firewall behavior changed.
- Update docs/ai-context/DEBUGGING.md if debugging commands, symptoms, logs, or recovery steps changed.
- Update docs/ai-context/CHANGELOG_AI.md with what changed, files touched, risks, and verification.
- Do not create duplicate docs.
- Do not document unrelated changes.
