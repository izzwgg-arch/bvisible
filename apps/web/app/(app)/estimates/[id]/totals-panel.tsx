'use client';

import { EstimateStatus } from '@bvisible/db';
import type { BreakdownByKind } from '@bvisible/pricing';
import { formatMoney } from '@/lib/estimate/format';
import { NumericCell } from '@/components/grid/cell-input';
import { parseMoney } from '@/lib/estimate/format';
import type { SaveEstimateState } from './actions';
import type { EditorBootstrap } from './editor';

const DEFAULT_MULTIPLIER_MILLI = 3000;

const STATUS_OPTIONS: ReadonlyArray<EstimateStatus> = [
  EstimateStatus.DRAFT,
  EstimateStatus.SENT,
  EstimateStatus.APPROVED,
  EstimateStatus.REJECTED,
];

const STATUS_TONE: Record<EstimateStatus, string> = {
  DRAFT: 'border-slate-200 bg-slate-50 text-slate-700',
  SENT: 'border-blue-200 bg-blue-50 text-blue-700',
  APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  REJECTED: 'border-rose-200 bg-rose-50 text-rose-700',
};

interface TotalsPanelProps {
  bootstrap: EditorBootstrap;
  breakdown: BreakdownByKind;
  subtotalCostCents: number;
  finalPriceCents: number;
  multiplierMilli: number;
  designFlatCents: number;
  dispatch: React.Dispatch<
    | { type: 'set-multiplier'; value: number }
    | { type: 'set-design-flat'; value: number }
    | { type: 'add-line'; kind: any }
    | { type: 'remove-line'; id: string }
    | { type: 'move-line'; id: string; dir: -1 | 1 }
    | { type: 'set-line'; id: string; patch: any }
    | { type: 'pick-machine'; id: string; machineId: string | null; ratePerHourCents: number | null }
    | { type: 'set-meta'; field: 'title' | 'notes'; value: string }
    | { type: 'reset-baseline'; hash: string }
  >;
  dirty: boolean;
  saving: boolean;
  statusBusy: boolean;
  deleting: boolean;
  saveState: SaveEstimateState;
  onSave: () => void;
  onStatusChange: (next: EstimateStatus) => void;
  onDelete: (() => void) | null;
}

