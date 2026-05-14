import { redirect } from 'next/navigation';
import {
  EmailIngestStatus,
  POStatus,
  Role,
  prisma,
} from '@bvisible/db';
import { requireRole } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { loadInboxDiag } from '@/lib/email-ingest/config';
import { InboxConfigCard } from './inbox-config-card';
import {
  EmailIngestionReviewTable,
  type EmailRow,
  type PoChoice,
} from './review-table';

export const metadata = { title: 'Email ingestion' };
export const dynamic = 'force-dynamic';

const FILTERS = ['unmatched', 'matched', 'failed', 'dismissed', 'all'] as const;
type FilterKey = (typeof FILTERS)[number];

interface SearchParams {
  filter?: string;
}

export default async function EmailIngestionPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRole(Role.ADMIN, Role.SUPER_ADMIN);
  if (!me.tenantId) {
    redirect('/dashboard?error=no-tenant');
  }
  const sp = await searchParams;
  const filter: FilterKey = (FILTERS as readonly string[]).includes(sp.filter ?? '')
    ? (sp.filter as FilterKey)
    : 'unmatched';

  const statusFilter = mapFilter(filter);

  const [emails, pos, diag, counts, recentRuns] = await Promise.all([
    prisma.ingestedEmail.findMany({
      where: {
        tenantId: me.tenantId,
        ...(statusFilter ? { status: { in: statusFilter } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        subject: true,
        fromAddress: true,
        fromName: true,
        receivedAt: true,
        createdAt: true,
        status: true,
        matchReason: true,
        matchHint: true,
        attachmentCount: true,
        bodyTextSnippet: true,
        matchedPurchaseOrder: { select: { id: true, number: true } },
        matchedVendor: { select: { id: true, name: true } },
        attachments: {
          orderBy: [{ createdAt: 'asc' }],
          select: {
            id: true,
            originalFilename: true,
            mimeType: true,
            sizeBytes: true,
            skipped: true,
            skipReason: true,
          },
        },
      },
    }),
    prisma.purchaseOrder.findMany({
      where: {
        tenantId: me.tenantId,
        deletedAt: null,
        status: {
          in: [
            POStatus.DRAFT,
            POStatus.SENT,
            POStatus.ORDERED,
            POStatus.PARTIALLY_RECEIVED,
            POStatus.RECEIVED,
          ],
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 200,
      select: {
        id: true,
        number: true,
        qboPoNumber: true,
        vendor: { select: { name: true } },
      },
    }),
    loadInboxDiag(me.tenantId),
    prisma.ingestedEmail.groupBy({
      where: { tenantId: me.tenantId },
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.emailIngestRun.findMany({
      where: { tenantId: me.tenantId },
      orderBy: [{ startedAt: 'desc' }],
      take: 5,
      select: {
        id: true,
        startedAt: true,
        finishedAt: true,
        durationMs: true,
        scannedCount: true,
        ingestedCount: true,
        matchedCount: true,
        errorCount: true,
        errorMessage: true,
      },
    }),
  ]);

  const rows: EmailRow[] = emails.map((e) => ({
    id: e.id,
    subject: e.subject,
    fromAddress: e.fromAddress,
    fromName: e.fromName,
    receivedAt: e.receivedAt.toISOString(),
    createdAt: e.createdAt.toISOString(),
    status: e.status,
    matchReason: e.matchReason,
    matchHint: e.matchHint,
    matchedPo: e.matchedPurchaseOrder,
    matchedVendor: e.matchedVendor,
    attachmentCount: e.attachmentCount,
    attachments: e.attachments,
    bodyTextSnippet: e.bodyTextSnippet,
  }));

  const poChoices: PoChoice[] = pos.map((p) => ({
    id: p.id,
    number: p.number,
    qboPoNumber: p.qboPoNumber,
    vendorName: p.vendor?.name ?? null,
  }));

  const counterMap = new Map<EmailIngestStatus, number>();
  for (const c of counts) counterMap.set(c.status, c._count._all);
  const totals = {
    unmatched:
      (counterMap.get(EmailIngestStatus.UNMATCHED) ?? 0) +
      (counterMap.get(EmailIngestStatus.PENDING) ?? 0),
    matched: counterMap.get(EmailIngestStatus.MATCHED) ?? 0,
    failed: counterMap.get(EmailIngestStatus.FAILED) ?? 0,
    dismissed: counterMap.get(EmailIngestStatus.DISMISSED) ?? 0,
  };

  const isSuperAdmin = me.role === Role.SUPER_ADMIN;

  return (
    <>
      <PageHeader
        title="Email ingestion"
        subtitle="Inbound vendor email captured by the IMAP poller. Review, link, retry, or dismiss. Matched emails materialize on the matched PO's timeline."
        actions={
          isSuperAdmin ? (
            <a
              href={`/admin/tenants/${me.tenantId}/email-inbox`}
              className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
            >
              Configure inbox
            </a>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section>
          <nav className="mb-4 flex flex-wrap items-center gap-1 text-[12.5px]">
            {FILTERS.map((f) => {
              const active = f === filter;
              const label = `${f.charAt(0).toUpperCase()}${f.slice(1)}`;
              const badge =
                f === 'unmatched'
                  ? totals.unmatched
                  : f === 'matched'
                    ? totals.matched
                    : f === 'failed'
                      ? totals.failed
                      : f === 'dismissed'
                        ? totals.dismissed
                        : totals.unmatched +
                          totals.matched +
                          totals.failed +
                          totals.dismissed;
              return (
                <a
                  key={f}
                  href={`/admin/email-ingestion?filter=${f}`}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium ${
                    active
                      ? 'border-[var(--color-bv-text)] bg-[var(--color-bv-text)] text-white'
                      : 'border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]'
                  }`}
                >
                  {label}
                  <span
                    className={`inline-flex h-4 min-w-[1.1rem] items-center justify-center rounded-full px-1 text-[10.5px] tabular-nums ${
                      active
                        ? 'bg-white/20 text-white'
                        : 'bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)]'
                    }`}
                  >
                    {badge}
                  </span>
                </a>
              );
            })}
          </nav>

          <EmailIngestionReviewTable
            rows={rows}
            pos={poChoices}
            filter={filter}
          />
        </section>

        <aside className="flex flex-col gap-4">
          <InboxConfigCard diag={diag} />

          <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
            <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-bv-text)]">
              Recent ticks
            </h2>
            {recentRuns.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-[var(--color-bv-muted)]">
                No ticks yet. The systemd timer fires every minute.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5 text-[12px]">
                {recentRuns.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-2 rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2 py-1.5"
                  >
                    <span className="font-mono text-[11px] tabular-nums text-[var(--color-bv-muted)]">
                      {r.startedAt.toISOString().slice(11, 16)}
                    </span>
                    <span className="text-[var(--color-bv-text)]">
                      {r.scannedCount} scanned · {r.ingestedCount} ingested ·{' '}
                      {r.matchedCount} matched
                    </span>
                    {r.errorCount > 0 ? (
                      <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10.5px] font-medium text-rose-700">
                        {r.errorCount} err
                      </span>
                    ) : null}
                    {r.durationMs ? (
                      <span className="text-[11px] text-[var(--color-bv-muted)]">
                        {r.durationMs} ms
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

function mapFilter(filter: FilterKey): EmailIngestStatus[] | null {
  switch (filter) {
    case 'unmatched':
      return [EmailIngestStatus.UNMATCHED, EmailIngestStatus.PENDING];
    case 'matched':
      return [EmailIngestStatus.MATCHED];
    case 'failed':
      return [EmailIngestStatus.FAILED];
    case 'dismissed':
      return [EmailIngestStatus.DISMISSED];
    case 'all':
    default:
      return null;
  }
}
