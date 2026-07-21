// B Visible business assistant — OpenAI tool-calling loop, grounded in
// the live Google Sheet and tenant data. Trained on the shop's rules via
// the system prompt (from the owner's handoff + this system's docs).
//
// Safety: tools are whitelisted and tenant-scoped. Reversible writes
// (draft estimates, draft purchase orders, customers, vendors, catalog
// items, edits) run immediately; irreversible actions (delete, send/email,
// approve, finalize) never run from the loop — the agent can only email or
// send anything through a separate, operator-approved step.

import { prisma } from '@bvisible/db';
import { computeEstimate, formatMoney, type LineKind } from '@bvisible/pricing';
import { fuzzySearch } from '@/lib/sheet-sync/fuzzy';
import { getSheetSnapshot } from '@/lib/sheet-sync/sync';
import { sheetItemKey } from '@/lib/sheet-sync/types';
import { loadOverrides, activeMaterialPrice } from '@/lib/sheet-sync/active-price';
import { nextEstimateNumber } from '@/lib/estimate/number';
import { writeAuditLog } from '@/lib/auth/audit';
import {
  addEstimateLine,
  addPurchaseOrderLine,
  createCatalogItem,
  createCustomer,
  createPurchaseOrder,
  createVendor,
  getEstimate,
  getPurchaseOrder,
  prepareDelete,
  preparePoStatusChange,
  prepareStatusChange,
  removeEstimateLine,
  updateCatalogItem,
  updateCustomer,
  updateEstimate,
  updateEstimateLine,
  updatePurchaseOrder,
  updateVendor,
  type PendingAction,
  type RecyclableEntity,
} from '@/lib/assistant/operator-actions';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

// Reliability guardrails for the agent loop:
// - Every OpenAI call gets a hard timeout and transient-failure retries.
// - The WHOLE loop gets a time budget; when it runs out we force a final
//   answer from what was gathered instead of dying in an nginx 504.
const OPENAI_CALL_TIMEOUT_MS = 75_000;
const OPENAI_TRANSIENT_RETRIES = 2;
const TOTAL_BUDGET_MS = 210_000;

interface OpenAIChatResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
}

/// One OpenAI chat call with timeout + retries on transient failures
/// (429/5xx/network). Returns a structured error instead of throwing.
async function callOpenAI(
  apiKey: string,
  body: string
): Promise<{ ok: true; json: OpenAIChatResponse } | { ok: false; error: string }> {
  let lastError = 'unknown error';
  for (let attempt = 0; attempt <= OPENAI_TRANSIENT_RETRIES; attempt += 1) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, attempt === 1 ? 800 : 2500));
    }
    try {
      const res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body,
        signal: AbortSignal.timeout(OPENAI_CALL_TIMEOUT_MS),
      });
      if (res.ok) {
        return { ok: true, json: (await res.json()) as OpenAIChatResponse };
      }
      const text = (await res.text()).slice(0, 300);
      lastError = `OpenAI ${res.status}: ${text}`;
      // Only transient statuses are worth retrying.
      if (![429, 500, 502, 503, 504].includes(res.status)) break;
    } catch (e) {
      // AbortError (timeout) and network failures — retry.
      lastError = e instanceof Error ? `${e.name}: ${e.message}` : 'network error';
    }
  }
  return { ok: false, error: lastError };
}

import { openSecret } from '@/lib/email-ingest/crypto';

/// DB-stored key (Assistant settings, encrypted) wins; env is fallback.
export async function loadAssistantConfig(
  tenantId: string
): Promise<{ apiKey: string | null; model: string }> {
  const row = await prisma.assistantSetting.findUnique({ where: { tenantId } });
  let apiKey: string | null = null;
  if (row?.apiKeyCipher) {
    try {
      apiKey = openSecret(row.apiKeyCipher);
    } catch {
      apiKey = null;
    }
  }
  if (!apiKey) apiKey = process.env.OPENAI_API_KEY?.trim() || null;
  const model = row?.model?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-5.6-sol';
  return { apiKey, model };
}

export async function assistantConfigured(tenantId: string): Promise<boolean> {
  return Boolean((await loadAssistantConfig(tenantId)).apiKey);
}

