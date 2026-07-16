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

type Listener = () => void;

interface StoreState {
  ctx: AssistantPageContext | null;
  applier: ((lines: ProposedLine[]) => void) | null;
  listeners: Set<Listener>;
}

const globalKey = '__bvAssistantContextStore';
const holder = globalThis as unknown as Record<string, StoreState | undefined>;
const store: StoreState =
  holder[globalKey] ?? (holder[globalKey] = { ctx: null, applier: null, listeners: new Set() });

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
