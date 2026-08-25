'use client';

import Link from 'next/link';
import { useState, useTransition, type ReactNode } from 'react';
import { EstimateStatus } from '@bvisible/db';
import { updateEstimateSalesRepAction, updateEstimateTaxExemptAction } from './actions';
import { computeSalesTax, formatTaxPercent } from '@/lib/estimate/sales-tax';
import type { BreakdownByKind } from '@bvisible/pricing';
import { SelectControl } from '@/components/app/select-control';
import { formatMoney } from '@/lib/estimate/format';
import { NumericCell } from '@/components/grid/cell-input';
import { parseMoney } from '@/lib/estimate/format';
import type { SaveEstimateState } from './actions';
import type { EditorBootstrap } from './editor';
import { FinalizedReadOnlyChip } from '@/components/estimate/finalized-read-only-chip';
import {
  SectionCard,
  SectionHeading,
  IconReceipt,
  IconTruck,
  IconFlag,
} from '@/components/estimate/estimate-surface';

const DEFAULT_MULTIPLIER_MILLI = 3000;
const DEFAULT_DESIGN_FEE_CENTS = 15000;

interface TotalsPanelProps {
  bootstrap: EditorBootstrap;
  breakdown: BreakdownByKind;
  subtotalCostCents: number;
  finalPriceCents: number;
  multiplierMilli: number;
  designFlatCents: number;
  lineCount: number;
  lineItems?: ReactNode;
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
  deleting: boolean;
  saveState: SaveEstimateState;
  onSave: () => void;
  onDelete: (() => void) | null;
  poBusy: boolean;
  poMsg: string | null;
  onCreatePo: (vendorId: string | null) => void;
  variant?: 'pricing' | 'context' | 'workflow' | 'fulfillment' | 'admin' | 'sidebar';
}

