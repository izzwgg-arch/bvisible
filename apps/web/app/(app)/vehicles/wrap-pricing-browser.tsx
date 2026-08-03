'use client';

// Vehicle Wrap Pricing browser — the exact flow of the owner's reference
// app (bvisible-wrap-pricing.vercel.app) with the B Visible look:
//   search → 8 cascading filters → stats → result cards (logo, photo,
//   price, sqft/rate/SKU/status, pricing rule, Copy description / QB
//   text) → table view toggle → filtered CSV export.
// Data comes live from the vehicle wrap pricing tables (Sheet-seeded).

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { SelectControl } from '@/components/app/select-control';
import { VEHICLE_PLACEHOLDER_SVG } from '@/lib/vehicles/display';

export interface WrapRow {
  id: string;
  productName: string;
  make: string;
  model: string;
  variant: string;
  wheelbase: string;
  height: string;
  roofWrapOption: string;
  extraVersion1: string;
  extraOption1: string;
  extraOption2: string;
  sku: string;
  squareFootage: number | null;
  ratePerSf: number | null; // dollars
  chargeCents: number | null;
  pricingRule: string;
  exportNote: string;
  photoUrl: string | null;
}

/// Brand logos are LOCAL files shipped with the app (public/vehicle-library)
/// — instant, offline-safe, never a broken image. Makes without a local
/// logo get a clean initials tile.
const LOCAL_MAKE_LOGO: Record<string, string> = {
  Chevrolet: '/vehicle-library/chevrolet.jpg',
  Chrysler: '/vehicle-library/chrysler.png',
  Crysler: '/vehicle-library/chrysler.png',
  Dodge: '/vehicle-library/dodge.png',
  Ford: '/vehicle-library/ford.png',
  GMC: '/vehicle-library/gmc.png',
  Honda: '/vehicle-library/honda.png',
  Kenworth: '/vehicle-library/kenworth.png',
  Kia: '/vehicle-library/kia.jpg',
  'Mercedes / Dodge': '/vehicle-library/mercedes.png',
  'Mercedes-Benz': '/vehicle-library/mercedes.png',
  Nissan: '/vehicle-library/nissan.jpg',
  Tesla: '/vehicle-library/tesla.png',
  Toyota: '/vehicle-library/toyota.png',
};

