'use client';

import Link from 'next/link';
import { startTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  EmailIngestStatus,
  EmailMatchReason,
} from '@bvisible/db';
import { labelEmailIngestStatus } from '@/lib/ui/status-labels';
import {
  dismissEmailAction,
  manualLinkEmailToPoAction,
  retryEmailAction,
} from './actions';

export interface PoChoice {
  id: string;
  number: string;
  qboPoNumber: string | null;
  vendorName: string | null;
}

export interface AttachmentRow {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  skipped: boolean;
  skipReason: string | null;
}

export interface EmailRow {
  id: string;
  subject: string;
  fromAddress: string;
  fromName: string | null;
  receivedAt: string;
  createdAt: string;
  status: EmailIngestStatus;
  matchReason: EmailMatchReason;
  matchHint: string | null;
  matchedPo: { id: string; number: string } | null;
  matchedVendor: { id: string; name: string } | null;
  attachmentCount: number;
  attachments: AttachmentRow[];
  bodyTextSnippet: string | null;
}

export interface ReviewTableProps {
  rows: ReadonlyArray<EmailRow>;
  pos: ReadonlyArray<PoChoice>;
  filter: 'unmatched' | 'matched' | 'failed' | 'dismissed' | 'all';
}

const STATUS_LABELS: Record<EmailIngestStatus, { label: string; className: string }> = {
  PENDING: {
    label: labelEmailIngestStatus(EmailIngestStatus.PENDING),
    className: 'border-amber-200 bg-amber-50 text-amber-800',
  },
  UNMATCHED: {
    label: labelEmailIngestStatus(EmailIngestStatus.UNMATCHED),
    className: 'border-amber-200 bg-amber-50 text-amber-800',
  },
  MATCHED: {
    label: labelEmailIngestStatus(EmailIngestStatus.MATCHED),
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  FAILED: {
    label: labelEmailIngestStatus(EmailIngestStatus.FAILED),
    className: 'border-rose-200 bg-rose-50 text-rose-700',
  },
  DISMISSED: {
    label: labelEmailIngestStatus(EmailIngestStatus.DISMISSED),
    className: 'border-slate-200 bg-slate-50 text-slate-600',
  },
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / (1024 * 102.4)) / 10} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function senderLabel(row: EmailRow): string {
  if (row.fromName && row.fromName.trim().length > 0) {
    return `${row.fromName} <${row.fromAddress}>`;
  }
  return row.fromAddress;
}