const SYSTEM_PROMPT = `You are the B Visible business assistant for B Visible Signs & Printing (sign shop, Harriman NY). You help the operator with estimating, purchasing insight, and day-to-day business questions.

NON-NEGOTIABLE PRICING RULES (from the owner):
- The live Google pricing Sheet ("B Visible Formula") is the SOURCE OF TRUTH for materials, machine rates, sq-ft rates, vehicle wraps, bundles, and recommendations. Always use the tools to look up real Sheet data — never invent materials or prices.
- Normal material/machine/labor lines get the estimate markup (default 200% = ×3.00 sell).
- Square-foot items and vehicle wraps use FINAL selling prices from the Sheet — NEVER apply markup to them again.
- Operating rates: shop labor $/hr, design flat fee, installation $/person/hr come from get_rates.
- Sign-type jobs (stop sign, pylon, channel letters, vehicle wrap, ACM, coroplast, monument…) should start from get_recommendations for that sign type, plus bundles when one matches.

WHAT YOU CAN DO — you are a full operator assistant. You can carry out any normal user task in the app:
- Look up materials, bundles, vehicle wraps, sq-ft rates, machines, recommendations (Sheet tools) and answer business questions from the database.
- Look up / open: get_purchase_order and get_estimate find a record by number (exact match, or lenient — "22" or "po 22" matches PO-000022) or by vendor/customer/title text, and open it on the operator's screen right away — no extra step needed. Use these whenever the operator gives you a PO or estimate number, or asks to see/open/check/look up one. If more than one record matches, you get a short candidate list back instead — read the options out and ask which one they mean, don't guess.
- Create: estimates (create_estimate_draft), estimate lines (add_estimate_line), catalog items (create_catalog_item), customers (create_customer), vendors (create_vendor), purchase orders (create_purchase_order), purchase-order lines (add_purchase_order_line). Run immediately.
- ORDERING MATERIALS / PURCHASE ORDERS: when the operator says "make me a PO", "order …", "buy …", first search_materials for each item (exact name, unit cost, vendor), then call create_purchase_order with those lines. It creates a DRAFT PO only — NOTHING is emailed to any vendor; the operator sends it themselves with "Send PO" on the PO page. End with "Draft <PO number> created — review it in Purchase Orders."
- Edit: update_customer, update_vendor, update_catalog_item, update_estimate (title / markup % / customer), update_purchase_order (notes / vendor / QuickBooks PO number). Run immediately.
- Edit or remove ONE estimate line: update_estimate_line (change a line's quantity, rate/unitCostCents, description, kind, or markup-exempt flag) and remove_estimate_line (delete a single line). Target the line by its number as shown on the estimate (first line = 1) or by matching text; the estimate total recalculates automatically. Use these to fix a line — NEVER add a $0 or "correction" line to offset a mistake. To make an installation (or any line) a flat FINAL price that is not marked up again, set markupExempt=true with the final per-unit price in unitCostCents (R-EST-05). If you need to see line numbers first, call get_estimate.
- Delete records (delete_record) for estimate / customer / vendor / purchase_order / catalog_item, and change status — set_estimate_status (APPROVED/SENT/REJECTED/DRAFT) or set_purchase_order_status (ORDERED/PARTIALLY_RECEIVED/RECEIVED/CANCELED/DRAFT). These do NOT happen instantly — the operator gets a one-tap Approve card. Deletes are soft: the record goes to the Recycle Bin, recoverable for 30 days. set_purchase_order_status can NEVER mark a PO "SENT" — real sending only happens when the operator presses "Send PO" themselves, which emails the vendor. Just call the tool; approval + recovery are handled for you.
- When the operator asks you to do something (add, change, delete, approve), DO IT with the tools — don't just describe it.
- SPEED: for a create/edit tool, pass a short "reply" argument (your one-line confirmation, e.g. "Added Blue Tape to the catalog."). The turn ends immediately with that reply — no extra round. Only skip "reply" if you still need another tool call afterward.

THE ONE HARD LIMIT: you work only with the database and normal in-app actions. You can NEVER change code, the backend, server, or app settings, and you never touch payments or pension. If asked for any of those, say it's outside what you can do.

SCREEN CONTEXT:
- When a "CURRENT SCREEN" note is present, the operator has that page open right now. Use it — never ask them to re-explain what they are working on.
- If the operator is building or editing an estimate ON SCREEN and wants lines added or something is missing, call propose_estimate_lines — the lines appear on their screen with a one-click "Add" button.

BUILDING FULL ESTIMATES (draft in the estimate workspace — the default):
- When the operator describes a sign or job they want an estimate for — from ANY page — build the complete estimate and call create_estimate_draft. The full estimate workspace opens on their screen with the DRAFT loaded (every line, markup, totals) — the same premium editor they use for all estimates. It is a DRAFT only: nothing is sent or approved; they review, adjust, and take it from there.
- Build the FULL recipe the way the shop would: structure/face/back materials at real Sheet prices with realistic quantities and sheet counts for the dimensions; for lit signs add LED modules (spaced ~1 per 0.35–0.5 sq ft of lit face), power supplies (~1 per 20–30 modules), low-voltage wire by linear feet, silicone/hardware/glue; machine time on the right machines from get_rates (CNC/router for cutting, flatbed or roll printer for prints); shop labor hours; design units; installation as INSTALL lines (hours × installers at the per-person rate). Start from get_recommendations for the sign type, then add what the description requires.
- Printed graphics: include printer machine time, and if ink/consumables aren't in the Sheet add a MISC line with a stated cost assumption.
- ALWAYS pass summaryForOperator with the create_estimate_draft / prefill_estimate call: the full line list with prices, the total, and a short "Assumptions to verify" list (sizes, coverage, counts you estimated). That text IS your final reply — the turn ends the moment the draft is created, with no extra round.
- On every MATERIAL line, set materialName to the EXACT name from your search_materials results (copy it verbatim). This links the line to the catalog so the operator sees vendors and cheapest prices on the estimate page.
- Use prefill_estimate only if the operator explicitly asks you to fill in the Create-estimate form without saving anything yet.

EFFICIENCY (critical):
- Batch your lookups: issue MANY tool calls in the SAME response — all search_materials calls at once, alongside get_rates and get_recommendations. NEVER search one material per round.
- Target 2 rounds total: round 1 = ALL lookups batched in parallel; round 2 = create_estimate_draft with summaryForOperator. Add a round only when a needed price is genuinely missing — never to double-check something you already have.

LEARNING (you have permanent memory):
- A MEMORY section with lessons from this shop may follow. Apply those lessons — they override generic guesses.
- Whenever the operator corrects you, states a preference or shop rule, or you learn something reusable (a recipe, a quantity rule, a preferred material, a pricing practice), call save_memory with a short general lesson (e.g. "Lightbox faces: use Dura-Bond Black 4x8 matt"). Don't save one-off job details, customer PII, or anything sensitive.

WHAT YOU MUST NEVER DO:
- Never change code, backend, server, or app configuration, and never touch payments or pension.
- Never guess prices — if a lookup returns nothing, say so and ask.

STYLE: concise, practical, dollars formatted, show your material picks as a short list. When you create an estimate, end with "Draft <number> created — review it in Estimates."`;

/* ------------------------------ tools ------------------------------ */

