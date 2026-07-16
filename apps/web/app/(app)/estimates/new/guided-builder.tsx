'use client';

// Guided line-by-line estimate builder (customer-flow redesign).
// Every line starts from one of three permanent paths:
//   1. Materials / ready items  (Sheet materials · bundles · vehicle wraps)
//   2. Custom build             (saves + opens the full line-grid editor)
//   3. Square footage items     (Sheet sq-ft rates — final prices, R-EST-05)
// Totals run through the same computeEstimate engine as the editor.

import { useActionState, useMemo, useState } from 'react';
import { computeEstimate, formatMoney, type LineKind } from '@bvisible/pricing';
import { fuzzyScore, fuzzySearch } from '@/lib/sheet-sync/fuzzy';
import { createGuidedEstimateAction, type GuidedEstimateState } from './guided-actions';
import { CustomBuildPanel } from './custom-build-panel';
import { RecommendationsPanel, type BuilderRecommendation } from './recommendations-panel';
import { JsonImportPanel, type ImportResult } from './json-import-panel';

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
  aliases: Array<{ alias: string; canonical: string }>;
  recommendations: BuilderRecommendation[];
  salesReps: Array<{ id: string; name: string }>;
  currentUserId: string;
}

/* ---------- internal line model ---------- */

interface GuidedRow {
  kind: LineKind;
  description: string;
  qtyMilli: number;
  unitCostCents: number;
  markupExempt: boolean;
  sourceKind: 'READY_ITEM' | 'BUNDLE' | 'VEHICLE_WRAP' | 'SQFT_ITEM' | 'CUSTOM';
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

/* ---------- vehicle-wrap make parsing (original Sheet names) ---------- */

const KNOWN_MAKES = [
  'Mercedes-Benz',
  'Mercedes',
  'Chevrolet',
  'Chevy',
  'Ford',
  'GMC',
  'RAM',
  'Dodge',
  'Nissan',
  'Toyota',
  'Honda',
  'Isuzu',
  'Freightliner',
  'Tesla',
  'Jeep',
  'Kia',
  'Hyundai',
  'Subaru',
  'Volkswagen',
  'VW',
] as const;

const MAKE_CANONICAL: Record<string, string> = {
  chevy: 'Chevrolet',
  mercedes: 'Mercedes-Benz',
  vw: 'Volkswagen',
};

function wrapMakeOf(name: string): string {
  const lower = name.toLowerCase();
  for (const mk of KNOWN_MAKES) {
    if (lower.startsWith(mk.toLowerCase())) {
      return MAKE_CANONICAL[mk.toLowerCase()] ?? mk;
    }
  }
  const first = name.split(/[\s|–-]+/)[0] ?? name;
  return MAKE_CANONICAL[first.toLowerCase()] ?? first;
}

const MAKE_LOGO_DOMAIN: Record<string, string> = {
  Chevrolet: 'chevrolet.com',
  Ford: 'ford.com',
  GMC: 'gmc.com',
  RAM: 'ramtrucks.com',
  Dodge: 'dodge.com',
  'Mercedes-Benz': 'mercedes-benz.com',
  Nissan: 'nissanusa.com',
  Toyota: 'toyota.com',
  Honda: 'honda.com',
  Isuzu: 'isuzu.com',
  Freightliner: 'freightliner.com',
  Tesla: 'tesla.com',
  Jeep: 'jeep.com',
  Kia: 'kia.com',
  Hyundai: 'hyundaiusa.com',
  Subaru: 'subaru.com',
  Volkswagen: 'vw.com',
};

function MakeLogo({ make, size = 20 }: { make: string; size?: number }) {
  const domain = MAKE_LOGO_DOMAIN[make];
  if (!domain) {
    return (
      <span
        className="grid shrink-0 place-items-center rounded-full bg-[var(--color-bv-bg)] text-[9px] font-bold text-[var(--color-bv-muted)]"
        style={{ width: size, height: size }}
      >
        {make.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://logo.clearbit.com/${domain}`}
      alt={make}
      width={size}
      height={size}
      className="shrink-0 rounded-full object-contain"
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = 'none';
      }}
    />
  );
}

const inputCls =
  'w-full rounded-[10px] border border-[var(--color-bv-border)] bg-white px-3 py-2 text-[13.5px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]';
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

