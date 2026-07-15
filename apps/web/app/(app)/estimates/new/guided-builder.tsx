'use client';

// Guided line-by-line estimate builder (customer-flow redesign).
// Every line starts from one of three permanent paths:
//   1. Materials / ready items  (Sheet materials · bundles · vehicle wraps)
//   2. Custom build             (saves + opens the full line-grid editor)
//   3. Square footage items     (Sheet sq-ft rates — final prices, R-EST-05)
// Totals run through the same computeEstimate engine as the editor.

import { useActionState, useMemo, useState } from 'react';
import { computeEstimate, formatMoney, type LineKind } from '@bvisible/pricing';
import { createGuidedEstimateAction, type GuidedEstimateState } from './guided-actions';

/* ---------- data shapes provided by the server page ---------- */

export interface BuilderMaterial {
  key: string;
  name: string;
  category: string;
  priceCents: number;
  vendor: string;
  source: 'SHEET' | 'OVERRIDE';
}
export interface BuilderMachine {
  name: string;
  ratePerHourCents: number;
}
export interface BuilderSqftRate {
  id: string;
  name: string;
  pricePerSqFtCents: number;
  wastePercent: number;
  unit: string;
}
export interface BuilderVehicleWrap {
  id: string;
  name: string;
  coverage: string;
  billableAreaSqFt: number;
  priceCents: number;
}
export interface BuilderBundle {
  id: string;
  name: string;
  signType: string;
  shopHours: number;
  designUnits: number;
  installHours: number;
  travelHours: number;
  installers: number;
  notes: string;
  components: Array<{
    componentType: 'Material' | 'Machine' | 'Square Foot';
    itemName: string;
    quantity: number;
    optional: boolean;
  }>;
}
export interface BuilderRates {
  shopLaborCentsPerHour: number;
  designFlatCents: number;
  installPerPersonHourCents: number;
}
export interface BuilderProps {
  clients: Array<{ id: string; companyName: string }>;
  defaultClientId: string | null;
  defaultMarkupPercent: number;
  rates: BuilderRates;
  materials: BuilderMaterial[];
  machines: BuilderMachine[];
  sqftRates: BuilderSqftRate[];
  vehicleWraps: BuilderVehicleWrap[];
  bundles: BuilderBundle[];
}

/* ---------- internal line model ---------- */

interface GuidedRow {
  kind: LineKind;
  description: string;
  qtyMilli: number;
  unitCostCents: number;
  markupExempt: boolean;
  sourceKind: 'READY_ITEM' | 'BUNDLE' | 'VEHICLE_WRAP' | 'SQFT_ITEM';
  sheetKey?: string | null;
  machineName?: string | null;
  notes?: string | null;
}

interface GuidedCard {
  uid: number;
  label: string;
  sublabel: string;
  badge: string;
  rows: GuidedRow[];
}

let nextUid = 1;

const inputCls =
  'w-full rounded-[10px] border border-[var(--color-bv-border)] bg-white px-3 py-2 text-[13.5px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]';
const btnPrimary =
  'inline-flex items-center justify-center rounded-[10px] bg-[var(--color-bv-accent)] px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-50';
const btnDark =
  'inline-flex items-center justify-center rounded-[10px] bg-[var(--color-bv-text)] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:opacity-95 disabled:opacity-50';
const cardCls =
  'rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]';

function cardSellCents(card: GuidedCard, multiplierMilli: number): number {
  let total = 0;
  for (const row of card.rows) {
    const cost = Math.round((row.qtyMilli * row.unitCostCents) / 1000);
    total += row.markupExempt ? cost : Math.round((cost * multiplierMilli) / 1000);
  }
  return total;
}

