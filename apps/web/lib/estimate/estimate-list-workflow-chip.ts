import { EstimateStatus } from '@bvisible/db';
import { WORKFLOW_STATE_LABELS } from '@/lib/workflow/operational-state';

export type EstimateListWorkflowChip = {
  label: string;
  tone: 'neutral' | 'action' | 'ready' | 'muted';
};

/** Compact list-row chips — display only, no DB writes. */
export function getEstimateListWorkflowChips(input: {
  status: EstimateStatus;
  hasLinkedPo: boolean;
  hasLinkedInvoice: boolean;
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
      if (!input.hasLinkedInvoice) {
        return [
          { label: 'PO linked', tone: 'neutral' },
          { label: 'Bill customer', tone: 'action' },
        ];
      }
      return [
        { label: 'PO + invoice', tone: 'neutral' },
        { label: WORKFLOW_STATE_LABELS.ready_to_finalize, tone: 'ready' },
      ];
    case EstimateStatus.FINALIZED:
      return [{ label: 'Finalized', tone: 'muted' }];
    case EstimateStatus.REJECTED:
      return [{ label: 'Declined', tone: 'muted' }];
    default:
      return [];
  }
}
