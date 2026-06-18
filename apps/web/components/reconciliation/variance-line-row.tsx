import {
  POReconciliationLineMatch,
  POReconciliationLineResolution,
} from '@bvisible/db';
import {
  mergeReconciliationLinesFormAction,
  reconciliationLineResolutionFormAction,
  rejectReconciliationLineFormAction,
} from '@/lib/reconciliation/actions';
import { SelectControl } from '@/components/app/select-control';
import { RECON_ACTION_HINTS } from '@/lib/reconciliation/ui-copy';
import {
  fmtQtyMilli,
  fmtReconMoney,
  fmtSignedVariance,
  isVarianceMatch,
  pairedReviewMatches,
  varianceClass,
} from '@/lib/reconciliation/ui-format';
import { MatchChip, ResolutionChip } from '@/components/reconciliation/reconciliation-badges';

export type VarianceLineRowData = {
  id: string;
  match: POReconciliationLineMatch;
  resolution: POReconciliationLineResolution;
  poDescription: string | null;
  receiptName: string | null;
  expectedUnitCostCents: number | null;
  expectedQtyMilli: number | null;
  observedUnitPriceCents: number | null;
  observedQtyMilli: number | null;
  priceVarianceCents: number | null;
  qtyVarianceMilli: number | null;
};

export type PoMergeCandidate = {
  id: string;
  description: string;
};

export function VarianceLineRow({
  line,
  poCandidates,
}: {
  line: VarianceLineRowData;
  poCandidates: PoMergeCandidate[];
}) {
  const receiptNeedsMerge =
    line.match === POReconciliationLineMatch.UNMATCHED_RECEIPT_LINE ||
    line.match === POReconciliationLineMatch.AMBIGUOUS_RECEIPT_LINE;
  const showPairActions = pairedReviewMatches().has(line.match);
  const unresolved = line.resolution === POReconciliationLineResolution.NONE;
  const hasVariance = isVarianceMatch(line.match);

  const rowRing =
    unresolved && hasVariance
      ? 'border-amber-300/70 bg-amber-50/30'
      : unresolved && line.match !== POReconciliationLineMatch.MATCHED
        ? 'border-violet-200/80 bg-violet-50/20'
        : 'border-[var(--color-bv-border)] bg-[var(--color-bv-surface)]';

  return (
    <article
      className={`rounded-[10px] border px-3 py-2.5 shadow-[var(--shadow-bv-card)] ${rowRing}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <MatchChip match={line.match} />
          <ResolutionChip resolution={line.resolution} />
        </div>
        {(line.priceVarianceCents !== null || line.qtyVarianceMilli !== null) && (
          <div className="text-right">
            <p className={`text-[13px] font-semibold tabular-nums ${varianceClass(line.priceVarianceCents)}`}>
              {fmtSignedVariance(line.priceVarianceCents)}
            </p>
            {line.qtyVarianceMilli !== null && line.qtyVarianceMilli !== 0 ? (
              <p className="text-[10.5px] tabular-nums text-[var(--color-bv-muted)]">
                Δ qty {line.qtyVarianceMilli} milli
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <CompareCell
          label="PO line"
          primary={line.poDescription ?? '—'}
          unit={fmtReconMoney(line.expectedUnitCostCents)}
          qty={fmtQtyMilli(line.expectedQtyMilli)}
        />
        <CompareCell
          label="Receipt (normalized)"
          primary={line.receiptName ?? '—'}
          unit={
            line.observedUnitPriceCents === null
              ? '—'
              : fmtReconMoney(line.observedUnitPriceCents)
          }
          qty={fmtQtyMilli(line.observedQtyMilli)}
          mono
        />
      </div>

      {unresolved ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-[var(--color-bv-border)] pt-2.5">
          {showPairActions ? (
            <>
              <ActionButton
                formAction={reconciliationLineResolutionFormAction}
                hidden={[
                  { name: 'lineId', value: line.id },
                  {
                    name: 'resolution',
                    value: POReconciliationLineResolution.CONFIRMED_PAIR,
                  },
                ]}
                label="Confirm match"
                hint={RECON_ACTION_HINTS.confirmPair}
                tone="emerald"
              />
              {hasVariance ? (
                <ActionButton
                  formAction={reconciliationLineResolutionFormAction}
                  hidden={[
                    { name: 'lineId', value: line.id },
                    {
                      name: 'resolution',
                      value: POReconciliationLineResolution.ACCEPTED_VARIANCE,
                    },
                  ]}
                  label="Accept variance"
                  hint={RECON_ACTION_HINTS.acceptVariance}
                  tone="amber"
                />
              ) : null}
              <ActionButton
                formAction={rejectReconciliationLineFormAction}
                hidden={[{ name: 'lineId', value: line.id }]}
                label="Reject mapping"
                hint={RECON_ACTION_HINTS.rejectMapping}
                tone="rose"
              />
            </>
          ) : null}

          {receiptNeedsMerge && poCandidates.length > 0 ? (
            <form
              action={mergeReconciliationLinesFormAction}
              className="flex w-full min-w-[200px] flex-1 flex-wrap items-end gap-1.5 sm:max-w-md"
              title={RECON_ACTION_HINTS.mergeManual}
            >
              <input type="hidden" name="receiptSideLineId" value={line.id} />
              <label className="min-w-0 flex-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-bv-muted)]">
                Map to PO row
                <SelectControl
                  name="poSideLineId"
                  required
                  className="mt-0.5 w-full rounded-[6px] border border-[var(--color-bv-border)] bg-white px-2 py-1 text-[11px] text-[var(--color-bv-text)]"
                >
                  <option value="">Choose PO line…</option>
                  {poCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.description.slice(0, 72)}
                    </option>
                  ))}
                </SelectControl>
              </label>
              <button
                type="submit"
                className="rounded-[6px] bg-[var(--color-bv-accent)] px-2.5 py-1.5 text-[11px] font-medium text-white hover:opacity-95"
              >
                Merge
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function CompareCell({
  label,
  primary,
  unit,
  qty,
  mono = false,
}: {
  label: string;
  primary: string;
  unit: string;
  qty: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-[8px] border border-[var(--color-bv-border)]/60 bg-[var(--color-bv-bg)]/50 px-2.5 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-bv-muted)]">
        {label}
      </p>
      <p
        className={`mt-0.5 truncate text-[12.5px] font-medium text-[var(--color-bv-text)] ${mono ? 'font-mono text-[11.5px]' : ''}`}
        title={primary}
      >
        {primary}
      </p>
      <p className="mt-1 text-[11px] tabular-nums text-[var(--color-bv-muted)]">
        {unit} × {qty}
      </p>
    </div>
  );
}

function ActionButton({
  formAction,
  hidden,
  label,
  hint,
  tone,
}: {
  formAction: (formData: FormData) => Promise<void>;
  hidden: { name: string; value: string }[];
  label: string;
  hint: string;
  tone: 'emerald' | 'amber' | 'rose';
}) {
  const toneClass =
    tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-950 hover:bg-emerald-100'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-950 hover:bg-amber-100'
        : 'border-rose-200 bg-rose-50 text-rose-950 hover:bg-rose-100';

  return (
    <form action={formAction}>
      {hidden.map((h) => (
        <input key={h.name} type="hidden" name={h.name} value={h.value} />
      ))}
      <button
        type="submit"
        title={hint}
        className={`rounded-[6px] border px-2.5 py-1 text-[11px] font-medium ${toneClass}`}
      >
        {label}
      </button>
    </form>
  );
}
