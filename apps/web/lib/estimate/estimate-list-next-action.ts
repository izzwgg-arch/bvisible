import { EstimateStatus } from '@bvisible/db';

export type EstimateListNextAction = {
  label: string;
  href: string;
  tone: 'primary' | 'muted';
};

export function getEstimateListNextAction(input: {
  id: string;
  status: EstimateStatus;
  lineCount?: number;
  hasLinkedPo?: boolean;
}): EstimateListNextAction {
  const base = `/estimates/${input.id}`;
  switch (input.status) {
    case EstimateStatus.DRAFT:
      if (input.lineCount === 0) {
        return { label: 'Add lines', href: `${base}#estimate-line-grid`, tone: 'primary' };
      }
      return { label: 'Continue draft', href: base, tone: 'primary' };
    case EstimateStatus.SENT:
      return { label: 'Preview quote', href: `${base}/preview`, tone: 'primary' };
    case EstimateStatus.APPROVED:
      if (!input.hasLinkedPo) {
        return { label: 'Create PO', href: `${base}#estimate-create-po`, tone: 'primary' };
      }
      return { label: 'Finalize estimate', href: base, tone: 'primary' };
    case EstimateStatus.FINALIZED:
      return { label: 'View finalized', href: base, tone: 'muted' };
    case EstimateStatus.REJECTED:
      return { label: 'Revise estimate', href: base, tone: 'primary' };
    default:
      return { label: 'Open', href: base, tone: 'muted' };
  }
}