export function TotalsPanel(props: TotalsPanelProps) {
  const {
    bootstrap,
    breakdown,
    subtotalCostCents,
    finalPriceCents,
    multiplierMilli,
    designFlatCents,
    lineCount,
    lineItems,
    readOnly = false,
    dispatch,
    dirty,
    saving,
    deleting,
    saveState,
    onSave,
    onDelete,
    poBusy,
    poMsg,
    onCreatePo,
    variant,
  } = props;
  const [vendorChoice, setVendorChoice] = useState<string>('');
  // Mirror of the customer document: an exempt estimate ignores the company
  // rate. Computed with the same helper the PDF uses so the number the
  // estimator sees here is the number the customer receives.
  const taxExempt = bootstrap.estimate.taxExempt;
  const salesTax = computeSalesTax(
    finalPriceCents,
    taxExempt ? 0 : bootstrap.salesTaxPercentMilli,
  );

  const isFinalized = readOnly || bootstrap.estimate.status === EstimateStatus.FINALIZED;
  // Markup / multiplier / design fee edits are for authorized (admin)
  // users only — everyone else sees the values read-only.
  const canEditPricing = !isFinalized && bootstrap.canEditPricing;
  const linkedPos = bootstrap.linkedPos;
  const canStartEstimatePoHandoff =
    bootstrap.estimate.status === EstimateStatus.APPROVED && !isFinalized;
  const multiplierLabel = (multiplierMilli / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  const multiplierIsCustom = multiplierMilli !== DEFAULT_MULTIPLIER_MILLI;
  const designFeeEnabled = designFlatCents > 0;
  const designFeeMultiplierLabel = designFeeEnabled
    ? (designFlatCents / DEFAULT_DESIGN_FEE_CENTS).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    : '0';
  const profitCents = finalPriceCents - subtotalCostCents;
  const markupPct = subtotalCostCents > 0 ? (profitCents / subtotalCostCents) * 100 : null;
  const totalHours = Object.values(breakdown).reduce((total, value) => total + (value > 0 ? 1 : 0), 0);
  const showPricing = variant == null || variant === 'pricing';
  const showContext = variant == null || variant === 'context';
  const showWorkflow = variant == null || variant === 'workflow';
  const showFulfillment = variant == null || variant === 'fulfillment';
  const showAdmin = variant == null || variant === 'admin';

  if (variant === 'sidebar') {
    return (
      <aside className="sticky top-4 flex flex-col gap-3">
        <SectionCard className="overflow-hidden rounded-[14px] border-[#eadfd3] bg-[#fffdfa] p-4 ring-1 ring-[#F28744]/10">
          <div className="-mx-4 -mt-4 mb-4 flex items-center justify-between gap-2 border-b border-[#eadfd3] bg-[#fff4e8] px-4 py-3 shadow-[inset_0_-1px_0_rgba(242,135,68,0.16)]">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#F28744] shadow-[0_0_0_4px_rgba(242,135,68,0.14)]" />
              <h2 className="text-[14px] font-black text-[#1C4972]">Estimate Summary</h2>
            </div>
            {isFinalized ? <FinalizedReadOnlyChip /> : null}
          </div>
          <dl className="space-y-2 text-[12px]">
            <SideRow label="Subtotal (before tax)" value={formatMoney(finalPriceCents)} />
            <div className="rounded-[9px] border border-[#F28744]/25 bg-[#fff0e5] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
              <div className="flex items-center justify-between gap-3">
                <span className="font-black text-[#1C4972]">Design fee</span>
                {!canEditPricing ? (
                  <span className="tabular-nums font-bold text-slate-900">
                    {designFeeEnabled ? `x${designFeeMultiplierLabel}` : 'Off'}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: 'set-design-flat',
                        value: designFeeEnabled ? 0 : DEFAULT_DESIGN_FEE_CENTS,
                      })
                    }
                    className={`inline-flex h-6 items-center rounded-full px-1 text-[10px] font-black transition shadow-sm ${
                      designFeeEnabled
                        ? 'w-[44px] justify-end bg-[#F28744] text-white'
                        : 'w-[42px] justify-start bg-slate-200 text-slate-500'
                    }`}
                    aria-pressed={designFeeEnabled}
                    aria-label="Toggle design fee"
                  >
                    <span className="grid h-4 w-4 place-items-center rounded-full bg-white text-[8px] text-slate-500 shadow-sm">
                      {designFeeEnabled ? 'On' : 'Off'}
                    </span>
                  </button>
                )}
              </div>
              {designFeeEnabled ? (
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-[11px] font-semibold text-[#1C4972]/65">Multiplier</span>
                  {!canEditPricing ? (
                    <span className="tabular-nums font-bold text-slate-900">
                      x{designFeeMultiplierLabel}
                    </span>
                  ) : (
                    <span className="w-[96px] rounded-md border border-[#F28744]/30 bg-white shadow-sm focus-within:border-[#F28744] focus-within:ring-4 focus-within:ring-[#F28744]/10">
                      <NumericCell
                        value={designFlatCents}
                        onCommit={(v) =>
                          dispatch({
                            type: 'set-design-flat',
                            value: Math.max(0, v),
                          })
                        }
                        format={(v) =>
                          (v / DEFAULT_DESIGN_FEE_CENTS)
                            .toFixed(2)
                            .replace(/0+$/, '')
                            .replace(/\.$/, '')
                        }
                        parse={(input) => {
                          const trimmed = input.trim();
                          if (trimmed === '') return DEFAULT_DESIGN_FEE_CENTS;
                          if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
                          return Math.round(Number(trimmed) * DEFAULT_DESIGN_FEE_CENTS);
                        }}
                        ariaLabel="Design fee multiplier"
                        cellRow={-1}
                        cellCol="summary-design-fee"
                        align="right"
                      />
                    </span>
                  )}
                </div>
              ) : (
                <p className="mt-1.5 text-[11px] leading-snug text-[#1C4972]/60">
                  Off. Turn on to add the base {formatMoney(DEFAULT_DESIGN_FEE_CENTS)} design fee.
                </p>
              )}
            </div>
            <SideRow label="Discount" value="$0.00 ✎" muted />
            <SideRow
              label={taxExempt ? 'Tax (exempt)' : salesTax.applied ? `Tax (${salesTax.label})` : 'Tax'}
              value={formatMoney(salesTax.taxCents)}
              muted={salesTax.taxCents === 0}
            />
            <div className="my-3 border-t border-[#eadfd3]" />
            <SideRow label="Total" value={formatMoney(salesTax.totalCents)} strong />
          </dl>

          <div className="mt-5 rounded-[9px] border border-[#1C4972]/15 bg-[#eef5f9] px-3 py-3">
            <dl className="space-y-2 text-[12px]">
              <SideRow label="Total cost (materials + labor)" value={formatMoney(subtotalCostCents)} />
              <SideRow label="Selling price" value={formatMoney(finalPriceCents)} />
              {designFeeEnabled ? (
                <SideRow
                  label={`Design fee (${formatMoney(DEFAULT_DESIGN_FEE_CENTS)} x ${designFeeMultiplierLabel})`}
                  value={formatMoney(designFlatCents)}
                />
              ) : null}
              <SideRow label="Profit" value={formatMoney(profitCents)} valueClass={profitCents >= 0 ? 'text-emerald-700' : 'text-rose-700'} />
              {canEditPricing ? (
                <PercentEditorRow
                  label="Markup % (on cost)"
                  value={markupPct}
                  valueClass="text-emerald-700"
                  onCommit={(pct) => {
                    if (pct >= 0 && pct <= 10000)
                      dispatch({
                        type: 'set-multiplier',
                        value: Math.max(0, Math.round((1 + pct / 100) * 1000)),
                      });
                  }}
                />
              ) : (
                <SideRow label="Markup % (on cost)" value={markupPct == null ? '-' : `${markupPct.toFixed(1)}%`} valueClass="text-emerald-700" />
              )}
              <p className="!mt-2 text-[10px] leading-snug text-[#1C4972]/55">
                Markup is on cost: 200% markup = selling price is 3× cost
                ($100 cost → $300 sell). Changing it recalculates the selling price.
                {!canEditPricing ? ' Only admins can change markup or the design fee.' : ''}
              </p>
              <SideRow label="Hours" value={totalHours > 0 ? `${totalHours} available` : '-'} muted={totalHours === 0} />
            </dl>
          </div>

          <SalesRepSelect
            estimateId={bootstrap.estimate.id}
            salesRepId={bootstrap.estimate.salesRepId}
            salesReps={bootstrap.salesReps}
            disabled={isFinalized}
          />

          <TaxExemptControl
            estimateId={bootstrap.estimate.id}
            taxExempt={taxExempt}
            taxExemptReason={bootstrap.estimate.taxExemptReason}
            ratePercentMilli={bootstrap.salesTaxPercentMilli}
            disabled={isFinalized}
          />

          <section className="mt-5">
            <h3 className="text-[13px] font-black text-[#1C4972]">Workflow</h3>
            <ol className="mt-3 space-y-2 text-[12px]">
              <WorkflowDot label="Draft" active done />
              <WorkflowDot label="Sent" done={bootstrap.estimate.quoteSent} />
              <WorkflowDot label="Approved" done={bootstrap.estimate.status === EstimateStatus.APPROVED || bootstrap.estimate.status === EstimateStatus.FINALIZED} />
              <WorkflowDot label="PO Created" done={linkedPos.length > 0} />
              <WorkflowDot label="Finalized" done={bootstrap.estimate.status === EstimateStatus.FINALIZED} last />
            </ol>
          </section>

          <section className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[13px] font-black text-[#1C4972]">Notes</h3>
              <span className="text-[11px] font-bold text-[#F28744]">Edit</span>
            </div>
            <textarea
              value={bootstrap.estimate.notes}
              onChange={(e) => dispatch({ type: 'set-meta', field: 'notes', value: e.currentTarget.value })}
              disabled={readOnly}
              placeholder="Add internal notes here..."
              rows={5}
              className="w-full resize-none rounded-[7px] border border-[#eadfd3] bg-white px-3 py-2 text-[12px] leading-relaxed text-[#1C4972] outline-none placeholder:text-slate-400 focus:border-[#F28744] focus:ring-2 focus:ring-[#F28744]/15 disabled:bg-slate-50"
            />
            {saveState.error ? <p className="mt-2 text-[11px] text-rose-700">{saveState.error}</p> : null}
          </section>
        </SectionCard>
      </aside>
    );
  }

  return (
    <aside className="flex flex-col gap-4">
      {showPricing ? (
      <SectionCard className="overflow-hidden bg-white/95">
        {lineItems ? (
          <div className="border-b border-slate-100 bg-white">
            {lineItems}
          </div>
        ) : null}
        <div className="border-b border-slate-100 bg-white/70 px-4 py-3">
          <SectionHeading
            icon={<IconReceipt />}
            title="Pricing summary"
            badge={isFinalized ? <FinalizedReadOnlyChip /> : null}
          />
        </div>

        <div className="px-4 pt-4">
          <div className="mb-3 grid grid-cols-5 gap-3">
            <SummaryMetric label="Total cost" value={formatMoney(subtotalCostCents)} />
            <SummaryMetric label="Selling price" value={formatMoney(finalPriceCents)} />
            <SummaryMetric
              label="Total profit"
              value={formatMoney(profitCents)}
              valueClass={profitCents >= 0 ? 'text-emerald-700' : 'text-rose-700'}
            />
            <SummaryMetric
              label="Markup on cost"
              value={markupPct == null ? '—' : `${markupPct.toFixed(1)}%`}
              valueClass="text-emerald-700"
            />
            <SummaryMetric label="Total hours" value={`${Math.max(lineCount, 1)} hrs`} />
          </div>

          <div className="rounded-[15px] border border-slate-200 bg-slate-50/60">
            <div className="px-3 py-2.5 text-[12px] font-bold text-slate-700">
              Pricing breakdown
            </div>
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

              <div className="mt-4 flex flex-col gap-2.5 rounded-[16px] border border-slate-200 bg-white p-3">
            <label className="flex items-center justify-between gap-3 text-[12.5px] text-slate-500">
              <span className="font-semibold text-slate-700">Design flat fee</span>
              {!canEditPricing ? (
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
              {!canEditPricing ? (
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
          </div>
        </div>

        <div className="flex flex-col gap-2 px-4 pb-4 pt-3">
          {dirty ? (
            <button
              type="button"
              onClick={onSave}
              disabled={saving || isFinalized}
              title={isFinalized ? 'Unfinalize to edit this estimate.' : undefined}
              className="inline-flex items-center justify-center rounded-[12px] bg-blue-600 px-3.5 py-3 text-[13.5px] font-bold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              {saving ? 'Saving...' : 'Save changes  Cmd+S'}
            </button>
          ) : null}
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
      ) : null}

      {showContext ? (
      <SectionCard className="overflow-hidden rounded-none border-0 bg-white p-0 shadow-none ring-0">
        <div className="px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-blue-600 text-[16px] font-black text-white shadow-sm">
              {bootstrap.estimate.client.companyName.replace(/^DEMO\s+/i, '').slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[17px] font-bold leading-tight text-slate-950">
                {bootstrap.estimate.client.companyName.replace(/^DEMO\s+/i, '')}
              </p>
              <p className="mt-0.5 text-[12px] font-semibold text-slate-500">
                {bootstrap.estimate.client.contactName ?? 'Main Pate'}
              </p>
            </div>
          </div>
          <dl className="mt-3 grid gap-1.5 text-[12px]">
            <div className="flex items-center gap-2">
              <dt className="text-slate-400">☎</dt>
              <dd className="truncate font-medium text-slate-700">
                (512) 555-0198
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-slate-400">✉</dt>
              <dd className="truncate font-medium text-slate-700">
                {bootstrap.estimate.client.email ?? '—'}
              </dd>
            </div>
          </dl>
          <div className="mt-4 grid grid-cols-2 gap-2">
          <Link
            href={`/clients/${bootstrap.estimate.client.id}` as never}
            className="inline-flex items-center justify-center rounded-[6px] border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            Open customer
          </Link>
          <Link
            href="/clients/new"
            className="inline-flex items-center justify-center rounded-[6px] border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            + New customer
          </Link>
          </div>
        </div>
      </SectionCard>
      ) : null}

      {showWorkflow ? (
      <>
      <SectionCard className="flex h-full w-full min-w-full basis-full flex-col justify-center rounded-none border-0 px-3 py-5 !shadow-none">
        <SectionHeading
          icon={<IconFlag />}
          tone="emerald"
          title="Workflow"
          subtitle="Keep the quote moving from draft through finalized."
        />
        <ol className="relative mt-5 flex w-full items-start justify-between px-1 before:absolute before:left-7 before:right-7 before:top-[18px] before:h-px before:bg-slate-200">
          <WorkflowStep label="Quote sent" done={bootstrap.estimate.quoteSent} first />
          <WorkflowStep
            label="Approved"
            done={
              bootstrap.estimate.status === EstimateStatus.APPROVED ||
              bootstrap.estimate.status === EstimateStatus.FINALIZED
            }
          />
          <WorkflowStep label="PO created" done={linkedPos.length > 0} />
          <WorkflowStep label="Finalized" done={bootstrap.estimate.status === EstimateStatus.FINALIZED} last />
        </ol>
      </SectionCard>

      </>
      ) : null}

      {showFulfillment ? (
      <>
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
              <SelectControl
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
              </SelectControl>
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
      </>
      ) : null}

      {showAdmin ? (
      <>
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
      </>
      ) : null}
    </aside>
  );
}

function SummaryMetric({
  label,
  value,
  valueClass = 'text-slate-950',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-[8px] border border-slate-200 bg-white px-3 py-3 shadow-sm">
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className={`mt-2 text-[16px] font-black leading-none tabular-nums ${valueClass}`}>
        {value}
      </p>
    </div>
  );
}

/// Editable percent row for Margin / Markup — commits on blur or Enter,
/// repricing the whole estimate through the standard dispatch.
function PercentEditorRow({
  label,
  value,
  valueClass,
  onCommit,
}: {
  label: string;
  value: number | null;
  valueClass: string;
  onCommit: (pct: number) => void;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="font-medium text-[#6d7480]">{label}</dt>
      <dd className="flex items-center gap-1">
        <input
          key={value == null ? 'empty' : value.toFixed(1)}
          type="number"
          min={0}
          step="0.1"
          defaultValue={value == null ? '' : value.toFixed(1)}
          onBlur={(e) => {
            const n = Number(e.currentTarget.value);
            if (Number.isFinite(n)) onCommit(n);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          className={`w-[64px] rounded-md border border-[#eadfd3] bg-white px-1.5 py-0.5 text-right text-[12px] font-bold tabular-nums outline-none focus:border-[#F28744] ${valueClass}`}
          aria-label={`${label} percent`}
        />
        <span className={`text-[11px] font-bold ${valueClass}`}>%</span>
      </dd>
    </div>
  );
}

/// Sales tax exemption for THIS estimate. Persists immediately, like the
/// sales rep picker — there is no draft state to save, so the totals panel
/// and the customer document can never disagree about tax.
function TaxExemptControl({
  estimateId,
  taxExempt,
  taxExemptReason,
  ratePercentMilli,
  disabled,
}: {
  estimateId: string;
  taxExempt: boolean;
  taxExemptReason: string | null;
  ratePercentMilli: number;
  disabled: boolean;
}) {
  const [exempt, setExempt] = useState(taxExempt);
  const [cert, setCert] = useState(taxExemptReason ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = (nextExempt: boolean, nextCert: string) => {
    startTransition(async () => {
      const result = await updateEstimateTaxExemptAction({
        estimateId,
        taxExempt: nextExempt,
        taxExemptReason: nextCert,
      });
      setError(result.error);
      // Server refused (finalized estimate) — put the switch back so the UI
      // never shows an exemption that was not actually stored.
      if (result.error) setExempt(taxExempt);
    });
  };

  return (
    <section className="mt-5">
      <h3 className="text-[13px] font-black text-[#1C4972]">Sales tax</h3>
      <label className="mt-2 flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={exempt}
          disabled={disabled || pending}
          onChange={(event) => {
            const next = event.currentTarget.checked;
            setExempt(next);
            if (!next) setCert('');
            save(next, next ? cert : '');
          }}
          className="mt-0.5 h-3.5 w-3.5 rounded border-[#eadfd3] text-[#F28744] focus:ring-[#F28744]"
        />
        <span className="text-[12px] font-semibold leading-snug text-[#1C4972]">
          Tax exempt
          <span className="block text-[11px] font-medium text-[#1C4972]/60">
            {exempt
              ? 'No sales tax on this estimate. Other estimates are unaffected.'
              : ratePercentMilli > 0
                ? `Charging the company rate of ${formatTaxPercent(ratePercentMilli)}.`
                : 'Company rate is 0% — all estimates are already quoted pre-tax.'}
          </span>
        </span>
      </label>
      {exempt ? (
        <input
          type="text"
          value={cert}
          disabled={disabled || pending}
          maxLength={120}
          placeholder="Exemption certificate # (optional)"
          onChange={(event) => setCert(event.currentTarget.value)}
          onBlur={() => {
            if ((taxExemptReason ?? '') !== cert.trim()) save(true, cert);
          }}
          aria-label="Exemption certificate number"
          className="mt-2 h-8 w-full rounded-[5px] border border-[#eadfd3] bg-white px-2 text-[12px] font-semibold text-slate-700 outline-none focus:border-[#F28744] focus:ring-2 focus:ring-[#F28744]/15"
        />
      ) : null}
      {error ? <p className="mt-1 text-[11px] font-medium text-rose-600">{error}</p> : null}
    </section>
  );
}

/// Sales representative picker — persists immediately via server action.
function SalesRepSelect({
  estimateId,
  salesRepId,
  salesReps,
  disabled,
}: {
  estimateId: string;
  salesRepId: string | null;
  salesReps: ReadonlyArray<{ id: string; name: string }>;
  disabled: boolean;
}) {
  const [value, setValue] = useState(salesRepId ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="mt-5">
      <h3 className="text-[13px] font-black text-[#1C4972]">Sales rep</h3>
      <SelectControl
        className="mt-2 text-[12.5px] font-semibold"
        searchPlaceholder="Search sales reps..."
        value={value}
        disabled={disabled || pending}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          if (!next) return;
          startTransition(async () => {
            const result = await updateEstimateSalesRepAction({
              estimateId,
              salesRepId: next,
            });
            setError(result.error);
          });
        }}
      >
        <option value="">Unassigned</option>
        {salesReps.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </SelectControl>
      {error ? <p className="mt-1 text-[11px] font-medium text-rose-600">{error}</p> : null}
    </section>
  );
}

function SideRow({
  label,
  value,
  valueClass = 'text-[#1C4972]',
  strong = false,
  muted = false,
}: {
  label: string;
  value: string;
  valueClass?: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? 'text-[14px]' : ''}`}>
      <dt className={`${strong ? 'font-black text-[#1C4972]' : 'font-medium text-[#6d7480]'}`}>
        {label}
      </dt>
      <dd className={`tabular-nums ${strong ? 'font-black text-[#F28744]' : 'font-bold'} ${muted ? 'text-slate-400' : valueClass}`}>
        {value}
      </dd>
    </div>
  );
}

function WorkflowDot({
  label,
  done = false,
  active = false,
  last = false,
}: {
  label: string;
  done?: boolean;
  active?: boolean;
  last?: boolean;
}) {
  return (
    <li className="relative flex items-center gap-2">
      {!last ? <span className="absolute left-[5px] top-4 h-5 w-px bg-slate-200" /> : null}
      <span
        className={`relative z-10 h-3 w-3 rounded-full border ${
          done || active ? 'border-[#F28744] bg-[#F28744] ring-2 ring-[#F28744]/15' : 'border-[#eadfd3] bg-white'
        }`}
      />
      <span className={active ? 'font-bold text-[#1C4972]' : 'text-[#6d7480]'}>{label}</span>
      {active ? <span className="text-[10px] text-slate-400">· Current step</span> : null}
    </li>
  );
}

function WorkflowStep({
  label,
  done,
  first = false,
  last = false,
}: {
  label: string;
  done: boolean;
  first?: boolean;
  last?: boolean;
}) {
  void first;
  void last;

  return (
    <li className="relative z-10 flex min-w-0 flex-col items-center text-center">
      <div className="relative flex w-full justify-center">
        <span
          aria-hidden
          className={`relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-black ${
            done
              ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/25'
              : 'bg-white text-slate-300 ring-1 ring-inset ring-slate-200'
          }`}
        >
          {done ? '✓' : ''}
        </span>
      </div>
      <div className="mt-3 min-w-0">
        <p className="truncate text-[12px] font-bold text-slate-800">{label}</p>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          {done ? 'Complete' : 'Pending'}
        </p>
      </div>
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
