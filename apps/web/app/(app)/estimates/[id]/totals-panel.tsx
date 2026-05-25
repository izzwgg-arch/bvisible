'use client';

import Link from 'next/link';
import { useState } from 'react';
import { EstimateStatus, POStatus } from '@bvisible/db';
import type { BreakdownByKind } from '@bvisible/pricing';
import {
  receiptOcrOperationalHint,
  reconciliationGuidanceLabel,
} from '@/lib/estimate/estimate-fulfillment';
import { formatMoney } from '@/lib/estimate/format';
import { NumericCell } from '@/components/grid/cell-input';
import { parseMoney } from '@/lib/estimate/format';
import type { SaveEstimateState } from './actions';
import type { EditorBootstrap } from './editor';
import { labelEstimateStatus, labelPoStatus } from '@/lib/ui/status-labels';
import { evaluateEstimateFinalizeGates } from '@/lib/estimate/estimate-finalization';
import { FinalizedReadOnlyChip } from '@/components/estimate/finalized-read-only-chip';

const DEFAULT_MULTIPLIER_MILLI = 3000;

// FINALIZED is intentionally excluded — the only path into FINALIZED
// is the gated finalize action below, not the generic status changer.
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
  FINALIZED: 'border-violet-200 bg-violet-50 text-violet-700',
};

const PO_STATUS_TONE: Record<POStatus, string> = {
  DRAFT: 'border-slate-200 bg-slate-50 text-slate-700',
  SENT: 'border-blue-200 bg-blue-50 text-blue-700',
  ORDERED: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  PARTIALLY_RECEIVED: 'border-amber-200 bg-amber-50 text-amber-800',
  RECEIVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  CANCELED: 'border-rose-200 bg-rose-50 text-rose-700',
};

interface TotalsPanelProps {
  bootstrap: EditorBootstrap;
  breakdown: BreakdownByKind;
  subtotalCostCents: number;
  finalPriceCents: number;
  multiplierMilli: number;
  designFlatCents: number;
  readOnly?: boolean;
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
  poBusy: boolean;
  poMsg: string | null;
  finalizeBusy: boolean;
  finalizeMsg: string | null;
  onCreatePo: (vendorId: string | null) => void;
  onFinalize: () => void;
  onUnfinalize: (() => void) | null;
}

