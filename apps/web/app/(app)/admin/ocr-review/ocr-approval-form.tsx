'use client';

import Link from 'next/link';
import { useEffect, useTransition, useState } from 'react';
import {
  approveOcrDocumentAction,
  rejectOcrDocumentAction,
} from '@/app/(app)/admin/ocr-review/actions';
import { labelOcrParseReason } from '@/lib/ocr/parse-reason-labels';
import { labelVendorPriceConfidenceProduct } from '@/lib/vendor-pricing/vendor-price-source-label';
import { VendorPriceConfidence } from '@bvisible/db';

export interface ApprovalLineRow {
  id: string;
  rawLineText: string;
  itemLabelNormalized: string | null;
  unitPriceCentsGuess: number | null;
  quantityMilliGuess: number | null;
  extractionSource: string;
  confidence: string;
}

function formatQty(milli: number | null): string {
  if (milli == null) return '—';
  const n = milli / 1000;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function defaultInclude(line: ApprovalLineRow): boolean {
  return (
    line.itemLabelNormalized != null &&
    line.itemLabelNormalized.length >= 2 &&
    line.unitPriceCentsGuess != null
  );
}

function collectPayload(documentId: string, lines: ApprovalLineRow[]) {
  return lines.map((line) => {
    const inc =
      (
        document.querySelector(
          `[data-ocr-include="${documentId}-${line.id}"]`
        ) as HTMLInputElement | null
      )?.checked ?? false;
    const itemRaw =
      (
        document.querySelector(
          `[data-ocr-item="${documentId}-${line.id}"]`
        ) as HTMLInputElement | null
      )?.value ?? line.rawLineText;
    const priceStr =
      (
        document.querySelector(
          `[data-ocr-price="${documentId}-${line.id}"]`
        ) as HTMLInputElement | null
      )?.value ?? '';
    const priceCents = Math.round(Number.parseFloat(priceStr.replace(/,/g, '')) * 100);
    return {
      ocrLineItemId: line.id,
      include: inc,
      itemRaw,
      priceCents,
      unit: null,
      quantityMilli: line.quantityMilliGuess,
    };
  });
}

export function OcrDecisionRail({
  documentId,
  lines,
  previewHref,
  purchaseOrderId,
  purchaseOrderNumber,
  disabled = false,
}: {
  documentId: string;
  lines: ApprovalLineRow[];
  previewHref?: string | null;
  purchaseOrderId?: string | null;
  purchaseOrderNumber?: string | null;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [approvedPoId, setApprovedPoId] = useState<string | null>(null);
  const [reconciliationSkipped, setReconciliationSkipped] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (disabled || pending || lines.length === 0) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('ocr-approve-btn')?.click();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [disabled, pending, lines.length]);

  const poId = approvedPoId ?? purchaseOrderId;

  return (
    <aside className="sticky top-4 flex flex-col gap-3 rounded-lg border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-3 shadow-[var(--shadow-bv-card)]">
      <div>
        <h2 className="text-[13px] font-semibold text-[var(--color-bv-text)]">Decision</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-bv-muted)]">
          Vendor price history and reconciliation run only after you approve. Edits here do not
          mutate pricing until then.
        </p>
      </div>

      {!disabled ? (
        <div className="flex flex-col gap-2">
          <button
            id="ocr-approve-btn"
            type="button"
            disabled={pending || lines.length === 0}
            className="w-full rounded-md bg-emerald-700 px-3 py-2 text-[13px] font-medium text-white hover:bg-emerald-800 disabled:opacity-40"
            onClick={() => {
              setMessage(null);
              startTransition(async () => {
                const payloadLines = collectPayload(documentId, lines);
                const bad = payloadLines.some(
                  (l) => l.include && (!Number.isFinite(l.priceCents) || l.priceCents <= 0)
                );
                if (bad) {
                  setMessage('Each selected line needs a valid dollar amount.');
                  return;
                }
                const r = await approveOcrDocumentAction({
                  documentId,
                  lines: payloadLines,
                });
                if (!r.ok) setMessage(r.error ?? 'Approve failed.');
                else if (r.purchaseOrderId) {
                  setReconciliationSkipped(!!r.reconciliationSkipped);
                  setMessage(
                    r.reconciliationSkipped
                      ? 'Approved — pricing saved. Reconciliation snapshot already exists.'
                      : 'Approved — pricing saved and reconciliation snapshot created.'
                  );
                  setApprovedPoId(r.purchaseOrderId);
                } else {
                  setMessage('Approved — vendor price history updated.');
                }
              });
            }}
          >
            Approve selected
          </button>
          <button
            type="button"
            disabled={pending}
            className="w-full rounded-md border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px] font-medium text-[var(--color-bv-text)] disabled:opacity-40"
            onClick={() => {
              setMessage(null);
              startTransition(async () => {
                const r = await rejectOcrDocumentAction(documentId);
                if (!r.ok) setMessage(r.error ?? 'Reject failed.');
                else setMessage('Rejected — no pricing was written.');
              });
            }}
          >
            Reject
          </button>
          {lines.length > 0 ? (
            <p className="text-[10px] text-[var(--color-bv-muted)]">
              Shortcut: Ctrl+Enter to approve
            </p>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <p className="rounded-md bg-[var(--color-bv-bg)] px-2.5 py-2 text-[12px] leading-snug text-[var(--color-bv-text)]">
          {message}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5 border-t border-[var(--color-bv-border)] pt-3">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
          Next steps
        </span>
        <div className="flex flex-wrap gap-1.5">
          {previewHref ? (
            <a
              href={previewHref}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-0.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-50"
            >
              Open attachment
            </a>
          ) : null}
          {poId ? (
            <>
              <Link
                href={`/purchase-orders/${poId}`}
                className="rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-surface)]"
              >
                PO {purchaseOrderNumber ?? 'detail'}
              </Link>
              {approvedPoId ? (
                <Link
                  href={`/purchase-orders/${poId}/reconciliation`}
                  className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-950 hover:bg-emerald-100"
                >
                  {reconciliationSkipped ? 'Review reconciliation' : 'Open reconciliation'}
                </Link>
              ) : null}
            </>
          ) : null}
          <Link
            href="/admin/ocr-review"
            className="rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-bv-muted)] hover:bg-[var(--color-bv-surface)]"
          >
            Back to queue
          </Link>
        </div>
      </div>
    </aside>
  );
}

export function OcrLineReviewTable({
  documentId,
  lines,
}: {
  documentId: string;
  lines: ApprovalLineRow[];
}) {
  if (lines.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-3 text-[12px] text-[var(--color-bv-muted)]">
        No line candidates were parsed. Reject this run or re-upload the attachment on the PO.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-[var(--color-bv-text)]">
          Line candidates ({lines.length})
        </h2>
        <div className="flex gap-2 text-[11px] font-medium text-emerald-700">
          <button
            type="button"
            className="hover:underline"
            onClick={() => {
              for (const line of lines) {
                const el = document.querySelector(
                  `[data-ocr-include="${documentId}-${line.id}"]`
                ) as HTMLInputElement | null;
                if (el) el.checked = true;
              }
            }}
          >
            Select all
          </button>
          <span className="text-[var(--color-bv-muted)]">·</span>
          <button
            type="button"
            className="hover:underline"
            onClick={() => {
              for (const line of lines) {
                const el = document.querySelector(
                  `[data-ocr-include="${documentId}-${line.id}"]`
                ) as HTMLInputElement | null;
                if (el) el.checked = false;
              }
            }}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--color-bv-border)]">
        <table className="w-full border-collapse text-left text-[12px]">
          <thead className="border-b border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[10px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
            <tr>
              <th className="w-8 px-2 py-1.5" aria-label="Include" />
              <th className="w-8 px-2 py-1.5">#</th>
              <th className="px-2 py-1.5">Item</th>
              <th className="w-16 px-2 py-1.5 text-right">Qty</th>
              <th className="w-24 px-2 py-1.5 text-right">Price</th>
              <th className="hidden px-2 py-1.5 sm:table-cell">Parse</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <LineRow key={line.id} documentId={documentId} line={line} idx={idx} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** @deprecated Use OcrLineReviewTable + OcrDecisionRail */
export function OcrApprovalForm({
  documentId,
  lines,
}: {
  documentId: string;
  lines: ApprovalLineRow[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <OcrLineReviewTable documentId={documentId} lines={lines} />
      <OcrDecisionRail documentId={documentId} lines={lines} />
    </div>
  );
}

function LineRow({
  documentId,
  line,
  idx,
}: {
  documentId: string;
  line: ApprovalLineRow;
  idx: number;
}) {
  const dollars =
    line.unitPriceCentsGuess != null ? (line.unitPriceCentsGuess / 100).toFixed(2) : '';
  const defaultItem =
    line.itemLabelNormalized && line.itemLabelNormalized.length > 0
      ? line.itemLabelNormalized
      : line.rawLineText.slice(0, 500);
  const confLabel =
    labelVendorPriceConfidenceProduct(line.confidence as VendorPriceConfidence) ?? '—';
  const parseLabel = labelOcrParseReason(line.extractionSource);

  return (
    <tr className="border-t border-[var(--color-bv-border)] align-top hover:bg-[var(--color-bv-bg)]/40">
      <td className="px-2 py-1.5">
        <input
          type="checkbox"
          data-ocr-include={`${documentId}-${line.id}`}
          defaultChecked={defaultInclude(line)}
          className="size-3.5 rounded border-[var(--color-bv-border)]"
          aria-label={`Include line ${idx + 1}`}
        />
      </td>
      <td className="px-2 py-1.5 tabular-nums text-[var(--color-bv-muted)]">{idx + 1}</td>
      <td className="px-2 py-1.5">
        <input
          data-ocr-item={`${documentId}-${line.id}`}
          defaultValue={defaultItem}
          className="mb-1 w-full min-w-0 rounded border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-2 py-1 text-[12px] text-[var(--color-bv-text)]"
        />
        <details className="text-[10px] text-[var(--color-bv-muted)]">
          <summary className="cursor-pointer select-none hover:text-[var(--color-bv-text)]">
            Source line
          </summary>
          <p className="mt-0.5 font-mono leading-snug">{line.rawLineText}</p>
        </details>
        <div className="mt-1 flex flex-wrap gap-1 sm:hidden">
          <Chip label={parseLabel} tone="parse" />
          <Chip label={confLabel} tone="conf" />
        </div>
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--color-bv-muted)]">
        {formatQty(line.quantityMilliGuess)}
      </td>
      <td className="px-2 py-1.5">
        <input
          data-ocr-price={`${documentId}-${line.id}`}
          defaultValue={dollars}
          inputMode="decimal"
          placeholder="0.00"
          className="w-full rounded border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-2 py-1 text-right text-[12px] tabular-nums text-[var(--color-bv-text)]"
        />
      </td>
      <td className="hidden px-2 py-1.5 sm:table-cell">
        <div className="flex flex-col gap-1">
          <Chip label={parseLabel} tone="parse" />
          <Chip label={confLabel} tone="conf" />
        </div>
      </td>
    </tr>
  );
}

function Chip({ label, tone }: { label: string; tone: 'parse' | 'conf' }) {
  const cls =
    tone === 'parse'
      ? 'bg-blue-500/10 text-blue-900 ring-1 ring-blue-500/15'
      : 'bg-slate-500/10 text-slate-700 ring-1 ring-slate-500/15';
  return (
    <span
      className={`inline-flex max-w-full truncate rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${cls}`}
      title={label}
    >
      {label}
    </span>
  );
}
