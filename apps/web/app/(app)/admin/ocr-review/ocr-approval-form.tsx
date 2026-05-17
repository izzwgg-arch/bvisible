'use client';

import Link from 'next/link';
import { useTransition, useState } from 'react';
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

function formatQty(milli: number | null): string | null {
  if (milli == null) return null;
  const n = milli / 1000;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function OcrApprovalForm({
  documentId,
  lines,
}: {
  documentId: string;
  lines: ApprovalLineRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [approvedPoId, setApprovedPoId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] leading-relaxed text-[var(--color-bv-muted)]">
        Checked lines are written to{' '}
        <span className="font-medium text-[var(--color-bv-text)]">
          vendor price history
        </span>{' '}
        only after you approve. Nothing is trusted for reconciliation until then.
      </p>

      {lines.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-4 text-[13px] text-[var(--color-bv-muted)]">
          No line candidates were parsed. Reject this run or re-scan the attachment.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lines.map((line, idx) => (
            <LineEditor
              key={line.id}
              documentId={documentId}
              line={line}
              idx={idx}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-bv-border)] pt-4">
        <button
          type="button"
          disabled={pending || lines.length === 0}
          className="rounded-md bg-emerald-700 px-4 py-2 text-[13px] font-medium text-white hover:bg-emerald-800 disabled:opacity-40"
          onClick={() => {
            setMessage(null);
            startTransition(async () => {
              const payloadLines = lines.map((line) => {
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
                const priceCents = Math.round(
                  Number.parseFloat(priceStr.replace(/,/g, '')) * 100
                );
                return {
                  ocrLineItemId: line.id,
                  include: inc,
                  itemRaw,
                  priceCents,
                  unit: null,
                  quantityMilli: line.quantityMilliGuess,
                };
              });
              const bad = payloadLines.some(
                (l) =>
                  l.include &&
                  (!Number.isFinite(l.priceCents) || l.priceCents <= 0)
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
                setMessage(
                  r.reconciliationSkipped
                    ? `Approved. Pricing saved. Reconciliation snapshot already exists for this approval — open the PO to review or recompute.`
                    : `Approved. Pricing saved and a reconciliation snapshot was created — review variances on the PO.`,
                );
                setApprovedPoId(r.purchaseOrderId);
              } else {
                setMessage('Approved. Vendor price history updated for selected lines.');
              }
            });
          }}
        >
          Approve selected
        </button>
        <button
          type="button"
          disabled={pending}
          className="rounded-md border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-2 text-[13px] font-medium text-[var(--color-bv-text)] disabled:opacity-40"
          onClick={() => {
            setMessage(null);
            startTransition(async () => {
              const r = await rejectOcrDocumentAction(documentId);
              if (!r.ok) setMessage(r.error ?? 'Reject failed.');
              else setMessage('Rejected. No pricing was written.');
            });
          }}
        >
          Reject
        </button>
        {message ? (
          <span className="text-[13px] text-[var(--color-bv-muted)]">{message}</span>
        ) : null}
        {approvedPoId ? (
          <Link
            href={`/purchase-orders/${approvedPoId}/reconciliation`}
            className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12px] font-semibold text-emerald-950 hover:bg-emerald-100"
          >
            Open PO reconciliation
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function LineEditor({
  documentId,
  line,
  idx,
}: {
  documentId: string;
  line: ApprovalLineRow;
  idx: number;
}) {
  const dollars =
    line.unitPriceCentsGuess != null
      ? (line.unitPriceCentsGuess / 100).toFixed(2)
      : '';
  const qty = formatQty(line.quantityMilliGuess);

  return (
    <li className="rounded-lg border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            data-ocr-include={`${documentId}-${line.id}`}
            defaultChecked={
              line.itemLabelNormalized != null &&
              line.itemLabelNormalized.length >= 2 &&
              line.unitPriceCentsGuess != null
            }
            className="size-4 rounded border-[var(--color-bv-border)]"
          />
          <span className="font-medium text-[var(--color-bv-text)]">
            Line {idx + 1}
          </span>
        </label>
        <span className="flex flex-wrap gap-1.5">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
            {labelVendorPriceConfidenceProduct(line.confidence as VendorPriceConfidence) ??
              'Confidence'}
          </span>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-900">
            {labelOcrParseReason(line.extractionSource)}
          </span>
        </span>
      </div>
      <p className="mt-2 font-mono text-[11px] leading-snug text-[var(--color-bv-muted)]">
        Source: {line.rawLineText}
      </p>
      {qty ? (
        <p className="mt-1 text-[11px] text-[var(--color-bv-muted)]">
          Parsed qty: {qty}
        </p>
      ) : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-bv-muted)]">
          Item label
          <input
            data-ocr-item={`${documentId}-${line.id}`}
            defaultValue={
              line.itemLabelNormalized && line.itemLabelNormalized.length > 0
                ? line.itemLabelNormalized
                : line.rawLineText.slice(0, 500)
            }
            className="rounded-md border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-1.5 text-[13px] normal-case tracking-normal text-[var(--color-bv-text)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-bv-muted)]">
          Unit price (USD)
          <input
            data-ocr-price={`${documentId}-${line.id}`}
            defaultValue={dollars}
            inputMode="decimal"
            className="rounded-md border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-1.5 text-[13px] normal-case tracking-normal text-[var(--color-bv-text)]"
          />
        </label>
      </div>
    </li>
  );
}