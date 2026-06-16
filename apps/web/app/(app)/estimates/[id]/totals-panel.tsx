'use client';

import Link from 'next/link';
import { useState } from 'react';
import { EstimateStatus } from '@bvisible/db';
import type { BreakdownByKind } from '@bvisible/pricing';
import { formatMoney } from '@/lib/estimate/format';
import { NumericCell } from '@/components/grid/cell-input';
import { parseMoney } from '@/lib/estimate/format';
import type { SaveEstimateState } from './actions';
import type { EditorBootstrap } from './editor';
import { labelEstimateStatus } from '@/lib/ui/status-labels';
import { evaluateEstimateFinalizeGates } from '@/lib/estimate/estimate-finalization';
import { FinalizedReadOnlyChip } from '@/components/estimate/finalized-read-only-chip';
import {
  SectionCard,
  SectionHeading,
  IconReceipt,
  IconTruck,
  IconFlag,
} from '@/components/estimate/estimate-surface';

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
  const profitCents = finalPriceCents - subtotalCostCents;
  const marginPct =
    finalPriceCents > 0 ? (profitCents / finalPriceCents) * 100 : null;

  return (
    <aside className="sticky top-6 flex flex-col gap-4">
      <SectionCard className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <SectionHeading
            icon={<IconReceipt />}
            title="Pricing Summary"
            badge={isFinalized ? <FinalizedReadOnlyChip /> : null}
          />
        </div>

        <div className="px-5 pt-4">
          <div className="mb-4 grid grid-cols-2 gap-3">
            <SummaryMetric label="Sell price" value={formatMoney(finalPriceCents)} strong />
            <SummaryMetric label="Cost" value={formatMoney(subtotalCostCents)} />
            <SummaryMetric
              label="Profit"
              value={formatMoney(profitCents)}
              valueClass={profitCents >= 0 ? 'text-emerald-700' : 'text-rose-700'}
            />
            <SummaryMetric
              label="Margin"
              value={marginPct == null ? '—' : `${marginPct.toFixed(1)}%`}
              valueClass="text-emerald-700"
            />
          </div>

          <details className="rounded-[13px] border border-slate-200 bg-slate-50/60">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-[12px] font-bold text-slate-700 marker:content-none [&::-webkit-details-marker]:hidden">
              View pricing breakdown
              <span aria-hidden className="text-slate-400">›</span>
            </summary>
            <div className="border-t border-slate-200 px-3 pb-3 pt-2">
              <dl className="flex flex-col gap-1.5 text-[13px]">
                <Row label="Materials" value={breakdown.materialsCents} />
                <Row label="Machines" value={breakdown.machinesCents} />
                <Row label="Labor" value={breakdown.laborCents} />
                <Row label="Design" value={breakdown.designCents} />
                <Row label="Install" value={breakdown.installCents} />
                <Row label="Misc" value={breakdown.miscCents} />
                <div className="my-1.5 border-t border-dashed border-slate-200" />
                <Row label="Raw cost" value={subtotalCostCents} bold />
              </dl>
            </div>
          </details>

          <div className="mt-4 flex flex-col gap-2.5 rounded-[14px] border border-slate-200 bg-slate-50/60 p-3.5">
            <label className="flex items-center justify-between gap-3 text-[12.5px] text-slate-500">
              <span className="font-semibold text-slate-700">Design flat fee</span>
              {isFinalized ? (
                <span className="tabular-nums font-semibold text-slate-900">
                  {formatMoney(designFlatCents)}
                </span>
              ) : (
                <span className="w-[110px] rounded-lg border border-slate-200 bg-white shadow-sm focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10">
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
            <label className="flex items-center justify-between gap-3 text-[12.5px] text-slate-500">
              <span className="font-semibold text-slate-700">
                Multiplier{' '}
                <span className="font-normal text-slate-400">(×{multiplierLabel || '0'})</span>
              </span>
              {isFinalized ? (
                <span className="tabular-nums font-semibold text-slate-900">
                  ×{multiplierLabel || '0'}
                </span>
              ) : (
                <span className="w-[110px] rounded-lg border border-slate-200 bg-white shadow-sm focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10">
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
              <p className="flex items-start gap-1.5 text-[11.5px] text-amber-700">
                <span aria-hidden>⚠</span>
                Override active (default ×3.000). Logged in audit trail on save.
              </p>
            ) : (
              <p className="text-[11.5px] leading-snug text-slate-400">
                Default sell = raw line costs × this multiplier (×3 = triple cost). Catalog “sell
                hints” are separate guidance only.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 px-5 pb-5 pt-4">
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !dirty || isFinalized}
            title={isFinalized ? 'Unfinalize to edit this estimate.' : undefined}
            className={`inline-flex items-center justify-center rounded-[12px] px-3.5 py-3 text-[13.5px] font-bold shadow-sm transition disabled:cursor-not-allowed ${
              dirty && !isFinalized
                ? 'bg-blue-600 text-white hover:bg-blue-500'
                : 'bg-slate-100 text-slate-400'
            }`}
          >
            {saving ? 'Saving…' : dirty ? 'Save changes  ⌘S' : '✓ Saved'}
          </button>
          {saveState.error ? (
            <p className="text-[12px] text-rose-700">{saveState.error}</p>
          ) : saveState.savedAt ? (
            <p className="text-[12px] text-emerald-700">
              Saved · cost {formatMoney(saveState.subtotalCostCents ?? 0)} · sell{' '}
              {formatMoney(saveState.finalPriceCents ?? 0)}
            </p>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard className="p-5">
        <SectionHeading icon={<IconReceipt />} tone="blue" title="Customer" />
        <div className="mt-3 rounded-[14px] border border-slate-200 bg-slate-50/50 px-3 py-3">
          <p className="text-[13px] font-bold text-slate-950">
            {bootstrap.estimate.client.companyName}
          </p>
          <dl className="mt-2 grid gap-1.5 text-[12px]">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-400">Contact</dt>
              <dd className="truncate font-medium text-slate-700">
                {bootstrap.estimate.client.contactName ?? '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-400">Email</dt>
              <dd className="truncate font-medium text-slate-700">
                {bootstrap.estimate.client.email ?? '—'}
              </dd>
            </div>
          </dl>
          <Link
            href="/clients"
            className="mt-3 inline-flex w-full items-center justify-center rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-[12px] font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            View customers
          </Link>
        </div>
      </SectionCard>

      <SectionCard className="p-5">
        <SectionHeading icon={<IconFlag />} tone="emerald" title="Workflow Status" />
        <ol className="mt-3 flex flex-col gap-2">
          <WorkflowStep label="Quote Sent" done={bootstrap.estimate.quoteSent} />
          <WorkflowStep
            label="Approved"
            done={
              bootstrap.estimate.status === EstimateStatus.APPROVED ||
              bootstrap.estimate.status === EstimateStatus.FINALIZED
            }
          />
          <WorkflowStep label="PO Created" done={linkedPos.length > 0} />
          <WorkflowStep label="Invoiced" done={bootstrap.estimate.hasInvoice} />
          <WorkflowStep label="Paid" done={bootstrap.estimate.invoicePaid} />
        </ol>
      </SectionCard>

      {canStartEstimatePoHandoff ? (
        <SectionCard id="estimate-create-po" className="p-5">
          <SectionHeading icon={<IconTruck />} tone="amber" title="Fulfillment" />
          <div className="mt-3 flex flex-col gap-2 rounded-[14px] border border-amber-200 bg-amber-50/60 p-3">
            <Link
              href={`/purchase-orders/new?estimateId=${bootstrap.estimate.id}`}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[12px] font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
            >
              Link existing purchase order…
            </Link>
            <label className="flex flex-col gap-1 text-[11.5px] text-slate-500">
              <span className="font-semibold text-slate-600">Create PO from estimate rows</span>
              <select
                value={vendorChoice}
                onChange={(e) => setVendorChoice(e.currentTarget.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[12.5px] text-slate-700 outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10"
              >
                <option value="">Pick vendor (optional)</option>
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
              className="inline-flex items-center justify-center rounded-[10px] bg-amber-500 px-2.5 py-2.5 text-[12.5px] font-bold text-white shadow-sm transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {poBusy ? 'Creating PO…' : 'Create purchase order'}
            </button>
            {poMsg ? <p className="text-[11.5px] text-rose-700">{poMsg}</p> : null}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard className="p-5">
        <SectionHeading icon={<IconFlag />} tone="violet" title="Closeout" />
        <div className="mt-3 flex flex-col gap-1.5">
          {!isFinalized ? (
            <>
              <button
                type="button"
                onClick={onFinalize}
                disabled={finalizeBusy || !!finalizeBlockedReason}
                title={finalizeBlockedReason ?? undefined}
                className="inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-gradient-to-br from-violet-600 to-fuchsia-600 px-3.5 py-2.5 text-[13px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(124,58,237,0.7)] transition hover:from-violet-500 hover:to-fuchsia-500 disabled:cursor-not-allowed disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 disabled:shadow-none"
              >
                <IconFlag width={15} height={15} />
                {finalizeBusy ? 'Finalizing…' : 'Finalize estimate'}
              </button>
              {finalizeBlockedReason ? (
                <p className="text-[11.5px] text-slate-400">{finalizeBlockedReason}</p>
              ) : finalizeGates.canFinalize ? (
                <p className="text-[11.5px] text-emerald-700">
                  Closeout gates passed — finalize locks status and line edits.
                </p>
              ) : null}
              {finalizeMsg ? <p className="text-[11.5px] text-rose-700">{finalizeMsg}</p> : null}
            </>
          ) : onUnfinalize ? (
            <>
              <p className="rounded-[10px] border border-violet-200 bg-violet-50 px-3 py-2 text-[11.5px] text-violet-800">
                FINALIZED — locked. Unfinalize to edit again.
              </p>
              <button
                type="button"
                onClick={onUnfinalize}
                disabled={finalizeBusy}
                className="inline-flex items-center justify-center rounded-lg border border-violet-200 bg-white px-2.5 py-2 text-[12px] font-semibold text-violet-700 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {finalizeBusy ? 'Unfinalizing…' : 'Unfinalize'}
              </button>
              {finalizeMsg ? <p className="text-[11.5px] text-rose-700">{finalizeMsg}</p> : null}
            </>
          ) : (
            <p className="rounded-[10px] border border-violet-200 bg-violet-50 px-3 py-2 text-[11.5px] text-violet-800">
              FINALIZED — only an admin can unfinalize.
            </p>
          )}
        </div>
      </SectionCard>

      <SectionCard id="estimate-status-controls" className="p-5">
        <SectionHeading icon={<IconFlag />} tone="slate" title="Status" />
        <div className="mt-3 grid grid-cols-2 gap-2">
          {STATUS_OPTIONS.map((s) => {
            const active = bootstrap.estimate.status === s;
            return (
              <button
                key={s}
                type="button"
                disabled={statusBusy || active || isFinalized}
                onClick={() => onStatusChange(s)}
              className={`inline-flex items-center justify-center rounded-[10px] border px-2 py-2.5 text-[12.5px] font-bold transition ${
                  active
                    ? STATUS_TONE[s]
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50 disabled:hover:bg-white'
                } disabled:cursor-not-allowed`}
              >
                {labelEstimateStatus(s)}
              </button>
            );
          })}
        </div>
        {isFinalized ? (
          <p className="mt-2.5 text-[11.5px] text-slate-400">Status is locked while FINALIZED.</p>
        ) : null}
        <p className="mt-3 text-[11.5px] text-slate-400">
          {bootstrap.estimate.number} · client {bootstrap.estimate.client.companyName}
        </p>
      </SectionCard>

      {onDelete ? (
        <details className="rounded-[18px] border border-rose-100 bg-white/90 shadow-sm">
          <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-semibold text-rose-700 marker:content-none [&::-webkit-details-marker]:hidden">
            Danger zone
          </summary>
          <div className="border-t border-rose-100 bg-rose-50/40 px-4 pb-4 pt-3">
            <p className="text-[11.5px] text-rose-700">
              Soft-deletes this estimate. It disappears from the list. Audit log retains the row.
            </p>
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="mt-2.5 inline-flex items-center justify-center rounded-lg border border-rose-200 bg-white px-2.5 py-2 text-[12px] font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleting ? 'Deleting…' : 'Delete estimate'}
            </button>
          </div>
        </details>
      ) : null}
    </aside>
  );
}

function SummaryMetric({
  label,
  value,
  strong = false,
  valueClass = 'text-slate-950',
}: {
  label: string;
  value: string;
  strong?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-3 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p
        className={`mt-1 font-bold leading-none tabular-nums ${valueClass} ${
          strong ? 'text-[24px]' : 'text-[18px]'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function WorkflowStep({ label, done }: { label: string; done: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-[12px] border border-slate-200 bg-slate-50/55 px-3 py-2.5">
      <span className="flex min-w-0 items-center gap-2 text-[12.5px] font-semibold text-slate-700">
        <span
          aria-hidden
          className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${
            done ? 'bg-emerald-500 text-white' : 'bg-white text-slate-300 ring-1 ring-inset ring-slate-200'
          }`}
        >
          {done ? '✓' : ''}
        </span>
        {label}
      </span>
      <span className="text-[11px] font-medium text-slate-400">{done ? 'Done' : 'Pending'}</span>
    </li>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className={bold ? 'font-semibold text-slate-700' : 'text-slate-500'}>{label}</dt>
      <dd
        className={`tabular-nums ${bold ? 'text-[14px] font-bold text-slate-900' : 'text-slate-700'}`}
      >
        {formatMoney(value)}
      </dd>
    </div>
  );
}
