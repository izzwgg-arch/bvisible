'use client';

// Shared client-side store connecting the pages the operator works on
// with the floating assistant dock. Pages publish a live "what's on my
// screen" summary; the dock feeds it to the agent so the operator never
// has to explain what they're working on. Pages that can accept lines
// (guided builder, estimate editor) also register an applier so the
// agent's proposed lines land in the page with one click — client-side
// only, nothing is saved until the operator saves.

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

let currentContext: AssistantPageContext | null = null;
let lineApplier: ((lines: ProposedLine[]) => void) | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

export function setAssistantContext(ctx: Omit<AssistantPageContext, 'canApplyLines'> | null) {
  currentContext = ctx ? { ...ctx, canApplyLines: lineApplier != null } : null;
  emit();
}

export function registerLineApplier(fn: ((lines: ProposedLine[]) => void) | null) {
  lineApplier = fn;
  if (currentContext) {
    currentContext = { ...currentContext, canApplyLines: fn != null };
  }
  emit();
}

/// Returns true when a page accepted the lines.
export function applyProposedLines(lines: ProposedLine[]): boolean {
  if (!lineApplier) return false;
  lineApplier(lines);
  return true;
}

export function getAssistantContext(): AssistantPageContext | null {
  return currentContext;
}

export function getAssistantContextServer(): AssistantPageContext | null {
  return null;
}

export function subscribeAssistantContext(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