export function TotalsPanel(props: TotalsPanelProps) {
  const {
    bootstrap,
    breakdown,
    subtotalCostCents,
    finalPriceCents,
    multiplierMilli,
    designFlatCents,
    readOnly = false,
    dispatch,
    dirty,
    saving,
    statusBusy,
    deleting,
    saveState,
    onSave,
    onStatusChange,
    onDelete,
    poBusy,
    poMsg,
    finalizeBusy,
    finalizeMsg,
    onCreatePo,
    onFinalize,
    onUnfinalize,
  } = props;
  const [vendorChoice, setVendorChoice] = useState<string>('');

  const isFinalized = readOnly || bootstrap.estimate.status === EstimateStatus.FINALIZED;
  const linkedPos = bootstrap.linkedPos;
  const canStartEstimatePoHandoff =
    bootstrap.estimate.status === EstimateStatus.APPROVED && !isFinalized;
  const finalizeGates = evaluateEstimateFinalizeGates({
    estimateStatus: bootstrap.estimate.status,
    linkedPos: linkedPos.map((p) => ({
      id: p.id,
      number: p.number,
      qboPoNumber: p.qboPoNumber,
      latestReconciliationStatus: p.latestReconciliationStatus,
    })),
  });
  const finalizeBlockedReason = isFinalized
    ? null
    : finalizeGates.blockedReason;

  const multiplierLabel = (multiplierMilli / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  const multiplierIsCustom = multiplierMilli !== DEFAULT_MULTIPLIER_MILLI;

  return (
    <aside className="sticky top-6 flex flex-col gap-4">
      <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[14.5px] font-semibold tracking-tight text-[var(--color-bv-text)]">
            Totals
          </h2>
          {isFinalized ? <FinalizedReadOnlyChip /> : null}
        </div>

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
            {isFinalized ? (
              <span className="tabular-nums font-medium text-[var(--color-bv-text)]">
                {formatMoney(designFlatCents)}
              </span>
            ) : (
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
            )}
          </label>
          <label className="flex items-center justify-between gap-3 text-[12.5px] text-[var(--color-bv-muted)]">
            <span className="font-medium">
              Multiplier{' '}
              <span className="font-normal text-[var(--color-bv-muted)]">
                (×{multiplierLabel || '0'})
              </span>
            </span>
            {isFinalized ? (
              <span className="tabular-nums font-medium text-[var(--color-bv-text)]">
                ×{multiplierLabel || '0'}
              </span>
            ) : (
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
            )}
          </label>
          {multiplierIsCustom ? (
            <p className="text-[11.5px] text-amber-700">
              Override active (default ×3.000). Logged in audit trail on save.
            </p>
          ) : (
            <p className="text-[11.5px] leading-snug text-[var(--color-bv-muted)]">
              Default sell = raw line costs × this multiplier (×3 = triple cost). Catalog “sell hints” are separate guidance only.
            </p>
          )}
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
            disabled={saving || !dirty || isFinalized}
            title={isFinalized ? 'Unfinalize to edit this estimate.' : undefined}
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

      <section
        id="estimate-linked-pos"
        className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-[13.5px] font-semibold text-[var(--color-bv-text)]">
            Linked POs
          </h3>
          <span className="text-[11.5px] text-[var(--color-bv-muted)]">
            {linkedPos.length}
          </span>
        </div>
        <ul className="mt-2 flex flex-col gap-1.5 text-[12.5px]">
          {linkedPos.map((p) => {
            const reconPhrase = reconciliationGuidanceLabel(p.latestReconciliationStatus);
            const ocrPhrase = receiptOcrOperationalHint({
              receiptishAttachmentCount: p.receiptishAttachmentCount,
              ocrPendingOrProcessingCount: p.ocrPendingOrProcessingCount,
              ocrNeedsReviewCount: p.ocrNeedsReviewCount,
            });
            return (
              <li
                key={p.id}
                className="rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <Link
                      href={`/purchase-orders/${p.id}` as never}
                      className="font-mono text-[12px] text-[var(--color-bv-accent)] hover:underline"
                    >
                      {p.number}
                    </Link>
                    <span className="truncate text-[11px] text-[var(--color-bv-muted)]">
                      {p.vendor?.name ?? 'no vendor'} · {formatMoney(p.subtotalCents)} · QBO{' '}
                      {p.qboPoNumber ?? '—'} · created{' '}
                      <time dateTime={p.createdAtIso}>
                        {new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(
                          new Date(p.createdAtIso)
                        )}
                      </time>
                    </span>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10.5px] font-medium ${PO_STATUS_TONE[p.status]}`}
                  >
                    {labelPoStatus(p.status)}
                  </span>
                </div>
                {(p.reconciliationNeedsAttention || reconPhrase || ocrPhrase) && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {p.reconciliationNeedsAttention ? (
                      <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-amber-950">
                        Reconciliation attention
                      </span>
                    ) : null}
                    {reconPhrase ? (
                      <span className="rounded-full border border-[var(--color-bv-border)] bg-white px-1.5 py-0.5 text-[9.5px] font-medium text-[var(--color-bv-text)]">
                        {reconPhrase}
                      </span>
                    ) : null}
                    {ocrPhrase ? (
                      <span className="rounded-full border border-[var(--color-bv-border)] bg-white px-1.5 py-0.5 text-[9.5px] font-medium text-[var(--color-bv-text)]">
                        {ocrPhrase}
                      </span>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
          {linkedPos.length === 0 ? (
            <li className="text-[12px] text-[var(--color-bv-muted)]">
              No POs yet for this estimate.
            </li>
          ) : null}
        </ul>

        {!isFinalized ? (
          <div
            id="estimate-create-po"
            className="mt-3 flex flex-col gap-2 rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] p-3"
          >
            {canStartEstimatePoHandoff ? (
              <>
                <Link
                  href={`/purchase-orders/new?estimateId=${bootstrap.estimate.id}`}
                  className="inline-flex items-center justify-center rounded-[6px] border border-[var(--color-bv-border)] bg-white px-2.5 py-1.5 text-[12px] font-semibold text-[var(--color-bv-text)] hover:bg-[var(--color-bv-surface)]"
                >
                  Link existing purchase order…
                </Link>
                <label className="flex flex-col gap-1 text-[11.5px] text-[var(--color-bv-muted)]">
                  <span className="font-medium">Create PO from lines (copies estimate rows)</span>
                  <select
                    value={vendorChoice}
                    onChange={(e) => setVendorChoice(e.currentTarget.value)}
                    className="rounded-[6px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5 text-[12.5px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]"
                  >
                    <option value="">— pick vendor (optional) —</option>
                    {bootstrap.vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => onCreatePo(vendorChoice || null)}
                  disabled={poBusy}
                  className="inline-flex items-center justify-center rounded-[6px] bg-[var(--color-bv-accent)] px-2.5 py-1.5 text-[12.5px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-sm hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {poBusy ? 'Creating PO…' : 'Create PO from estimate'}
                </button>
              </>
            ) : (
              <p className="text-[12px] leading-snug text-[var(--color-bv-muted)]">
                PO creation and linking unlock when this estimate is{' '}
                <strong className="font-medium text-[var(--color-bv-text)]">Approved</strong> (customer
                acceptance). This keeps fulfillment aligned with explicit quote decisions.
              </p>
            )}
            {poMsg ? (
              <p className="text-[11.5px] text-rose-700">{poMsg}</p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3 flex flex-col gap-1.5">
          {!isFinalized ? (
            <>
              <button
                type="button"
                onClick={onFinalize}
                disabled={finalizeBusy || !!finalizeBlockedReason}
                title={finalizeBlockedReason ?? undefined}
                className="inline-flex items-center justify-center rounded-[8px] bg-violet-600 px-3.5 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                {finalizeBusy ? 'Finalizing…' : 'Finalize estimate'}
              </button>
              {finalizeBlockedReason ? (
                <p className="text-[11.5px] text-[var(--color-bv-muted)]">
                  {finalizeBlockedReason}
                </p>
              ) : finalizeGates.canFinalize ? (
                <p className="text-[11.5px] text-emerald-800">
                  Closeout gates passed — finalize locks status and line edits.
                </p>
              ) : null}
              {finalizeMsg ? (
                <p className="text-[11.5px] text-rose-700">{finalizeMsg}</p>
              ) : null}
            </>
          ) : onUnfinalize ? (
            <>
              <p className="rounded-[6px] border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[11.5px] text-violet-800">
                FINALIZED — locked. Unfinalize to edit again.
              </p>
              <button
                type="button"
                onClick={onUnfinalize}
                disabled={finalizeBusy}
                className="inline-flex items-center justify-center rounded-[6px] border border-violet-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {finalizeBusy ? 'Unfinalizing…' : 'Unfinalize'}
              </button>
              {finalizeMsg ? (
                <p className="text-[11.5px] text-rose-700">{finalizeMsg}</p>
              ) : null}
            </>
          ) : (
            <p className="rounded-[6px] border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[11.5px] text-violet-800">
              FINALIZED — only an admin can unfinalize.
            </p>
          )}
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
                disabled={statusBusy || active || isFinalized}
                onClick={() => onStatusChange(s)}
                className={`inline-flex items-center justify-center rounded-[6px] border px-2 py-1.5 text-[12.5px] font-medium ${
                  active
                    ? STATUS_TONE[s]
                    : 'border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)] hover:bg-[var(--color-bv-surface)]'
                } disabled:cursor-not-allowed`}
              >
                {labelEstimateStatus(s)}
              </button>
            );
          })}
        </div>
        {isFinalized ? (
          <p className="mt-2 text-[11.5px] text-[var(--color-bv-muted)]">
            Status is locked while FINALIZED.
          </p>
        ) : null}
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
