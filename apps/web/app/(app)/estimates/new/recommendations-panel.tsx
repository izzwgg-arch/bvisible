'use client';

// Material recommendations by sign type — driven by the Sheet's
// "Estimator Recommendations" tab. Pick a sign type (Pylon, Channel
// Letters, Vehicle Wrap, ACM, Coroplast, Monument, …) and add/remove the
// materials normally needed for that job. Suggestions resolve to live
// Sheet materials via fuzzy matching; nothing is added automatically.
// Before adding, the estimator enters how much is needed — a quantity,
// a % of a full sheet/roll, square feet, or linear feet — and the
// portion of the full material plus cost is calculated automatically.

import { useMemo, useState } from 'react';
import { formatMoney } from '@bvisible/pricing';
import { fuzzySearch } from '@/lib/sheet-sync/fuzzy';
import type { MeasurementResult } from '@/lib/estimate/measurement';
import {
  MeasurementControls,
  defaultMeasurementState,
  measurementDescription,
  measurementResult,
  type MeasurementState,
} from './measurement-entry';
import type { BuilderMaterial } from './guided-builder';

export interface BuilderRecommendation {
  signType: string;
  materialKeyword: string;
  preferredItem: string;
  reason: string;
  priority: 'Required' | 'Check';
}

export function RecommendationsPanel({
  recommendations,
  materials,
  addedKeys,
  markupPercent,
  onAdd,
  onRemove,
  detected,
}: {
  recommendations: BuilderRecommendation[];
  materials: BuilderMaterial[];
  addedKeys: ReadonlySet<string>;
  /// Estimate markup % — used to show the selling price live.
  markupPercent: number;
  onAdd: (
    material: BuilderMaterial,
    reason: string,
    measurement: MeasurementResult,
    description: string
  ) => void;
  onRemove: (materialKey: string) => void;
  /// Auto-detected from the job name (AI suggestion) with confidence 0–100.
  detected?: { signType: string; confidence: number } | null;
}) {
  const signTypes = useMemo(
    () => Array.from(new Set(recommendations.map((r) => r.signType))),
    [recommendations]
  );
  const [signType, setSignType] = useState(detected?.signType ?? '');
  const showingDetected = detected != null && signType === detected.signType;

  // Per-material measurement entry (opened by clicking a suggestion).
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, MeasurementState>>({});

  function entryFor(material: BuilderMaterial): MeasurementState {
    return entries[material.key] ?? defaultMeasurementState(material.name);
  }

  function commitAdd(material: BuilderMaterial, reason: string) {
    const state = entryFor(material);
    const result = measurementResult(state, material.priceCents);
    if (!result.ok) return;
    onAdd(material, reason, result, measurementDescription(material.name, state, result));
    setOpenKey(null);
  }

  const resolved = useMemo(() => {
    if (!signType) return [];
    return recommendations
      .filter((r) => r.signType === signType)
      .map((rec) => {
        const hit =
          fuzzySearch(rec.preferredItem, materials, (m) => `${m.name} ${m.category}`, {
            limit: 1,
            threshold: 0.5,
          })[0] ??
          fuzzySearch(rec.materialKeyword, materials, (m) => `${m.name} ${m.category}`, {
            limit: 1,
            threshold: 0.5,
          })[0] ??
          null;
        return { rec, material: hit };
      });
  }, [signType, recommendations, materials]);

  if (recommendations.length === 0) return null;

  return (
    <div className="mt-4 rounded-[14px] border border-[var(--color-bv-border)] bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-[var(--color-bv-accent)] text-[14px] text-white">
          ✦
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-bold text-[var(--color-bv-text)]">
            Suggested materials by sign type
            {showingDetected ? (
              <span className="rounded-full bg-[#fdeee1] px-2.5 py-0.5 text-[10px] font-bold text-[#b05c1e]">
                AI detected from job name · {detected.confidence}% confidence
              </span>
            ) : null}
          </div>
          <div className="text-[11px] text-[var(--color-bv-muted)]">
            What this job normally needs — add or remove anything.
          </div>
        </div>
        <select
          className="rounded-[10px] border border-[var(--color-bv-border)] bg-white px-3 py-2 text-[13px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]"
          value={signType}
          onChange={(e) => setSignType(e.target.value)}
        >
          <option value="">Choose a sign type…</option>
          {signTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {signType ? (
        <div className="mt-3 divide-y divide-[var(--color-bv-border)]">
          {resolved.map(({ rec, material }, i) => {
            const added = material ? addedKeys.has(material.key) : false;
            const open = material != null && !added && openKey === material.key;
            return (
              <div key={`${rec.preferredItem}-${i}`} className="py-2.5">
                <div
                  className={`flex items-center gap-3 ${material && !added ? 'cursor-pointer rounded-[8px] hover:bg-[var(--color-bv-bg)]' : ''}`}
                  onClick={() => {
                    if (material && !added) setOpenKey(open ? null : material.key);
                  }}
                >
                  <span
                    className={`rounded-full px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.08em] ${
                      rec.priority === 'Required'
                        ? 'bg-[#fdeee1] text-[#b05c1e]'
                        : 'bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)]'
                    }`}
                  >
                    {rec.priority}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-[var(--color-bv-text)]">
                      {material ? material.name : rec.preferredItem}
                    </div>
                    <div className="truncate text-[11px] text-[var(--color-bv-muted)]">
                      {rec.reason}
                      {!material ? ' · not found in the Sheet catalog' : ''}
                    </div>
                  </div>
                  {material ? (
                    <div className="text-right">
                      <div className="text-[12.5px] font-bold text-[var(--color-bv-text)]">
                        {formatMoney(material.priceCents)}
                      </div>
                      <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--color-bv-muted)]">
                        full sheet/roll
                      </div>
                    </div>
                  ) : null}
                  {material ? (
                    added ? (
                      <button
                        type="button"
                        className="rounded-[9px] border border-[var(--color-bv-border)] px-3 py-1.5 text-[11.5px] font-bold text-[var(--color-bv-muted)] hover:text-red-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemove(material.key);
                        }}
                      >
                        Added ✓ — remove
                      </button>
                    ) : (
                      <span className="pointer-events-none rounded-[9px] bg-[var(--color-bv-text)] px-3.5 py-1.5 text-[11.5px] font-bold text-white">
                        {open ? 'Choose amount ↓' : '+ Add'}
                      </span>
                    )
                  ) : null}
                </div>
                {open && material ? (
                  <div
                    className="mt-2 rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] p-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-bv-muted)]">
                      How much of this material?
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="min-w-0 flex-1">
                        <MeasurementControls
                          state={entryFor(material)}
                          onChange={(next) =>
                            setEntries((prev) => ({ ...prev, [material.key]: next }))
                          }
                          fullUnitPriceCents={material.priceCents}
                          markupPercent={markupPercent}
                        />
                      </div>
                      <button
                        type="button"
                        className="rounded-[9px] bg-[var(--color-bv-accent)] px-4 py-2 text-[11.5px] font-bold text-white hover:opacity-95 disabled:opacity-50"
                        disabled={!measurementResult(entryFor(material), material.priceCents).ok}
                        onClick={() => commitAdd(material, rec.reason)}
                      >
                        Add to estimate
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