function MakeLogo({ make, size = 40 }: { make: string; size?: number }) {
  const src = LOCAL_MAKE_LOGO[make];
  return (
    <span
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-[10px] bg-[var(--color-bv-bg)]"
      style={{ width: size, height: size }}
    >
      <span className="text-[12px] font-black tracking-wide text-[var(--color-bv-muted)]">
        {make.slice(0, 2).toUpperCase()}
      </span>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full bg-white object-contain p-1"
          onError={(e) => {
            (e.target as HTMLImageElement).remove();
          }}
        />
      ) : null}
    </span>
  );
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: cents % 100 === 0 ? 0 : 2 })}`;
}

/// The QuickBooks-ready description line — identical format to the
/// reference app's Copy description / QB text.
function qbLine(r: WrapRow): string {
  const parts = [
    `Vehicle wrap pricing: ${r.productName}${r.variant ? ` - ${r.variant}` : ''}`,
    r.roofWrapOption ? `Roof Wrap Option: ${r.roofWrapOption}` : '',
    r.squareFootage != null ? `${r.squareFootage} SF` : '',
    r.chargeCents != null ? `Price: ${money(r.chargeCents)}` : 'Price not set',
  ].filter(Boolean);
  return parts.join(' | ');
}

interface FilterDef {
  key: keyof WrapRow & ('make' | 'model' | 'wheelbase' | 'height' | 'roofWrapOption' | 'extraVersion1' | 'extraOption1' | 'extraOption2');
  label: string;
}

const FILTERS: FilterDef[] = [
  { key: 'make', label: 'Make' },
  { key: 'model', label: 'Model' },
  { key: 'wheelbase', label: 'Wheelbase / Body' },
  { key: 'height', label: 'Height / Roof' },
  { key: 'roofWrapOption', label: 'Roof Wrap Options' },
  { key: 'extraVersion1', label: 'Extra Version / Cab' },
  { key: 'extraOption1', label: 'Extra Option 1' },
  { key: 'extraOption2', label: 'Extra Option 2' },
];

const TABLE_COLS: Array<[string, (r: WrapRow) => string]> = [
  ['Make', (r) => r.make],
  ['Model', (r) => r.model],
  ['Variant', (r) => r.variant],
  ['Wheelbase', (r) => r.wheelbase],
  ['Height', (r) => r.height],
  ['Roof Wrap Option', (r) => r.roofWrapOption],
  ['Extra Version 1', (r) => r.extraVersion1],
  ['Extra Option 1', (r) => r.extraOption1],
  ['Extra Option 2', (r) => r.extraOption2],
  ['Square Footage', (r) => (r.squareFootage != null ? String(r.squareFootage) : '')],
  ['Rate Per SF', (r) => (r.ratePerSf != null ? `$${r.ratePerSf}` : '')],
  ['Charge', (r) => (r.chargeCents != null ? money(r.chargeCents) : '')],
  ['Pricing Rule', (r) => r.pricingRule],
];

export function WrapPricingBrowser({ rows }: { rows: WrapRow[] }) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [onlyPriced, setOnlyPriced] = useState(false);
  const [tableView, setTableView] = useState(false);
  const [qbOpen, setQbOpen] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const matches = (r: WrapRow, skipKey?: string): boolean => {
    for (const f of FILTERS) {
      if (f.key === skipKey) continue;
      const v = filters[f.key];
      if (v && (r[f.key] || '') !== v) return false;
    }
    if (onlyPriced && r.chargeCents == null) return false;
    const q = search.trim().toLowerCase();
    if (q) {
      const hay = `${r.productName} ${r.make} ${r.model} ${r.variant} ${r.sku} ${r.wheelbase} ${r.height} ${r.roofWrapOption} ${r.extraVersion1} ${r.extraOption1} ${r.extraOption2}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  const filtered = useMemo(() => rows.filter((r) => matches(r)), [rows, filters, onlyPriced, search]); // eslint-disable-line react-hooks/exhaustive-deps

  /// Cascading options: each dropdown lists the values available given
  /// every OTHER active filter (same faceted behavior as the reference).
  const optionsFor = (key: string): string[] => {
    const set = new Set<string>();
    for (const r of rows) {
      if (!matches(r, key)) continue;
      const v = (r as unknown as Record<string, string>)[key];
      if (v) set.add(v);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  };

  const stats = useMemo(() => {
    const withPrice = filtered.filter((r) => r.chargeCents != null);
    const makes = new Set(filtered.map((r) => r.make).filter(Boolean));
    const lowest = withPrice.length > 0 ? Math.min(...withPrice.map((r) => r.chargeCents!)) : null;
    return { total: filtered.length, withPrice: withPrice.length, makes: makes.size, lowest };
  }, [filtered]);

  function resetFilters() {
    setFilters({});
    setSearch('');
    setOnlyPriced(false);
  }

  async function copyDescription(r: WrapRow) {
    try {
      await navigator.clipboard.writeText(qbLine(r));
      setCopied(r.id);
      setTimeout(() => setCopied((c) => (c === r.id ? null : c)), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  function exportCsv() {
    const header = ['Product Name', 'Make', 'Model', 'Charge', 'Variant', 'Wheelbase', 'Height', 'Roof Wrap Option', 'Extra Version 1', 'Extra Option 1', 'Extra Option 2', 'SKU', 'Square Footage', 'Rate Per SF', 'Pricing Rule', 'Export Note'];
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
    const body = filtered.map((r) =>
      [
        r.productName, r.make, r.model,
        r.chargeCents != null ? String(r.chargeCents / 100) : '',
        r.variant, r.wheelbase, r.height, r.roofWrapOption,
        r.extraVersion1, r.extraOption1, r.extraOption2, r.sku,
        r.squareFootage != null ? String(r.squareFootage) : '',
        r.ratePerSf != null ? String(r.ratePerSf) : '',
        r.pricingRule, r.exportNote,
      ].map(esc).join(',')
    );
    const blob = new Blob([[header.join(','), ...body].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vehicle-wrap-pricing-filtered.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      {/* search + actions */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search vehicle, variant, SKU, option…"
          className="h-11 min-w-[260px] flex-1 rounded-[12px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 text-[13.5px] text-[var(--color-bv-text)] shadow-[var(--shadow-bv-card)] outline-none focus:border-[var(--color-bv-accent)]"
        />
        <button
          type="button"
          onClick={resetFilters}
          className="h-11 rounded-[12px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 text-[12.5px] font-bold text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
        >
          Reset filters
        </button>
        <button
          type="button"
          onClick={exportCsv}
          className="h-11 rounded-[12px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 text-[12.5px] font-bold text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
        >
          Export filtered CSV
        </button>
        <Link
          href="/vehicles/library"
          className="h-11 rounded-[12px] bg-[var(--color-bv-accent)] px-4 text-[12.5px] font-bold leading-[44px] text-white hover:opacity-95"
        >
          Vehicle library →
        </Link>
      </div>

      {/* filters */}
      <div className="mb-4 rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-4 shadow-[var(--shadow-bv-card)]">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FILTERS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1.5">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--color-bv-muted)]">{f.label}</span>
              <SelectControl
                searchPlaceholder={`Search ${f.label.toLowerCase()}...`}
                value={filters[f.key] ?? ''}
                onChange={(e) => setFilters((prev) => ({ ...prev, [f.key]: e.target.value }))}
              >
                <option value="">All</option>
                {optionsFor(f.key).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </SelectControl>
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-5 text-[12.5px] text-[var(--color-bv-text)]">
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={onlyPriced} onChange={(e) => setOnlyPriced(e.target.checked)} className="h-4 w-4 rounded border-[var(--color-bv-border)] text-[var(--color-bv-accent)]" />
            show only rows with price
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={tableView} onChange={(e) => setTableView(e.target.checked)} className="h-4 w-4 rounded border-[var(--color-bv-border)] text-[var(--color-bv-accent)]" />
            table view
          </label>
        </div>
      </div>

      {/* stats */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          [String(stats.total), 'matching options'],
          [String(stats.withPrice), 'with final price'],
          [String(stats.makes), 'makes in results'],
          [stats.lowest != null ? money(stats.lowest) : '$0', 'lowest matching price'],
        ].map(([v, l]) => (
          <div key={l} className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-3 shadow-[var(--shadow-bv-card)]">
            <div className="text-[22px] font-black text-[var(--color-bv-text)]">{v}</div>
            <div className="text-[11px] font-semibold text-[var(--color-bv-muted)]">{l}</div>
          </div>
        ))}
      </div>

      <h2 className="mb-3 text-[15px] font-black text-[var(--color-bv-text)]">Results</h2>

      {tableView ? (
        <div className="overflow-x-auto rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
          <table className="w-full min-w-[1100px] text-[12px]">
            <thead>
              <tr className="border-b border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-left text-[10px] font-bold uppercase tracking-wider text-[var(--color-bv-muted)]">
                {TABLE_COLS.map(([h]) => (
                  <th key={h} className="px-3 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-[var(--color-bv-border)] last:border-b-0 hover:bg-[var(--color-bv-bg)]">
                  {TABLE_COLS.map(([h, get]) => (
                    <td key={h} className={`px-3 py-2 ${h === 'Charge' ? 'font-bold text-[var(--color-bv-text)]' : 'text-[var(--color-bv-muted)]'}`}>
                      {get(r) || '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((r) => (
            <div key={r.id} className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-4 shadow-[var(--shadow-bv-card)]">
              {/* photo area with floating make badge — photo always fills
                  the frame gracefully (contain + soft bg), placeholder
                  silhouette when the row has no picture. */}
              <div className="relative mb-3 h-28 overflow-hidden rounded-[12px] border border-[var(--color-bv-border)] bg-gradient-to-br from-white to-[var(--color-bv-bg)] sm:h-32">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.photoUrl ?? VEHICLE_PLACEHOLDER_SVG}
                  alt={`${r.productName} ${r.variant}`.trim()}
                  loading="lazy"
                  className="h-full w-full object-contain p-2"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = VEHICLE_PLACEHOLDER_SVG;
                  }}
                />
                <span className="absolute left-2 top-2 rounded-[12px] border border-[var(--color-bv-border)] bg-white/95 p-0.5 shadow-sm">
                  <MakeLogo make={r.make} size={34} />
                </span>
              </div>

              {/* title + price — wraps cleanly on narrow screens */}
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1 basis-[160px]">
                  <div className="truncate text-[15px] font-black text-[var(--color-bv-text)]">{r.productName}</div>
                  <div className="text-[12px] text-[var(--color-bv-muted)]">{r.variant || '—'}</div>
                </div>
                <div className={`shrink-0 text-right font-black leading-tight ${r.chargeCents != null ? 'text-[22px] text-[var(--color-bv-text)]' : 'text-[14px] text-[var(--color-bv-muted)]'}`}>
                  {r.chargeCents != null ? money(r.chargeCents) : 'Price not set'}
                </div>
              </div>

              {r.roofWrapOption ? (
                <span className="mt-2 inline-flex rounded-full border border-[#ecc39e] bg-[#fdf6ef] px-2.5 py-0.5 text-[10.5px] font-bold text-[#8a5a33]">
                  Roof Wrap Option: {r.roofWrapOption}
                </span>
              ) : null}

              {/* stat boxes */}
              <div className="mt-3 grid grid-cols-2 gap-2">
                {[
                  ['Square footage', r.squareFootage != null ? `${r.squareFootage} SF` : '—'],
                  ['Rate per SF', r.ratePerSf != null ? `$${r.ratePerSf}` : '—'],
                  ['SKU', r.sku || '—'],
                  ['Status', r.exportNote || 'Active variant'],
                ].map(([l, v]) => (
                  <div key={l} className="rounded-[10px] bg-[var(--color-bv-bg)] px-2.5 py-1.5">
                    <div className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--color-bv-muted)]">{l}</div>
                    <div className="truncate text-[12.5px] font-bold text-[var(--color-bv-text)]">{v}</div>
                  </div>
                ))}
              </div>

              <div className="mt-2 text-[11px] font-semibold text-[var(--color-bv-muted)]">
                {r.pricingRule || 'No pricing rule listed'}
              </div>

              {/* actions */}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => void copyDescription(r)}
                  className="rounded-[9px] bg-[var(--color-bv-text)] px-3 py-1.5 text-[11px] font-bold text-white hover:opacity-90"
                >
                  {copied === r.id ? 'Copied ✓' : 'Copy description'}
                </button>
                <button
                  type="button"
                  onClick={() => setQbOpen((prev) => ({ ...prev, [r.id]: !prev[r.id] }))}
                  className="rounded-[9px] border border-[var(--color-bv-border)] bg-white px-3 py-1.5 text-[11px] font-bold text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
                >
                  {qbOpen[r.id] ? 'Hide QB text' : 'View QB text'}
                </button>
              </div>
              {qbOpen[r.id] ? (
                <pre className="mt-2 whitespace-pre-wrap rounded-[10px] bg-[var(--color-bv-bg)] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-bv-text)]">{qbLine(r)}</pre>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-[var(--radius-bv)] border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-5 py-10 text-center text-[13px] text-[var(--color-bv-muted)]">
          No vehicles match these filters — hit Reset filters to start over.
        </div>
      ) : null}

      <p className="mt-6 text-[11.5px] leading-relaxed text-[var(--color-bv-muted)]">
        Prices come live from the pricing Sheet. Rows without a charge show as &ldquo;Price not
        set&rdquo; so they can be completed later. Wrap prices are FINAL selling prices — they are
        never marked up again on estimates.
      </p>
    </div>
  );
}
