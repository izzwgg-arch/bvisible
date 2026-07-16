'use client';

// Material recommendations by sign type — driven by the Sheet's
// "Estimator Recommendations" tab. Pick a sign type (Pylon, Channel
// Letters, Vehicle Wrap, ACM, Coroplast, Monument, …) and add/remove the
// materials normally needed for that job. Suggestions resolve to live
// Sheet materials via fuzzy matching; nothing is added automatically.

import { useMemo, useState } from 'react';
import { formatMoney } from '@bvisible/pricing';
import { fuzzySearch } from '@/lib/sheet-sync/fuzzy';
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
  onAdd,
  onRemove,
  detected,
}: {
  recommendations: BuilderRecommendation[];
  materials: BuilderMaterial[];
  addedKeys: ReadonlySet<string>;
  onAdd: (material: BuilderMaterial, reason: string) => void;
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
            return (
              <div
                key={`${rec.preferredItem}-${i}`}
                className={`flex items-center gap-3 py-2.5 ${material && !added ? 'cursor-pointer rounded-[8px] hover:bg-[var(--color-bv-bg)]' : ''}`}
                onClick={() => {
                  if (material && !added) onAdd(material, rec.reason);
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
                  <div className="text-[12.5px] font-bold text-[var(--color-bv-text)]">
                    {formatMoney(material.priceCents)}
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
                      + Add
                    </span>
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
