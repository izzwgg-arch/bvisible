'use client';

// Custom build workspace inside the guided estimate flow ("Build the
// price from the real cost"): materials from the live Sheet, machine
// hours, and labor & installation at the fixed shop rates — with a live
// price rail. "Add to estimate" collapses the build into one estimate
// line group (multiple underlying rows, sourceKind CUSTOM). No page
// navigation; nothing touches the advanced grid editor.

import { useMemo, useState } from 'react';
import { formatMoney } from '@bvisible/pricing';
import { fuzzySearch } from '@/lib/sheet-sync/fuzzy';
import type { BuilderMachine, BuilderMaterial, BuilderRates } from './guided-builder';

export interface CustomBuildRow {
  kind: 'MATERIAL' | 'MACHINE' | 'LABOR' | 'DESIGN' | 'INSTALL';
  description: string;
  qtyMilli: number;
  unitCostCents: number;
  markupExempt: boolean;
  sourceKind: 'CUSTOM';
  sheetKey?: string | null;
  machineName?: string | null;
}

interface MatRow {
  uid: number;
  name: string;
  sheetKey: string | null;
  unitCostCents: number;
  qty: number;
}
interface MachRow {
  uid: number;
  name: string;
  rateCents: number;
  hours: number;
}

let uidSeq = 1;

const inputCls =
  'rounded-[10px] border border-[var(--color-bv-border)] bg-white px-3 py-2 text-[13px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]';
const miniCls =
  'w-20 rounded-[9px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5 text-right text-[12.5px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]';
const secCls =
  'rounded-[14px] border border-[var(--color-bv-border)] bg-white p-4';