  // Sq-ft panel state. Price is editable — prefilled from the Sheet rate;
  // whatever ends up here is the FINAL selling $/sq ft (never marked up).
  const [sqftId, setSqftId] = useState(props.sqftRates[0]?.id ?? '');
  const [widthFt, setWidthFt] = useState('4');
  const [heightFt, setHeightFt] = useState('8');
  const [pieces, setPieces] = useState('1');
  const [sqftPrice, setSqftPrice] = useState(() =>
    props.sqftRates[0] ? (props.sqftRates[0].pricePerSqFtCents / 100).toFixed(2) : ''
  );

  // Extra tool panels (suggestions by sign type, JSON import).
  const [toolPanel, setToolPanel] = useState<'recommend' | 'json' | null>(null);
  const [autoRecommendDismissed, setAutoRecommendDismissed] = useState(false);

  // Sales representative (defaults to the signed-in user).
  const [salesRepId, setSalesRepId] = useState(props.currentUserId);

  // Vehicle-wrap make filter (manufacturer dropdown with logos).
  const [wrapMake, setWrapMake] = useState('');

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

  // Fuzzy search: tolerates misspellings, partial words, and Sheet ALIASES.
  const filterText = search.trim();
  const filteredMaterials = useMemo(
    () =>
      filterText
        ? fuzzySearch(filterText, props.materials, (m) => `${m.name} ${m.category} ${m.vendor}`, {
            limit: 30,
            aliases: props.aliases,
          })
        : props.materials.slice(0, 30),
    [props.materials, props.aliases, filterText]
  );
  const filteredBundles = useMemo(
    () =>
      filterText
        ? fuzzySearch(filterText, props.bundles, (b) => `${b.name} ${b.signType}`, { limit: 20 })
        : props.bundles,
    [props.bundles, filterText]
  );
  const filteredWraps = useMemo(() => {
    const pool = wrapMake
      ? props.vehicleWraps.filter((w) => wrapMakeOf(w.name) === wrapMake)
      : props.vehicleWraps;
    return filterText
      ? fuzzySearch(filterText, pool, (w) => `${w.name} ${w.coverage}`, { limit: 40 })
      : pool.slice(0, 40);
  }, [props.vehicleWraps, filterText, wrapMake]);

