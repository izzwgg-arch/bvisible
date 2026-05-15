import {
  POAttachmentKind,
  prisma,
  Role,
} from '@bvisible/db';

export interface OnboardingChecklistState {
  hasClient: boolean;
  hasVendor: boolean;
  inboxConfigured: boolean;
  hasEstimate: boolean;
  hasPo: boolean;
  hasReceiptOrInvoiceUpload: boolean;
  completedCount: number;
  totalSteps: number;
  /** Inbox step only actionable by admins in product nav — still counted for everyone when evaluating workspace readiness. */
  inboxStepForOperatorsOnly: boolean;
}

const RECEIPTISH_KINDS: POAttachmentKind[] = [
  POAttachmentKind.RECEIPT,
  POAttachmentKind.INVOICE,
  POAttachmentKind.VENDOR_INVOICE,
];

export async function getOnboardingChecklistState(
  tenantId: string,
  role: Role,
): Promise<OnboardingChecklistState> {
  const [
    clientCount,
    vendorCount,
    inbox,
    estimateCount,
    poCount,
    receiptAttachCount,
  ] = await Promise.all([
    prisma.client.count({ where: { tenantId, deletedAt: null } }),
    prisma.vendor.count({ where: { tenantId, deletedAt: null } }),
    prisma.tenantEmailInbox.findUnique({
      where: { tenantId },
      select: { enabled: true },
    }),
    prisma.estimate.count({ where: { tenantId, deletedAt: null } }),
    prisma.purchaseOrder.count({ where: { tenantId, deletedAt: null } }),
    prisma.pOAttachment.count({
      where: {
        tenantId,
        kind: { in: RECEIPTISH_KINDS },
      },
    }),
  ]);

  const hasClient = clientCount > 0;
  const hasVendor = vendorCount > 0;
  const inboxConfigured = inbox != null && inbox.enabled;
  const hasEstimate = estimateCount > 0;
  const hasPo = poCount > 0;
  const hasReceiptOrInvoiceUpload = receiptAttachCount > 0;

  const inboxStepForOperatorsOnly =
    role !== Role.ADMIN && role !== Role.SUPER_ADMIN;

  let completedCount = 0;
  if (hasClient) completedCount++;
  if (hasVendor) completedCount++;
  if (inboxConfigured) completedCount++;
  if (hasEstimate) completedCount++;
  if (hasPo) completedCount++;
  if (hasReceiptOrInvoiceUpload) completedCount++;

  const totalSteps = 6;

  return {
    hasClient,
    hasVendor,
    inboxConfigured,
    hasEstimate,
    hasPo,
    hasReceiptOrInvoiceUpload,
    completedCount,
    totalSteps,
    inboxStepForOperatorsOnly,
  };
}