export function EmailIngestionReviewTable({ rows, pos, filter }: ReviewTableProps) {
  const router = useRouter();
  const [poChoiceByRow, setPoChoiceByRow] = useState<Record<string, string>>({});
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [errByRow, setErrByRow] = useState<Record<string, string | null>>({});
  const [openRow, setOpenRow] = useState<string | null>(null);

  function reportErr(rowId: string, msg: string | null) {
    setErrByRow((e) => ({ ...e, [rowId]: msg }));
  }

  async function doLink(rowId: string) {
    const purchaseOrderId = poChoiceByRow[rowId];
    if (!purchaseOrderId) {
      reportErr(rowId, 'Pick a PO from the list first.');
      return;
    }
    setBusyRow(rowId);
    reportErr(rowId, null);
    try {
      const r = await manualLinkEmailToPoAction({
        ingestedEmailId: rowId,
        purchaseOrderId,
      });
      if (r.error) reportErr(rowId, r.error);
      else startTransition(() => router.refresh());
    } finally {
      setBusyRow(null);
    }
  }

  async function doRetry(rowId: string) {
    setBusyRow(rowId);
    reportErr(rowId, null);
    try {
      const r = await retryEmailAction({ ingestedEmailId: rowId });
      if (r.error) reportErr(rowId, r.error);
      else startTransition(() => router.refresh());
    } finally {
      setBusyRow(null);
    }
  }

  async function doDismiss(rowId: string) {
    setBusyRow(rowId);
    reportErr(rowId, null);
    try {
      const r = await dismissEmailAction({ ingestedEmailId: rowId });
      if (r.error) reportErr(rowId, r.error);
      else startTransition(() => router.refresh());
    } finally {
      setBusyRow(null);
    }
  }

  if (rows.length === 0) {
    const guide = inboxEmptyGuidance(filter);
    return (
      <div className="rounded-[var(--radius-bv)] border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-8 py-12 text-center shadow-[var(--shadow-bv-card)]">
        <h3 className="text-[16px] font-semibold tracking-tight text-[var(--color-bv-text)]">
          {guide.title}
        </h3>
        <p className="mx-auto mt-2 max-w-lg text-[13.5px] leading-relaxed text-[var(--color-bv-muted)]">
          {guide.body}
        </p>
        {guide.href ? (
          <Link
            href={guide.href as never}
            className="mt-6 inline-flex items-center justify-center rounded-[10px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-[var(--shadow-bv-card)] transition-colors hover:opacity-92"
          >
            {guide.linkLabel}
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => {
        const status = STATUS_LABELS[row.status];
        const canManualLink =
          row.status !== EmailIngestStatus.MATCHED &&
          row.status !== EmailIngestStatus.DISMISSED;
        const canDismiss = row.status !== EmailIngestStatus.MATCHED;
        const canRetry =
          row.status === EmailIngestStatus.UNMATCHED ||
          row.status === EmailIngestStatus.FAILED ||
          row.status === EmailIngestStatus.PENDING;
        const isOpen = openRow === row.id;
        const err = errByRow[row.id];
        return (
          <li
            key={row.id}
            className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]"
          >
            <div className="flex items-start gap-3 px-5 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.className}`}
                  >
                    {status.label}
                  </span>
                  {row.matchReason !== EmailMatchReason.NONE ? (
                    <span className="inline-flex items-center rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-bv-muted)]">
                      {row.matchReason.toLowerCase().replace(/_/g, ' ')}
                      {row.matchHint ? ` · ${row.matchHint}` : ''}
                    </span>
                  ) : null}
                  {row.matchedPo ? (
                    <a
                      href={`/purchase-orders/${row.matchedPo.id}`}
                      className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
                    >
                      → {row.matchedPo.number}
                    </a>
                  ) : null}
                  {row.attachmentCount > 0 ? (
                    <span className="inline-flex items-center rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-bv-muted)]">
                      📎 {row.attachmentCount}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 text-[14px] font-medium text-[var(--color-bv-text)] break-words">
                  {row.subject}
                </p>
                <p className="mt-0.5 text-[12px] text-[var(--color-bv-muted)] break-words">
                  {senderLabel(row)} · {formatDate(row.receivedAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenRow(isOpen ? null : row.id)}
                className="inline-flex items-center justify-center rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
              >
                {isOpen ? 'Hide' : 'Details'}
              </button>
            </div>
            {isOpen ? (
              <div className="border-t border-[var(--color-bv-border)] px-5 py-3">
                {row.bodyTextSnippet ? (
                  <pre className="whitespace-pre-wrap break-words rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] p-3 text-[12px] text-[var(--color-bv-text)]">
                    {row.bodyTextSnippet}
                  </pre>
                ) : (
                  <p className="text-[12px] text-[var(--color-bv-muted)]">
                    No text body captured.
                  </p>
                )}
                {row.attachments.length > 0 ? (
                  <ul className="mt-3 flex flex-col gap-1">
                    {row.attachments.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center justify-between gap-3 text-[12px]"
                      >
                        <span className="text-[var(--color-bv-text)] break-all">
                          {a.originalFilename}
                          <span className="ml-2 text-[var(--color-bv-muted)]">
                            ({a.mimeType} · {formatBytes(a.sizeBytes)})
                          </span>
                        </span>
                        {a.skipped ? (
                          <span className="text-rose-700">
                            skipped: {a.skipReason ?? 'unsupported type'}
                          </span>
                        ) : (
                          <a
                            href={`/api/email-ingest/${row.id}/attachments/${a.id}`}
                            className="text-[var(--color-bv-text)] underline-offset-2 hover:underline"
                            rel="noreferrer"
                          >
                            Download
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-4 flex flex-wrap items-end gap-2">
                  {canManualLink ? (
                    <label className="flex flex-1 min-w-[260px] flex-col gap-1">
                      <span className="text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
                        Link to PO
                      </span>
                      <select
                        value={poChoiceByRow[row.id] ?? ''}
                        onChange={(e) =>
                          setPoChoiceByRow((m) => ({
                            ...m,
                            [row.id]: e.currentTarget.value,
                          }))
                        }
                        className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-1.5 text-[13px] text-[var(--color-bv-text)]"
                      >
                        <option value="">— pick a PO —</option>
                        {pos.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.number}
                            {p.qboPoNumber ? ` · QBO ${p.qboPoNumber}` : ''}
                            {p.vendorName ? ` · ${p.vendorName}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  <div className="flex items-center gap-2">
                    {canManualLink ? (
                      <button
                        type="button"
                        onClick={() => doLink(row.id)}
                        disabled={busyRow === row.id}
                        className="inline-flex items-center justify-center rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-text)] px-3 py-1.5 text-[12.5px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {busyRow === row.id ? 'Linking…' : 'Link'}
                      </button>
                    ) : null}
                    {canRetry ? (
                      <button
                        type="button"
                        onClick={() => doRetry(row.id)}
                        disabled={busyRow === row.id}
                        className="inline-flex items-center justify-center rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Retry
                      </button>
                    ) : null}
                    {canDismiss ? (
                      <button
                        type="button"
                        onClick={() => doDismiss(row.id)}
                        disabled={busyRow === row.id}
                        className="inline-flex items-center justify-center rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-1.5 text-[12.5px] font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Dismiss
                      </button>
                    ) : null}
                  </div>
                </div>
                {err ? (
                  <p className="mt-2 text-[11.5px] text-rose-700">{err}</p>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function inboxEmptyGuidance(
  filter: ReviewTableProps['filter'],
): { title: string; body: string; href?: string; linkLabel?: string } {
  switch (filter) {
    case 'unmatched':
      return {
        title: 'Nothing needs matching right now',
        body: "When vendor mail arrives and automatic PO matching cannot finish, messages appear here. Pick the correct PO to attach vendors' replies and documents to the record.",
        href: '/purchase-orders',
        linkLabel: 'Browse purchase orders',
      };
    case 'matched':
      return {
        title: 'No matched mail in view',
        body: 'Matched emails are filed on their PO timelines. Switch filters or wait for the next inbound tick.',
      };
    case 'failed':
      return {
        title: 'No failed processing runs',
        body: 'Failures appear here when ingestion hits an error mid-flight. Use Retry on a row after fixing connectivity or configuration.',
        href: '/admin/email-ingestion',
        linkLabel: 'Email ingestion overview',
      };
    case 'dismissed':
      return {
        title: 'No dismissed messages',
        body: 'Dismissed mail stays for audit but leaves the active queues. Use this tab when you need to confirm junk was intentionally skipped.',
      };
    default:
      return {
        title: 'No mail loaded',
        body: 'Adjust the filter chips above to see unmatched, matched, failed, or dismissed buckets.',
      };
  }
}
