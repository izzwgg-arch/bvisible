import { Prisma } from '@bvisible/db';
import { acquireTenantSequenceLock } from '@/lib/sequence/lock';

const PREFIX = 'INV-';
const PAD = 6;

export async function nextInvoiceNumber(
  tx: Prisma.TransactionClient,
  tenantId: string
): Promise<string> {
  await acquireTenantSequenceLock(tx, tenantId, 'invoice');

  const last = await tx.invoice.findFirst({
    where: { tenantId, number: { startsWith: PREFIX } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });

  let nextSeq = 1;
  if (last) {
    const parsed = Number.parseInt(last.number.slice(PREFIX.length), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      nextSeq = parsed + 1;
    }
  }
  return `${PREFIX}${nextSeq.toString().padStart(PAD, '0')}`;
}