export function GuidedEstimateBuilder(props: BuilderProps) {
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState<string>(props.defaultClientId ?? '');
  const [newClientName, setNewClientName] = useState('');
  const [markupPercent, setMarkupPercent] = useState<number>(props.defaultMarkupPercent);
  const [cards, setCards] = useState<GuidedCard[]>([]);
  const [panel, setPanel] = useState<'ready' | 'custom' | 'sqft' | null>(null);
  const [readyTab, setReadyTab] = useState<'materials' | 'bundles' | 'wraps'>('materials');
  const [search, setSearch] = useState('');

  // Sq-ft panel state
  const [sqftId, setSqftId] = useState(props.sqftRates[0]?.id ?? '');
  const [widthFt, setWidthFt] = useState('4');
  const [heightFt, setHeightFt] = useState('8');
  const [pieces, setPieces] = useState('1');

  const [state, formAction, pending] = useActionState<GuidedEstimateState, FormData>(
    createGuidedEstimateAction,
    { error: null }
  );

  const multiplierMilli = Math.round((1 + (Number(markupPercent) || 0) / 100) * 1000);

  const totals = useMemo(() => {
    const rows = cards.flatMap((c) => c.rows);
    return computeEstimate({
      multiplierMilli,
      designFlatCents: 0,
      lines: rows.map((r, i) => ({
        id: `r${i}`,
        kind: r.kind,
        qtyMilli: r.qtyMilli,
        unitCostCents: r.unitCostCents,
        markupExempt: r.markupExempt,
      })),
    });
  }, [cards, multiplierMilli]);

  const markupAmount = totals.finalPriceCents - totals.subtotalCostCents;

  const filterText = search.trim().toLowerCase();
  const tokens = filterText.split(/\s+/).filter(Boolean);
  const matches = (haystack: string) => {
    const lower = haystack.toLowerCase();
    return tokens.every((t) => lower.includes(t));
  };

  const filteredMaterials = useMemo(
    () => props.materials.filter((m) => !filterText || matches(`${m.name} ${m.category} ${m.vendor}`)).slice(0, 30),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.materials, filterText]
  );
  const filteredBundles = props.bundles.filter((b) => !filterText || matches(`${b.name} ${b.signType}`));
  const filteredWraps = useMemo(
    () => props.vehicleWraps.filter((w) => !filterText || matches(`${w.name} ${w.coverage}`)).slice(0, 30),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.vehicleWraps, filterText]
  );

  function addCard(card: Omit<GuidedCard, 'uid'>) {
    setCards((prev) => [...prev, { ...card, uid: nextUid++ }]);
    setPanel(null);
    setSearch('');
  }

  function addMaterial(m: BuilderMaterial) {
    addCard({
      label: m.name,
      sublabel: `${m.category}${m.vendor ? ` · cheapest vendor: ${m.vendor}` : ''} · ${formatMoney(m.priceCents)}/unit — from Live Sheet`,
      badge: 'Material',
      rows: [
        {
          kind: 'MATERIAL',
          description: m.name,
          qtyMilli: 1000,
          unitCostCents: m.priceCents,
          markupExempt: false,
          sourceKind: 'READY_ITEM',
          sheetKey: m.key,
        },
      ],
    });
  }

  function addWrap(w: BuilderVehicleWrap) {
    addCard({
      label: `${w.name}${w.coverage ? ` — ${w.coverage}` : ''}`,
      sublabel: `${w.billableAreaSqFt > 0 ? `${w.billableAreaSqFt} sq ft · ` : ''}vehicle wrap ready item · price already includes markup`,
      badge: 'Vehicle wrap',
      rows: [
        {
          kind: 'MATERIAL',
          description: `Vehicle wrap — ${w.name}${w.coverage ? ` (${w.coverage})` : ''}`,
          qtyMilli: 1000,
          unitCostCents: w.priceCents,
          markupExempt: true,
          sourceKind: 'VEHICLE_WRAP',
        },
      ],
    });
  }

  function addBundle(b: BuilderBundle) {
    const rows: GuidedRow[] = [];
    for (const comp of b.components) {
      if (comp.optional) continue;
      if (comp.componentType === 'Material') {
        const mat = props.materials.find(
          (m) => m.name.toLowerCase() === comp.itemName.toLowerCase()
        );
        rows.push({
          kind: 'MATERIAL',
          description: comp.itemName,
          qtyMilli: Math.round(comp.quantity * 1000),
          unitCostCents: mat?.priceCents ?? 0,
          markupExempt: false,
          sourceKind: 'BUNDLE',
          sheetKey: mat?.key ?? null,
        });
      } else if (comp.componentType === 'Machine') {
        const machine = props.machines.find(
          (m) => m.name.toLowerCase() === comp.itemName.toLowerCase()
        );
        rows.push({
          kind: 'MACHINE',
          description: comp.itemName,
          qtyMilli: Math.round(comp.quantity * 1000),
          unitCostCents: machine?.ratePerHourCents ?? 0,
          markupExempt: false,
          sourceKind: 'BUNDLE',
          machineName: machine?.name ?? null,
        });
      } else {
        const rate =
          props.sqftRates.find((r) => r.id === comp.itemName) ??
          props.sqftRates.find((r) => r.name.toLowerCase() === comp.itemName.toLowerCase());
        if (rate) {
          rows.push({
            kind: 'MATERIAL',
            description: `${rate.name} — ${comp.quantity} sq ft (Sheet rate, includes markup)`,
            qtyMilli: Math.round(comp.quantity * 1000),
            unitCostCents: rate.pricePerSqFtCents,
            markupExempt: true,
            sourceKind: 'BUNDLE',
          });
        }
      }
    }
    if (b.shopHours > 0) {
      rows.push({
        kind: 'LABOR',
        description: `Shop labor — ${b.name}`,
        qtyMilli: Math.round(b.shopHours * 1000),
        unitCostCents: props.rates.shopLaborCentsPerHour,
        markupExempt: false,
        sourceKind: 'BUNDLE',
      });
    }
    if (b.designUnits > 0) {
      rows.push({
        kind: 'DESIGN',
        description: `Design — ${b.name}`,
        qtyMilli: Math.round(b.designUnits * 1000),
        unitCostCents: props.rates.designFlatCents,
        markupExempt: false,
        sourceKind: 'BUNDLE',
      });
    }
    const installHours = b.installHours + b.travelHours;
    if (installHours > 0) {
      rows.push({
        kind: 'INSTALL',
        description: `Installation + travel — ${installHours} hr × ${b.installers} installer${b.installers > 1 ? 's' : ''}`,
        qtyMilli: Math.round(installHours * b.installers * 1000),
        unitCostCents: props.rates.installPerPersonHourCents,
        markupExempt: false,
        sourceKind: 'BUNDLE',
      });
    }
    addCard({
      label: b.name,
      sublabel: `Saved bundle · ${rows.length} components from the Sheet`,
      badge: 'Bundle',
      rows,
    });
  }

  function addSqft() {
    const rate = props.sqftRates.find((r) => r.id === sqftId);
    const w = Number(widthFt) || 0;
    const h = Number(heightFt) || 0;
    const n = Math.max(1, Math.round(Number(pieces) || 1));
    if (!rate || w <= 0 || h <= 0) return;
    const area = w * h * n;
    const billableArea = area * (1 + Math.max(0, rate.wastePercent) / 100);
    addCard({
      label: `${rate.name} — ${w}′ × ${h}′${n > 1 ? ` × ${n}` : ''}`,
      sublabel: `${billableArea.toFixed(2)} sq ft × ${formatMoney(rate.pricePerSqFtCents)}/sq ft — Sheet price, already includes markup`,
      badge: 'Square footage',
      rows: [
        {
          kind: 'MATERIAL',
          description: `${rate.name} — ${w}ft × ${h}ft × ${n} (${billableArea.toFixed(2)} sq ft)`,
          qtyMilli: Math.round(billableArea * 1000),
          unitCostCents: rate.pricePerSqFtCents,
          markupExempt: true,
          sourceKind: 'SQFT_ITEM',
        },
      ],
    });
  }

  function buildPayload(intent: 'save' | 'custom-build') {
    return JSON.stringify({
      title,
      clientId: clientId === '__new__' || clientId === '' ? null : clientId,
      newClientName: clientId === '__new__' ? newClientName : null,
      markupPercent: Number(markupPercent) || 0,
      intent,
      lines: cards.flatMap((c) => c.rows),
    });
  }

  const sqftRate = props.sqftRates.find((r) => r.id === sqftId);
  const sqftPreviewArea =
    (Number(widthFt) || 0) * (Number(heightFt) || 0) * Math.max(1, Math.round(Number(pieces) || 1));
  const sqftPreviewCents = sqftRate
    ? Math.round(
        sqftPreviewArea * (1 + Math.max(0, sqftRate.wastePercent) / 100) * sqftRate.pricePerSqFtCents
      )
    : 0;

  return (
    <form action={formAction} className="pb-28">
      <input type="hidden" name="payload" id="guided-payload" />

      {/* meta */}
      <section className={`${cardCls} grid gap-4 p-5 md:grid-cols-[2fr_1.6fr_0.7fr]`}>
        <label className="block">
          <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-text)] opacity-75">
            Job name
          </span>
          <input
            className={inputCls}
            placeholder="Example: Main entrance pylon"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
        <div>
          <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-text)] opacity-75">
            Customer
          </span>
          <div className="flex gap-2">
            <select className={inputCls} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Choose customer…</option>
              {props.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName}
                </option>
              ))}
              <option value="__new__">+ New customer…</option>
            </select>
            {clientId === '__new__' ? (
              <input
                className={inputCls}
                placeholder="Customer or company"
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
              />
            ) : null}
          </div>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-text)] opacity-75">
            Markup %
          </span>
          <input
            className={inputCls}
            type="number"
            min={0}
            step={1}
            value={markupPercent}
            onChange={(e) => setMarkupPercent(Number(e.target.value))}
          />
        </label>
      </section>

      {/* lines */}
      {cards.length > 0 ? (
        <section className={`${cardCls} mt-4 divide-y divide-[var(--color-bv-border)] overflow-hidden`}>
          {cards.map((card, i) => (
            <div key={card.uid} className="flex items-center gap-4 px-5 py-3.5">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-[var(--color-bv-bg)] text-[12px] font-bold text-[var(--color-bv-text)]">
                {i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold text-[var(--color-bv-text)]">
                  {card.label}
                </div>
                <div className="truncate text-[11.5px] text-[var(--color-bv-muted)]">
                  {card.sublabel}
                </div>
              </div>
              <span className="whitespace-nowrap rounded-full bg-[#fdeee1] px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#b05c1e]">
                {card.badge}
              </span>
              <div className="w-24 text-right text-[14px] font-bold text-[var(--color-bv-text)]">
                {formatMoney(cardSellCents(card, multiplierMilli))}
              </div>
              <button
                type="button"
                aria-label="Remove line"
                className="text-slate-400 hover:text-red-500"
                onClick={() => setCards((prev) => prev.filter((c) => c.uid !== card.uid))}
              >
                ✕
              </button>
            </div>
          ))}
        </section>
      ) : null}

      {/* chooser */}
      <section className="mt-4 rounded-[var(--radius-bv)] border-2 border-dashed border-[#ecc39e] bg-[#fdf6ef] p-6">
        <h2 className="text-[18px] font-bold text-[var(--color-bv-text)]">
          Add line {cards.length + 1} — choose one of three options
        </h2>
        <p className="mt-0.5 text-[12.5px] text-[var(--color-bv-muted)]">
          This is the permanent estimate structure. Every line starts from one of these paths.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {(
            [
              {
                key: 'ready' as const,
                n: '1',
                title: 'Materials / ready items',
                body: 'Full stocked sheets, saved bundles, or a vehicle wrap from the vehicle list.',
              },
              {
                key: 'custom' as const,
                n: '2',
                title: 'Custom build',
                body: 'Open the full estimator: materials, machines, labor, design, and installation.',
              },
              {
                key: 'sqft' as const,
                n: '3',
                title: 'Square footage items',
                body: 'Coroplast, banner, Dura-Bond, reflective, wrap — rates come from the Sheet.',
              },
            ]
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setPanel(panel === opt.key ? null : opt.key)}
              className={`rounded-[var(--radius-bv)] border bg-[var(--color-bv-surface)] p-4 text-left shadow-[var(--shadow-bv-card)] transition-shadow hover:shadow-[var(--shadow-bv-elevated)] ${
                panel === opt.key
                  ? 'border-[var(--color-bv-accent)] ring-1 ring-[var(--color-bv-accent)]'
                  : 'border-[var(--color-bv-border)]'
              }`}
            >
              <div className="grid h-8 w-8 place-items-center rounded-[9px] bg-[var(--color-bv-text)] text-[13px] font-bold text-white">
                {opt.n}
              </div>
              <div className="mt-2.5 text-[14px] font-bold text-[var(--color-bv-text)]">{opt.title}</div>
              <p className="mt-1 text-[11.5px] leading-snug text-[var(--color-bv-muted)]">{opt.body}</p>
            </button>
          ))}
        </div>

        {/* ready items panel */}
        {panel === 'ready' ? (
          <div className={`${cardCls} mt-4 p-4`}>
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ['materials', `Full materials · ${props.materials.length}`],
                  ['bundles', `Saved bundles · ${props.bundles.length}`],
                  ['wraps', `Vehicle wraps · ${props.vehicleWraps.length}`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setReadyTab(key)}
                  className={`rounded-full px-4 py-1.5 text-[12px] font-semibold ${
                    readyTab === key
                      ? 'bg-[var(--color-bv-text)] text-white'
                      : 'bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)]'
                  }`}
                >
                  {label}
                </button>
              ))}
              <input
                className={`${inputCls} ml-auto max-w-xs`}
                placeholder="Search — misspellings okay…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="mt-3 max-h-80 divide-y divide-[var(--color-bv-border)] overflow-y-auto">
              {readyTab === 'materials'
                ? filteredMaterials.map((m) => (
                    <div key={m.key} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-[var(--color-bv-text)]">
                          {m.name}
                        </div>
                        <div className="text-[11px] text-[var(--color-bv-muted)]">
                          {m.category}
                          {m.source === 'OVERRIDE' ? ' · app override price' : ''}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[13px] font-bold text-[var(--color-bv-text)]">
                          {formatMoney(m.priceCents)}
                        </div>
                        {m.vendor ? (
                          <div className="text-[10.5px] font-semibold text-[var(--color-bv-accent)]">
                            {m.vendor}
                          </div>
                        ) : null}
                      </div>
                      <button type="button" className={btnDark} onClick={() => addMaterial(m)}>
                        + Add
                      </button>
                    </div>
                  ))
                : null}
              {readyTab === 'bundles'
                ? filteredBundles.map((b) => (
                    <div key={b.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-[var(--color-bv-text)]">
                          {b.name}
                        </div>
                        <div className="text-[11px] text-[var(--color-bv-muted)]">
                          {b.signType || 'Ready item'} · {b.components.length} components
                          {b.shopHours > 0 ? ` · ${b.shopHours} shop hr` : ''}
                        </div>
                      </div>
                      <button type="button" className={btnDark} onClick={() => addBundle(b)}>
                        + Add bundle
                      </button>
                    </div>
                  ))
                : null}
              {readyTab === 'wraps'
                ? filteredWraps.map((w) => (
                    <div key={w.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-[var(--color-bv-text)]">
                          {w.name}
                        </div>
                        <div className="text-[11px] text-[var(--color-bv-muted)]">
                          {w.coverage ? `${w.coverage} · ` : ''}
                          {w.billableAreaSqFt > 0 ? `${w.billableAreaSqFt} sq ft` : 'vehicle wrap'}
                        </div>
                      </div>
                      <div className="text-[13px] font-bold text-[var(--color-bv-text)]">
                        {formatMoney(w.priceCents)}
                      </div>
                      <button type="button" className={btnDark} onClick={() => addWrap(w)}>
                        + Add wrap
                      </button>
                    </div>
                  ))
                : null}
            </div>
          </div>
        ) : null}

        {/* custom build panel */}
        {panel === 'custom' ? (
          <div className={`${cardCls} mt-4 flex flex-wrap items-center justify-between gap-4 p-5`}>
            <div className="max-w-xl text-[13px] leading-relaxed text-[var(--color-bv-muted)]">
              <span className="font-semibold text-[var(--color-bv-text)]">
                Custom build opens the full estimate workspace
              </span>{' '}
              — materials, machines, labor, design, installation, catalog intelligence, and the
              pricing helper. Lines added here are saved first, then the editor opens on the line
              grid.
            </div>
            <button
              type="submit"
              className={btnPrimary}
              disabled={
                pending ||
                !title.trim() ||
                clientId === '' ||
                (clientId === '__new__' && !newClientName.trim())
              }
              onClick={() => {
                const el = document.getElementById('guided-payload') as HTMLInputElement | null;
                if (el) el.value = buildPayload('custom-build');
              }}
            >
              {pending ? 'Opening…' : 'Save & open custom build →'}
            </button>
          </div>
        ) : null}

        {/* sq-ft panel */}
        {panel === 'sqft' ? (
          <div className={`${cardCls} mt-4 p-5`}>
            <div className="grid gap-3 md:grid-cols-[2fr_repeat(3,0.8fr)_1fr_auto] md:items-end">
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-text)] opacity-75">
                  Item
                </span>
                <select className={inputCls} value={sqftId} onChange={(e) => setSqftId(e.target.value)}>
                  {props.sqftRates.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} — {formatMoney(r.pricePerSqFtCents)}/sq ft
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-text)] opacity-75">
                  Width (ft)
                </span>
                <input className={inputCls} type="number" min={0} step="0.01" value={widthFt} onChange={(e) => setWidthFt(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-text)] opacity-75">
                  Height (ft)
                </span>
                <input className={inputCls} type="number" min={0} step="0.01" value={heightFt} onChange={(e) => setHeightFt(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-text)] opacity-75">
                  Quantity
                </span>
                <input className={inputCls} type="number" min={1} step="1" value={pieces} onChange={(e) => setPieces(e.target.value)} />
              </label>
              <div className="pb-1 text-right">
                <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-bv-muted)]">
                  {sqftPreviewArea.toFixed(2)} sq ft
                </div>
                <div className="text-[17px] font-bold text-[var(--color-bv-accent)]">
                  {formatMoney(sqftPreviewCents)}
                </div>
              </div>
              <button type="button" className={btnDark} onClick={addSqft}>
                Add square-foot item
              </button>
            </div>
            <p className="mt-3 text-[11px] text-[var(--color-bv-muted)]">
              Sq-ft prices come from the Sheet and already include markup — they are never marked up
              twice.
            </p>
          </div>
        ) : null}
      </section>

      {state.error ? (
        <div className="mt-4 rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-900">
          {state.error}
        </div>
      ) : null}

      {/* sticky totals bar */}
      <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-[min(1040px,calc(100%-2rem))] items-stretch overflow-hidden rounded-[var(--radius-bv)] bg-[var(--color-bv-text)] text-white shadow-[var(--shadow-bv-elevated)]">
        <div className="flex-1 border-r border-white/10 px-6 py-3.5">
          <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/60">Subtotal</div>
          <div className="text-[19px] font-bold">{formatMoney(totals.subtotalCostCents)}</div>
        </div>
        <div className="flex-1 border-r border-white/10 px-6 py-3.5">
          <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/60">
            Markup {Number(markupPercent) || 0}% · custom lines only
          </div>
          <div className="text-[19px] font-bold">{formatMoney(markupAmount)}</div>
        </div>
        <div className="flex-1 px-6 py-3.5">
          <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/60">
            Estimate total
          </div>
          <div className="text-[19px] font-bold">{formatMoney(totals.finalPriceCents)}</div>
        </div>
        <button
          type="submit"
          className="bg-[var(--color-bv-accent)] px-9 text-[14.5px] font-bold text-white hover:opacity-95 disabled:opacity-60"
          disabled={
            pending ||
            cards.length === 0 ||
            !title.trim() ||
            clientId === '' ||
            (clientId === '__new__' && !newClientName.trim())
          }
          onClick={() => {
            const el = document.getElementById('guided-payload') as HTMLInputElement | null;
            if (el) el.value = buildPayload('save');
          }}
        >
          {pending ? 'Saving…' : 'Save estimate'}
        </button>
      </div>
    </form>
  );
}
