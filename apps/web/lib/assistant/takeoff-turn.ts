// Assistant turn for a message that carries a parsed Excel takeoff.
//
// This deliberately bypasses the multi-round agent loop: the line items
// are already parsed and priced by the workbook, so the model's ONLY
// jobs are picking the tab, naming the customer, and titling the job —
// one small OpenAI call with a forced tool. Everything else (line
// mapping, bundles, totals, the reply text) is deterministic, so a
// 134-line takeoff imports verbatim with zero transcription risk and
// near-zero token cost.

import { randomUUID } from 'node:crypto';
import { prisma } from '@bvisible/db';
import { computeEstimate, formatMoney } from '@bvisible/pricing';
import { nextEstimateNumber } from '@/lib/estimate/number';
import { assignBundleGroupIds } from '@/lib/estimate/line-groups';
import { writeAuditLog } from '@/lib/auth/audit';
import {
  describeTakeoffForModel,
  selectTakeoffTab,
  takeoffTabToEstimateRows,
  takeoffTabTotalCents,
  MAX_TAKEOFF_LINES,
  type AttachedTakeoff,
} from '@/lib/estimate-import/attached-takeoff';
import {
  loadAssistantConfig,
  type AssistantProgressEvent,
  type AssistantTurn,
} from '@/lib/assistant/agent';

/// Minimal actor — the takeoff path needs no role/permissions beyond a
/// signed-in tenant user (it only ever creates a draft estimate).
interface TakeoffActor {
  id: string;
  tenantId: string;
}

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const CALL_TIMEOUT_MS = 45_000;

const PLAN_TOOL = {
  type: 'function',
  function: {
    name: 'plan_takeoff_import',
    description:
      'Decide how to import the attached Excel takeoff as an estimate. The system imports the parsed rows verbatim — you never list line items.',
    parameters: {
      type: 'object',
      properties: {
        tab: {
          type: 'string',
          description:
            'Sheet/tab name to import, when the operator asked for a specific one. Omit to use the most detailed tab.',
        },
        customerName: {
          type: 'string',
          description:
            'Customer/company this estimate is for, from the operator message or conversation. OMIT ENTIRELY if the operator never named one — do not invent or guess.',
        },
        title: {
          type: 'string',
          description: 'Job name. Prefer the operator\'s words; fall back to the sheet title.',
        },
        markupPercent: {
          type: 'number',
          description: 'Only if the operator stated a markup. Default is 200.',
        },
        priceBasis: {
          type: 'string',
          enum: ['sell', 'cost'],
          description:
            'ONLY if the operator explicitly said what the sheet\'s numbers are: "sell" = final selling prices, import as-is; "cost" = costs, markup applies. Omit otherwise — the detected column semantics are used.',
        },
      },
      required: [],
    },
  },
} as const;

const PLAN_SYSTEM_PROMPT = `You are the B Visible business assistant. The operator attached an Excel takeoff, already parsed by the system. Call plan_takeoff_import exactly once with the import decisions. Rules:
- customerName: only what the operator actually named (message or conversation). Never invent one; omit the field if unknown.
- tab: only when the operator asked for a specific tab.
- title: operator's words if any, else omit (the sheet title is used).
- Say nothing else — the tool call is your whole answer.`;

interface PlanArgs {
  tab?: string;
  customerName?: string;
  title?: string;
  markupPercent?: number;
  priceBasis?: 'sell' | 'cost';
}

/// One forced-tool OpenAI call. Returns null args on total failure so
/// the caller can fall back to deterministic defaults (and ask for the
/// customer instead of dying).
async function planImport(
  apiKey: string,
  model: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  takeoff: AttachedTakeoff
): Promise<PlanArgs | null> {
  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: PLAN_SYSTEM_PROMPT },
          { role: 'system', content: describeTakeoffForModel(takeoff) },
          ...history.slice(-8),
        ],
        tools: [PLAN_TOOL],
        tool_choice: { type: 'function', function: { name: 'plan_takeoff_import' } },
        ...(model.startsWith('gpt-5.')
          ? { reasoning_effort: 'none' }
          : model.startsWith('gpt-5')
            ? { reasoning_effort: 'minimal' }
            : /^o\d/.test(model)
              ? { reasoning_effort: 'low' }
              : {}),
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function: { arguments: string } }> } }>;
    };
    const raw = json.choices?.[0]?.message?.tool_calls?.[0]?.function.arguments;
    if (!raw) return null;
    return JSON.parse(raw) as PlanArgs;
  } catch {
    return null;
  }
}

