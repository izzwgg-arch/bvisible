/**
 * Production workflow queue snapshot (read-only). Never logs secrets.
 */
import { prisma } from '@bvisible/db';
import { getOperationalWorkflowQueues } from '../lib/workflow/get-operational-workflow-queues';
import { OPERATIONAL_QUEUE_BUCKET_ORDER } from '../lib/workflow/operational-matrix';

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!tenant) {
    console.log(JSON.stringify({ ok: false, error: 'no_tenant' }));
    process.exit(1);
  }

  const queues = await getOperationalWorkflowQueues(tenant.id, {
    includeOperatorQueues: true,
  });

  const summary = Object.fromEntries(
    OPERATIONAL_QUEUE_BUCKET_ORDER.map((b) => [b, queues.sections[b].length]),
  );

  const samples = Object.fromEntries(
    OPERATIONAL_QUEUE_BUCKET_ORDER.map((b) => [
      b,
      queues.sections[b].slice(0, 2).map((r) => ({
        title: r.title,
        state: r.workflowState,
        href: r.href,
      })),
    ]),
  );

  console.log(
    JSON.stringify({
      ok: true,
      tenantId: tenant.id,
      totalActionable: queues.totalActionable,
      counts: summary,
      samples,
    }),
  );
}

main()
  .catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
