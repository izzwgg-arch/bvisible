import {
  EmailIngestStatus,
  POStatus,
  Role,
  prisma,
} from '@bvisible/db';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { AdminMetric, AdminPanel, AdminPill, adminSecondaryButtonClass } from '@/components/app/admin-ui';
import { loadInboxDiag } from '@/lib/email-ingest/config';
import { InboxConfigCard } from './inbox-config-card';
import {
  buildEmailReasonPrismaWhere,
  countEmailReasonFilter,
  isEmailReasonFilter,
  parseStoredReviewReasonCodes,
  type EmailReasonFilter,
} from '@/lib/email-ingest/review-reasons';
import { QueuePaginationBar } from '@/components/app/queue-pagination-bar';
import {
  buildQueueLoadMoreHref,
  parseQueuePage,
  queueFetchTake,
  resolveQueuePage,
} from '@/lib/ui/queue-pagination';
import {
  getEmailReviewPoSuggestions,
  type PoSuggestionCandidate,
} from '@/lib/email-ingest/email-review-po-suggestions';
import {
  EmailIngestionReviewTable,
  type EmailRow,
  type PoChoice,
} from './review-table';

export const metadata = { title: 'Email ingestion' };
export const dynamic = 'force-dynamic';

const FILTERS = ['unmatched', 'matched', 'failed', 'dismissed', 'all'] as const;
type FilterKey = (typeof FILTERS)[number];

const REASON_FILTERS: { key: EmailReasonFilter; label: string }[] = [
  { key: 'all', label: 'All unmatched' },
  { key: 'attachment_rejected', label: 'Attachment rejected' },
  { key: 'ambiguous', label: 'Ambiguous match' },
  { key: 'ocr_pending', label: 'OCR pending' },
];

interface SearchParams {
  filter?: string;
  reason?: string;
  page?: string;
}