export function TotalsPanel(props: TotalsPanelProps) {
  const {
    bootstrap,
    breakdown,
    subtotalCostCents,
    finalPriceCents,
    multiplierMilli,
    designFlatCents,
    dispatch,
    dirty,
    saving,
    statusBusy,
    deleting,
    saveState,
    onSave,
    onStatusChange,
    onDelete,
  } = props;

  const multiplierLabel = (multiplierMilli / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  const multiplierIsCustom = multiplierMilli !== DEFAULT_MULTIPLIER_MILLI;

  return (
    <aside className="sticky top-6 flex flex-col gap-4">
      <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
        <h2 className="text-[14.5px] font-semibold tracking-tight text-[var(--color-bv-text)]">
          Totals
        </h2>

        <dl className="mt-3 flex flex-col gap-1 text-[13px]">
          <Row label="Materials" value={breakdown.materialsCents} />
          <Row label="Machines" value={breakdown.machinesCents} />
          <Row label="Labor" value={breakdown.laborCents} />
          <Row label="Design" value={breakdown.designCents} />
          <Row label="Install" value={breakdown.installCents} />
          <Row label="Misc" value={breakdown.miscCents} />
          <div className="my-2 border-t border-[var(--color-bv-border)]" />
          <Row label="Raw cost" value={subtotalCostCents} bold />
        </dl>

        <div className="mt-4 flex flex-col gap-2 rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] p-3">
          <label className="flex items-center justify-between gap-3 text-[12.5px] text-[var(--color-bv-muted)]">
            <span className="font-medium">Design flat fee</span>
            <span className="w-[110px] rounded-md border border-[var(--color-bv-border)] bg-white">
              <NumericCell
                value={designFlatCents}
                onCommit={(v) => dispatch({ type: 'set-design-flat', value: v })}
                format={formatMoney}
                parse={parseMoney}
                ariaLabel="Design flat fee"
                cellRow={-1}
                cellCol="design-flat"
                align="right"
              />
            </span>
          </label>
          <label className="flex items-center justify-between gap-3 text-[12.5px] text-[var(--color-bv-muted)]">
            <span className="font-medium">
              Multiplier{' '}
              <span className="font-normal text-[var(--color-bv-muted)]">
                (×{multiplierLabel || '0'})
              </span>
            </span>
            <span className="w-[110px] rounded-md border border-[var(--color-bv-border)] bg-white">
              <NumericCell
                value={multiplierMilli}
                onCommit={(v) => dispatch({ type: 'set-multiplier', value: Math.max(0, v) })}
                format={(v) => (v / 1000).toString()}
                parse={(input) => {
                  const trimmed = input.trim();
                  if (trimmed === '') return DEFAULT_MULTIPLIER_MILLI;
                  if (!/^\d+(\.\d{1,3})?$/.test(trimmed)) return null;
                  return Math.round(Number(trimmed) * 1000);
                }}
                ariaLabel="Sell multiplier"
                cellRow={-1}
                cellCol="multiplier"
                align="right"
              />
            </span>
          </label>
          {multiplierIsCustom ? (
            <p className="text-[11.5px] text-amber-700">
              Override active (default ×3.000). Logged in audit trail on save.
            </p>
          ) : null}
        </div>

        <div className="mt-4 rounded-[8px] border border-[var(--color-bv-accent)]/30 bg-[var(--color-bv-accent)]/5 p-3">
          <div className="text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
            Final sell price
          </div>
          <div className="mt-1 text-[22px] font-semibold tabular-nums text-[var(--color-bv-text)]">
            {formatMoney(finalPriceCents)}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !dirty}
            className="inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving…' : dirty ? 'Save changes (⌘S)' : 'Saved'}
          </button>
          {saveState.error ? (
            <p className="text-[12px] text-rose-700">{saveState.error}</p>
          ) : saveState.savedAt ? (
            <p className="text-[12px] text-emerald-700">
              Saved · cost {formatMoney(saveState.subtotalCostCents ?? 0)} · sell {formatMoney(saveState.finalPriceCents ?? 0)}
            </p>
          ) : null}
        </div>
      </section>

      <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
        <h3 className="text-[13.5px] font-semibold text-[var(--color-bv-text)]">Status</h3>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {STATUS_OPTIONS.map((s) => {
            const active = bootstrap.estimate.status === s;
            return (
              <button
                key={s}
                type="button"
                disabled={statusBusy || active}
                onClick={() => onStatusChange(s)}
                className={`inline-flex items-center justify-center rounded-[6px] border px-2 py-1.5 text-[12.5px] font-medium ${
                  active
                    ? STATUS_TONE[s]
                    : 'border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)] hover:bg-[var(--color-bv-surface)]'
                } disabled:cursor-not-allowed`}
              >
                {s}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[11.5px] text-[var(--color-bv-muted)]">
          {bootstrap.estimate.number} · client {bootstrap.estimate.client.companyName}
        </p>
      </section>

      {onDelete ? (
        <section className="rounded-[var(--radius-bv)] border border-rose-100 bg-rose-50/40 p-4">
          <h3 className="text-[13px] font-semibold text-rose-800">Danger zone</h3>
          <p className="mt-1 text-[11.5px] text-rose-700">
            Soft-deletes this estimate. It disappears from the list. Audit log retains the row.
          </p>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="mt-2 inline-flex items-center justify-center rounded-[6px] border border-rose-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleting ? 'Deleting…' : 'Delete estimate'}
          </button>
        </section>
      ) : null}
    </aside>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-[var(--color-bv-muted)]">{label}</dt>
      <dd className={`tabular-nums ${bold ? 'font-semibold text-[var(--color-bv-text)]' : 'text-[var(--color-bv-text)]'}`}>
        {formatMoney(value)}
      </dd>
    </div>
  );
}
