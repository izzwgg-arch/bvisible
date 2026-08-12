'use client';

// JSON estimate import: paste a job spec, validate it, preview the
// resolved lines (fuzzy-matched against the live Sheet catalog), then
// add everything to the estimate — still fully editable before saving.

import { useState } from 'react';
import { formatMoney } from '@bvisible/pricing';
import { fuzzySearch } from '@/lib/sheet-sync/fuzzy';
import type {
  BuilderMachine,
  BuilderMaterial,
  BuilderRates,
  BuilderSqftRate,
  BuilderVehicleWrap,
} from './guided-builder';

export const SAMPLE_JSON = `{
  "job": "36x36 Lighted Address Pylon",
  "customer": "Newburg Egg",
  "markupPercent": 200,
  "materials": [
    { "item": "White Acrylic 3/16", "qty": 1 },
    { "item": "Power Supply 12V 150W", "qty": 1 }
  ],
  "machines": [
    { "machine": "Colex Sharp Cut Cutter -CNC", "hours": 1 }
  ],
  "labor": [
    { "type": "Labor", "hours": 7 },
    { "type": "Design", "units": 1 },
    { "type": "Installation", "hours": 4, "installers": 2, "travelHours": 1 }
  ],
  "sqft": [
    { "item": "Dura-Bond Sign", "widthFt": 4, "heightFt": 8, "qty": 1 }
  ],
  "vehicleWraps": [
    { "vehicle": "Chevrolet city express - Full" }
  ]
}`;

export interface ImportedCard {
  label: string;
  sublabel: string;
  badge: string;
  rows: Array<{
    kind: 'MATERIAL' | 'MACHINE' | 'LABOR' | 'DESIGN' | 'INSTALL' | 'MISC';
    description: string;
    qtyMilli: number;
    unitCostCents: number;
    markupExempt: boolean;
    sourceKind: 'READY_ITEM' | 'BUNDLE' | 'VEHICLE_WRAP' | 'SQFT_ITEM' | 'CUSTOM';
    sheetKey?: string | null;
    machineName?: string | null;
    notes?: string | null;
  }>;
}

export interface ImportResult {
  title: string | null;
  customerName: string | null;
  markupPercent: number | null;
  cards: ImportedCard[];
}

interface PreviewLine {
  label: string;
  detail: string;
  sellNote: string;
  warning: string | null;
  card: ImportedCard;
}

function asNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function JsonImportPanel({
  materials,
  machines,
  sqftRates,
  vehicleWraps,
  rates,
  aliases,
  onImport,
  onClose,
}: {
  materials: BuilderMaterial[];
  machines: BuilderMachine[];
  sqftRates: BuilderSqftRate[];
  vehicleWraps: BuilderVehicleWrap[];
  rates: BuilderRates;
  aliases: Array<{ alias: string; canonical: string }>;
  onImport: (result: ImportResult) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewLine[] | null>(null);
  const [meta, setMeta] = useState<Omit<ImportResult, 'cards'>>({
    title: null,
    customerName: null,
    markupPercent: null,
  });

  function validate() {
    const errs: string[] = [];
    const lines: PreviewLine[] = [];
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch (e) {
      setErrors([`Invalid JSON: ${e instanceof Error ? e.message : 'could not parse'}`]);
      setPreview(null);
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setErrors(['The JSON root must be an object — see the sample format.']);
      setPreview(null);
      return;
    }

    const title = typeof parsed.job === 'string' ? parsed.job.trim().slice(0, 200) : null;
    const customerName =
      typeof parsed.customer === 'string' ? parsed.customer.trim().slice(0, 200) : null;
    const markupPercent =
      parsed.markupPercent != null && Number.isFinite(Number(parsed.markupPercent))
        ? Math.max(0, Number(parsed.markupPercent))
        : null;

    const findMaterial = (name: string) =>
      fuzzySearch(name, materials, (m) => `${m.name} ${m.category}`, {
        limit: 1,
        threshold: 0.5,
        aliases,
      })[0] ?? null;

    // materials
    for (const [i, raw] of (Array.isArray(parsed.materials) ? parsed.materials : []).entries()) {
      const item = raw as { item?: unknown; qty?: unknown };
      const name = typeof item.item === 'string' ? item.item : '';
      if (!name) {
        errs.push(`materials[${i}]: missing "item".`);
        continue;
      }
      const qty = Math.max(0.001, asNumber(item.qty, 1));
      const hit = findMaterial(name);
      if (!hit) {
        errs.push(`materials[${i}]: "${name}" not found in the Sheet catalog.`);
        continue;
      }
      lines.push({
        label: hit.name,
        detail: `Material · qty ${qty} × ${formatMoney(hit.priceCents)}${hit.name.toLowerCase() !== name.toLowerCase() ? ` · matched from “${name}”` : ''}`,
        sellNote: 'markup applies',
        warning: null,
        card: {
          label: hit.name,
          sublabel: `Imported from JSON · qty ${qty} × ${formatMoney(hit.priceCents)}`,
          badge: 'Material',
          rows: [
            {
              kind: 'MATERIAL',
              description: hit.name,
              qtyMilli: Math.round(qty * 1000),
              unitCostCents: hit.priceCents,
              markupExempt: false,
              sourceKind: 'READY_ITEM',
              sheetKey: hit.key,
            },
          ],
        },
      });
    }

    // machines
    for (const [i, raw] of (Array.isArray(parsed.machines) ? parsed.machines : []).entries()) {
      const item = raw as { machine?: unknown; hours?: unknown };
      const name = typeof item.machine === 'string' ? item.machine : '';
      if (!name) {
        errs.push(`machines[${i}]: missing "machine".`);
        continue;
      }
      const hours = Math.max(0.01, asNumber(item.hours, 0.25));
      const hit =
        fuzzySearch(name, machines, (m) => m.name, { limit: 1, threshold: 0.5 })[0] ?? null;
      if (!hit) {
        errs.push(`machines[${i}]: "${name}" is not a known machine.`);
        continue;
      }
      lines.push({
        label: hit.name,
        detail: `Machine · ${hours} hr × ${formatMoney(hit.ratePerHourCents)}/hr`,
        sellNote: 'markup applies',
        warning: null,
        card: {
          label: `${hit.name} — ${hours} hr`,
          sublabel: `Imported from JSON · machine time`,
          badge: 'Machine',
          rows: [
            {
              kind: 'MACHINE',
              description: hit.name,
              qtyMilli: Math.round(hours * 1000),
              unitCostCents: hit.ratePerHourCents,
              markupExempt: false,
              sourceKind: 'CUSTOM',
              machineName: hit.name,
            },
          ],
        },
      });
    }

    // labor
    for (const [i, raw] of (Array.isArray(parsed.labor) ? parsed.labor : []).entries()) {
      const item = raw as {
        type?: unknown;
        hours?: unknown;
        units?: unknown;
        installers?: unknown;
        travelHours?: unknown;
      };
      const type = String(item.type ?? '').toLowerCase();
      if (type.startsWith('design')) {
        const units = Math.max(1, asNumber(item.units ?? item.hours, 1));
        lines.push({
          label: `Design × ${units}`,
          detail: `Design · ${units} × ${formatMoney(rates.designFlatCents)} flat`,
          sellNote: 'markup applies',
          warning: null,
          card: {
            label: `Design × ${units}`,
            sublabel: 'Imported from JSON · design flat fee',
            badge: 'Design',
            rows: [
              {
                kind: 'DESIGN',
                description: `Design — ${units} × flat fee`,
                qtyMilli: Math.round(units * 1000),
                unitCostCents: rates.designFlatCents,
                markupExempt: false,
                sourceKind: 'CUSTOM',
              },
            ],
          },
        });
      } else if (type.startsWith('install')) {
        const hours = Math.max(0.25, asNumber(item.hours, 1));
        const travel = asNumber(item.travelHours, 0);
        const installers = Math.max(1, Math.round(asNumber(item.installers, 1)));
        const totalHours = hours + travel;
        lines.push({
          label: `Installation ${totalHours} hr × ${installers}`,
          detail: `Install + travel · ${totalHours} hr × ${installers} installer${installers > 1 ? 's' : ''} × ${formatMoney(rates.installPerPersonHourCents)}/hr`,
          sellNote: 'markup applies',
          warning: null,
          card: {
            label: `Installation — ${totalHours} hr × ${installers}`,
            sublabel: 'Imported from JSON · installation + travel',
            badge: 'Install',
            rows: [
              {
                kind: 'INSTALL',
                description: `Installation + travel — ${totalHours} hr × ${installers} installer${installers > 1 ? 's' : ''}`,
                qtyMilli: Math.round(totalHours * installers * 1000),
                unitCostCents: rates.installPerPersonHourCents,
                markupExempt: false,
                sourceKind: 'CUSTOM',
              },
            ],
          },
        });
      } else {
        const hours = Math.max(0.25, asNumber(item.hours, 1));
        lines.push({
          label: `Shop labor ${hours} hr`,
          detail: `Labor · ${hours} hr × ${formatMoney(rates.shopLaborCentsPerHour)}/hr`,
          sellNote: 'markup applies',
          warning: null,
          card: {
            label: `Shop labor — ${hours} hr`,
            sublabel: 'Imported from JSON · shop labor',
            badge: 'Labor',
            rows: [
              {
                kind: 'LABOR',
                description: `Shop labor — ${hours} hr`,
                qtyMilli: Math.round(hours * 1000),
                unitCostCents: rates.shopLaborCentsPerHour,
                markupExempt: false,
                sourceKind: 'CUSTOM',
              },
            ],
          },
        });
      }
    }

    // sqft
    for (const [i, raw] of (Array.isArray(parsed.sqft) ? parsed.sqft : []).entries()) {
      const item = raw as {
        item?: unknown;
        widthFt?: unknown;
        heightFt?: unknown;
        sqft?: unknown;
        qty?: unknown;
        pricePerSqFt?: unknown;
      };
      const name = typeof item.item === 'string' ? item.item : '';
      const rate =
        fuzzySearch(name, sqftRates, (r) => `${r.id} ${r.name}`, { limit: 1, threshold: 0.45 })[0] ??
        null;
      if (!rate) {
        errs.push(`sqft[${i}]: "${name || '(missing item)'}" is not a Sheet sq-ft item.`);
        continue;
      }
      const qty = Math.max(1, Math.round(asNumber(item.qty, 1)));
      const area =
        asNumber(item.sqft, 0) > 0
          ? asNumber(item.sqft) * qty
          : asNumber(item.widthFt) * asNumber(item.heightFt) * qty;
      if (area <= 0) {
        errs.push(`sqft[${i}]: provide "sqft" or "widthFt" × "heightFt".`);
        continue;
      }
      const priceCents =
        asNumber(item.pricePerSqFt, 0) > 0
          ? Math.round(asNumber(item.pricePerSqFt) * 100)
          : rate.pricePerSqFtCents;
      const billable = area * (1 + Math.max(0, rate.wastePercent) / 100);
      lines.push({
        label: `${rate.name} — ${billable.toFixed(2)} sq ft`,
        detail: `Square footage · ${billable.toFixed(2)} sq ft × ${formatMoney(priceCents)}/sq ft`,
        sellNote: 'final price — never marked up',
        warning:
          asNumber(item.pricePerSqFt, 0) > 0 && priceCents !== rate.pricePerSqFtCents
            ? `price overridden (Sheet rate ${formatMoney(rate.pricePerSqFtCents)})`
            : null,
        card: {
          label: `${rate.name} — ${billable.toFixed(2)} sq ft`,
          sublabel: `Imported from JSON · ${formatMoney(priceCents)}/sq ft — final price, includes markup`,
          badge: 'Square footage',
          rows: [
            {
              kind: 'MATERIAL',
              description: `${rate.name} — ${billable.toFixed(2)} sq ft`,
              qtyMilli: Math.round(billable * 1000),
              unitCostCents: priceCents,
              markupExempt: true,
              sourceKind: 'SQFT_ITEM',
            },
          ],
        },
      });
    }

    // vehicle wraps
    for (const [i, raw] of (
      Array.isArray(parsed.vehicleWraps) ? parsed.vehicleWraps : []
    ).entries()) {
      const item = raw as { vehicle?: unknown };
      const name = typeof item.vehicle === 'string' ? item.vehicle : '';
      const hit =
        fuzzySearch(name, vehicleWraps, (w) => `${w.name} ${w.coverage}`, {
          limit: 1,
          threshold: 0.5,
        })[0] ?? null;
      if (!hit) {
        errs.push(`vehicleWraps[${i}]: "${name || '(missing vehicle)'}" not found in the vehicle list.`);
        continue;
      }
      lines.push({
        label: `${hit.name}${hit.coverage ? ` — ${hit.coverage}` : ''}`,
        detail: `Vehicle wrap · ${formatMoney(hit.priceCents)}`,
        sellNote: 'final price — never marked up',
        warning: null,
        card: {
          label: `${hit.name}${hit.coverage ? ` — ${hit.coverage}` : ''}`,
          sublabel: 'Imported from JSON · vehicle wrap ready item · price includes markup',
          badge: 'Vehicle wrap',
          rows: [
            {
              kind: 'MATERIAL',
              description: `Vehicle wrap — ${hit.name}${hit.coverage ? ` (${hit.coverage})` : ''}`,
              qtyMilli: 1000,
              unitCostCents: hit.priceCents,
              markupExempt: true,
              sourceKind: 'VEHICLE_WRAP',
            },
          ],
        },
      });
    }

    if (lines.length === 0 && errs.length === 0) {
      errs.push('No lines found — add materials, machines, labor, sqft, or vehicleWraps arrays.');
    }
    setMeta({ title, customerName, markupPercent });
    setErrors(errs);
    setPreview(lines.length > 0 ? lines : null);
  }

  return (
    <div className="mt-4 rounded-[14px] border border-[var(--color-bv-border)] bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[13.5px] font-bold text-[var(--color-bv-text)]">
            Import estimate from JSON
          </div>
          <div className="text-[11px] text-[var(--color-bv-muted)]">
            Paste a job spec, validate it, preview the lines, then add them — everything stays
            editable before saving.
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-[9px] border border-[var(--color-bv-border)] px-3 py-1.5 text-[11.5px] font-bold text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
            onClick={() => setText(SAMPLE_JSON)}
          >
            Paste sample
          </button>
          <button
            type="button"
            className="rounded-[9px] border border-[var(--color-bv-border)] px-3 py-1.5 text-[11.5px] font-bold text-[var(--color-bv-muted)] hover:bg-[var(--color-bv-bg)]"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      <textarea
        className="mt-3 h-48 w-full rounded-[10px] border border-[var(--color-bv-border)] bg-[#fafbfc] p-3 font-mono text-[11.5px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]"
        placeholder={SAMPLE_JSON}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
          setErrors([]);
        }}
      />

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          className="rounded-[10px] bg-[var(--color-bv-text)] px-4 py-2 text-[12.5px] font-bold text-white hover:opacity-95 disabled:opacity-50"
          disabled={!text.trim()}
          onClick={validate}
        >
          Validate & preview
        </button>
        {preview ? (
          <button
            type="button"
            className="rounded-[10px] bg-[var(--color-bv-accent)] px-4 py-2 text-[12.5px] font-bold text-white hover:opacity-95"
            onClick={() =>
              onImport({
                ...meta,
                cards: preview.map((p) => p.card),
              })
            }
          >
            Add {preview.length} line{preview.length > 1 ? 's' : ''} to estimate →
          </button>
        ) : null}
      </div>

      {errors.length > 0 ? (
        <div className="mt-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11.5px] text-amber-900">
          <b>Check these:</b>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview ? (
        <div className="mt-3 divide-y divide-[var(--color-bv-border)] rounded-[10px] border border-[var(--color-bv-border)]">
          {preview.map((p, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold text-[var(--color-bv-text)]">
                  {p.label}
                </div>
                <div className="truncate text-[11px] text-[var(--color-bv-muted)]">
                  {p.detail}
                  {p.warning ? ` · ⚠ ${p.warning}` : ''}
                </div>
              </div>
              <span className="whitespace-nowrap text-[10px] font-bold text-[var(--color-bv-muted)]">
                {p.sellNote}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
