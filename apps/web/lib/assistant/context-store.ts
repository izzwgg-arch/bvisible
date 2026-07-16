'use client';

// Shared client-side store connecting the pages the operator works on
// with the floating assistant dock. Pages publish a live "what's on my
// screen" summary; the dock feeds it to the agent so the operator never
// has to explain what they're working on. Pages that can accept lines
// (guided builder, estimate editor) also register an applier so the
// agent's proposed lines land in the page with one click — client-side
// only, nothing is saved until the operator saves.
//
// State lives on globalThis: the dock (layout client graph) and the
// pages (page client graphs) can be bundled as separate module
// instances, and a plain module-level variable would silently split
// into two stores.

export interface ProposedLine {
  kind: 'MATERIAL' | 'MACHINE' | 'LABOR' | 'DESIGN' | 'INSTALL' | 'MISC';
  description: string;
  qty: number;
  unitCostCents: number;
  markupExempt: boolean;
}

export interface AssistantPageContext {
  /// Short page label, e.g. 'New estimate (guided flow)'.
  page: string;
  /// Live summary of what's on screen (job, customer, lines, totals…).
  summary: string;
  /// True when the page registered an applier for proposed lines.
  canApplyLines: boolean;
}

/// Complete estimate the agent built — applied into the Create-estimate
/// page (job name, customer, markup, lines). Operator reviews and saves.
export interface EstimatePrefill {
  title: string;
  customerName: string | null;
  markupPercent: number | null;
  note: string | null;
  lines: ProposedLine[];
}

type Listener = () => void;

interface StoreState {
  ctx: AssistantPageContext | null;
  applier: ((lines: ProposedLine[]) => void) | null;
  prefillApplier: ((prefill: EstimatePrefill) => void) | null;
  listeners: Set<Listener>;
}

const globalKey = '__bvAssistantContextStore';
const holder = globalThis as unknown as Record<string, StoreState | undefined>;
const store: StoreState =
  holder[globalKey] ??
  (holder[globalKey] = { ctx: null, applier: null, prefillApplier: null, listeners: new Set() });

function emit() {
  for (const l of store.listeners) l();
}

export function setAssistantContext(ctx: Omit<AssistantPageContext, 'canApplyLines'> | null) {
  store.ctx = ctx ? { ...ctx, canApplyLines: store.applier != null } : null;
  emit();
}

export function registerLineApplier(fn: ((lines: ProposedLine[]) => void) | null) {
  store.applier = fn;
  if (store.ctx) {
    store.ctx = { ...store.ctx, canApplyLines: fn != null };
  }
  emit();
}

/// Returns true when a page accepted the lines.
export function applyProposedLines(lines: ProposedLine[]): boolean {
  if (!store.applier) return false;
  store.applier(lines);
  return true;
}

export function registerPrefillApplier(fn: ((prefill: EstimatePrefill) => void) | null) {
  store.prefillApplier = fn;
}

/// Apply a full estimate prefill if the Create-estimate page is mounted.
export function applyEstimatePrefill(prefill: EstimatePrefill): boolean {
  if (!store.prefillApplier) return false;
  store.prefillApplier(prefill);
  return true;
}

/* Cross-page handoff: when the operator asks for an estimate from any
   other page, the dock parks the prefill here and navigates to
   /estimates/new; the guided builder picks it up on mount. */

const PENDING_PREFILL_KEY = 'bv-assistant-pending-prefill';

export function parkPendingPrefill(prefill: EstimatePrefill) {
  try {
    sessionStorage.setItem(PENDING_PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    /* storage unavailable */
  }
}

export function takePendingPrefill(): EstimatePrefill | null {
  try {
    const raw = sessionStorage.getItem(PENDING_PREFILL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_PREFILL_KEY);
    const parsed = JSON.parse(raw) as EstimatePrefill;
    return parsed && typeof parsed.title === 'string' && Array.isArray(parsed.lines) ? parsed : null;
  } catch {
    return null;
  }
}

export function getAssistantContext(): AssistantPageContext | null {
  return store.ctx;
}

export function getAssistantContextServer(): AssistantPageContext | null {
  return null;
}

export function subscribeAssistantContext(cb: Listener): () => void {
  store.listeners.add(cb);
  return () => store.listeners.delete(cb);
}
