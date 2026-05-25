'use client';

import Link from 'next/link';
import { startTransition, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  EmailIngestStatus,
  EmailMatchReason,
} from '@bvisible/db';
import type { EmailReviewReasonCode } from '@/lib/email-ingest/review-reasons';
import {
  explainEmailMatch,
  explainUnmatchedReview,
  labelEmailReviewReasonCode,
  shortLabelEmailReviewReasonCode,
} from '@/lib/email-ingest/review-reasons';
import { labelEmailIngestStatus, labelEmailMatchReason } from '@/lib/ui/status-labels';
import type { EmailReviewPoSuggestion } from '@/lib/email-ingest/email-review-po-suggestions';
import { EmailReviewPoSuggestionsPanel } from '@/components/email-ingest/email-review-po-suggestions';
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
  reviewReasonCodes: EmailReviewReasonCode[];
  poSuggestions: readonly EmailReviewPoSuggestion[];
}

export interface ReviewTableProps {
  rows: ReadonlyArray<EmailRow>;
  pos: ReadonlyArray<PoChoice>;
  filter: 'unmatched' | 'matched' | 'failed' | 'dismissed' | 'all';
}

function reasonCodeChipClass(code: EmailReviewReasonCode): string {
  if (
    code === 'ATTACHMENT_REJECTED' ||
    code === 'OCR_FAILED' ||
    code === 'UNKNOWN_PO'
  ) {
    return 'border-amber-200 bg-amber-50 text-amber-900';
  }
  if (
    code === 'MULTIPLE_PO_MATCHES' ||
    code === 'MULTIPLE_QBO_MATCHES' ||
    code === 'MULTIPLE_VENDOR_PO_CANDIDATES'
  ) {
    return 'border-violet-200 bg-violet-50 text-violet-900';
  }
  if (code === 'OCR_PENDING') {
    return 'border-sky-200 bg-sky-50 text-sky-900';
  }
  if (code === 'MANUAL_REVIEW_REQUIRED') {
    return 'border-slate-200 bg-slate-50 text-slate-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-800';
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
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return d.toISOString().slice(0, 10);
}

function senderLabel(row: EmailRow): string {
  if (row.fromName && row.fromName.trim().length > 0) {
    return row.fromName;
  }
  return row.fromAddress;
}

/** Hide noisy manual-review chip when other codes explain the row. */
function visibleReasonCodes(codes: EmailReviewReasonCode[]): EmailReviewReasonCode[] {
  const filtered = codes.filter((c) => c !== 'MANUAL_REVIEW_REQUIRED');
  return filtered.length > 0 ? filtered : codes;
}

export function EmailIngestionReviewTable({ rows, pos, filter }: ReviewTableProps) {
  const router = useRouter();
  const [poChoiceByRow, setPoChoiceByRow] = useState<Record<string, string>>({});
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [errByRow, setErrByRow] = useState<Record<string, string | null>>({});
  const [openRow, setOpenRow] = useState<string | null>(null);

  const toggleRow = useCallback((rowId: string) => {
    setOpenRow((prev) => (prev === rowId ? null : rowId));
  }, []);

  function reportErr(rowId: string, msg: string | null) {
    setErrByRow((e) => ({ ...e, [rowId]: msg }));
  }

  async function doLinkToPo(rowId: string, purchaseOrderId: string) {
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

  async function doLink(rowId: string) {
    const purchaseOrderId = poChoiceByRow[rowId];
    if (!purchaseOrderId) {
      reportErr(rowId, 'Pick a PO from the list first.');
      return;
    }
    await doLinkToPo(rowId, purchaseOrderId);
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
      <div className="rounded-[var(--radius-bv)] border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-6 py-10 text-center shadow-[var(--shadow-bv-card)]">
        <h3 className="text-[15px] font-semibold tracking-tight text-[var(--color-bv-text)]">
          {guide.title}
        </h3>
        <p className="mx-auto mt-2 max-w-lg text-[13px] leading-relaxed text-[var(--color-bv-muted)]">
          {guide.body}
        </p>
        {guide.href ? (
          <Link
            href={guide.href as never}
            className="mt-5 inline-flex items-center justify-center rounded-[10px] bg-[var(--color-bv-accent)] px-4 py-2 text-[13px] font-medium text-[var(--color-bv-accent-foreground)] shadow-[var(--shadow-bv-card)] transition-colors hover:opacity-92"
          >
            {guide.linkLabel}
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => {
        const status = STATUS_LABELS[row.status];
        const canManualLink =
          row.status !== EmailIngestStatus.MATCHED &&
          row.status !== EmailIngestStatus.DISMISSED;
        const showSuggestions =
          canManualLink &&
          (row.status === EmailIngestStatus.UNMATCHED ||
            row.status === EmailIngestStatus.PENDING);
        const canDismiss = row.status !== EmailIngestStatus.MATCHED;
        const canRetry =
          row.status === EmailIngestStatus.UNMATCHED ||
          row.status === EmailIngestStatus.FAILED ||
          row.status === EmailIngestStatus.PENDING;
        const isOpen = openRow === row.id;
        const err = errByRow[row.id];
        const codes = visibleReasonCodes(row.reviewReasonCodes);
        const showWhyCollapsed =
          row.status === EmailIngestStatus.MATCHED ||
          codes.length === 0;

        return (
          <li
            key={row.id}
            className="rounded-lg border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]"
          >
            <div
              className="px-3 py-2"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !(e.target instanceof HTMLSelectElement)) {
                  e.preventDefault();
                  toggleRow(row.id);
                }
              }}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <span
                      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${status.className}`}
                    >
                      {status.label}
                    </span>
                    {row.matchReason !== EmailMatchReason.NONE &&
                    row.status === EmailIngestStatus.MATCHED ? (
                      <span className="inline-flex items-center rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-bv-muted)]">
                        {labelEmailMatchReason(row.matchReason)}
                      </span>
                    ) : null}
                    {codes.map((code) => (
                      <span
                        key={code}
                        className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${reasonCodeChipClass(code)}`}
                        title={labelEmailReviewReasonCode(code)}
                      >
                        {shortLabelEmailReviewReasonCode(code)}
                      </span>
                    ))}
                    {row.matchedPo ? (
                      <a
                        href={`/purchase-orders/${row.matchedPo.id}`}
                        className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
                      >
                        {row.matchedPo.number}
                      </a>
                    ) : null}
                    {row.attachmentCount > 0 ? (
                      <span className="inline-flex items-center rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--color-bv-muted)]">
                        {row.attachmentCount} file{row.attachmentCount === 1 ? '' : 's'}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[13px] font-medium leading-snug text-[var(--color-bv-text)] break-words">
                    {row.subject}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--color-bv-muted)]">
                    {senderLabel(row)} · {formatDate(row.receivedAt)}
                  </p>
                  {showWhyCollapsed ? (
                    <p className="mt-1 text-[11px] leading-snug text-[var(--color-bv-muted)]">
                      {row.status === EmailIngestStatus.MATCHED
                        ? explainEmailMatch({
                            matchReason: row.matchReason,
                            matchHint: row.matchHint,
                          })
                        : explainUnmatchedReview({
                            codes: row.reviewReasonCodes,
                            matchHint: row.matchHint,
                          })}
                    </p>
                  ) : null}
                  {showSuggestions ? (
                    <EmailReviewPoSuggestionsPanel
                      compact
                      suggestions={row.poSuggestions}
                      busy={busyRow === row.id}
                      onLink={(poId) => {
                        setPoChoiceByRow((m) => ({ ...m, [row.id]: poId }));
                        void doLinkToPo(row.id, poId);
                      }}
                    />
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => toggleRow(row.id)}
                  className="shrink-0 inline-flex items-center justify-center rounded-md border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-2 py-1 text-[11px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
                  aria-expanded={isOpen}
                >
                  {isOpen ? 'Hide' : 'Body'}
                </button>
              </div>

              {canManualLink || canRetry || canDismiss ? (
                <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-[var(--color-bv-border)] pt-2">
                  {canManualLink ? (
                    <label className="flex min-w-[180px] flex-1 flex-col gap-0.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
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
                        className="rounded-md border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2 py-1 text-[12px] text-[var(--color-bv-text)]"
                      >
                        <option value="">— pick PO —</option>
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

                  <div className="flex flex-wrap items-center gap-1.5">
                    {canManualLink ? (
                      <button
                        type="button"
                        onClick={() => doLink(row.id)}
                        disabled={busyRow === row.id}
                        className="inline-flex items-center justify-center rounded-md bg-[var(--color-bv-text)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {busyRow === row.id ? 'Linking…' : 'Link'}
                      </button>
                    ) : null}
                    {canRetry ? (
                      <button
                        type="button"
                        onClick={() => doRetry(row.id)}
                        disabled={busyRow === row.id}
                        className="inline-flex items-center justify-center rounded-md border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Retry
                      </button>
                    ) : null}
                    {canDismiss ? (
                      <button
                        type="button"
                        onClick={() => doDismiss(row.id)}
                        disabled={busyRow === row.id}
                        className="inline-flex items-center justify-center rounded-md px-2 py-1.5 text-[12px] font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Dismiss
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {err ? <p className="mt-1.5 text-[11px] text-rose-700">{err}</p> : null}
            </div>

            {isOpen ? (
              <div className="border-t border-[var(--color-bv-border)] px-3 py-2">
                {row.status === EmailIngestStatus.DISMISSED ? (
                  <p className="mb-2 text-[11px] leading-snug text-[var(--color-bv-muted)]">
                    Dismissed by operator — retained for audit.
                  </p>
                ) : null}
                {!showWhyCollapsed ? (
                  <p className="mb-2 text-[11px] leading-snug text-[var(--color-bv-muted)]">
                    {explainUnmatchedReview({
                      codes: row.reviewReasonCodes,
                      matchHint: row.matchHint,
                    })}
                  </p>
                ) : null}
                {row.bodyTextSnippet ? (
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] p-2 text-[11px] text-[var(--color-bv-text)]">
                    {row.bodyTextSnippet}
                  </pre>
                ) : (
                  <p className="text-[11px] text-[var(--color-bv-muted)]">No text body captured.</p>
                )}
                {row.attachments.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1">
                    {row.attachments.map((a) => (
                      <li
                        key={a.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2 py-1 text-[11px]"
                      >
                        <span className="min-w-0 break-all text-[var(--color-bv-text)]">
                          <span
                            className={`mr-1.5 inline-flex rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                              a.skipped
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {a.skipped ? 'Skipped' : 'Saved'}
                          </span>
                          {a.originalFilename}
                          <span className="ml-1.5 text-[var(--color-bv-muted)]">
                            {formatBytes(a.sizeBytes)}
                          </span>
                        </span>
                        {a.skipped ? (
                          <span className="shrink-0 text-[10px] text-amber-900">
                            {a.skipReason ?? 'rejected'}
                          </span>
                        ) : (
                          <a
                            href={`/api/email-ingest/${row.id}/attachments/${a.id}`}
                            className="shrink-0 font-medium underline-offset-2 hover:underline"
                            rel="noreferrer"
                          >
                            Download
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
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
