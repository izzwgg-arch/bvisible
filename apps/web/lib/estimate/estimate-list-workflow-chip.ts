import { EstimateStatus } from '@bvisible/db';
import { POTENTIALLY_READY_LABEL } from '@/lib/estimate/estimate-finalization';
import { WORKFLOW_STATE_LABELS } from '@/lib/workflow/operational-state';

export type EstimateListWorkflowChip = {
  label: string;
  tone: 'neutral' | 'action' | 'ready' | 'muted';
};

/** Compact list-row chips — display only, no DB writes. */
export function getEstimateListWorkflowChips(input: {
  status: EstimateStatus;
  hasLinkedPo: boolean;
}): EstimateListWorkflowChip[] {
  switch (input.status) {
    case EstimateStatus.DRAFT:
      return [{ label: 'Draft', tone: 'neutral' }];
    case EstimateStatus.SENT:
      return [{ label: WORKFLOW_STATE_LABELS.awaiting_customer, tone: 'action' }];
    case EstimateStatus.APPROVED:
      if (!input.hasLinkedPo) {
        return [
          { label: WORKFLOW_STATE_LABELS.approved_waiting_po, tone: 'action' },
        ];
      }
      return [
        { label: 'PO linked', tone: 'neutral' },
        { label: POTENTIALLY_READY_LABEL, tone: 'ready' },
      ];
    case EstimateStatus.FINALIZED:
      return [{ label: 'Finalized', tone: 'muted' }];
    case EstimateStatus.REJECTED:
      return [{ label: 'Declined', tone: 'muted' }];
    default:
      return [];
  }
}