function SectionTitle({ n, title, hint }: { n: string; title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="grid h-6 w-6 place-items-center rounded-[7px] bg-[var(--color-bv-text)] text-[11px] font-bold text-white">
        {n}
      </span>
      <span className="text-[14px] font-bold text-[var(--color-bv-text)]">{title}</span>
      {hint ? (
        <span className="ml-auto text-[9.5px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function CustomBuildPanel({
  materials,
  machines,
  rates,
  markupPercent,
  nextLineNumber,
  onAdd,
}: {
  materials: BuilderMaterial[];
  machines: BuilderMachine[];
  rates: BuilderRates;
  markupPercent: number;
  nextLineNumber: number;
  onAdd: (card: { label: string; sublabel: string; badge: string; rows: CustomBuildRow[] }) => void;
}) {
  const [buildName, setBuildName] = useState('');
  const [matSearch, setMatSearch] = useState('');
  const [matRows, setMatRows] = useState<MatRow[]>([]);
  const [machRows, setMachRows] = useState<MachRow[]>([]);
  const [shopHours, setShopHours] = useState('0');
  const [designUnits, setDesignUnits] = useState('0');
  const [onsiteHours, setOnsiteHours] = useState('0');
  const [travelHours, setTravelHours] = useState('0');
  const [installers, setInstallers] = useState('1');

  const matHits = useMemo(() => {
    const q = matSearch.trim();
    if (!q) return [];
    // Fuzzy: misspellings, partial words, reordered tokens all match.
    return fuzzySearch(q, materials, (m) => `${m.name} ${m.category} ${m.vendor}`, { limit: 8 });
  }, [matSearch, materials]);

  const num = (v: string) => Math.max(0, Number(v) || 0);
  const ppl = Math.max(1, Math.round(Number(installers) || 1));

  const materialsCents = matRows.reduce((s, r) => s + Math.round(r.qty * r.unitCostCents), 0);
  const machinesCents = machRows.reduce((s, r) => s + Math.round(r.hours * r.rateCents), 0);
  const laborCents = Math.round(num(shopHours) * rates.shopLaborCentsPerHour);
  const designCents = Math.round(num(designUnits) * rates.designFlatCents);
  const installCents = Math.round(
    (num(onsiteHours) + num(travelHours)) * ppl * rates.installPerPersonHourCents
  );
  const trueCostCents = materialsCents + machinesCents + laborCents + designCents + installCents;
  const recommendedCents = Math.round(trueCostCents * (1 + (Number(markupPercent) || 0) / 100));

  function buildRows(): CustomBuildRow[] {
    const rows: CustomBuildRow[] = [];
    for (const r of matRows) {
      rows.push({
        kind: 'MATERIAL',
        description: r.name,
        qtyMilli: Math.round(r.qty * 1000),
        unitCostCents: r.unitCostCents,
        markupExempt: false,
        sourceKind: 'CUSTOM',
        sheetKey: r.sheetKey,
      });
    }
    for (const r of machRows) {
      rows.push({
        kind: 'MACHINE',
        description: r.name,
        qtyMilli: Math.round(r.hours * 1000),
        unitCostCents: r.rateCents,
        markupExempt: false,
        sourceKind: 'CUSTOM',
        machineName: r.name,
      });
    }
    if (num(shopHours) > 0) {
      rows.push({
        kind: 'LABOR',
        description: `Shop labor — ${num(shopHours)} hr`,
        qtyMilli: Math.round(num(shopHours) * 1000),
        unitCostCents: rates.shopLaborCentsPerHour,
        markupExempt: false,
        sourceKind: 'CUSTOM',
      });
    }
    if (num(designUnits) > 0) {
      rows.push({
        kind: 'DESIGN',
        description: `Design — ${num(designUnits)} × flat fee`,
        qtyMilli: Math.round(num(designUnits) * 1000),
        unitCostCents: rates.designFlatCents,
        markupExempt: false,
        sourceKind: 'CUSTOM',
      });
    }
    if (num(onsiteHours) + num(travelHours) > 0) {
      rows.push({
        kind: 'INSTALL',
        description: `Installation + travel — ${num(onsiteHours) + num(travelHours)} hr × ${ppl} installer${ppl > 1 ? 's' : ''}`,
        qtyMilli: Math.round((num(onsiteHours) + num(travelHours)) * ppl * 1000),
        unitCostCents: rates.installPerPersonHourCents,
        markupExempt: false,
        sourceKind: 'CUSTOM',
      });
    }
    return rows;
  }

  function handleAdd() {
    const rows = buildRows();
    if (rows.length === 0) return;
    const parts: string[] = [];
    if (matRows.length > 0) parts.push(`${matRows.length} material${matRows.length > 1 ? 's' : ''}`);
    if (machRows.length > 0) parts.push(`${machRows.length} machine${machRows.length > 1 ? 's' : ''}`);
    if (num(shopHours) > 0) parts.push(`shop ${num(shopHours)} hr`);
    if (num(designUnits) > 0) parts.push(`design ×${num(designUnits)}`);
    if (num(onsiteHours) + num(travelHours) > 0)
      parts.push(`install ${num(onsiteHours) + num(travelHours)} hr × ${ppl}`);
    onAdd({
      label: buildName.trim() || 'Custom build',
      sublabel: `Custom build · ${parts.join(' · ')} · true cost ${formatMoney(trueCostCents)}`,
      badge: 'Custom build',
      rows,
    });
    setBuildName('');
    setMatSearch('');
    setMatRows([]);
    setMachRows([]);
    setShopHours('0');
    setDesignUnits('0');
    setOnsiteHours('0');
    setTravelHours('0');
    setInstallers('1');
  }

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="space-y-4">
        <div className={secCls}>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-text)] opacity-70">
              Build name (shows on the estimate line)
            </span>
            <input
              className={`${inputCls} w-full`}
              placeholder="e.g. Lighted address pylon"
              value={buildName}
              onChange={(e) => setBuildName(e.target.value)}
            />
          </label>
        </div>

        {/* 1 · Materials */}
        <div className={secCls}>
          <SectionTitle n="1" title="Materials" hint={`${matRows.length} added · ${materials.length} in Sheet`} />
          <input
            className={`${inputCls} w-full`}
            placeholder="Search every material in the main sheet…"
            value={matSearch}
            onChange={(e) => setMatSearch(e.target.value)}
          />
          {matHits.length > 0 ? (
            <div className="mt-2 divide-y divide-[var(--color-bv-border)] rounded-[10px] border border-[var(--color-bv-border)]">
              {matHits.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--color-bv-bg)]"
                  onClick={() => {
                    setMatRows((prev) => [
                      ...prev,
                      { uid: uidSeq++, name: m.name, sheetKey: m.key, unitCostCents: m.priceCents, qty: 1 },
                    ]);
                    setMatSearch('');
                  }}
                >
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-[var(--color-bv-text)]">
                    {m.name}
                  </span>
                  <span className="text-[11px] text-[var(--color-bv-muted)]">{m.category}</span>
                  <span className="text-[12.5px] font-bold text-[var(--color-bv-accent)]">
                    {formatMoney(m.priceCents)} +
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {matRows.map((r) => (
            <div key={r.uid} className="mt-2 flex items-center gap-2.5 border-t border-[var(--color-bv-border)] pt-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--color-bv-text)]">
                {r.name}
              </span>
              <span className="text-[9.5px] font-bold uppercase text-[var(--color-bv-muted)]">Unit $</span>
              <input
                className={miniCls}
                type="number"
                min={0}
                step="0.01"
                value={(r.unitCostCents / 100).toString()}
                onChange={(e) =>
                  setMatRows((prev) =>
                    prev.map((x) =>
                      x.uid === r.uid
                        ? { ...x, unitCostCents: Math.round((Number(e.target.value) || 0) * 100) }
                        : x
                    )
                  )
                }
              />
              <span className="text-[9.5px] font-bold uppercase text-[var(--color-bv-muted)]">Qty</span>
              <input
                className={miniCls}
                type="number"
                min={0}
                step="any"
                value={r.qty}
                onChange={(e) =>
                  setMatRows((prev) =>
                    prev.map((x) => (x.uid === r.uid ? { ...x, qty: Number(e.target.value) || 0 } : x))
                  )
                }
              />
              <span className="w-20 text-right text-[13px] font-bold text-[var(--color-bv-text)]">
                {formatMoney(Math.round(r.qty * r.unitCostCents))}
              </span>
              <button
                type="button"
                aria-label="Remove material"
                className="text-slate-400 hover:text-red-500"
                onClick={() => setMatRows((prev) => prev.filter((x) => x.uid !== r.uid))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {/* 2 · Machines */}
        <div className={secCls}>
          <SectionTitle n="2" title="Machines" hint="RATES FROM SHEET" />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {machines.map((m) => (
              <button
                key={m.name}
                type="button"
                className="rounded-[10px] border border-[var(--color-bv-border)] bg-white px-3 py-2.5 text-left hover:border-[var(--color-bv-accent)]"
                onClick={() =>
                  setMachRows((prev) => [
                    ...prev,
                    { uid: uidSeq++, name: m.name, rateCents: m.ratePerHourCents, hours: 0.25 },
                  ])
                }
              >
                <span className="block truncate text-[12px] font-bold text-[var(--color-bv-text)]">{m.name}</span>
                <span className="text-[10.5px] text-[var(--color-bv-muted)]">
                  {formatMoney(m.ratePerHourCents)}/hr
                </span>
              </button>
            ))}
          </div>
          {machRows.map((r) => (
            <div key={r.uid} className="mt-2 flex items-center gap-2.5 border-t border-[var(--color-bv-border)] pt-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--color-bv-text)]">
                {r.name}
              </span>
              <span className="text-[9.5px] font-bold uppercase text-[var(--color-bv-muted)]">Hrs</span>
              <input
                className={miniCls}
                type="number"
                min={0}
                step="0.05"
                value={r.hours}
                onChange={(e) =>
                  setMachRows((prev) =>
                    prev.map((x) => (x.uid === r.uid ? { ...x, hours: Number(e.target.value) || 0 } : x))
                  )
                }
              />
              <span className="w-20 text-right text-[13px] font-bold text-[var(--color-bv-text)]">
                {formatMoney(Math.round(r.hours * r.rateCents))}
              </span>
              <button
                type="button"
                aria-label="Remove machine"
                className="text-slate-400 hover:text-red-500"
                onClick={() => setMachRows((prev) => prev.filter((x) => x.uid !== r.uid))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {/* 3 · Labor & installation */}
        <div className={secCls}>
          <SectionTitle n="3" title="Labor & installation" hint="FIXED SHOP RATES · PRICING BACKEND" />
          <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {(
              [
                ['Shop labor', `${formatMoney(rates.shopLaborCentsPerHour)} / hour`, shopHours, setShopHours],
                ['Design', `${formatMoney(rates.designFlatCents)} flat`, designUnits, setDesignUnits],
                ['On-site hours', `${formatMoney(rates.installPerPersonHourCents)} / installer / hr`, onsiteHours, setOnsiteHours],
                ['Round-trip travel', 'Hours', travelHours, setTravelHours],
                ['Installers', 'People', installers, setInstallers],
              ] as const
            ).map(([label, hint, value, setter]) => (
              <label key={label} className="block rounded-[10px] border border-[var(--color-bv-border)] bg-white p-2.5">
                <span className="block text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--color-bv-text)] opacity-75">
                  {label}
                </span>
                <span className="mb-1.5 block text-[10px] text-[var(--color-bv-muted)]">{hint}</span>
                <input
                  className="w-full rounded-[8px] border border-[var(--color-bv-border)] px-2 py-1.5 text-[13px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]"
                  type="number"
                  min={0}
                  step="any"
                  value={value}
                  onChange={(e) => setter(e.target.value)}
                />
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* live price rail */}
      <div className="h-fit rounded-[14px] bg-[var(--color-bv-text)] text-white lg:sticky lg:top-4">
        <div className="px-5 pt-5">
          <div className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-[#ffb98a]">Live price</div>
          <div className="mt-1 truncate text-[16px] font-bold">{buildName.trim() || 'Custom build'}</div>
        </div>
        <div className="mt-3 space-y-1.5 px-5 text-[12.5px]">
          {(
            [
              ['Materials', materialsCents],
              ['Machine cost', machinesCents],
              ['Shop labor', laborCents],
              ['Design', designCents],
              ['Install + travel', installCents],
            ] as const
          ).map(([label, cents]) => (
            <div key={label} className="flex justify-between text-white/75">
              <span>{label}</span>
              <span className="font-bold text-white">{formatMoney(cents)}</span>
            </div>
          ))}
          <div className="!mt-3 flex justify-between border-t border-white/15 pt-2.5">
            <span className="text-white/75">True cost</span>
            <span className="font-bold">{formatMoney(trueCostCents)}</span>
          </div>
        </div>
        <div className="mt-4 bg-[var(--color-bv-accent)] px-5 py-4">
          <div className="text-[9px] font-bold uppercase tracking-[0.18em]">Recommended price</div>
          <div className="text-[26px] font-extrabold">{formatMoney(recommendedCents)}</div>
          <div className="text-[10.5px] opacity-90">True cost + {Number(markupPercent) || 0}% markup</div>
        </div>
        <div className="p-4">
          <button
            type="button"
            className="w-full rounded-[10px] bg-white py-3 text-[13.5px] font-bold text-[var(--color-bv-text)] hover:opacity-95 disabled:opacity-50"
            disabled={trueCostCents <= 0}
            onClick={handleAdd}
          >
            Add to estimate as line {nextLineNumber} →
          </button>
          <p className="mt-2.5 text-center text-[10px] leading-snug text-white/60">
            Saves as one line group. You can still fine-tune later in the advanced editor.
          </p>
        </div>
      </div>
    </div>
  );
}
