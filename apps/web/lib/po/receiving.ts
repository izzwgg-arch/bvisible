// Pure receiving logic for the Ordered Materials checklist. Server
// actions and the UI both derive line/PO receiving state from these so
// the two can never disagree.

import { POStatus } from '@bvisible/db';

export type LineReceivingState = 'waiting' | 'partial' | 'received';

export interface ReceivableLine {
  qtyMilli: number;
  receivedQtyMilli: number;
}

/// received 0 → waiting · 0<received<ordered → partial · received ≥ ordered → received
export function lineReceivingState(line: ReceivableLine): LineReceivingState {
  if (line.receivedQtyMilli <= 0) return 'waiting';
  if (line.receivedQtyMilli >= line.qtyMilli) return 'received';
  return 'partial';
}

export function isLineFullyReceived(line: ReceivableLine): boolean {
  return line.qtyMilli > 0 ? line.receivedQtyMilli >= line.qtyMilli : line.receivedQtyMilli > 0;
}

/// Statuses whose materials the shop can receive against. DRAFT is not
/// here on purpose: nothing was ordered yet. CANCELED never receives.
export const RECEIVABLE_PO_STATUSES: readonly POStatus[] = [
  POStatus.SENT,
  POStatus.ORDERED,
  POStatus.PARTIALLY_RECEIVED,
  POStatus.RECEIVED,
];

/// Maps line receipts onto the PO status. Falls back to the current
/// status when nothing is received so an ORDERED PO isn't silently
/// rewritten to SENT just by toggling a checkbox on and off.
export function derivePoStatusFromLines(
  lines: readonly ReceivableLine[],
  current: POStatus
): POStatus {
  if (lines.length === 0) return current;
  const allReceived = lines.every(isLineFullyReceived);
  if (allReceived) return POStatus.RECEIVED;
  const anyReceived = lines.some((l) => l.receivedQtyMilli > 0);
  if (anyReceived) return POStatus.PARTIALLY_RECEIVED;
  return current === POStatus.ORDERED ? POStatus.ORDERED : POStatus.SENT;
}

export type ReceivingEventAction =
  | 'received'
  | 'partial'
  | 'corrected'
  | 'reversed'
  | 'mark_all'
  | 'undo';

/// Classifies a quantity change for the receiving history. `source`
/// overrides the derived label for bulk/undo flows.
export function classifyReceivingChange(
  prevMilli: number,
  nextMilli: number,
  orderedMilli: number,
  source?: 'mark_all' | 'undo'
): ReceivingEventAction {
  if (source) return source;
  if (nextMilli <= 0) return 'reversed';
  if (nextMilli >= orderedMilli) return 'received';
  return nextMilli >= prevMilli ? 'partial' : 'corrected';
}

/// Clamp a requested received quantity into the supported range. The
/// system does not support over-receiving, so ordered qty is the cap.
export function clampReceivedQty(requestedMilli: number, orderedMilli: number): number {
  if (!Number.isFinite(requestedMilli)) return 0;
  return Math.max(0, Math.min(Math.round(requestedMilli), orderedMilli));
}