const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'search_materials',
      description: 'Fuzzy-search the live Sheet material catalog (name, category, price, vendor). Use before adding any material line.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recommendations',
      description: 'Materials normally needed for a sign type (from the Sheet "Estimator Recommendations" tab). Also returns available sign types and saved bundles.',
      parameters: {
        type: 'object',
        properties: { signType: { type: 'string', description: 'e.g. "Stop Sign", "Pylon Sign", "Channel Letters"' } },
        required: ['signType'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_rates',
      description: 'Operating rates (shop labor, design flat, install per person/hr, default markup %), machine hourly rates, and sq-ft rates (final prices).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_vehicle_wraps',
      description: 'Search the Sheet vehicle wrap list (original names/variants, final prices).',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'business_snapshot',
      description: 'Read-only tenant stats: estimate/PO counts by status, recent estimates and POs with totals, top customers.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_estimate_lines',
      description:
        'Propose lines for the estimate the operator has OPEN ON SCREEN (see CURRENT SCREEN note). The lines show up on their screen with a one-click "Add" button — nothing is added or saved until they click. Use real prices from prior tool lookups. sqft/wrap lines: markupExempt=true with the FINAL price.',
      parameters: {
        type: 'object',
        properties: {
          note: { type: 'string', description: 'One short line explaining why (shown to the operator).' },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC'] },
                description: { type: 'string' },
                qty: { type: 'number' },
                unitCostCents: { type: 'number' },
                markupExempt: { type: 'boolean' },
              },
              required: ['kind', 'description', 'qty', 'unitCostCents'],
            },
          },
        },
        required: ['lines'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prefill_estimate',
      description:
        'Open the Create-estimate page on the operator\'s screen with the COMPLETE estimate filled in: job name, customer, markup, and every line. Nothing is saved. Use ONLY when the operator explicitly asks to fill the form without saving — otherwise use create_estimate_draft.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Job name, e.g. "66x48x4 push-through lightbox".' },
          customerName: { type: 'string', description: 'Customer/company if the operator gave one.' },
          markupPercent: { type: 'number', description: 'Default 200 unless the operator says otherwise.' },
          note: { type: 'string', description: 'One short line shown to the operator.' },
          summaryForOperator: {
            type: 'string',
            description:
              'Your COMPLETE final reply to the operator: the line list with quantities and prices, the total, and a short "Assumptions to verify" list. The turn ends with this text — always provide it.',
          },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC'] },
                description: { type: 'string' },
                qty: { type: 'number' },
                unitCostCents: { type: 'number' },
                markupExempt: { type: 'boolean' },
              },
              required: ['kind', 'description', 'qty', 'unitCostCents'],
            },
          },
        },
        required: ['title', 'lines'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description:
        'Save a short, reusable lesson to your permanent memory for this shop (a correction, preference, recipe, or rule the operator taught you). It will be shown to you in every future conversation.',
      parameters: {
        type: 'object',
        properties: {
          lesson: { type: 'string', description: 'One or two sentences, general and reusable.' },
          category: { type: 'string', description: 'e.g. "materials", "pricing", "recipe", "workflow".' },
        },
        required: ['lesson'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_estimate_draft',
      description: 'Create a DRAFT estimate — the DEFAULT way to build an estimate the operator asked for. The estimate workspace opens on their screen with the draft loaded. Lines must use real prices from prior tool lookups. sqft/wrap lines: markupExempt=true with the FINAL price. Never used without the operator asking for an estimate.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          customerName: { type: 'string', description: 'Existing or new customer/company name.' },
          markupPercent: { type: 'number', description: 'Default 200 unless the operator says otherwise.' },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC'] },
                description: { type: 'string' },
                qty: { type: 'number' },
                unitCostCents: { type: 'number' },
                markupExempt: { type: 'boolean' },
                materialName: {
                  type: 'string',
                  description:
                    'MATERIAL lines: the EXACT material name as returned by search_materials. Links the line to the catalog so vendor + cheapest pricing show on the estimate page.',
                },
              },
              required: ['kind', 'description', 'qty', 'unitCostCents'],
            },
          },
          summaryForOperator: {
            type: 'string',
            description:
              'Your COMPLETE final reply to the operator: the line list with quantities and prices, the total, and a short "Assumptions to verify" list. The turn ends with this text — always provide it.',
          },
        },
        required: ['title', 'customerName', 'lines'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_purchase_order',
      description:
        'Create a DRAFT purchase order to ORDER materials from a vendor — runs immediately. Use whenever the operator says "make me a PO", "order …", "buy …", "PO for …". First call search_materials to get the exact material name, unit cost, and vendor, then pass materialName (verbatim), unitCostCents (from priceCents), and vendorName from those results. The PO is a DRAFT only — NOTHING is emailed to any vendor; the operator sends it later with the "Send PO" button on the PO page.',
      parameters: {
        type: 'object',
        properties: {
          vendorName: {
            type: 'string',
            description: 'Vendor for the whole PO (created if it does not exist yet). Omit if each line names its own vendor, or if unknown.',
          },
          notes: { type: 'string', description: 'Optional PO notes.' },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC'] },
                description: { type: 'string', description: 'What to order, e.g. \'4x8 1/2" white PVC\'.' },
                materialName: {
                  type: 'string',
                  description: 'EXACT material name from search_materials (copy verbatim). Links the line to the catalog for vendor + pricing and auto-picks the preferred vendor.',
                },
                qty: { type: 'number' },
                unit: { type: 'string', enum: ['EACH', 'SHEET', 'SQ_FT', 'HOUR', 'LINEAR_FT', 'ROLL', 'CUSTOM'] },
                unitCostCents: { type: 'number', description: 'Vendor unit cost in cents (use priceCents from search_materials).' },
                vendorName: { type: 'string', description: 'Per-line vendor, only if different from the PO vendor.' },
              },
              required: ['description', 'qty', 'unitCostCents'],
            },
          },
          reply: { type: 'string', description: 'Your one-line confirmation to the operator. The turn ends with it.' },
        },
        required: ['lines'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_purchase_order',
      description:
        'Find a purchase order by number (e.g. "PO-000022", or just "22") or by vendor name, and open it on the operator\'s screen right away. Use whenever the operator asks to see, open, check, or look up a PO, or gives you a PO number. Returns full detail (status, vendor, lines, totals) so you can also describe it in your reply. If several POs match, you get a short candidate list instead — ask which one they mean.',
      parameters: {
        type: 'object',
        properties: {
          reference: { type: 'string', description: 'PO number, full or partial (e.g. "PO-000022", "22"), or a vendor name.' },
        },
        required: ['reference'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_estimate',
      description:
        'Find an estimate by number (e.g. "EST-000021", or just "21"), customer name, or title, and open it on the operator\'s screen right away. Use whenever the operator asks to see, open, check, or look up an estimate, or gives you an estimate number. Returns full detail (status, customer, lines, totals) so you can also describe it in your reply. If several estimates match, you get a short candidate list instead — ask which one they mean.',
      parameters: {
        type: 'object',
        properties: {
          reference: { type: 'string', description: 'Estimate number, full or partial (e.g. "EST-000021", "21"), customer name, or title.' },
        },
        required: ['reference'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_purchase_order',
      description:
        'Edit a purchase order\'s notes, vendor, or QuickBooks PO number — runs immediately. (Do NOT use this to change status or add lines; use set_purchase_order_status / add_purchase_order_line.)',
      parameters: {
        type: 'object',
        properties: {
          reference: { type: 'string', description: 'PO number or id.' },
          notes: { type: 'string' },
          vendorName: { type: 'string', description: 'Sets the PO-level vendor (created if it does not exist yet).' },
          qboPoNumber: { type: 'string' },
          reply: { type: 'string' },
        },
        required: ['reference'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_purchase_order_line',
      description:
        'Append a line item to an EXISTING purchase order (by number, e.g. PO-000022) — runs immediately. Use catalog prices from search_materials.',
      parameters: {
        type: 'object',
        properties: {
          purchaseOrder: { type: 'string', description: 'PO number or id.' },
          kind: { type: 'string', enum: ['MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC'] },
          description: { type: 'string' },
          materialName: {
            type: 'string',
            description: 'EXACT material name from search_materials (copy verbatim), for MATERIAL lines. Links the line to the catalog for vendor + pricing.',
          },
          qty: { type: 'number' },
          unit: { type: 'string', enum: ['EACH', 'SHEET', 'SQ_FT', 'HOUR', 'LINEAR_FT', 'ROLL', 'CUSTOM'] },
          unitCostCents: { type: 'number' },
          vendorName: { type: 'string', description: 'Per-line vendor, only if different from the PO vendor.' },
        },
        required: ['purchaseOrder', 'description', 'qty', 'unitCostCents'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_purchase_order_status',
      description:
        'Change a purchase order\'s status (DRAFT/ORDERED/PARTIALLY_RECEIVED/RECEIVED/CANCELED). This is a meaningful action, so it does NOT run immediately — the operator approves it with one tap. NEVER use this for "sent" — sending a PO emails the vendor and only happens when the operator presses "Send PO" on the PO page themselves.',
      parameters: {
        type: 'object',
        properties: {
          purchaseOrder: { type: 'string', description: 'PO number or id.' },
          status: { type: 'string', enum: ['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELED'] },
        },
        required: ['purchaseOrder', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_catalog_item',
      description:
        'Create a new catalog (shop material) item in the database — runs immediately. Use when the operator says "add … to the catalog".',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', enum: ['MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC'] },
          unit: { type: 'string', enum: ['EACH', 'SHEET', 'SQ_FT', 'HOUR', 'LINEAR_FT', 'ROLL', 'CUSTOM'] },
          category: { type: 'string' },
          internalCostCents: { type: 'number', description: 'Internal unit cost in cents.' },
          markupPercent: { type: 'number', description: 'Default 200.' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_estimate_line',
      description:
        'Append a line item to an EXISTING estimate (by number, e.g. EST-000021) — runs immediately. Use catalog prices from search_materials.',
      parameters: {
        type: 'object',
        properties: {
          estimate: { type: 'string', description: 'Estimate number or id.' },
          kind: { type: 'string', enum: ['MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC'] },
          description: { type: 'string' },
          qty: { type: 'number' },
          unitCostCents: { type: 'number' },
          markupExempt: { type: 'boolean' },
        },
        required: ['estimate', 'description', 'qty', 'unitCostCents'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_record',
      description:
        'Delete a record (estimate, customer, vendor, purchase_order, or catalog_item). This is IRREVERSIBLE-feeling, so it does NOT run immediately — it returns a request the operator must approve with one tap. The delete is a soft delete: the record goes to the Recycle Bin and is recoverable for 30 days.',
      parameters: {
        type: 'object',
        properties: {
          entity: { type: 'string', enum: ['estimate', 'customer', 'vendor', 'purchase_order', 'catalog_item'] },
          reference: { type: 'string', description: 'Name or number identifying the record (e.g. "EST-000021", "Valley Plumbing").' },
        },
        required: ['entity', 'reference'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_customer',
      description: 'Create a customer/client — runs immediately.',
      parameters: {
        type: 'object',
        properties: {
          companyName: { type: 'string' },
          contactName: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          reply: { type: 'string', description: 'Your one-line confirmation to the operator. The turn ends with it.' },
        },
        required: ['companyName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_vendor',
      description: 'Create a vendor — runs immediately.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          reply: { type: 'string', description: 'Your one-line confirmation. The turn ends with it.' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_customer',
      description: 'Edit a customer (rename, contact, email, phone) — runs immediately.',
      parameters: {
        type: 'object',
        properties: {
          reference: { type: 'string', description: 'Current customer name or id.' },
          newName: { type: 'string' },
          contactName: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          reply: { type: 'string' },
        },
        required: ['reference'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_vendor',
      description: 'Edit a vendor (rename, email, phone) — runs immediately.',
      parameters: {
        type: 'object',
        properties: {
          reference: { type: 'string' },
          newName: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          reply: { type: 'string' },
        },
        required: ['reference'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_catalog_item',
      description: 'Edit a catalog item (rename, internal cost, markup %, category) — runs immediately.',
      parameters: {
        type: 'object',
        properties: {
          reference: { type: 'string' },
          newName: { type: 'string' },
          internalCostCents: { type: 'number' },
          markupPercent: { type: 'number' },
          category: { type: 'string' },
          reply: { type: 'string' },
        },
        required: ['reference'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_estimate',
      description: 'Edit an estimate\'s title, markup %, or customer — runs immediately. (Do NOT use this to change status; use set_estimate_status.)',
      parameters: {
        type: 'object',
        properties: {
          estimate: { type: 'string', description: 'Estimate number or id.' },
          title: { type: 'string' },
          markupPercent: { type: 'number' },
          customerName: { type: 'string' },
          reply: { type: 'string' },
        },
        required: ['estimate'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_estimate_line',
      description:
        'Edit ONE existing line on an estimate — its quantity, rate (unitCostCents), description, kind, or markup-exempt flag — then the estimate total recalculates automatically. Runs immediately. Target the line by its number as shown on the estimate (1-based, first line = 1) or by "match" text from its description. Set markupExempt=true for a line whose price is a FINAL price that must NOT be marked up again (sq-ft, vehicle wraps, or an install quoted at a flat final price) and put the final PER-UNIT price in unitCostCents. Use this — not a $0 "correction" line — to fix a line.',
      parameters: {
        type: 'object',
        properties: {
          estimate: { type: 'string', description: 'Estimate number or id (e.g. EST-000037).' },
          lineNumber: { type: 'number', description: 'Which line, 1-based as shown on the estimate (first line = 1).' },
          match: { type: 'string', description: 'Alternative to lineNumber: text from the line description to find it (must match exactly one line).' },
          description: { type: 'string', description: 'New description for the line.' },
          kind: { type: 'string', enum: ['MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC'] },
          qty: { type: 'number', description: 'New quantity.' },
          unitCostCents: { type: 'number', description: 'New unit cost/rate in cents. For a markup-exempt line this is the FINAL per-unit price.' },
          markupExempt: { type: 'boolean', description: 'True = final price, never marked up again (R-EST-05).' },
          reply: { type: 'string', description: 'Your one-line confirmation to the operator. The turn ends with it.' },
        },
        required: ['estimate'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_estimate_line',
      description:
        'Remove ONE line from an estimate (by lineNumber as shown, or by "match" text from its description); the remaining lines renumber and the estimate total recalculates automatically. Runs immediately and is reversible (re-add the line). This is a line edit, NOT a record deletion — do not use delete_record to remove a single line.',
      parameters: {
        type: 'object',
        properties: {
          estimate: { type: 'string', description: 'Estimate number or id (e.g. EST-000037).' },
          lineNumber: { type: 'number', description: 'Which line to remove, 1-based as shown (first line = 1).' },
          match: { type: 'string', description: 'Alternative to lineNumber: text from the line description (must match exactly one line).' },
          reply: { type: 'string', description: 'Your one-line confirmation to the operator. The turn ends with it.' },
        },
        required: ['estimate'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_estimate_status',
      description: 'Change an estimate\'s status (APPROVED, SENT, REJECTED, DRAFT). This is a meaningful action, so it does NOT run immediately — the operator approves it with one tap.',
      parameters: {
        type: 'object',
        properties: {
          estimate: { type: 'string', description: 'Estimate number or id.' },
          status: { type: 'string', enum: ['DRAFT', 'SENT', 'APPROVED', 'REJECTED'] },
        },
        required: ['estimate', 'status'],
      },
    },
  },
] as const;

async function runTool(
  name: string,
  args: Record<string, unknown>,
  me: { id: string; tenantId: string }
): Promise<unknown> {
  const snapshot = await getSheetSnapshot(me.tenantId);
  const data = snapshot.data;

  if (name === 'search_materials') {
    const overrides = await loadOverrides(me.tenantId);
    return fuzzySearch(String(args.query ?? ''), data.materials, (m) => `${m.name} ${m.category}`, {
      limit: 6,
    }).map((m) => {
      const active = activeMaterialPrice(overrides, m.key, m.priceCents);
      return { name: m.name, category: m.category, priceCents: active.priceCents, price: formatMoney(active.priceCents), vendor: m.vendor };
    });
  }

  if (name === 'get_recommendations') {
    const signTypes = Array.from(new Set(data.recommendations.map((r) => r.signType)));
    const wanted = String(args.signType ?? '');
    const match = fuzzySearch(wanted, signTypes, (s) => s, { limit: 1, threshold: 0.4 })[0] ?? null;
    return {
      matchedSignType: match,
      availableSignTypes: signTypes,
      recommendations: match
        ? data.recommendations
            .filter((r) => r.signType === match)
            .map((r) => ({ item: r.preferredItem, keyword: r.materialKeyword, reason: r.reason, priority: r.priority }))
        : [],
      bundles: data.bundles.map((b) => ({ id: b.id, name: b.name, signType: b.signType })),
    };
  }

  if (name === 'get_rates') {
    const rates = await prisma.tenantOperatingRates.findUnique({ where: { tenantId: me.tenantId } });
    return {
      shopLaborCentsPerHour: rates?.shopLaborCentsPerHour ?? 5000,
      designFlatCents: rates?.designFlatCents ?? 15000,
      installPerPersonHourCents: rates?.installPerPersonHourCents ?? 15000,
      defaultMarkupPercent: Math.round((rates?.defaultMarkupPercentMilli ?? 200000) / 1000),
      machines: data.machines.map((m) => ({ name: m.name, ratePerHourCents: m.ratePerHourCents })),
      sqftRatesFinalPrices: data.sqftRates.map((r) => ({ id: r.id, name: r.name, pricePerSqFtCents: r.pricePerSqFtCents, wastePercent: r.wastePercent })),
    };
  }

  if (name === 'search_vehicle_wraps') {
    return fuzzySearch(String(args.query ?? ''), data.vehicleWraps, (w) => `${w.name} ${w.coverage}`, { limit: 10 }).map(
      (w) => ({ name: w.name, coverage: w.coverage, sqFt: w.billableAreaSqFt, finalPriceCents: w.priceCents, price: formatMoney(w.priceCents) })
    );
  }

  if (name === 'business_snapshot') {
    const [estByStatus, poByStatus, recentEst, recentPos, topClients] = await Promise.all([
      prisma.estimate.groupBy({ by: ['status'], where: { tenantId: me.tenantId, deletedAt: null }, _count: true, _sum: { finalPriceCents: true } }),
      prisma.purchaseOrder.groupBy({ by: ['status'], where: { tenantId: me.tenantId, deletedAt: null }, _count: true, _sum: { subtotalCents: true } }),
      prisma.estimate.findMany({ where: { tenantId: me.tenantId, deletedAt: null }, orderBy: { updatedAt: 'desc' }, take: 8, select: { number: true, title: true, status: true, finalPriceCents: true, client: { select: { companyName: true } } } }),
      prisma.purchaseOrder.findMany({ where: { tenantId: me.tenantId, deletedAt: null }, orderBy: { updatedAt: 'desc' }, take: 8, select: { number: true, status: true, subtotalCents: true, vendor: { select: { name: true } } } }),
      prisma.estimate.groupBy({ by: ['clientId'], where: { tenantId: me.tenantId, deletedAt: null }, _count: true, _sum: { finalPriceCents: true }, orderBy: { _sum: { finalPriceCents: 'desc' } }, take: 5 }),
    ]);
    const clientRows = await prisma.client.findMany({
      where: { id: { in: topClients.map((c) => c.clientId) } },
      select: { id: true, companyName: true },
    });
    const clientName = new Map(clientRows.map((c) => [c.id, c.companyName]));
    return {
      estimatesByStatus: estByStatus.map((r) => ({ status: r.status, count: r._count, sellCents: r._sum.finalPriceCents ?? 0 })),
      posByStatus: poByStatus.map((r) => ({ status: r.status, count: r._count, spendCents: r._sum.subtotalCents ?? 0 })),
      recentEstimates: recentEst,
      recentPurchaseOrders: recentPos,
      topCustomers: topClients.map((c) => ({ customer: clientName.get(c.clientId) ?? c.clientId, estimates: c._count, sellCents: c._sum.finalPriceCents ?? 0 })),
    };
  }

  if (name === 'propose_estimate_lines') {
    const rawLines = Array.isArray(args.lines) ? (args.lines as Array<Record<string, unknown>>) : [];
    if (rawLines.length === 0 || rawLines.length > 50) {
      return { error: '1–50 proposed lines are required.' };
    }
    const lines = rawLines.map((l) => ({
      kind: (['MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC'].includes(String(l.kind)) ? String(l.kind) : 'MATERIAL') as
        | 'MATERIAL' | 'MACHINE' | 'LABOR' | 'DESIGN' | 'INSTALL' | 'MISC',
      description: String(l.description ?? '').slice(0, 400),
      qty: Math.max(0.001, Number(l.qty) || 1),
      unitCostCents: Math.max(0, Math.round(Number(l.unitCostCents) || 0)),
      markupExempt: Boolean(l.markupExempt),
    }));
    return {
      ok: true,
      proposedCount: lines.length,
      note: String(args.note ?? '').slice(0, 300),
      lines,
      delivered:
        'The lines are now on the operator’s screen with a one-click "Add" button. Nothing is added or saved until they click it.',
    };
  }

  if (name === 'prefill_estimate') {
    const rawLines = Array.isArray(args.lines) ? (args.lines as Array<Record<string, unknown>>) : [];
    const title = String(args.title ?? '').trim().slice(0, 200);
    if (!title || rawLines.length === 0 || rawLines.length > 100) {
      return { error: 'title and 1–100 lines are required.' };
    }
    const lines = rawLines.map((l) => ({
      kind: (['MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC'].includes(String(l.kind)) ? String(l.kind) : 'MATERIAL') as
        | 'MATERIAL' | 'MACHINE' | 'LABOR' | 'DESIGN' | 'INSTALL' | 'MISC',
      description: String(l.description ?? '').slice(0, 400),
      qty: Math.max(0.001, Number(l.qty) || 1),
      unitCostCents: Math.max(0, Math.round(Number(l.unitCostCents) || 0)),
      markupExempt: Boolean(l.markupExempt),
    }));
    return {
      ok: true,
      title,
      customerName: String(args.customerName ?? '').trim().slice(0, 200) || null,
      markupPercent: args.markupPercent != null ? Math.max(0, Number(args.markupPercent) || 200) : null,
      note: String(args.note ?? '').slice(0, 300),
      lines,
      delivered:
        'The Create-estimate page is opening on the operator’s screen with everything filled in. They will review and save it — do NOT also create a draft.',
    };
  }

  if (name === 'save_memory') {
    const lesson = String(args.lesson ?? '').trim().slice(0, 600);
    if (lesson.length < 8) return { error: 'Lesson too short to be useful.' };
    await prisma.assistantMemory.create({
      data: {
        tenantId: me.tenantId,
        content: lesson,
        category: String(args.category ?? '').trim().slice(0, 60) || null,
      },
    });
    // Cap the memory bank — drop the oldest lessons beyond 300.
    const extras = await prisma.assistantMemory.findMany({
      where: { tenantId: me.tenantId },
      orderBy: { createdAt: 'desc' },
      skip: 300,
      select: { id: true },
    });
    if (extras.length > 0) {
      await prisma.assistantMemory.deleteMany({ where: { id: { in: extras.map((e) => e.id) } } });
    }
    return { ok: true, saved: lesson };
  }

  if (name === 'create_estimate_draft') {
    const title = String(args.title ?? '').trim().slice(0, 200);
    const customerName = String(args.customerName ?? '').trim().slice(0, 200);
    const markupPercent = Math.max(0, Number(args.markupPercent ?? 200) || 200);
    const rawLines = Array.isArray(args.lines) ? (args.lines as Array<Record<string, unknown>>) : [];
    if (!title || !customerName || rawLines.length === 0 || rawLines.length > 100) {
      return { error: 'title, customerName, and 1–100 lines are required.' };
    }
    const lines = rawLines.map((l) => ({
      kind: (['MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC'].includes(String(l.kind)) ? String(l.kind) : 'MATERIAL') as LineKind,
      description: String(l.description ?? '').slice(0, 400),
      qtyMilli: Math.max(1, Math.round((Number(l.qty) || 1) * 1000)),
      unitCostCents: Math.max(0, Math.round(Number(l.unitCostCents) || 0)),
      markupExempt: Boolean(l.markupExempt),
      materialName: String(l.materialName ?? '').trim().slice(0, 400),
    }));

    // Link MATERIAL lines to the shop catalog so the estimate workspace
    // shows vendor + cheapest pricing for them, exactly like hand-picked
    // lines. Exact Sheet name (from the model's own search_materials
    // results) wins; a conservative fuzzy match on the description is the
    // fallback. Unmatched lines simply stay unlinked.
    const lineSheetKeys = lines.map((l) => {
      if (l.kind !== 'MATERIAL') return null;
      if (l.materialName) {
        const exactKey = sheetItemKey(l.materialName);
        if (data.materials.some((m) => m.key === exactKey)) return exactKey;
      }
      const best = fuzzySearch(l.materialName || l.description, data.materials, (m) => m.name, {
        limit: 1,
        threshold: 0.55,
      })[0];
      return best?.key ?? null;
    });
    const wantedKeys = Array.from(new Set(lineSheetKeys.filter((k): k is string => k != null)));
    const catalogRows =
      wantedKeys.length > 0
        ? await prisma.shopMaterialItem.findMany({
            where: { tenantId: me.tenantId, sheetKey: { in: wantedKeys }, isActive: true },
            select: { id: true, sheetKey: true },
          })
        : [];
    const catalogIdBySheetKey = new Map(
      catalogRows.filter((r) => r.sheetKey).map((r) => [r.sheetKey!, r.id])
    );

    let client = await prisma.client.findFirst({
      where: { tenantId: me.tenantId, companyName: { equals: customerName, mode: 'insensitive' }, deletedAt: null },
      select: { id: true },
    });
    if (!client) {
      client = await prisma.client.create({ data: { tenantId: me.tenantId, companyName: customerName }, select: { id: true } });
    }

    const multiplierMilli = Math.round((1 + markupPercent / 100) * 1000);
    const computed = computeEstimate({
      multiplierMilli,
      designFlatCents: 0,
      lines: lines.map((l, i) => ({ id: `l${i}`, ...l })),
    });

    const estimate = await prisma.$transaction(async (tx) => {
      const number = await nextEstimateNumber(tx, me.tenantId);
      const created = await tx.estimate.create({
        data: {
          tenantId: me.tenantId,
          clientId: client!.id,
          number,
          title,
          estimateType: 'CUSTOM',
          multiplierMilli,
          designFlatCents: 0,
          subtotalCostCents: computed.subtotalCostCents,
          finalPriceCents: computed.finalPriceCents,
          createdById: me.id,
          salesRepId: me.id,
        },
        select: { id: true, number: true },
      });
      await tx.estimateLineItem.createMany({
        data: lines.map((l, i) => ({
          tenantId: me.tenantId,
          estimateId: created.id,
          sortOrder: i,
          kind: l.kind,
          description: l.description,
          qtyMilli: l.qtyMilli,
          unitCostCents: l.unitCostCents,
          computedCostCents: computed.lineCosts[`l${i}`] ?? 0,
          markupExempt: l.markupExempt,
          sourceKind: 'CUSTOM',
          catalogItemId: lineSheetKeys[i] ? (catalogIdBySheetKey.get(lineSheetKeys[i]!) ?? null) : null,
        })),
      });
      return created;
    });

    await writeAuditLog({
      action: 'estimate_created',
      userId: me.id,
      tenantId: me.tenantId,
      targetType: 'estimate',
      targetId: estimate.id,
      metadata: { number: estimate.number, via: 'ai_assistant', title, lineCount: lines.length },
    });

    return {
      ok: true,
      estimateId: estimate.id,
      number: estimate.number,
      url: `/estimates/${estimate.id}`,
      totalSell: formatMoney(computed.finalPriceCents),
      status: 'DRAFT — nothing sent; operator review required',
    };
  }

  if (name === 'create_catalog_item') {
    return createCatalogItem(me, args);
  }

  if (name === 'add_estimate_line') {
    return addEstimateLine(me, args);
  }
  if (name === 'update_estimate_line') return updateEstimateLine(me, args);
  if (name === 'remove_estimate_line') return removeEstimateLine(me, args);

  if (name === 'create_customer') return createCustomer(me, args);
  if (name === 'create_vendor') return createVendor(me, args);
  if (name === 'create_purchase_order') return createPurchaseOrder(me, args);
  if (name === 'get_purchase_order') return getPurchaseOrder(me, args);
  if (name === 'get_estimate') return getEstimate(me, args);
  if (name === 'update_customer') return updateCustomer(me, args);
  if (name === 'update_vendor') return updateVendor(me, args);
  if (name === 'update_catalog_item') return updateCatalogItem(me, args);
  if (name === 'update_estimate') return updateEstimate(me, args);
  if (name === 'update_purchase_order') return updatePurchaseOrder(me, args);
  if (name === 'add_purchase_order_line') return addPurchaseOrderLine(me, args);

  if (name === 'delete_record') {
    const entity = String(args.entity ?? '') as RecyclableEntity;
    const reference = String(args.reference ?? '');
    const prepared = await prepareDelete(me, entity, reference);
    if ('error' in prepared) return prepared;
    // Signal to the loop that this needs the operator's approval — it is
    // NOT executed here.
    return { __pendingAction: prepared };
  }

  if (name === 'set_estimate_status') {
    const reference = String(args.estimate ?? args.reference ?? '');
    const status = String(args.status ?? '') as 'DRAFT' | 'SENT' | 'APPROVED' | 'REJECTED';
    const prepared = await prepareStatusChange(me, reference, status);
    if ('error' in prepared) return prepared;
    return { __pendingAction: prepared };
  }

  if (name === 'set_purchase_order_status') {
    const reference = String(args.purchaseOrder ?? args.reference ?? '');
    const status = String(args.status ?? '');
    const prepared = await preparePoStatusChange(me, reference, status);
    if ('error' in prepared) return prepared;
    return { __pendingAction: prepared };
  }

  return { error: `Unknown tool ${name}` };
}

function extractPendingAction(result: unknown): PendingAction | null {
  if (result && typeof result === 'object' && '__pendingAction' in result) {
    return (result as { __pendingAction: PendingAction }).__pendingAction;
  }
  return null;
}

/* --------------------------- agent loop --------------------------- */

export interface ProposedAssistantLine {
  kind: 'MATERIAL' | 'MACHINE' | 'LABOR' | 'DESIGN' | 'INSTALL' | 'MISC';
  description: string;
  qty: number;
  unitCostCents: number;
  markupExempt: boolean;
}

export interface EstimatePrefillPayload {
  title: string;
  customerName: string | null;
  markupPercent: number | null;
  note: string | null;
  lines: ProposedAssistantLine[];
}

/// Live progress events emitted while the agent works — streamed to the
/// client so the operator sees what is happening (and so nginx never
/// times out waiting for the first byte).
export type AssistantProgressEvent =
  | { type: 'round'; round: number }
  | { type: 'tool'; tool: string; summary: string };

export interface AssistantTurn {
  reply: string;
  toolEvents: Array<{ tool: string; summary: string }>;
  createdEstimate?: { id: string; number: string } | null;
  /// A PO the agent just created (create_purchase_order) — the frontend
  /// navigates straight to it, mirroring createdEstimate.
  createdPurchaseOrder?: { id: string; number: string } | null;
  /// An estimate/PO the agent found via get_estimate / get_purchase_order
  /// (a pure lookup, not a create) — the frontend opens it right away.
  openedEstimate?: { id: string; number: string } | null;
  openedPurchaseOrder?: { id: string; number: string } | null;
  /// Lines the agent proposed for the estimate open on the operator's
  /// screen — rendered client-side with a one-click Add button.
  proposedLines?: ProposedAssistantLine[] | null;
  proposalNote?: string | null;
  /// Complete estimate to prefill into the Create-estimate page —
  /// applied client-side; the operator reviews and saves.
  prefill?: EstimatePrefillPayload | null;
  /// Irreversible actions (deletes) the agent wants to run — each shown as
  /// a one-tap Approve card. Nothing happens until the operator approves.
  pendingActions?: PendingAction[] | null;
}

export async function runAssistant(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  me: { id: string; tenantId: string },
  pageContext?: string | null,
  onEvent?: (e: AssistantProgressEvent) => void
): Promise<AssistantTurn> {
  const { apiKey, model } = await loadAssistantConfig(me.tenantId);
  if (!apiKey) {
    return { reply: 'The assistant is not configured yet — add your OpenAI API key in Assistant settings.', toolEvents: [] };
  }

  // Permanent memory: lessons this shop taught the assistant.
  const memories = await prisma.assistantMemory.findMany({
    where: { tenantId: me.tenantId },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: { content: true, category: true },
  });

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(memories.length > 0
      ? [{
          role: 'system',
          content:
            'MEMORY — lessons learned in this shop (apply them, they override generic guesses):\n' +
            memories.map((m) => `- ${m.category ? `[${m.category}] ` : ''}${m.content}`).join('\n'),
        }]
      : []),
    ...(pageContext && pageContext.trim()
      ? [{ role: 'system', content: `CURRENT SCREEN (live, auto-captured — the operator sees this page right now):\n${pageContext.trim().slice(0, 4000)}` }]
      : []),
    ...history.slice(-16),
  ];
  const toolEvents: AssistantTurn['toolEvents'] = [];
  let createdEstimate: AssistantTurn['createdEstimate'] = null;
  let createdPurchaseOrder: AssistantTurn['createdPurchaseOrder'] = null;
  let openedEstimate: AssistantTurn['openedEstimate'] = null;
  let openedPurchaseOrder: AssistantTurn['openedPurchaseOrder'] = null;
  const proposedLines: ProposedAssistantLine[] = [];
  let proposalNote: string | null = null;
  let prefill: EstimatePrefillPayload | null = null;
  const pendingActions: PendingAction[] = [];

  const MAX_ROUNDS = 16;
  const startedAt = Date.now();
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    // On the last round — or when the time budget is spent — force a
    // final answer from what was gathered instead of failing with
    // "too many tool steps" or dying in a proxy timeout.
    const lastRound = round === MAX_ROUNDS - 1 || Date.now() - startedAt > TOTAL_BUDGET_MS;
    onEvent?.({ type: 'round', round: round + 1 });
    const apiCall = await callOpenAI(
      apiKey,
      JSON.stringify({
        model,
        messages,
        tools: TOOL_DEFS,
        tool_choice: lastRound ? 'none' : 'auto',
        // Reasoning models: keep private chain-of-thought at the floor.
        // Estimate building is structured tool work — long thinking only
        // adds latency. Original gpt-5 family (gpt-5, gpt-5-mini, gpt-5-nano)
        // supports 'minimal'; the gpt-5.x line (5.5, 5.6 Sol/Terra/Luna, ...)
        // dropped 'minimal' — 'none' is its floor instead. o-series' floor
        // is 'low'.
        ...(model.startsWith('gpt-5.')
          ? { reasoning_effort: 'none' }
          : model.startsWith('gpt-5')
            ? { reasoning_effort: 'minimal' }
            : /^o\d/.test(model)
              ? { reasoning_effort: 'low' }
              : {}),
      })
    );
    if (!apiCall.ok) {
      console.error('[assistant] OpenAI call failed after retries:', apiCall.error);
      return {
        reply: `The AI service didn't respond after several tries (${apiCall.error}). Please send that again in a moment.`,
        toolEvents, createdEstimate, createdPurchaseOrder, openedEstimate, openedPurchaseOrder, proposedLines, proposalNote, prefill,
      };
    }
    const msg = apiCall.json.choices[0]?.message;
    if (!msg) return { reply: 'No response from the model.', toolEvents, createdEstimate, createdPurchaseOrder, openedEstimate, openedPurchaseOrder, proposedLines, proposalNote, prefill, pendingActions };

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
      // When the model hands us its operator summary together with the
      // draft/prefill call, the turn can end right here — skipping the
      // final wrap-up round saves 15–40s per estimate.
      let finalSummary: string | null = null;
      let didImmediateAction = false;
      for (const call of msg.tool_calls) {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(call.function.arguments || '{}');
        } catch {
          /* keep empty */
        }
        let result: unknown;
        try {
          result = await runTool(call.function.name, parsed, me);
        } catch (e) {
          result = { error: e instanceof Error ? e.message : 'tool failed' };
        }
        // Delete requests come back as a PendingAction — collect it for the
        // operator's approval and let the model tell them what it wants to
        // delete (the tool result reflects that it's awaiting approval).
        const pending = extractPendingAction(result);
        if (pending) {
          pendingActions.push(pending);
          result = { awaitingApproval: true, action: pending.label, note: 'Shown to the operator for one-tap approval; nothing changed yet.' };
        }
        // Immediate action tools (create/edit) carry an optional `reply`.
        // When present and the action succeeded, end the turn in this same
        // round — no wrap-up call — so simple actions finish in ~2s.
        const IMMEDIATE_ACTION_TOOLS = new Set([
          'create_catalog_item', 'add_estimate_line', 'update_estimate_line', 'remove_estimate_line', 'create_customer', 'create_vendor',
          'create_purchase_order', 'add_purchase_order_line',
          'update_customer', 'update_vendor', 'update_catalog_item', 'update_estimate', 'update_purchase_order',
        ]);
        if (
          IMMEDIATE_ACTION_TOOLS.has(call.function.name) &&
          result && typeof result === 'object' && 'ok' in result
        ) {
          didImmediateAction = true;
          const s = String(parsed.reply ?? '').trim();
          if (s) finalSummary = s;
        }
        if (
          call.function.name === 'create_estimate_draft' &&
          result &&
          typeof result === 'object' &&
          'estimateId' in result
        ) {
          const r = result as { estimateId: string; number: string };
          createdEstimate = { id: r.estimateId, number: r.number };
          const s = String(parsed.summaryForOperator ?? '').trim();
          if (s) finalSummary = s;
        }
        if (
          call.function.name === 'create_purchase_order' &&
          result &&
          typeof result === 'object' &&
          'purchaseOrderId' in result
        ) {
          const r = result as { purchaseOrderId: string; number: string };
          createdPurchaseOrder = { id: r.purchaseOrderId, number: r.number };
        }
        // Pure lookups (get_purchase_order / get_estimate) — the model
        // hasn't seen the record yet when it makes this call, so it can't
        // pre-supply a reply; capture the id/number here for the frontend
        // to open regardless, and let the wrap-up round describe it.
        if (
          call.function.name === 'get_purchase_order' &&
          result &&
          typeof result === 'object' &&
          'purchaseOrderId' in result
        ) {
          const r = result as { purchaseOrderId: string; number: string };
          openedPurchaseOrder = { id: r.purchaseOrderId, number: r.number };
        }
        if (
          call.function.name === 'get_estimate' &&
          result &&
          typeof result === 'object' &&
          'estimateId' in result
        ) {
          const r = result as { estimateId: string; number: string };
          openedEstimate = { id: r.estimateId, number: r.number };
        }
        // Line edits/removes return the estimate id/number — open it on the
        // operator's screen so they see the recalculated total right away.
        if (
          (call.function.name === 'update_estimate_line' || call.function.name === 'remove_estimate_line') &&
          result &&
          typeof result === 'object' &&
          'estimateId' in result
        ) {
          const r = result as { estimateId: string; number: string };
          openedEstimate = { id: r.estimateId, number: r.number };
        }
        if (
          call.function.name === 'propose_estimate_lines' &&
          result &&
          typeof result === 'object' &&
          'lines' in result
        ) {
          const r = result as { lines: ProposedAssistantLine[]; note?: string };
          proposedLines.push(...r.lines);
          if (r.note) proposalNote = r.note;
        }
        if (
          call.function.name === 'prefill_estimate' &&
          result &&
          typeof result === 'object' &&
          'lines' in result &&
          'title' in result
        ) {
          const r = result as { title: string; customerName: string | null; markupPercent: number | null; note: string | null; lines: ProposedAssistantLine[] };
          prefill = { title: r.title, customerName: r.customerName, markupPercent: r.markupPercent, note: r.note, lines: r.lines };
          const s = String(parsed.summaryForOperator ?? '').trim();
          if (s) finalSummary = s;
        }
        toolEvents.push({ tool: call.function.name, summary: JSON.stringify(parsed).slice(0, 160) });
        onEvent?.({ type: 'tool', tool: call.function.name, summary: JSON.stringify(parsed).slice(0, 160) });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 12000) });
      }
      if (finalSummary && (createdEstimate || prefill || didImmediateAction)) {
        return { reply: finalSummary, toolEvents, createdEstimate, createdPurchaseOrder, openedEstimate, openedPurchaseOrder, proposedLines, proposalNote, prefill, pendingActions };
      }
      continue;
    }

    return { reply: msg.content ?? '(empty reply)', toolEvents, createdEstimate, createdPurchaseOrder, openedEstimate, openedPurchaseOrder, proposedLines, proposalNote, prefill, pendingActions };
  }
  return { reply: 'I could not finish that one — please try again.', toolEvents, createdEstimate, createdPurchaseOrder, openedEstimate, openedPurchaseOrder, proposedLines, proposalNote, prefill, pendingActions };
}

/* ------------------------- voice transcription ------------------------- */

/// Transcribe a recorded voice note with OpenAI (same stored key).
/// Audio never persists anywhere — it is forwarded and discarded.
export async function transcribeVoiceNote(
  tenantId: string,
  audio: Blob,
  fileName: string
): Promise<{ text: string } | { error: string }> {
  const { apiKey } = await loadAssistantConfig(tenantId);
  if (!apiKey) return { error: 'Assistant not configured — add your OpenAI API key in Assistant settings.' };

  const form = new FormData();
  form.append('file', audio, fileName);
  form.append('model', 'whisper-1');
  form.append('response_format', 'json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 200);
    return { error: `Transcription failed (${res.status}): ${text}` };
  }
  const json = (await res.json()) as { text?: string };
  return { text: (json.text ?? '').trim() };
}
