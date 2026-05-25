import type { POReconciliationStatus } from '@bvisible/db';
import { EstimateStatus } from '@bvisible/db';
import { reconciliationNeedsAttention } from '@/lib/estimate/estimate-fulfillment';

export type FinalizeGateKind =
  | 'ready'
  | 'already_finalized'
  | 'not_approved'
  | 'no_linked_po'
  | 'missing_qbo'
  | 'reconciliation_unresolved';

export type LinkedPoFinalizeInput = {
  id: string;
  number: string;
  qboPoNumber: string | null;
  latestReconciliationStatus: POReconciliationStatus | null;
};

export type FinalizeGateResult = {
  canFinalize: boolean;
  kind: FinalizeGateKind;
  blockedReason: string | null;
};

/** Shared R-EST-04 closeout gates — server action and UI must agree. */
export function evaluateEstimateFinalizeGates(input: {
  estimateStatus: EstimateStatus;
  linkedPos: ReadonlyArray<LinkedPoFinalizeInput>;
}): FinalizeGateResult {
  if (input.estimateStatus === EstimateStatus.FINALIZED) {
    return {
      canFinalize: false,
      kind: 'already_finalized',
      blockedReason: 'Estimate is already finalized.',
    };
  }

  if (input.estimateStatus !== EstimateStatus.APPROVED) {
    return {
      canFinalize: false,
      kind: 'not_approved',
      blockedReason: 'Estimate must be Approved before finalize.',
    };
  }

  if (input.linkedPos.length === 0) {
    return {
      canFinalize: false,
      kind: 'no_linked_po',
      blockedReason: 'Create a PO from this estimate first.',
    };
  }

  const missingQbo = input.linkedPos.filter((p) => !p.qboPoNumber?.trim());
  if (missingQbo.length > 0) {
    return {
      canFinalize: false,
      kind: 'missing_qbo',
      blockedReason:
        missingQbo.length === 1
          ? `${missingQbo[0]!.number} needs a QuickBooks PO number first.`
          : `${missingQbo.length} linked POs still need a QuickBooks PO number.`,
    };
  }

  const reconAttention = input.linkedPos.filter((p) =>
    reconciliationNeedsAttention(p.latestReconciliationStatus),
  );
  if (reconAttention.length > 0) {
    return {
      canFinalize: false,
      kind: 'reconciliation_unresolved',
      blockedReason:
        reconAttention.length === 1
          ? `Clear reconciliation on ${reconAttention[0]!.number} before finalizing.`
          : `${reconAttention.length} linked POs need reconciliation review before finalizing.`,
    };
  }

  return { canFinalize: true, kind: 'ready', blockedReason: null };
}

/** Dashboard/list heuristics that skip recon or QBO checks. */
export function isPotentiallyReadyToFinalizeHeuristic(input: {
  estimateStatus: EstimateStatus;
  hasLinkedPo: boolean;
  allLinkedPosHaveQbo?: boolean;
}): boolean {
  return (
    input.estimateStatus === EstimateStatus.APPROVED &&
    input.hasLinkedPo &&
    input.allLinkedPosHaveQbo !== false
  );
}

export const POTENTIALLY_READY_LABEL = 'Potentially ready — open to confirm.';