/// Handle a chat turn that carries an attached takeoff: plan with one
/// model call, then create the DRAFT estimate deterministically. The
/// reply and totals come from the parsed data, never from the model.
export async function runTakeoffTurn(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  me: TakeoffActor,
  takeoff: AttachedTakeoff,
  onEvent?: (e: AssistantProgressEvent) => void
): Promise<AssistantTurn> {
  const { apiKey, model } = await loadAssistantConfig(me.tenantId);
  if (!apiKey) {
    return {
      reply: 'The assistant is not configured yet — add your OpenAI API key in Assistant settings.',
      toolEvents: [],
    };
  }

  onEvent?.({ type: 'tool', tool: 'plan_takeoff_import', summary: takeoff.fileName });
  const plan = (await planImport(apiKey, model, history, takeoff)) ?? {};

  const customerName = (plan.customerName ?? '').trim().slice(0, 200);
  if (!customerName) {
    const tabNames = takeoff.tabs.map((t) => `"${t.sheetName}"`).join(', ');
    return {
      reply: `I parsed ${takeoff.fileName} (${tabNames}) and I'm ready to create the estimate — which customer is it for?`,
      toolEvents: [{ tool: 'plan_takeoff_import', summary: 'awaiting customer name' }],
    };
  }

  const tab = selectTakeoffTab(takeoff, plan.tab ?? null);
  const title = (plan.title ?? '').trim().slice(0, 200) || tab.title || takeoff.fileName;
  const markupPercent = Math.max(0, Number(plan.markupPercent ?? 200) || 200);
  // Operator's explicit word beats the detected column semantics.
  const basis: 'sell' | 'cost' =
    plan.priceBasis === 'sell' || plan.priceBasis === 'cost' ? plan.priceBasis : tab.priceBasis;
  const rows = takeoffTabToEstimateRows(tab).map((r) => ({
    ...r,
    markupExempt: basis === 'sell',
  }));

  onEvent?.({ type: 'tool', tool: 'create_estimate_from_takeoff', summary: tab.sheetName });

  // Same persistence shape as the guided import: real bundle ids for
  // section runs, notes preserved, pricing engine recomputes totals.
  let client = await prisma.client.findFirst({
    where: {
      tenantId: me.tenantId,
      companyName: { equals: customerName, mode: 'insensitive' },
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!client) {
    client = await prisma.client.create({
      data: { tenantId: me.tenantId, companyName: customerName },
      select: { id: true },
    });
  }

  const multiplierMilli = Math.round((1 + markupPercent / 100) * 1000);
  const computed = computeEstimate({
    multiplierMilli,
    designFlatCents: 0,
    lines: rows.map((r, i) => ({
      id: `l${i}`,
      kind: r.kind,
      qtyMilli: r.qtyMilli,
      unitCostCents: r.unitCostCents,
      markupExempt: r.markupExempt,
    })),
  });
  const groupIdByKey = assignBundleGroupIds(
    rows.map((r) => r.groupKey),
    randomUUID
  );

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
      data: rows.map((r, i) => ({
        tenantId: me.tenantId,
        estimateId: created.id,
        sortOrder: i,
        kind: r.kind,
        description: r.description,
        qtyMilli: r.qtyMilli,
        unitCostCents: r.unitCostCents,
        computedCostCents: computed.lineCosts[`l${i}`] ?? 0,
        markupExempt: r.markupExempt,
        sourceKind: 'CUSTOM',
        notes: r.notes,
        lineGroupId: r.groupKey ? (groupIdByKey.get(r.groupKey) ?? null) : null,
        lineGroupLabel:
          r.groupKey && groupIdByKey.has(r.groupKey) ? r.groupLabel : null,
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
    metadata: {
      number: estimate.number,
      via: 'ai_assistant_takeoff',
      title,
      fileName: takeoff.fileName,
      tab: tab.sheetName,
      lineCount: rows.length,
    },
  });

  // Deterministic reply from the parsed data — never the model's numbers.
  const sections = new Map<string, number>();
  for (const r of rows) {
    const key = r.groupLabel ?? '(loose lines)';
    sections.set(key, (sections.get(key) ?? 0) + 1);
  }
  const sectionList = [...sections.entries()]
    .slice(0, 12)
    .map(([name, count]) => `• ${name}: ${count} line${count > 1 ? 's' : ''}`)
    .join('\n');
  const basisNote =
    basis === 'sell'
      ? 'Prices imported as final selling prices (never marked up again). Say "import it as costs" if they should be marked up instead.'
      : `Costs imported as costs — the ${markupPercent}% markup applies. Say "those are final prices" if they should import as-is instead.`;
  const truncated = tab.lines.length > MAX_TAKEOFF_LINES
    ? `\n⚠ The tab has ${tab.lines.length} lines — only the first ${MAX_TAKEOFF_LINES} imported (estimate limit).`
    : '';
  const skippedNote = tab.skipped.length > 0 ? `\nSkipped: ${tab.skipped.join(' · ')}` : '';
  const reply = `Imported "${tab.sheetName}" from ${takeoff.fileName} — ${rows.length} lines for ${customerName}:\n${sectionList}\n\nSheet total ${formatMoney(takeoffTabTotalCents(tab))} · estimate total ${formatMoney(computed.finalPriceCents)}. ${basisNote}${truncated}${skippedNote}\n\nDraft ${estimate.number} created — review it in Estimates.`;

  return {
    reply,
    toolEvents: [
      { tool: 'create_estimate_from_takeoff', summary: `${takeoff.fileName} → ${tab.sheetName}` },
    ],
    createdEstimate: { id: estimate.id, number: estimate.number },
  };
}
