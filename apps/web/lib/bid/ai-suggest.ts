// Optional AI assistance for the Bid Estimator: rank standard-sign
// candidates for lines the deterministic ladder could not settle.
//
// Boundaries (spec §5.3 / §13): AI may only PROPOSE — output is a ranked
// list with structured confidence + evidence, stored as a suggestion on the
// line for a human to review. It never sets a match, quantity, size, rate
// or price, and when it is not configured or fails the deterministic
// import continues untouched.
//
// Uses the existing assistant configuration (Assistant settings → OpenAI
// key, model) — no second AI integration.

import { loadAssistantConfig } from '@/lib/assistant/agent';
import type { StandardSignCatalog } from './match-standard-sign';

export interface AiSignSuggestion {
  model: string;
  generatedAt: string;
  ranked: Array<{ signKey: string; name: string; confidence: number; evidence: string }>;
  missingInformation: string[];
  note: string;
}

export type AiSuggestionMap = Record<string, AiSignSuggestion>;

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 40_000;
const MAX_ITEMS = 40;
const MAX_SIGNS = 120;

interface RawResponse {
  items?: Array<{
    key?: string;
    ranked?: Array<{ signKey?: string; confidence?: number; evidence?: string }>;
    missingInformation?: string[];
  }>;
}

/**
 * Returns a suggestion per candidate key, or null when AI is not configured
 * / not needed. Never throws to the caller (import continues without AI).
 */
export async function rankStandardSignSuggestions(
  tenantId: string,
  items: ReadonlyArray<{ key: string; name: string; description: string | null }>,
  catalog: StandardSignCatalog
): Promise<AiSuggestionMap | null> {
  if (items.length === 0) return null;
  const active = catalog.signs.filter((s) => s.active);
  if (active.length === 0) return null;
  const config = await loadAssistantConfig(tenantId);
  if (!config.apiKey) return null;

  const signs = active.slice(0, MAX_SIGNS).map((s) => ({
    signKey: s.signKey,
    name: s.name,
    aliases: s.aliases.slice(0, 6),
    category: s.category,
    size: s.widthMilli && s.heightMilli ? `${s.widthMilli / 1000}x${s.heightMilli / 1000} in` : null,
    material: s.material,
    braille: s.braille,
    illumination: s.illumination,
    pricingMethod: s.pricingMethod,
  }));
  const batch = items.slice(0, MAX_ITEMS).map((i) => ({ key: i.key, name: i.name, description: (i.description ?? '').slice(0, 400) }));

  const body = JSON.stringify({
    model: config.model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You help a sign shop map takeoff line items to its catalog of standard signs. ' +
          'For each item return up to 3 candidate signKeys from the provided catalog ranked by confidence (0-1) with one sentence of evidence each, ' +
          'and list any information that is missing to price it (size, wording, material, illumination, mounting). ' +
          'Only use signKeys from the catalog. Never invent sizes, quantities, materials, or prices. ' +
          'Respond with JSON: {"items":[{"key":string,"ranked":[{"signKey":string,"confidence":number,"evidence":string}],"missingInformation":[string]}]}',
      },
      { role: 'user', content: JSON.stringify({ catalog: signs, items: batch }) },
    ],
  });

  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as RawResponse;
    const byKey = new Map(active.map((s) => [s.signKey, s]));
    const out: AiSuggestionMap = {};
    const now = new Date().toISOString();
    for (const item of parsed.items ?? []) {
      if (!item.key || !batch.some((b) => b.key === item.key)) continue;
      const ranked = (item.ranked ?? [])
        .filter((r) => r.signKey && byKey.has(r.signKey))
        .slice(0, 3)
        .map((r) => ({
          signKey: r.signKey!,
          name: byKey.get(r.signKey!)!.name,
          confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)),
          evidence: String(r.evidence ?? '').slice(0, 300),
        }));
      out[item.key] = {
        model: config.model,
        generatedAt: now,
        ranked,
        missingInformation: (item.missingInformation ?? []).map((m) => String(m).slice(0, 120)).slice(0, 6),
        note: 'AI suggestion — review required; nothing was applied automatically.',
      };
    }
    return out;
  } catch {
    return null;
  }
}
