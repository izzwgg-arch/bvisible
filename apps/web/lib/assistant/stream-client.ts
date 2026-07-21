'use client';

// Client for /api/assistant. Requests the NDJSON stream (heartbeats +
// live progress + final turn) so long agent runs survive the proxy and
// the operator sees what's happening. Falls back transparently to the
// buffered JSON response if the server ever answers with plain JSON.

import type { EstimatePrefill, ProposedLine } from './context-store';

/// A delete the assistant wants to run, awaiting the operator's one-tap
/// approval. Mirrors PendingAction on the server.
export interface AssistantPendingAction {
  token: string;
  kind: 'delete' | 'set_estimate_status' | 'set_po_status';
  entity?: string;
  recordId: string;
  targetStatus?: string;
  label: string;
  detail: string;
  question: string;
  confirmLabel: string;
}

export interface AssistantTurnPayload {
  reply?: string;
  toolEvents?: Array<{ tool: string; summary: string }>;
  createdEstimate?: { id: string; number: string } | null;
  /// A PO the agent just created — mirrors createdEstimate.
  createdPurchaseOrder?: { id: string; number: string } | null;
  /// An estimate/PO the agent found via a lookup (get_estimate /
  /// get_purchase_order), not a create — open it just the same.
  openedEstimate?: { id: string; number: string } | null;
  openedPurchaseOrder?: { id: string; number: string } | null;
  proposedLines?: ProposedLine[] | null;
  proposalNote?: string | null;
  prefill?: EstimatePrefill | null;
  pendingActions?: AssistantPendingAction[] | null;
  error?: string;
}

/// Execute an approved action via the confirm endpoint.
export async function confirmAssistantAction(
  action: AssistantPendingAction,
): Promise<{ ok: true; label: string } | { error: string }> {
  try {
    const res = await fetch('/api/assistant/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = (await res.json()) as { ok?: boolean; label?: string; error?: string };
    if (data.error) return { error: data.error };
    return { ok: true, label: data.label ?? action.label };
  } catch {
    return { error: 'Could not reach the server — try again.' };
  }
}

const TOOL_LABELS_EXTRA: Record<string, string> = {
  create_catalog_item: 'Creating the catalog item…',
  add_estimate_line: 'Adding the line to the estimate…',
  update_estimate_line: 'Updating the estimate line…',
  remove_estimate_line: 'Removing the estimate line…',
  delete_record: 'Preparing the delete for your approval…',
  get_purchase_order: 'Looking up the purchase order…',
  get_estimate: 'Looking up the estimate…',
  update_purchase_order: 'Updating the purchase order…',
  add_purchase_order_line: 'Adding the line to the purchase order…',
  set_purchase_order_status: 'Preparing the status change for your approval…',
};

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
  ...TOOL_LABELS_EXTRA,
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
