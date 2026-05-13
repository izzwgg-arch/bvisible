# Cursor Prompt Template — B Visible

Copy the block below into the start of every new Cursor task in this repo.
Replace the bracketed values. Keep the wording identical so future agents
can rely on it.

---

Read docs/ai-context/CURSOR_START_HERE.md first.

This task is: [server / deployment / UI / database / estimates / purchase orders / vendors / email ingestion / mobile / notifications / API / security]
Risk level: [low / medium / high / extreme]

Only use the relevant files.
Do not analyze the whole repo.
Do not change unrelated files.
First give root cause and file plan before coding.

---

## What to put after the opener

After the standard opener, paste:

1. A one-sentence statement of the goal.
2. Hard constraints (e.g. "do not touch deploy queue", "do not run migrations").
3. The acceptance tests you want, written as a checklist.
4. Final-step requirements (e.g. "commit + push to main with message X").

Keep prompts short. The routing table in `CURSOR_START_HERE.md` will pull in
the deeper context.

## Risk levels — what they mean

| Level | Meaning | Required behavior |
|---|---|---|
| low | Docs, copy, comments, internal naming | Brief plan OK |
| medium | New feature wired into existing module | Root cause + file plan + acceptance tests |
| high | Schema change, new server endpoint, auth touch | Plan + dry run + DB backup note + reviewer |
| extreme | Server prep, deploy pipeline, secrets, firewall | Strict step-by-step, safety guards, rollback plan, no parallel work |

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
