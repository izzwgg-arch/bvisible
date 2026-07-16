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
- If the operator is building or editing an estimate ON SCREEN and wants lines added or something is missing, call propose_estimate_lines — the lines appear on their screen with a one-click "Add" button. Do NOT create a separate draft with create_estimate_draft in that case.
- Only use create_estimate_draft when there is no estimate open on screen.

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
      name: 'create_estimate_draft',
      description: 'Create a DRAFT estimate. Lines must use real prices from prior tool lookups. sqft/wrap lines: markupExempt=true with the FINAL price. Never used without the operator asking for an estimate.',
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

export interface AssistantTurn {
  reply: string;
  toolEvents: Array<{ tool: string; summary: string }>;
  createdEstimate?: { id: string; number: string } | null;
  /// Lines the agent proposed for the estimate open on the operator's
  /// screen — rendered client-side with a one-click Add button.
  proposedLines?: ProposedAssistantLine[] | null;
  proposalNote?: string | null;
}

export async function runAssistant(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  me: { id: string; tenantId: string },
  pageContext?: string | null
): Promise<AssistantTurn> {
  const { apiKey, model } = await loadAssistantConfig(me.tenantId);
  if (!apiKey) {
    return { reply: 'The assistant is not configured yet — add your OpenAI API key in Assistant settings.', toolEvents: [] };
  }

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(pageContext && pageContext.trim()
      ? [{ role: 'system', content: `CURRENT SCREEN (live, auto-captured — the operator sees this page right now):\n${pageContext.trim().slice(0, 4000)}` }]
      : []),
    ...history.slice(-16),
  ];
  const toolEvents: AssistantTurn['toolEvents'] = [];
  let createdEstimate: AssistantTurn['createdEstimate'] = null;
  const proposedLines: ProposedAssistantLine[] = [];
  let proposalNote: string | null = null;

  for (let round = 0; round < 8; round += 1) {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, tools: TOOL_DEFS, tool_choice: 'auto' }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      return { reply: `OpenAI request failed (${res.status}): ${text}`, toolEvents, createdEstimate, proposedLines, proposalNote };
    }
    const json = (await res.json()) as {
      choices: Array<{ message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
    };
    const msg = json.choices[0]?.message;
    if (!msg) return { reply: 'No response from the model.', toolEvents, createdEstimate, proposedLines, proposalNote };

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
        toolEvents.push({ tool: call.function.name, summary: JSON.stringify(parsed).slice(0, 160) });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 12000) });
      }
      continue;
    }

    return { reply: msg.content ?? '(empty reply)', toolEvents, createdEstimate, proposedLines, proposalNote };
  }
  return { reply: 'Stopped after too many tool steps — try a more specific request.', toolEvents, createdEstimate, proposedLines, proposalNote };
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