  // Which Sheet materials are already on the estimate (for recommendations).
  const addedMaterialKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const card of cards) {
      for (const row of card.rows) if (row.sheetKey) keys.add(row.sheetKey);
    }
    return keys;
  }, [cards]);

  // AI sign-type detection from the job name (deterministic fuzzy match
  // against the Sheet's recommendation sign types) with a confidence %.
  const detectedSign = useMemo(() => {
    const t = title.trim();
    if (t.length < 3) return null;
    let best: { signType: string; score: number } | null = null;
    for (const st of Array.from(new Set(props.recommendations.map((r) => r.signType)))) {
      const score = fuzzyScore(t, st);
      if (!best || score > best.score) best = { signType: st, score };
    }
    return best && best.score >= 0.5
      ? { signType: best.signType, confidence: Math.min(99, Math.round(best.score * 100)) }
      : null;
  }, [title, props.recommendations]);

  const autoRecommendOpen =
    detectedSign != null && !autoRecommendDismissed && toolPanel === null;
  const recommendOpen = toolPanel === 'recommend' || autoRecommendOpen;

  // Vehicle-wrap make list parsed from the Sheet's original vehicle names.
  const wrapMakes = useMemo(() => {
    const makes = new Map<string, number>();
    for (const w of props.vehicleWraps) {
      const make = wrapMakeOf(w.name);
      makes.set(make, (makes.get(make) ?? 0) + 1);
    }
    return Array.from(makes.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [props.vehicleWraps]);

  function addCard(card: Omit<GuidedCard, 'uid'>) {
    setCards((prev) => [...prev, { ...card, uid: nextUid++ }]);
    setPanel(null);
    setSearch('');
  }

  // Same, but keeps the current panel open (recommendations add several).
  function addCardKeepPanel(card: Omit<GuidedCard, 'uid'>) {
    setCards((prev) => [...prev, { ...card, uid: nextUid++ }]);
  }

  function setCardQty(uid: number, qty: number) {
    setCards((prev) =>
      prev.map((c) => {
        const row = c.rows[0];
        if (c.uid !== uid || c.rows.length !== 1 || !row) return c;
        const qtyMilli = Math.max(1, Math.round(qty * 1000));
        const updated: GuidedRow = { ...row, qtyMilli };
        return { ...c, rows: [updated] };
      })
    );
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
    const priceCents = Math.round((Number(sqftPrice) || 0) * 100);
    if (!rate || w <= 0 || h <= 0 || priceCents <= 0) return;
    const area = w * h * n;
    const billableArea = area * (1 + Math.max(0, rate.wastePercent) / 100);
    const overridden = priceCents !== rate.pricePerSqFtCents;
    addCard({
      label: `${rate.name} — ${w}′ × ${h}′${n > 1 ? ` × ${n}` : ''}`,
      sublabel: `${billableArea.toFixed(2)} sq ft × ${formatMoney(priceCents)}/sq ft${overridden ? ` (overridden — Sheet rate ${formatMoney(rate.pricePerSqFtCents)})` : ''} — final price, never marked up`,
      badge: 'Square footage',
      rows: [
        {
          kind: 'MATERIAL',
          description: `${rate.name} — ${w}ft × ${h}ft × ${n} (${billableArea.toFixed(2)} sq ft @ ${formatMoney(priceCents)}/sq ft)`,
          qtyMilli: Math.round(billableArea * 1000),
          unitCostCents: priceCents,
          markupExempt: true,
          sourceKind: 'SQFT_ITEM',
        },
      ],
    });
  }

  function addRecommendedMaterial(m: BuilderMaterial, reason: string) {
    addCardKeepPanel({
      label: m.name,
      sublabel: `Suggested for this sign type — ${reason}`,
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

  function removeMaterialByKey(key: string) {
    setCards((prev) => prev.filter((c) => !c.rows.some((r) => r.sheetKey === key)));
  }

  function handleJsonImport(result: ImportResult) {
    setCards((prev) => [...prev, ...result.cards.map((c) => ({ ...c, uid: nextUid++ }))]);
    if (result.title && !title.trim()) setTitle(result.title);
    if (result.markupPercent != null) setMarkupPercent(result.markupPercent);
    if (result.customerName && clientId === '') {
      const existing = props.clients.find(
        (c) => c.companyName.toLowerCase() === result.customerName!.toLowerCase()
      );
      if (existing) {
        setClientId(existing.id);
      } else {
        setClientId('__new__');
        setNewClientName(result.customerName);
      }
    }
    setToolPanel(null);
  }

  function buildPayload(intent: 'save') {
    return JSON.stringify({
      title,
      clientId: clientId === '__new__' || clientId === '' ? null : clientId,
      newClientName: clientId === '__new__' ? newClientName : null,
      markupPercent: Number(markupPercent) || 0,
      salesRepId: salesRepId || null,
      intent,
      lines: cards.flatMap((c) => c.rows),
    });
  }

  const sqftRate = props.sqftRates.find((r) => r.id === sqftId);
  const sqftPreviewArea =
    (Number(widthFt) || 0) * (Number(heightFt) || 0) * Math.max(1, Math.round(Number(pieces) || 1));
  const sqftPriceCents = Math.round((Number(sqftPrice) || 0) * 100);
  const sqftPreviewCents = sqftRate
    ? Math.round(sqftPreviewArea * (1 + Math.max(0, sqftRate.wastePercent) / 100) * sqftPriceCents)
    : 0;

  return (
    <form action={formAction} className="pb-8">
      <input type="hidden" name="payload" id="guided-payload" />

      {/* meta */}
      <section className={`${cardCls} grid gap-4 p-5 md:grid-cols-[2fr_1.6fr_0.6fr_1fr]`}>
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
        <label className="block">
          <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-text)] opacity-75">
            Sales rep
          </span>
          <select
            className={inputCls}
            value={salesRepId}
            onChange={(e) => setSalesRepId(e.target.value)}
          >
            {props.salesReps.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
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
              {card.rows.length === 1 &&
              card.rows[0] &&
              card.rows[0].kind === 'MATERIAL' &&
              !card.rows[0].markupExempt ? (
                <label className="flex items-center gap-1.5">
                  <span className="text-[9px] font-bold uppercase text-[var(--color-bv-muted)]">
                    Qty
                  </span>
                  <input
                    className="w-16 rounded-[8px] border border-[var(--color-bv-border)] bg-white px-2 py-1 text-right text-[12.5px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]"
                    type="number"
                    min={0.001}
                    step="any"
                    value={card.rows[0].qtyMilli / 1000}
                    onChange={(e) => setCardQty(card.uid, Number(e.target.value) || 0.001)}
                  />
                </label>
              ) : null}
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
              {readyTab === 'wraps' ? (
                <div className="ml-auto flex items-center gap-2">
                  {wrapMake ? <MakeLogo make={wrapMake} size={22} /> : null}
                  <select
                    className={`${inputCls} w-44`}
                    value={wrapMake}
                    onChange={(e) => setWrapMake(e.target.value)}
                    aria-label="Filter by manufacturer"
                  >
                    <option value="">All makes</option>
                    {wrapMakes.map(([make, count]) => (
                      <option key={make} value={make}>
                        {make} · {count}
                      </option>
                    ))}
                  </select>
                  <input
                    className={`${inputCls} max-w-xs`}
                    placeholder="Search — misspellings okay…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              ) : (
                <input
                  className={`${inputCls} ml-auto max-w-xs`}
                  placeholder="Search — misspellings okay…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              )}
            </div>

            <div className="mt-3 max-h-80 divide-y divide-[var(--color-bv-border)] overflow-y-auto">
              {readyTab === 'materials'
                ? filteredMaterials.map((m) => (
                    <div
                      key={m.key}
                      className="flex cursor-pointer items-center gap-3 rounded-[8px] px-1 py-2.5 hover:bg-[var(--color-bv-bg)]"
                      onClick={() => addMaterial(m)}
                    >
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
                      <span className={`${btnDark} pointer-events-none`}>+ Add</span>
                    </div>
                  ))
                : null}
              {readyTab === 'bundles'
                ? filteredBundles.map((b) => (
                    <div
                      key={b.id}
                      className="flex cursor-pointer items-center gap-3 rounded-[8px] px-1 py-2.5 hover:bg-[var(--color-bv-bg)]"
                      onClick={() => addBundle(b)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-[var(--color-bv-text)]">
                          {b.name}
                        </div>
                        <div className="text-[11px] text-[var(--color-bv-muted)]">
                          {b.signType || 'Ready item'} · {b.components.length} components
                          {b.shopHours > 0 ? ` · ${b.shopHours} shop hr` : ''}
                        </div>
                      </div>
                      <span className={`${btnDark} pointer-events-none`}>+ Add bundle</span>
                    </div>
                  ))
                : null}
              {readyTab === 'wraps'
                ? filteredWraps.map((w) => (
                    <div
                      key={w.id}
                      className="flex cursor-pointer items-center gap-3 rounded-[8px] px-1 py-2.5 hover:bg-[var(--color-bv-bg)]"
                      onClick={() => addWrap(w)}
                    >
                      <MakeLogo make={wrapMakeOf(w.name)} />
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
                      <span className={`${btnDark} pointer-events-none`}>+ Add wrap</span>
                    </div>
                  ))
                : null}
            </div>
          </div>
        ) : null}

        {/* custom build panel — full cost-up workspace, returns as one line group */}
        {panel === 'custom' ? (
          <CustomBuildPanel
            materials={props.materials}
            machines={props.machines}
            rates={props.rates}
            markupPercent={Number(markupPercent) || 0}
            nextLineNumber={cards.length + 1}
            onAdd={(card) => addCard(card)}
          />
        ) : null}

        {/* sq-ft panel */}
        {panel === 'sqft' ? (
          <div className={`${cardCls} mt-4 p-5`}>
            <div className="grid gap-3 md:grid-cols-[2fr_repeat(3,0.7fr)_0.9fr_1fr_auto] md:items-end">
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-text)] opacity-75">
                  Item
                </span>
                <select
                  className={inputCls}
                  value={sqftId}
                  onChange={(e) => {
                    setSqftId(e.target.value);
                    const rate = props.sqftRates.find((r) => r.id === e.target.value);
                    if (rate) setSqftPrice((rate.pricePerSqFtCents / 100).toFixed(2));
                  }}
                >
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
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-accent)]">
                  $ / sq ft (final)
                </span>
                <input
                  className={`${inputCls} ${sqftRate && sqftPriceCents !== sqftRate.pricePerSqFtCents ? 'border-[var(--color-bv-accent)] font-bold' : ''}`}
                  type="number"
                  min={0}
                  step="0.01"
                  value={sqftPrice}
                  onChange={(e) => setSqftPrice(e.target.value)}
                />
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
              The $/sq ft is the FINAL selling price (prefilled from the Sheet, editable per job) —
              total = square footage × price, never marked up again.
            </p>
          </div>
        ) : null}

        {/* extra tools: suggestions by sign type · JSON import */}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              if (autoRecommendOpen) {
                setAutoRecommendDismissed(true);
              } else if (toolPanel === 'recommend') {
                setToolPanel(null);
                setAutoRecommendDismissed(true);
              } else {
                setToolPanel('recommend');
              }
            }}
            className={`rounded-full px-4 py-1.5 text-[11.5px] font-bold ${
              recommendOpen
                ? 'bg-[var(--color-bv-accent)] text-white'
                : 'border border-[var(--color-bv-border)] bg-white text-[var(--color-bv-muted)]'
            }`}
          >
            ✦ Suggested materials by sign type
            {detectedSign ? ` · ${detectedSign.signType} ${detectedSign.confidence}%` : ''}
          </button>
          <button
            type="button"
            onClick={() => setToolPanel(toolPanel === 'json' ? null : 'json')}
            className={`rounded-full px-4 py-1.5 text-[11.5px] font-bold ${
              toolPanel === 'json'
                ? 'bg-[var(--color-bv-accent)] text-white'
                : 'border border-[var(--color-bv-border)] bg-white text-[var(--color-bv-muted)]'
            }`}
          >
            {'{ }'} Import estimate from JSON
          </button>
        </div>

        {recommendOpen ? (
          <RecommendationsPanel
            key={detectedSign?.signType ?? 'manual'}
            recommendations={props.recommendations}
            materials={props.materials}
            addedKeys={addedMaterialKeys}
            onAdd={addRecommendedMaterial}
            onRemove={removeMaterialByKey}
            detected={detectedSign}
          />
        ) : null}

        {toolPanel === 'json' ? (
          <JsonImportPanel
            materials={props.materials}
            machines={props.machines}
            sqftRates={props.sqftRates}
            vehicleWraps={props.vehicleWraps}
            rates={props.rates}
            aliases={props.aliases}
            onImport={handleJsonImport}
            onClose={() => setToolPanel(null)}
          />
        ) : null}
      </section>

      {state.error ? (
        <div className="mt-4 rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-900">
          {state.error}
        </div>
      ) : null}

      {/* sticky totals bar — sticks inside the content column, never over the sidebar */}
      <div className="sticky bottom-4 z-40 mt-6 flex w-full flex-wrap items-stretch overflow-hidden rounded-[var(--radius-bv)] bg-[var(--color-bv-text)] text-white shadow-[var(--shadow-bv-elevated)]">
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
