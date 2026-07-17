// B Visible business assistant — OpenAI tool-calling loop, grounded in
// the live Google Sheet and tenant data. Trained on the shop's rules via
// the system prompt (from the owner's handoff + this system's docs).
//
// Safety: tools are whitelisted. Reads are tenant-scoped. The ONLY write
// is creating DRAFT estimates — the agent can never send, email, approve,
// finalize, or delete anything.

import { prisma } from '@bvisible/db';
import { computeEstimate, formatMoney, type LineKind } from '@bvisible/pricing';
import { fuzzySearch } from '@/lib/sheet-sync/fuzzy';
import { getSheetSnapshot } from '@/lib/sheet-sync/sync';
import { loadOverrides, activeMaterialPrice } from '@/lib/sheet-sync/active-price';
import { nextEstimateNumber } from '@/lib/estimate/number';
import { writeAuditLog } from '@/lib/auth/audit';

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
  const model = row?.model?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-5-mini';
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

WHAT YOU CAN DO:
- Look up materials, bundles, vehicle wraps, sq-ft rates, machines, recommendations (Sheet tools).
- Answer business questions from the database snapshot (estimates, POs, customers — read-only).
- Create DRAFT estimates with create_estimate_draft. Always confirm the built line list and total in your reply, with the estimate number.

SCREEN CONTEXT:
- When a "CURRENT SCREEN" note is present, the operator has that page open right now. Use it — never ask them to re-explain what they are working on.
- If the operator is building or editing an estimate ON SCREEN and wants lines added or something is missing, call propose_estimate_lines — the lines appear on their screen with a one-click "Add" button.

BUILDING FULL ESTIMATES (draft in the estimate workspace — the default):
- When the operator describes a sign or job they want an estimate for — from ANY page — build the complete estimate and call create_estimate_draft. The full estimate workspace opens on their screen with the DRAFT loaded (every line, markup, totals) — the same premium editor they use for all estimates. It is a DRAFT only: nothing is sent or approved; they review, adjust, and take it from there.
- Build the FULL recipe the way the shop would: structure/face/back materials at real Sheet prices with realistic quantities and sheet counts for the dimensions; for lit signs add LED modules (spaced ~1 per 0.35–0.5 sq ft of lit face), power supplies (~1 per 20–30 modules), low-voltage wire by linear feet, silicone/hardware/glue; machine time on the right machines from get_rates (CNC/router for cutting, flatbed or roll printer for prints); shop labor hours; design units; installation as INSTALL lines (hours × installers at the per-person rate). Start from get_recommendations for the sign type, then add what the description requires.
- Printed graphics: include printer machine time, and if ink/consumables aren't in the Sheet add a MISC line with a stated cost assumption.
- End your reply with a short "Assumptions to verify" list (sizes, coverage, counts you estimated).
- Use prefill_estimate only if the operator explicitly asks you to fill in the Create-estimate form without saving anything yet.

EFFICIENCY (critical):
- Batch your lookups: issue MANY tool calls in the SAME response — all search_materials calls at once, alongside get_rates and get_recommendations. NEVER search one material per round.
- Target 3–4 rounds total even for complex signs. If a search misses, move on with your best Sheet match or a stated assumption instead of endless searching.

LEARNING (you have permanent memory):
- A MEMORY section with lessons from this shop may follow. Apply those lessons — they override generic guesses.
- Whenever the operator corrects you, states a preference or shop rule, or you learn something reusable (a recipe, a quantity rule, a preferred material, a pricing practice), call save_memory with a short general lesson (e.g. "Lightbox faces: use Dura-Bond Black 4x8 matt"). Don't save one-off job details, customer PII, or anything sensitive.

WHAT YOU MUST NEVER DO:
- Never send, email, approve, finalize, or delete anything. Drafts only. The operator reviews everything.
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
              },
              required: ['kind', 'description', 'qty', 'unitCostCents'],
            },
          },
        },
        required: ['title', 'customerName', 'lines'],
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
      limit: 10,
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
    }));

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

  return { error: `Unknown tool ${name}` };
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
  /// Lines the agent proposed for the estimate open on the operator's
  /// screen — rendered client-side with a one-click Add button.
  proposedLines?: ProposedAssistantLine[] | null;
  proposalNote?: string | null;
  /// Complete estimate to prefill into the Create-estimate page —
  /// applied client-side; the operator reviews and saves.
  prefill?: EstimatePrefillPayload | null;
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
  const proposedLines: ProposedAssistantLine[] = [];
  let proposalNote: string | null = null;
  let prefill: EstimatePrefillPayload | null = null;

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
      })
    );
    if (!apiCall.ok) {
      console.error('[assistant] OpenAI call failed after retries:', apiCall.error);
      return {
        reply: `The AI service didn't respond after several tries (${apiCall.error}). Please send that again in a moment.`,
        toolEvents, createdEstimate, proposedLines, proposalNote, prefill,
      };
    }
    const msg = apiCall.json.choices[0]?.message;
    if (!msg) return { reply: 'No response from the model.', toolEvents, createdEstimate, proposedLines, proposalNote, prefill };

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
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
        if (
          call.function.name === 'create_estimate_draft' &&
          result &&
          typeof result === 'object' &&
          'estimateId' in result
        ) {
          const r = result as { estimateId: string; number: string };
          createdEstimate = { id: r.estimateId, number: r.number };
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
        }
        toolEvents.push({ tool: call.function.name, summary: JSON.stringify(parsed).slice(0, 160) });
        onEvent?.({ type: 'tool', tool: call.function.name, summary: JSON.stringify(parsed).slice(0, 160) });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 12000) });
      }
      continue;
    }

    return { reply: msg.content ?? '(empty reply)', toolEvents, createdEstimate, proposedLines, proposalNote, prefill };
  }
  return { reply: 'I could not finish that one — please try again.', toolEvents, createdEstimate, proposedLines, proposalNote, prefill };
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
