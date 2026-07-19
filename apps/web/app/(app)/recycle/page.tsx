import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { EmptyState } from '@/components/app/empty-state';
import { listRecycleBin, purgeExpiredRecycleBin } from '@/lib/assistant/recycle';
import { RECYCLE_RETENTION_DAYS } from '@/lib/assistant/operator-actions';
import { RestoreButton } from './restore-button';

export const metadata = { title: 'Recycle Bin' };
export const dynamic = 'force-dynamic';

export default async function RecyclePage() {
  const me = await requireTenantId();
  // Opportunistic cleanup: purge anything past the retention window when
  // the bin is viewed (idempotent, cheap).
  await purgeExpiredRecycleBin().catch(() => undefined);
  const entries = await listRecycleBin(me.tenantId);

  return (
    <>
      <PageHeader
        title="Recycle Bin"
        subtitle={`Deleted records are kept for ${RECYCLE_RETENTION_DAYS} days, then permanently removed. Restore anything below.`}
      />

      {entries.length === 0 ? (
        <EmptyState
          title="Nothing in the recycle bin"
          description="When you (or the assistant) delete something, it lands here and can be restored for 30 days."
          primaryAction={{ label: 'Back to Home', href: '/home' }}
        />
      ) : (
        <section className="flex max-h-[calc(100vh-220px)] min-h-[320px] flex-col overflow-hidden rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
          <div className="min-h-0 overflow-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-bv-border)] text-left text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
                  <th className="px-5 py-2 font-medium">Type</th>
                  <th className="px-5 py-2 font-medium">Record</th>
                  <th className="px-5 py-2 font-medium">Deleted</th>
                  <th className="px-5 py-2 font-medium">Auto-removes</th>
                  <th className="px-5 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={`${e.entity}:${e.id}`} className="border-b border-[var(--color-bv-border)] last:border-b-0 hover:bg-[var(--color-bv-bg)]">
                    <td className="px-5 py-2.5">
                      <span className="inline-flex rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
                        {e.entityLabel}
                      </span>
                    </td>
                    <td className="max-w-[320px] truncate px-5 py-2.5 font-medium text-[var(--color-bv-text)]">{e.label}</td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-[12px] text-[var(--color-bv-muted)]">
                      {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(e.deletedAtIso))}
                    </td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-[12px] text-[var(--color-bv-muted)]">
                      {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(e.expiresAtIso))}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <RestoreButton entity={e.entity} id={e.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
