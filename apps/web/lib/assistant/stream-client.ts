'use client';

// Client for /api/assistant. Requests the NDJSON stream (heartbeats +
// live progress + final turn) so long agent runs survive the proxy and
// the operator sees what's happening. Falls back transparently to the
// buffered JSON response if the server ever answers with plain JSON.

import type { EstimatePrefill, ProposedLine } from './context-store';

export interface AssistantTurnPayload {
  reply?: string;
  toolEvents?: Array<{ tool: string; summary: string }>;
  createdEstimate?: { id: string; number: string } | null;
  proposedLines?: ProposedLine[] | null;
  proposalNote?: string | null;
  prefill?: EstimatePrefill | null;
  error?: string;
}

/// Friendly labels for the live progress line under the chat.
const TOOL_LABELS: Record<string, string> = {
  search_materials: 'Checking material prices in the Sheet…',
  get_recommendations: 'Looking up the sign-type recipe…',
  get_rates: 'Getting shop + machine rates…',
  search_vehicle_wraps: 'Checking vehicle wrap prices…',
  business_snapshot: 'Reading your business data…',
  propose_estimate_lines: 'Preparing lines for your screen…',
  prefill_estimate: 'Building the full estimate…',
  save_memory: 'Saving what you taught me…',
  create_estimate_draft: 'Creating the draft estimate…',
};

export async function sendAssistantMessage(
  body: { messages: Array<{ role: string; content: string }>; context?: string },
  onProgress?: (label: string) => void,
  timeoutMs = 480_000
): Promise<AssistantTurnPayload> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('/api/assistant', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const ctype = res.headers.get('content-type') ?? '';
    if (!ctype.includes('x-ndjson') || !res.body) {
      return (await res.json()) as AssistantTurnPayload;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let finalTurn: AssistantTurnPayload | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        nl = buf.indexOf('\n');
        if (!line) continue;
        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (evt.type === 'done') {
          finalTurn = evt as AssistantTurnPayload;
        } else if (evt.type === 'tool') {
          const tool = String(evt.tool ?? '');
          onProgress?.(TOOL_LABELS[tool] ?? `Working — ${tool}…`);
        } else if (evt.type === 'round') {
          const round = Number(evt.round ?? 1);
          onProgress?.(round > 1 ? `Thinking it through — step ${round}…` : 'Thinking…');
        }
        // 'hb' heartbeats keep the connection alive; nothing to show.
      }
    }
    if (!finalTurn) {
      throw new Error('The connection dropped before the answer arrived.');
    }
    return finalTurn;
  } finally {
    clearTimeout(timer);
  }
}
