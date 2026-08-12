import { EstimateStatus } from '@bvisible/db';

export function getEstimateEditorPrimaryAction(input: {
  estimateId: string;
  status: EstimateStatus;
  lineCount: number;
  hasLinkedPo: boolean;
  quoteLinkActive: boolean;
}): { label: string; href: string; hint: string } {
  const base = `/estimates/${input.estimateId}`;
  const preview = `${base}/preview`;

  if (input.status === EstimateStatus.DRAFT) {
    if (input.lineCount === 0) {
      return {
        label: 'Add line items',
        href: `${base}#estimate-line-grid`,
        hint: 'Start with catalog Apply or the pricing helper, then save.',
      };
    }
    return {
      label: 'Preview quote',
      href: preview,
      hint: 'Review the customer-facing quote, then mark Sent when you email it.',
    };
  }

  if (input.status === EstimateStatus.SENT) {
    return {
      label: 'Send / track quote',
      href: `${preview}#customer-send`,
      hint: 'Issue a public link or resend — mark Approved when the customer commits.',
    };
  }

  if (input.status === EstimateStatus.APPROVED) {
    if (!input.hasLinkedPo) {
      return {
        label: 'Create purchase order',
        href: `${base}#estimate-create-po`,
        hint: 'Buy materials from an approved quote — PO links back here.',
      };
    }
    return {
      label: 'Preview quote',
      href: preview,
      hint: 'PO is linked — finalize when QBO numbers are recorded.',
    };
  }

  if (input.status === EstimateStatus.FINALIZED) {
    return {
      label: 'View quote',
      href: preview,
      hint: 'Estimate is finalized — unfinalize from totals if you need edits.',
    };
  }

  return {
    label: 'Open estimate',
    href: base,
    hint: 'Revise scope or pricing, then move status forward.',
  };
}