export default async function EmailIngestionPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const sp = await searchParams;
  const filter: FilterKey = (FILTERS as readonly string[]).includes(sp.filter ?? '')
    ? (sp.filter as FilterKey)
    : 'unmatched';
  const reasonFilter: EmailReasonFilter =
    filter === 'unmatched' && sp.reason && isEmailReasonFilter(sp.reason)
      ? sp.reason
      : 'all';
  const page = parseQueuePage(sp.page);

  const statusFilter = mapFilter(filter);
  const emailWhere = {
    tenantId: me.tenantId,
    ...(statusFilter ? { status: { in: statusFilter } } : {}),
    ...(filter === 'unmatched' ? buildEmailReasonPrismaWhere(reasonFilter) : {}),
  };

  const unmatchedBucketWhere = {
    tenantId: me.tenantId,
    status: { in: mapFilter('unmatched')! },
  };

  const [emailsRaw, pos, diag, counts, recentRuns, emailTotal, reasonCounts] =
    await Promise.all([
    prisma.ingestedEmail.findMany({
      where: emailWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: queueFetchTake(page),
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
        reviewReasonCodes: true,
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
        status: true,
        updatedAt: true,
        vendorId: true,
        vendor: { select: { id: true, name: true, email: true } },
        estimate: {
          select: {
            title: true,
            client: { select: { companyName: true } },
          },
        },
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
    prisma.ingestedEmail.count({ where: emailWhere }),
    filter === 'unmatched'
      ? Promise.all(
          REASON_FILTERS.map((rf) =>
            prisma.ingestedEmail.count({
              where: { ...unmatchedBucketWhere, ...buildEmailReasonPrismaWhere(rf.key) },
            }),
          ),
        )
      : Promise.resolve(null as number[] | null),
  ]);

  const { rows: emails, hasMore, loadedCount } = resolveQueuePage(emailsRaw, page);

  const suggestionCandidates: PoSuggestionCandidate[] = pos
    .filter((p): p is typeof p & { vendorId: string } => p.vendorId != null)
    .map((p) => ({
    id: p.id,
    number: p.number,
    qboPoNumber: p.qboPoNumber,
    vendorId: p.vendorId,
    vendorName: p.vendor?.name ?? null,
    vendorEmail: p.vendor?.email ?? null,
    status: p.status,
    updatedAt: p.updatedAt,
    estimateTitle: p.estimate?.title ?? null,
    clientCompanyName: p.estimate?.client?.companyName ?? null,
  }));

  const vendorIdBySenderEmail = new Map<string, string>();
  for (const p of pos) {
    const email = p.vendor?.email?.trim().toLowerCase();
    if (email && p.vendor?.id) vendorIdBySenderEmail.set(email, p.vendor.id);
  }

  const rows: EmailRow[] = emails.map((e) => {
    const reviewReasonCodes = parseStoredReviewReasonCodes(e.reviewReasonCodes);
    const attachmentFilenames = e.attachments.map((a) => a.originalFilename);
    const senderVendorId =
      vendorIdBySenderEmail.get(e.fromAddress.trim().toLowerCase()) ??
      e.matchedVendor?.id ??
      null;

    return {
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
      reviewReasonCodes,
      poSuggestions: getEmailReviewPoSuggestions({
        status: e.status,
        fromAddress: e.fromAddress,
        subject: e.subject,
        bodyTextSnippet: e.bodyTextSnippet,
        matchHint: e.matchHint,
        matchedVendorId: e.matchedVendor?.id ?? null,
        reviewReasonCodes,
        attachmentFilenames,
        candidatePos: suggestionCandidates,
        senderVendorId,
      }),
    };
  });

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
  const allTotal = totals.unmatched + totals.matched + totals.failed + totals.dismissed;

  return (
    <>
      <PageHeader
        title="Email ingestion"
        subtitle="Vendor email operations for signage purchasing: review incoming mail, connect documents to POs, and keep every match explicit."
        actions={
          isSuperAdmin ? (
            <a
              href={`/admin/tenants/${me.tenantId}/email-inbox`}
              className={adminSecondaryButtonClass}
            >
              Configure inbox
            </a>
          ) : null
        }
      />

      <div className="grid gap-5">
        <section className="grid gap-3 md:grid-cols-4">
          <AdminMetric label="Needs review" value={totals.unmatched} detail="Unmatched or pending vendor mail" tone="amber" />
          <AdminMetric label="Matched" value={totals.matched} detail="Filed to purchase orders" tone="emerald" />
          <AdminMetric label="Failures" value={totals.failed} detail="Connectivity or processing errors" tone="rose" />
          <AdminMetric label="Total mail" value={allTotal} detail={`${loadedCount} visible in this filter`} />
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <AdminPanel
            title="Inbound review queue"
            eyebrow="Email operations"
            description="Every vendor message is kept operator-controlled: suggest, inspect, link, retry, or dismiss."
            action={<AdminPill tone={filter === 'unmatched' ? 'amber' : 'blue'}>{filter}</AdminPill>}
          >
            <div className="space-y-3 p-4">
          <nav className="flex flex-wrap items-center gap-2 text-[12px]">
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
              const href = `/admin/email-ingestion?filter=${f}`;
              return (
                <a
                  key={f}
                  href={href}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-semibold transition-all ${
                    active
                      ? 'bg-[var(--color-bv-accent)] text-white shadow-[0_10px_22px_rgba(47,90,243,0.22)]'
                      : 'border border-slate-200 bg-white text-slate-500 hover:border-blue-100 hover:bg-blue-50 hover:text-blue-700'
                  }`}
                >
                  {label}
                  <span
                    className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                      active
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {badge}
                  </span>
                </a>
              );
            })}
          </nav>

          {filter === 'unmatched' ? (
            <nav className="flex flex-wrap items-center gap-2 text-[11px]">
              {REASON_FILTERS.map((rf, idx) => {
                const active = reasonFilter === rf.key;
                const count = reasonCounts?.[idx] ?? countEmailReasonFilter(rows, rf.key);
                const params = new URLSearchParams({ filter: 'unmatched' });
                if (rf.key !== 'all') params.set('reason', rf.key);
                return (
                  <a
                    key={rf.key}
                    href={`/admin/email-ingestion?${params.toString()}`}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold ${
                      active
                        ? 'border-violet-300 bg-violet-50 text-violet-950'
                        : 'border border-slate-200 bg-slate-50 text-slate-500 hover:bg-white'
                    }`}
                  >
                    {rf.label}
                    <span className="tabular-nums text-[9px] font-semibold">{count}</span>
                  </a>
                );
              })}
            </nav>
          ) : null}

          <EmailIngestionReviewTable rows={rows} pos={poChoices} filter={filter} />

          <QueuePaginationBar
            loaded={loadedCount}
            total={emailTotal}
            hasMore={hasMore}
            loadMoreHref={buildQueueLoadMoreHref(
              '/admin/email-ingestion',
              {
                filter,
                reason: filter === 'unmatched' && reasonFilter !== 'all' ? reasonFilter : undefined,
                page: page > 1 ? String(page) : undefined,
              },
              page,
            )}
            suffix={
              filter === 'unmatched' && reasonFilter !== 'all'
                ? `· ${REASON_FILTERS.find((r) => r.key === reasonFilter)?.label ?? reasonFilter}`
                : undefined
            }
          />
            </div>
          </AdminPanel>

        <aside className="flex flex-col gap-4">
          <InboxConfigCard diag={diag} />

          <AdminPanel title="Recent ticks" eyebrow="Timer health" description="Latest IMAP polling runs from the server timer.">
            {recentRuns.length === 0 ? (
              <p className="p-5 text-[12.5px] text-slate-500">
                No ticks yet. The systemd timer fires every minute.
              </p>
            ) : (
              <ul className="flex flex-col gap-2 p-4 text-[12px]">
                {recentRuns.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-2 rounded-[14px] border border-slate-100 bg-white px-3 py-2 shadow-sm"
                  >
                    <span className="font-mono text-[11px] tabular-nums text-slate-500">
                      {r.startedAt.toISOString().slice(11, 16)}
                    </span>
                    <span className="font-medium text-slate-800">
                      {r.scannedCount} scanned · {r.ingestedCount} ingested ·{' '}
                      {r.matchedCount} matched
                    </span>
                    {r.errorCount > 0 ? (
                      <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10.5px] font-medium text-rose-700">
                        {r.errorCount} err
                      </span>
                    ) : null}
                    {r.durationMs ? (
                      <span className="text-[11px] text-slate-500">
                        {r.durationMs} ms
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </AdminPanel>
        </aside>
        </div>
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
