'use client';

import { useTransition, useState } from 'react';
import {
  approveOcrDocumentAction,
  rejectOcrDocumentAction,
} from '@/app/(app)/admin/ocr-review/actions';

export interface ApprovalLineRow {
  id: string;
  rawLineText: string;
  itemLabelNormalized: string | null;
  unitPriceCentsGuess: number | null;
  confidence: string;
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

  return (
    <div className="flex flex-col gap-4">
      {lines.length === 0 ? (
        <p className="text-[13px] text-[var(--color-bv-muted)]">
          No line-item candidates were parsed. You can still reject this run or
          retry OCR after improving the scan.
        </p>
      ) : (
        lines.map((line, idx) => (
          <LineEditor key={line.id} documentId={documentId} line={line} idx={idx} />
        ))
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        <button
          type="button"
          disabled={pending || lines.length === 0}
          className="rounded-md bg-emerald-700 px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40"
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
                  quantityMilli: null,
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
              else setMessage('Approved — vendor price history updated.');
            });
          }}
        >
          Approve selected lines
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
              else setMessage('Rejected.');
            });
          }}
        >
          Reject extraction
        </button>
      </div>

      {message ? (
        <p className="text-[13px] text-[var(--color-bv-muted)]">{message}</p>
      ) : null}
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

  return (
    <div className="rounded-lg border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] p-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            data-ocr-include={`${documentId}-${line.id}`}
            defaultChecked={
              line.itemLabelNormalized != null &&
              line.itemLabelNormalized.length >= 2 &&
              line.unitPriceCentsGuess != null
            }
          />
          <span className="font-medium text-[var(--color-bv-text)]">
            Include #{idx + 1}
          </span>
        </label>
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-800">
          {line.confidence}
        </span>
      </div>
      <p className="mt-2 font-mono text-[12px] text-[var(--color-bv-muted)]">
        {line.rawLineText}
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[12px] text-[var(--color-bv-muted)]">
          Item label (editable)
          <input
            data-ocr-item={`${documentId}-${line.id}`}
            defaultValue={line.rawLineText.slice(0, 500)}
            className="rounded border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-2 py-1.5 text-[13px] text-[var(--color-bv-text)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--color-bv-muted)]">
          Unit price (USD)
          <input
            data-ocr-price={`${documentId}-${line.id}`}
            defaultValue={dollars}
            inputMode="decimal"
            className="rounded border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-2 py-1.5 text-[13px] text-[var(--color-bv-text)]"
          />
        </label>
      </div>
    </div>
  );
}
