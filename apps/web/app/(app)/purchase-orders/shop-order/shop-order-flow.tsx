'use client';

// "Order materials" — search the Sheet's catalog (misspelling-tolerant via
// the ALIASES tab), preferred vendor preselected when the material has one
// (otherwise the cheapest), then a Review order screen grouped by vendor
// before creating one PO per vendor. Amazon / retail vendors are split
// into their own cart group — they get the office cart workflow, never a
// vendor PO email. Optional custom materials for anything not in the list.

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { formatMoney } from '@bvisible/pricing';
import { SelectControl } from '@/components/app/select-control';
import { fuzzySearch } from '@/lib/sheet-sync/fuzzy';
import { setAssistantContext } from '@/lib/assistant/context-store';
import {
  createShopOrderAction,
  sendOfficeDraftEmailAction,
  sendShopOrderPoAction,
  type ShopOrderResult,
} from './shop-order-actions';
import {
  buildOfficeDraftEmail,
  buildRetailCartUrl,
  buildRetailItemLinks,
  isRetailVendor,
} from '@/lib/po/retail-cart';

export interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  spec: string;
  size: string;
  priceCents: number;
  vendor: string;
  vendorPrices: Array<{ vendor: string; priceCents: number }>;
  vendorSku: string;
  productUrl: string;
  /// Configured preferred vendor ('' when none). Wins over price when it
  /// has an entered price; the employee can always pick another vendor.
  preferredVendor: string;
}

export interface FlowProps {
  catalog: CatalogEntry[];
  aliases: Array<{ alias: string; canonical: string }>;
  vendorEmails: Record<string, string>;
  smtpConfigured: boolean;
}

type VendorMode = 'preferred' | 'cheapest' | 'manual';

interface OrderLine {
  uid: number;
  name: string;
  detail: string;
  vendor: string;
  vendorMode: VendorMode;
  qty: number;
  unitPriceCents: number;
  catalogId: string;
  vendorSku: string;
  productUrl: string;
  preferredVendor: string;
  vendorOptions: Array<{ vendor: string; priceCents: number }>;
}

let nextUid = 1;

const inputCls =
  'rounded-[10px] border border-[var(--color-bv-border)] bg-white px-3 py-2 text-[13px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]';
const btnDark =
  'inline-flex items-center justify-center rounded-[10px] bg-[var(--color-bv-text)] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:opacity-95 disabled:opacity-50';
const btnAccent =
  'inline-flex items-center justify-center rounded-[11px] bg-[var(--color-bv-accent)] px-5 py-3 text-[13.5px] font-bold text-white hover:opacity-95 disabled:opacity-60';
const cardCls =
  'rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]';

/* ------------------------------ helpers ------------------------------ */

function cheapestOption(
  options: Array<{ vendor: string; priceCents: number }>
): { vendor: string; priceCents: number } | undefined {
  return [...options].sort((a, b) => a.priceCents - b.priceCents)[0];
}

function sameVendor(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/// Preferred vendor wins when it has a price; otherwise the cheapest.
function defaultVendorFor(item: CatalogEntry): {
  vendor: string;
  priceCents: number;
  mode: VendorMode;
} {
  const preferred = item.preferredVendor
    ? item.vendorPrices.find((o) => sameVendor(o.vendor, item.preferredVendor))
    : undefined;
  if (preferred) return { vendor: preferred.vendor, priceCents: preferred.priceCents, mode: 'preferred' };
  const cheapest = cheapestOption(item.vendorPrices);
  if (cheapest) return { vendor: cheapest.vendor, priceCents: cheapest.priceCents, mode: 'cheapest' };
  return { vendor: item.vendor || 'Vendor TBD', priceCents: item.priceCents, mode: 'cheapest' };
}

function lineTotal(l: OrderLine): number {
  return Math.round(l.qty * l.unitPriceCents);
}

/// Vendor groups in add order — retail (Amazon/…) groups sorted last so
/// the review screen shows regular POs first, matching the summary.
function groupLines(lines: OrderLine[]): Array<[string, OrderLine[]]> {
  const map = new Map<string, OrderLine[]>();
  for (const l of lines) {
    const bucket = map.get(l.vendor) ?? [];
    bucket.push(l);
    map.set(l.vendor, bucket);
  }
  return Array.from(map.entries()).sort(
    (a, b) => Number(isRetailVendor(a[0])) - Number(isRetailVendor(b[0]))
  );
}

function splitRetailCounts(retailVendors: string[]): { amazon: number; other: number } {
  let amazon = 0;
  let other = 0;
  for (const v of retailVendors) {
    if (/amazon/i.test(v)) amazon += 1;
    else other += 1;
  }
  return { amazon, other };
}

function countsLabel(regular: number, retailVendors: string[]): string {
  const { amazon, other } = splitRetailCounts(retailVendors);
  const parts: string[] = [];
  if (regular > 0) parts.push(`${regular} purchase order${regular === 1 ? '' : 's'}`);
  if (amazon > 0) parts.push(`${amazon} Amazon cart${amazon === 1 ? '' : 's'}`);
  if (other > 0) parts.push(`${other} online cart${other === 1 ? '' : 's'}`);
  return parts.join(' + ') || 'No items yet';
}

function primaryButtonLabel(regular: number, retailVendors: string[]): string {
  const { amazon, other } = splitRetailCounts(retailVendors);
  const cartWord = amazon > 0 ? 'Amazon cart' : 'online cart';
  if (regular > 0 && amazon + other > 0)
    return `Create PO${regular === 1 ? '' : 's'} & add to ${cartWord}`;
  if (amazon + other > 0) return `Add items to ${cartWord}`;
  return `Create & send ${regular} PO${regular === 1 ? '' : 's'}`;
}

function draftButtonLabel(groupCount: number): string {
  if (groupCount <= 1) return 'Save as draft';
  return `Save ${groupCount} drafts`;
}

/* ------------------------------ vendor select ------------------------------ */

function VendorSelect({
  line,
  onPick,
  onOther,
  compact,
}: {
  line: Pick<OrderLine, 'vendor' | 'vendorOptions' | 'preferredVendor' | 'name'>;
  onPick: (vendor: string, priceCents: number) => void;
  onOther?: () => void;
  compact?: boolean;
}) {
  const best = cheapestOption(line.vendorOptions);
  return (
    <SelectControl
      searchPlaceholder="Search vendors..."
      value={line.vendor}
      aria-label={`Vendor for ${line.name}`}
      className={compact ? 'min-h-8 rounded-[9px] px-2.5 !text-[12px]' : undefined}
      onChange={(e) => {
        const next = e.target.value;
        if (next === '__other__') {
          onOther?.();
          return;
        }
        const opt = line.vendorOptions.find((o) => o.vendor === next);
        if (opt) onPick(opt.vendor, opt.priceCents);
      }}
    >
      {line.vendorOptions.map((o) => {
        const tags: string[] = [];
        if (line.preferredVendor && sameVendor(o.vendor, line.preferredVendor)) tags.push('Preferred');
        if (best && o.vendor === best.vendor) tags.push('Best price');
        return (
          <option key={o.vendor} value={o.vendor}>
            {o.vendor} — {formatMoney(o.priceCents)}
            {tags.length > 0 ? ` · ${tags.join(' · ')}` : ''}
          </option>
        );
      })}
      {/* Keep the current vendor selectable even when it is a manual
          "other vendor" that has no catalog price row. */}
      {line.vendorOptions.some((o) => o.vendor === line.vendor) ? null : (
        <option value={line.vendor}>{line.vendor}</option>
      )}
      {onOther ? <option value="__other__">Other vendor…</option> : null}
    </SelectControl>
  );
}

/// Inline mini-form shown when "Other vendor…" is picked for a line.
function OtherVendorForm({
  onApply,
  onCancel,
}: {
  onApply: (vendor: string, priceCents: number) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[10px] border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2">
      <input
        className={`${inputCls} w-40`}
        placeholder="Vendor name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Other vendor name"
      />
      <input
        className={`${inputCls} w-24`}
        type="number"
        min={0}
        step="0.01"
        placeholder="Price $"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        aria-label="Other vendor price"
      />
      <button
        type="button"
        className={btnDark}
        disabled={!name.trim()}
        onClick={() => onApply(name.trim(), Math.round((Number(price) || 0) * 100))}
      >
        Use vendor
      </button>
      <button
        type="button"
        className="text-[12px] font-semibold text-[var(--color-bv-muted)] hover:underline"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}

/* ------------------------------ qty stepper ------------------------------ */

function QtyStepper({
  qty,
  onChange,
  small,
}: {
  qty: number;
  onChange: (next: number) => void;
  small?: boolean;
}) {
  const btn = `grid place-items-center rounded-[8px] text-[15px] font-bold text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)] disabled:opacity-40 ${small ? 'h-7 w-7' : 'h-9 w-9'}`;
  return (
    <div
      className={`inline-flex items-center rounded-[10px] border border-[var(--color-bv-border)] bg-white ${small ? 'px-0.5' : 'px-1'}`}
    >
      <button
        type="button"
        aria-label="Decrease quantity"
        className={btn}
        disabled={qty <= 1}
        onClick={() => onChange(Math.max(1, Math.ceil(qty) - 1))}
      >
        −
      </button>
      <input
        className={`w-11 border-0 bg-transparent text-center text-[13.5px] font-bold text-[var(--color-bv-text)] outline-none ${small ? 'py-0.5' : 'py-1.5'}`}
        type="number"
        min={1}
        step="any"
        value={qty}
        aria-label="Quantity"
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= 1) onChange(v);
        }}
      />
      <button
        type="button"
        aria-label="Increase quantity"
        className={btn}
        onClick={() => onChange(Math.floor(qty) + 1)}
      >
        +
      </button>
    </div>
  );
}

/* ------------------------------ main flow ------------------------------ */

export function ShopOrderFlow(props: FlowProps) {
  const [step, setStep] = useState<'build' | 'review'>('build');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [vendorNotes, setVendorNotes] = useState<Record<string, string>>({});
  const [noteOpenFor, setNoteOpenFor] = useState<Record<string, boolean>>({});
  const [otherVendorFor, setOtherVendorFor] = useState<number | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customVendor, setCustomVendor] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  // One idempotency key per composed order — a double-click, refresh, or
  // retry of the same submission can never create duplicates.
  const requestIdRef = useRef<string>('');
  if (!requestIdRef.current) {
    requestIdRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `req-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }

  const [state, formAction, pending] = useActionState<ShopOrderResult, FormData>(
    createShopOrderAction,
    { error: null }
  );

  // Publish live screen context for the floating assistant dock.
  useEffect(() => {
    const vendorNames = Array.from(new Set(lines.map((l) => l.vendor)));
    const totalCents = lines.reduce((s, l) => s + lineTotal(l), 0);
    setAssistantContext({
      page: 'Order materials (shop order)',
      summary: [
        `Items (${lines.length}):`,
        lines
          .slice(0, 15)
          .map((l, i) => `${i + 1}. ${l.name} — ${l.qty} × ${formatMoney(l.unitPriceCents)} from ${l.vendor}`)
          .join('\n') || '(none yet — the operator is searching the Sheet vendor catalog)',
        `Vendors involved: ${vendorNames.join(', ') || '(none yet)'}`,
        `Order total: ${formatMoney(totalCents)}`,
        'One PO per regular vendor; Amazon/retail items go through the office cart workflow.',
      ].join('\n'),
    });
  }, [lines]);

  useEffect(() => {
    return () => setAssistantContext(null);
  }, []);

  const results = useMemo(() => {
    const q = search.trim();
    if (!q) return [];
    // Fuzzy: misspellings, partial words, and Sheet ALIASES all match.
    return fuzzySearch(
      q,
      props.catalog,
      (item) => `${item.name} ${item.category} ${item.subcategory} ${item.spec} ${item.size}`,
      { limit: 25, aliases: props.aliases }
    );
  }, [search, props.catalog, props.aliases]);

  function updateLine(uid: number, patch: Partial<OrderLine>) {
    setLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
  }

  function removeLine(uid: number) {
    setLines((prev) => prev.filter((l) => l.uid !== uid));
  }

  /// Add from a search result. Same material + same vendor bumps the
  /// quantity instead of creating a duplicate row. An explicit vendor
  /// (picked in the result row's dropdown before adding) is a manual
  /// override from the start.
  function addItem(item: CatalogEntry, override?: { vendor: string; priceCents: number }) {
    const pick = override
      ? { ...override, mode: 'manual' as VendorMode }
      : defaultVendorFor(item);
    setLines((prev) => {
      const existing = prev.find(
        (l) => l.catalogId === item.id && l.catalogId !== '' && sameVendor(l.vendor, pick.vendor)
      );
      if (existing) {
        return prev.map((l) => (l.uid === existing.uid ? { ...l, qty: l.qty + 1 } : l));
      }
      return [
        ...prev,
        {
          uid: nextUid++,
          name: item.name,
          detail: [item.spec, item.size].filter(Boolean).join(' · '),
          vendor: pick.vendor,
          vendorMode: pick.mode,
          qty: 1,
          unitPriceCents: pick.priceCents,
          catalogId: item.id,
          vendorSku: item.vendorSku,
          productUrl: item.productUrl,
          preferredVendor: item.preferredVendor,
          vendorOptions:
            item.vendorPrices.length > 0
              ? item.vendorPrices
              : [{ vendor: pick.vendor, priceCents: pick.priceCents }],
        },
      ];
    });
  }

  function addCustom() {
    const priceCents = Math.round((Number(customPrice) || 0) * 100);
    if (!customName.trim() || !customVendor.trim()) return;
    setLines((prev) => [
      ...prev,
      {
        uid: nextUid++,
        name: customName.trim(),
        detail: 'Custom material (not in the Sheet)',
        vendor: customVendor.trim(),
        vendorMode: 'manual',
        qty: 1,
        unitPriceCents: priceCents,
        catalogId: '',
        vendorSku: '',
        productUrl: '',
        preferredVendor: '',
        vendorOptions: [{ vendor: customVendor.trim(), priceCents }],
      },
    ]);
    setCustomName('');
    setCustomVendor('');
    setCustomPrice('');
    setCustomOpen(false);
  }

  const groups = useMemo(() => groupLines(lines), [lines]);
  const regularGroups = groups.filter(([v]) => !isRetailVendor(v));
  const retailGroups = groups.filter(([v]) => isRetailVendor(v));
  const combinedTotal = lines.reduce((s, l) => s + lineTotal(l), 0);

  function buildPayload(mode: 'send' | 'draft'): string {
    return JSON.stringify({
      mode,
      requestId: requestIdRef.current,
      vendorNotes,
      lines: lines.map((l) => ({
        name: l.name,
        detail: l.detail,
        vendor: l.vendor,
        qty: l.qty,
        unitPriceCents: l.unitPriceCents,
        catalogId: l.catalogId,
        vendorSku: l.vendorSku,
        productUrl: l.productUrl,
        vendorMode: l.vendorMode,
      })),
    });
  }

  function setPayload(mode: 'send' | 'draft') {
    const el = document.getElementById('shop-order-payload') as HTMLInputElement | null;
    if (el) el.value = buildPayload(mode);
  }

  /// Open the first retail cart in the same click so the browser treats
  /// it as a user action. ONE tab only — popup blockers swallow the rest;
  /// the results screen has "Reopen … cart" links for the others.
  function openFirstRetailCart() {
    for (const [vendorName, vendorLines] of retailGroups) {
      const cartUrl = buildRetailCartUrl(
        vendorName,
        vendorLines.map((l) => ({
          name: l.name,
          qty: Math.max(1, Math.ceil(l.qty)),
          url: l.productUrl,
          sku: l.vendorSku,
          unitPriceCents: l.unitPriceCents,
        }))
      );
      if (cartUrl) {
        window.open(cartUrl, '_blank', 'noopener');
        break;
      }
    }
  }

  /* ---------- results screen (order finished or drafts saved) ---------- */
  if (state.created && state.created.length > 0) {
    return (
      <ResultScreen
        created={state.created}
        mode={state.mode ?? 'draft'}
        smtpConfigured={props.smtpConfigured}
        onRestart={() => window.location.reload()}
      />
    );
  }

  const orderPanel = (
    <CurrentOrderPanel
      groups={groups}
      regularCount={regularGroups.length}
      retailVendors={retailGroups.map(([v]) => v)}
      combinedTotal={combinedTotal}
      otherVendorFor={otherVendorFor}
      setOtherVendorFor={setOtherVendorFor}
      updateLine={updateLine}
      removeLine={removeLine}
      pending={pending}
      onReview={() => setStep('review')}
      setPayload={setPayload}
    />
  );

  return (
    <form action={formAction} className="pb-8">
      <input type="hidden" name="payload" id="shop-order-payload" />

      {step === 'review' ? (
        <ReviewScreen
          groups={groups}
          regularGroups={regularGroups}
          retailGroups={retailGroups}
          lines={lines}
          combinedTotal={combinedTotal}
          vendorNotes={vendorNotes}
          setVendorNotes={setVendorNotes}
          noteOpenFor={noteOpenFor}
          setNoteOpenFor={setNoteOpenFor}
          otherVendorFor={otherVendorFor}
          setOtherVendorFor={setOtherVendorFor}
          updateLine={updateLine}
          removeLine={removeLine}
          pending={pending}
          error={state.error}
          onBack={() => setStep('build')}
          setPayload={setPayload}
          openFirstRetailCart={openFirstRetailCart}
        />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div>
            {/* search */}
            <input
              className="w-full rounded-[var(--radius-bv)] border-2 border-[var(--color-bv-accent)] bg-white px-5 py-3.5 text-[15px] text-[var(--color-bv-text)] shadow-[var(--shadow-bv-card)] outline-none"
              placeholder="Search materials..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setCustomOpen((v) => !v)}
              className="mt-2 text-[12.5px] font-semibold text-[var(--color-bv-accent)] hover:underline"
            >
              + Add a material not listed
            </button>

            {customOpen ? (
              <div className={`${cardCls} mt-3 grid gap-3 p-4 md:grid-cols-[2fr_1.2fr_0.8fr_auto] md:items-end`}>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-bv-muted)]">Material</span>
                  <input className={`${inputCls} w-full`} value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="What does the shop need?" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-bv-muted)]">Vendor</span>
                  <input className={`${inputCls} w-full`} value={customVendor} onChange={(e) => setCustomVendor(e.target.value)} placeholder="Vendor name" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-bv-muted)]">Est. price $</span>
                  <input className={`${inputCls} w-full`} type="number" min={0} step="0.01" value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} />
                </label>
                <button type="button" className={btnDark} onClick={addCustom}>
                  Add
                </button>
              </div>
            ) : null}

            {/* results */}
            {results.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2 flex items-center gap-1.5 text-[12px] text-[var(--color-bv-muted)]">
                  <span aria-hidden>ⓘ</span>
                  Preferred vendor selected automatically; otherwise best price — change it anytime.
                </p>
                <div className={`${cardCls} divide-y divide-[var(--color-bv-border)] overflow-visible`}>
                  {results.map((item) => (
                    <ResultRow
                      key={item.id}
                      item={item}
                      line={lines.find((l) => l.catalogId === item.id)}
                      onAdd={(override) => addItem(item, override)}
                      updateLine={updateLine}
                      removeLine={removeLine}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {search.trim() && results.length === 0 ? (
              <div className={`${cardCls} mt-4 px-5 py-8 text-center text-[13px] text-[var(--color-bv-muted)]`}>
                No materials match “{search.trim()}”. Try another spelling or add it as a
                custom material.
              </div>
            ) : null}

            {state.error ? (
              <div className="mt-3 rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-900">
                {state.error}
              </div>
            ) : null}
          </div>

          <div className="lg:sticky lg:top-5">{orderPanel}</div>
        </div>
      )}
    </form>
  );
}

/* ------------------------------ search result row ------------------------------ */

function ResultRow({
  item,
  line,
  onAdd,
  updateLine,
  removeLine,
}: {
  item: CatalogEntry;
  line: OrderLine | undefined;
  onAdd: (override?: { vendor: string; priceCents: number }) => void;
  updateLine: (uid: number, patch: Partial<OrderLine>) => void;
  removeLine: (uid: number) => void;
}) {
  const pick = line
    ? { vendor: line.vendor, priceCents: line.unitPriceCents }
    : defaultVendorFor(item);
  const selectable: Pick<OrderLine, 'vendor' | 'vendorOptions' | 'preferredVendor' | 'name'> = {
    vendor: pick.vendor,
    vendorOptions:
      item.vendorPrices.length > 0
        ? item.vendorPrices
        : [{ vendor: pick.vendor, priceCents: pick.priceCents }],
    preferredVendor: item.preferredVendor,
    name: item.name,
  };

  return (
    <div
      className={`flex flex-wrap items-center gap-3 px-4 py-3 transition-colors ${line ? 'bg-emerald-50/60' : ''}`}
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[#fdeee1] text-[10px] font-bold text-[#b05c1e]">
        {item.name.slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-[var(--color-bv-text)]">
          {item.name}
        </div>
        <div className="truncate text-[11px] text-[var(--color-bv-muted)]">
          {[item.spec, item.size, item.category].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="w-24 text-right text-[14px] font-bold text-[var(--color-bv-text)]">
        {formatMoney(pick.priceCents)}
      </div>
      <div className="w-44 shrink-0">
        <VendorSelect
          line={selectable}
          compact
          onPick={(vendor, priceCents) => {
            if (line) {
              updateLine(line.uid, { vendor, unitPriceCents: priceCents, vendorMode: 'manual' });
            } else {
              // Not in the order yet — add it with the chosen vendor as a
              // manual pick from the start.
              onAdd({ vendor, priceCents });
            }
          }}
        />
      </div>
      {line ? (
        <div className="flex items-center gap-2">
          <QtyStepper qty={line.qty} onChange={(q) => (q < 1 ? removeLine(line.uid) : updateLine(line.uid, { qty: q }))} />
        </div>
      ) : (
        <button type="button" className={btnDark} onClick={() => onAdd()}>
          Add
        </button>
      )}
    </div>
  );
}

/* ------------------------------ current order panel ------------------------------ */

function CurrentOrderPanel({
  groups,
  regularCount,
  retailVendors,
  combinedTotal,
  otherVendorFor,
  setOtherVendorFor,
  updateLine,
  removeLine,
  pending,
  onReview,
  setPayload,
}: {
  groups: Array<[string, OrderLine[]]>;
  regularCount: number;
  retailVendors: string[];
  combinedTotal: number;
  otherVendorFor: number | null;
  setOtherVendorFor: (uid: number | null) => void;
  updateLine: (uid: number, patch: Partial<OrderLine>) => void;
  removeLine: (uid: number) => void;
  pending: boolean;
  onReview: () => void;
  setPayload: (mode: 'send' | 'draft') => void;
}) {
  const itemCount = groups.reduce((s, [, ls]) => s + ls.length, 0);

  return (
    <div className={`${cardCls} p-5`}>
      <h2 className="text-[17px] font-bold text-[var(--color-bv-text)]">Current order</h2>
      <p className="text-[12px] text-[var(--color-bv-muted)]">
        {itemCount === 0 ? 'Nothing added yet' : `${itemCount} item${itemCount === 1 ? '' : 's'}`}
      </p>

      {groups.map(([vendorName, vendorLines]) => (
        <div key={vendorName} className="mt-4">
          <div className="text-[13.5px] font-bold text-[var(--color-bv-text)]">{vendorName}</div>
          {vendorLines.map((l) => (
            <div key={l.uid} className="mt-2 border-b border-[var(--color-bv-border)] pb-3 last:border-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 text-[12.5px] font-semibold text-[var(--color-bv-text)]">
                  {l.name}
                  {l.detail ? (
                    <span className="font-normal text-[var(--color-bv-muted)]"> — {l.detail}</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${l.name}`}
                  className="text-slate-400 hover:text-red-500"
                  onClick={() => removeLine(l.uid)}
                >
                  ✕
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-[var(--color-bv-muted)]">
                  <span>Vendor:</span>
                  <div className="w-36">
                    <VendorSelect
                      line={l}
                      compact
                      onPick={(vendor, priceCents) =>
                        updateLine(l.uid, { vendor, unitPriceCents: priceCents, vendorMode: 'manual' })
                      }
                      onOther={() => setOtherVendorFor(l.uid)}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <QtyStepper
                    small
                    qty={l.qty}
                    onChange={(q) => updateLine(l.uid, { qty: q })}
                  />
                  <div className="w-16 text-right text-[13px] font-bold text-[var(--color-bv-text)]">
                    {formatMoney(lineTotal(l))}
                  </div>
                </div>
              </div>
              {otherVendorFor === l.uid ? (
                <OtherVendorForm
                  onApply={(vendor, priceCents) => {
                    updateLine(l.uid, {
                      vendor,
                      unitPriceCents: priceCents || l.unitPriceCents,
                      vendorMode: 'manual',
                      vendorOptions: [
                        ...l.vendorOptions.filter((o) => !sameVendor(o.vendor, vendor)),
                        { vendor, priceCents: priceCents || l.unitPriceCents },
                      ],
                    });
                    setOtherVendorFor(null);
                  }}
                  onCancel={() => setOtherVendorFor(null)}
                />
              ) : null}
            </div>
          ))}
        </div>
      ))}

      {itemCount > 0 ? (
        <>
          <div className="mt-4 flex items-center gap-1.5 rounded-[10px] bg-[var(--color-bv-bg)] px-3 py-2 text-[11.5px] text-[var(--color-bv-muted)]">
            <span aria-hidden>ⓘ</span>
            {countsLabel(regularCount, retailVendors)} will be created
          </div>
          <button type="button" className={`${btnAccent} mt-3 w-full`} onClick={onReview}>
            Review order
          </button>
          <button
            type="submit"
            className="mt-2 w-full text-center text-[13px] font-bold text-[var(--color-bv-accent)] hover:underline disabled:opacity-50"
            disabled={pending}
            onClick={() => setPayload('draft')}
          >
            {pending ? 'Saving…' : draftButtonLabel(groups.length)}
          </button>
        </>
      ) : (
        <button type="button" className={`${btnAccent} mt-4 w-full`} disabled>
          Review order
        </button>
      )}
    </div>
  );
}

/* ------------------------------ review screen ------------------------------ */

function ReviewScreen({
  groups,
  regularGroups,
  retailGroups,
  lines,
  combinedTotal,
  vendorNotes,
  setVendorNotes,
  noteOpenFor,
  setNoteOpenFor,
  otherVendorFor,
  setOtherVendorFor,
  updateLine,
  removeLine,
  pending,
  error,
  onBack,
  setPayload,
  openFirstRetailCart,
}: {
  groups: Array<[string, OrderLine[]]>;
  regularGroups: Array<[string, OrderLine[]]>;
  retailGroups: Array<[string, OrderLine[]]>;
  lines: OrderLine[];
  combinedTotal: number;
  vendorNotes: Record<string, string>;
  setVendorNotes: (v: Record<string, string>) => void;
  noteOpenFor: Record<string, boolean>;
  setNoteOpenFor: (v: Record<string, boolean>) => void;
  otherVendorFor: number | null;
  setOtherVendorFor: (uid: number | null) => void;
  updateLine: (uid: number, patch: Partial<OrderLine>) => void;
  removeLine: (uid: number) => void;
  pending: boolean;
  error: string | null;
  onBack: () => void;
  setPayload: (mode: 'send' | 'draft') => void;
  openFirstRetailCart: () => void;
}) {
  const regularCount = regularGroups.length;
  const retailCount = retailGroups.length;
  const retailVendors = retailGroups.map(([v]) => v);
  const retailItemCount = retailGroups.reduce((s, [, ls]) => s + ls.length, 0);

  // Going back to materials with an empty order (everything removed on
  // review) keeps the flow usable.
  useEffect(() => {
    if (lines.length === 0) onBack();
  }, [lines.length, onBack]);

  function groupCard(vendorName: string, vendorLines: OrderLine[], index: number) {
    const retail = isRetailVendor(vendorName);
    const groupTotal = vendorLines.reduce((s, l) => s + lineTotal(l), 0);
    return (
      <div
        key={vendorName}
        className={`${cardCls} overflow-visible ${retail ? 'border-[#f2d9c2] bg-[#fdf6ef]' : ''}`}
      >
        <div className="flex flex-wrap items-center gap-2.5 px-5 pt-4">
          <span className="text-[16px] font-bold text-[var(--color-bv-text)]">{vendorName}</span>
          <span className="rounded-full bg-[#e8eefc] px-2.5 py-0.5 text-[11px] font-bold text-[#1C4972]">
            {vendorLines.length} item{vendorLines.length === 1 ? '' : 's'}
          </span>
          {retail ? null : (
            <span className="text-[11.5px] text-[var(--color-bv-muted)]">
              Purchase order {index + 1} of {regularGroups.length}
            </span>
          )}
        </div>

        <div className="mt-2 divide-y divide-[var(--color-bv-border)]">
          {vendorLines.map((l) => (
            <div key={l.uid} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[#fdeee1] text-[10px] font-bold text-[#b05c1e]">
                {l.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-[180px] flex-1">
                <div className="text-[13px] font-semibold text-[var(--color-bv-text)]">
                  {l.name}
                  {l.detail ? (
                    <span className="font-normal text-[var(--color-bv-muted)]"> — {l.detail}</span>
                  ) : null}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-[var(--color-bv-muted)]">
                  <span>Vendor:</span>
                  <div className="w-40">
                    <VendorSelect
                      line={l}
                      compact
                      onPick={(vendor, priceCents) =>
                        updateLine(l.uid, { vendor, unitPriceCents: priceCents, vendorMode: 'manual' })
                      }
                      onOther={() => setOtherVendorFor(l.uid)}
                    />
                  </div>
                </div>
                {otherVendorFor === l.uid ? (
                  <OtherVendorForm
                    onApply={(vendor, priceCents) => {
                      updateLine(l.uid, {
                        vendor,
                        unitPriceCents: priceCents || l.unitPriceCents,
                        vendorMode: 'manual',
                        vendorOptions: [
                          ...l.vendorOptions.filter((o) => !sameVendor(o.vendor, vendor)),
                          { vendor, priceCents: priceCents || l.unitPriceCents },
                        ],
                      });
                      setOtherVendorFor(null);
                    }}
                    onCancel={() => setOtherVendorFor(null)}
                  />
                ) : null}
              </div>
              <QtyStepper qty={l.qty} onChange={(q) => updateLine(l.uid, { qty: q })} />
              <div className="w-20 text-right text-[13px] text-[var(--color-bv-muted)]">
                {formatMoney(l.unitPriceCents)}
              </div>
              <div className="w-24 text-right text-[14px] font-bold text-[var(--color-bv-text)]">
                {formatMoney(lineTotal(l))}
              </div>
              <button
                type="button"
                aria-label={`Remove ${l.name}`}
                className="text-slate-400 hover:text-red-500"
                onClick={() => removeLine(l.uid)}
              >
                🗑
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-bv-border)] px-5 py-3.5">
          {retail ? (
            <span />
          ) : noteOpenFor[vendorName] ? (
            <div className="min-w-[240px] flex-1">
              <textarea
                className={`${inputCls} w-full`}
                rows={2}
                placeholder={`Note for ${vendorName} (appears on this PO)`}
                value={vendorNotes[vendorName] ?? ''}
                onChange={(e) => setVendorNotes({ ...vendorNotes, [vendorName]: e.target.value })}
              />
            </div>
          ) : (
            <button
              type="button"
              className="text-[12.5px] font-bold text-[#1C4972] hover:underline"
              onClick={() => setNoteOpenFor({ ...noteOpenFor, [vendorName]: true })}
            >
              + Add note for {vendorName}
            </button>
          )}
          <div className="ml-auto flex items-baseline gap-3">
            <span className="text-[12px] text-[var(--color-bv-muted)]">
              {retail ? `${vendorName} total` : 'PO total'}
            </span>
            <span className="text-[17px] font-bold text-[var(--color-bv-text)]">
              {formatMoney(groupTotal)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-1 inline-flex items-center gap-1.5 text-[13px] font-bold text-[#1C4972] hover:underline"
      >
        ← Back to materials
      </button>
      <h2 className="text-[24px] font-bold text-[var(--color-bv-text)]">Review order</h2>
      <p className="text-[13px] text-[var(--color-bv-muted)]">
        Check quantities and vendors before creating your purchase orders.
      </p>

      <div className="mt-4 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <h3 className="mb-3 text-[16px] font-bold text-[var(--color-bv-text)]">
            {countsLabel(regularCount, retailVendors)}
          </h3>
          <div className="space-y-4">
            {regularGroups.map(([v, ls], i) => groupCard(v, ls, i))}
            {retailGroups.map(([v, ls], i) => groupCard(v, ls, i))}
          </div>

          {error ? (
            <div className="mt-3 rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-900">
              {error}
            </div>
          ) : null}
        </div>

        <div className={`${cardCls} p-5 lg:sticky lg:top-5`}>
          <h3 className="text-[17px] font-bold text-[var(--color-bv-text)]">Order summary</h3>
          <dl className="mt-3 space-y-1.5 text-[13px]">
            <div className="flex items-center justify-between">
              <dt className="text-[var(--color-bv-muted)]">Materials</dt>
              <dd className="font-bold text-[var(--color-bv-text)]">{lines.length}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[var(--color-bv-muted)]">Purchase orders</dt>
              <dd className="font-bold text-[var(--color-bv-text)]">{regularCount}</dd>
            </div>
            {retailCount > 0 ? (
              <div className="flex items-center justify-between">
                <dt className="text-[var(--color-bv-muted)]">Amazon cart items</dt>
                <dd className="font-bold text-[var(--color-bv-text)]">{retailItemCount}</dd>
              </div>
            ) : null}
          </dl>
          <div className="mt-3 space-y-1.5 border-t border-[var(--color-bv-border)] pt-3 text-[13px]">
            {regularGroups.map(([v, ls]) => (
              <div key={v} className="flex items-center justify-between">
                <span className="text-[var(--color-bv-muted)]">{v} PO</span>
                <span className="font-bold text-[var(--color-bv-text)]">
                  {formatMoney(ls.reduce((s, l) => s + lineTotal(l), 0))}
                </span>
              </div>
            ))}
            {retailGroups.map(([v, ls]) => (
              <div key={v} className="flex items-center justify-between">
                <span className="text-[var(--color-bv-muted)]">{v} cart</span>
                <span className="font-bold text-[var(--color-bv-text)]">
                  {formatMoney(ls.reduce((s, l) => s + lineTotal(l), 0))}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-[var(--color-bv-border)] pt-3">
            <span className="text-[15px] font-bold text-[var(--color-bv-text)]">Total</span>
            <span className="text-[20px] font-bold text-[var(--color-bv-text)]">
              {formatMoney(combinedTotal)}
            </span>
          </div>

          <button
            type="submit"
            className={`${btnAccent} mt-4 w-full`}
            disabled={pending || lines.length === 0}
            onClick={() => {
              setPayload('send');
              openFirstRetailCart();
            }}
          >
            {pending ? 'Creating…' : primaryButtonLabel(regularCount, retailVendors)}
          </button>
          <button
            type="submit"
            className="mt-2 w-full rounded-[11px] border border-[var(--color-bv-accent)] px-5 py-2.5 text-[13.5px] font-bold text-[var(--color-bv-accent)] hover:bg-[#fff4eb] disabled:opacity-50"
            disabled={pending || lines.length === 0}
            onClick={() => setPayload('draft')}
          >
            {pending ? 'Saving…' : draftButtonLabel(groups.length)}
          </button>
          <p className="mt-2 text-center text-[11.5px] text-[var(--color-bv-muted)]">
            You can edit or resend them later.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------- results: POs created (sent or drafts) ---------- */

/// Office-review draft: the full email is shown on screen (it always
/// "works" even without a configured mail client), with copy, mail-app,
/// and in-app SMTP send options. Manual office approval stays required.
function OfficeDraftPanel({
  poId,
  poNumber,
  retail,
  smtpConfigured,
}: {
  poId: string;
  poNumber: string;
  retail: {
    vendor: string;
    cartUrl: string | null;
    items: Array<{ name: string; qty: number; url: string; sku: string; unitPriceCents: number }>;
  };
  smtpConfigured: boolean;
}) {
  const draft = useMemo(
    () => buildOfficeDraftEmail(poNumber, retail.vendor, retail.cartUrl, retail.items),
    [poNumber, retail]
  );
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [copied, setCopied] = useState(false);
  const [sendState, setSendState] = useState<{ status: 'idle' | 'sending' | 'sent' | 'error'; message: string }>({
    status: 'idle',
    message: '',
  });
  const [, startTransition] = useTransition();

  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;

  function copyDraft() {
    const text = `Subject: ${draft.subject}\n\n${draft.body}`;
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      })
      .catch(() => {});
  }

  function sendViaApp() {
    setSendState({ status: 'sending', message: '' });
    startTransition(async () => {
      const result = await sendOfficeDraftEmailAction({
        poId,
        to,
        subject: draft.subject,
        body: draft.body,
      });
      setSendState({ status: result.ok ? 'sent' : 'error', message: result.message });
    });
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-[9px] bg-[var(--color-bv-accent)] px-3.5 py-1.5 text-[11.5px] font-bold text-white hover:opacity-95"
      >
        {open ? 'Hide office review email' : 'Draft email for office review'}
      </button>
      {open ? (
        <div className="mt-2 rounded-[10px] border border-[var(--color-bv-border)] bg-white p-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-bv-muted)]">
            Subject
          </div>
          <div className="mt-0.5 text-[12.5px] font-semibold text-[var(--color-bv-text)]">
            {draft.subject}
          </div>
          <textarea
            readOnly
            value={draft.body}
            rows={Math.min(14, draft.body.split('\n').length + 1)}
            className="mt-2 w-full resize-y rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-bv-text)] outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={copyDraft} className={btnDark}>
              {copied ? 'Copied ✓' : 'Copy email text'}
            </button>
            <input
              className={`${inputCls} w-56`}
              type="email"
              placeholder="Office email address"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label="Office email address"
            />
            <button
              type="button"
              onClick={sendViaApp}
              disabled={
                !to.trim() || !smtpConfigured || sendState.status === 'sending' || sendState.status === 'sent'
              }
              title={!smtpConfigured ? 'Configure SMTP first (Settings → Email test).' : undefined}
              className="rounded-[9px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[11.5px] font-bold text-white hover:opacity-95 disabled:opacity-50"
            >
              {sendState.status === 'sending'
                ? 'Sending…'
                : sendState.status === 'sent'
                  ? 'Sent ✓'
                  : 'Send from the app'}
            </button>
            <a
              href={mailto}
              className="rounded-[9px] border border-[var(--color-bv-border)] bg-white px-3 py-1.5 text-[11.5px] font-bold text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
            >
              Open in mail app
            </a>
          </div>
          {sendState.message ? (
            <p
              className={`mt-1.5 text-[11px] font-semibold ${
                sendState.status === 'error' ? 'text-rose-700' : 'text-emerald-700'
              }`}
            >
              {sendState.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ResultScreen({
  created,
  mode,
  smtpConfigured,
  onRestart,
}: {
  created: NonNullable<ShopOrderResult['created']>;
  mode: 'send' | 'draft';
  smtpConfigured: boolean;
  onRestart: () => void;
}) {
  const [sendState, setSendState] = useState<
    Record<string, { status: 'idle' | 'sending' | 'sent' | 'error'; message: string }>
  >({});
  const [, startTransition] = useTransition();

  function sendPo(poId: string) {
    setSendState((prev) => ({ ...prev, [poId]: { status: 'sending', message: '' } }));
    startTransition(async () => {
      const result = await sendShopOrderPoAction(poId);
      setSendState((prev) => ({
        ...prev,
        [poId]: { status: result.ok ? 'sent' : 'error', message: result.message },
      }));
    });
  }

  const anyFailed = created.some((po) => po.emailStatus === 'SEND_FAILED');

  return (
    <div className="mx-auto max-w-2xl">
      <div className="text-center">
        <div
          className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl text-2xl text-white shadow-[var(--shadow-bv-card)] ${anyFailed ? 'bg-amber-500' : 'bg-emerald-500'}`}
        >
          {anyFailed ? '!' : '✓'}
        </div>
        <h2 className="mt-4 text-[26px] font-bold text-[var(--color-bv-text)]">
          {mode === 'draft'
            ? `${created.length} draft${created.length > 1 ? 's' : ''} saved`
            : anyFailed
              ? 'Order created — one email needs a retry'
              : 'Order placed'}
        </h2>
        <p className="mt-1 text-[12.5px] text-[var(--color-bv-muted)]">
          {mode === 'draft'
            ? 'Nothing has been emailed and no cart was prepared. Find these drafts under Past orders to edit or send them later.'
            : 'Vendors were emailed their POs. Amazon-style orders go to the office cart workflow — nothing is purchased automatically.'}
        </p>
      </div>

      <div className="mt-5 space-y-3">
        {created.map((po) => {
          const s = sendState[po.id] ?? { status: 'idle' as const, message: '' };
          const showSendButton =
            !po.retail &&
            (mode === 'draft' ||
              po.emailStatus === 'SEND_FAILED' ||
              po.emailStatus === 'NO_VENDOR_EMAIL');
          const noEmail = po.emailStatus === 'NO_VENDOR_EMAIL';
          const statusLine =
            s.status === 'sent'
              ? `✓ ${s.message}`
              : s.status === 'error'
                ? `⚠ ${s.message}`
                : po.emailStatus === 'SENT'
                  ? `✓ ${po.emailDetail ?? 'Emailed to the vendor'}`
                  : po.emailStatus === 'SEND_FAILED'
                    ? `⚠ ${po.emailDetail ?? 'Email failed — retry below'}`
                    : po.retail
                      ? (po.emailDetail ?? 'Office cart workflow — no vendor email')
                      : noEmail
                        ? 'No vendor email on file — draft saved'
                        : 'Draft saved · not sent yet';
          return (
            <div key={po.id} className={`${cardCls} px-5 py-4`}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-bold text-[var(--color-bv-text)]">
                    {po.number} · {po.vendor}
                  </div>
                  <div className="text-[11.5px] text-[var(--color-bv-muted)]">{statusLine}</div>
                </div>
                <div className="text-[15px] font-bold text-[var(--color-bv-text)]">
                  {formatMoney(po.totalCents)}
                </div>
                <Link
                  href={`/purchase-orders/${po.id}`}
                  className="rounded-[9px] border border-[var(--color-bv-border)] px-3 py-1.5 text-[11.5px] font-bold text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
                >
                  Open PO
                </Link>
                <Link
                  href={`/po-print/${po.id}`}
                  target="_blank"
                  className="rounded-[9px] border border-[var(--color-bv-border)] px-3 py-1.5 text-[11.5px] font-bold text-[var(--color-bv-accent)] hover:bg-[var(--color-bv-bg)]"
                >
                  PDF / Print
                </Link>
                {showSendButton ? (
                  <button
                    type="button"
                    className="rounded-[9px] bg-[var(--color-bv-accent)] px-4 py-1.5 text-[11.5px] font-bold text-white hover:opacity-95 disabled:opacity-50"
                    disabled={
                      noEmail || !smtpConfigured || s.status === 'sending' || s.status === 'sent'
                    }
                    title={
                      noEmail
                        ? 'Add a vendor email in the Sheet Vendor Directory first.'
                        : !smtpConfigured
                          ? 'Configure SMTP first (Settings → Email test).'
                          : undefined
                    }
                    onClick={() => sendPo(po.id)}
                  >
                    {s.status === 'sending'
                      ? 'Sending…'
                      : s.status === 'sent'
                        ? 'Sent ✓'
                        : po.emailStatus === 'SEND_FAILED'
                          ? 'Retry email'
                          : 'Send PO'}
                  </button>
                ) : null}
              </div>

              {po.retail ? (
                <div className="mt-3 rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-4 py-3">
                  <div className="text-[11.5px] font-bold text-[var(--color-bv-text)]">
                    {po.retail.cartUrl ? (
                      <>
                        {po.retail.vendor} is an online store — the prefilled cart opened in a
                        new tab. Review it, then the office places the order. Nothing is
                        ordered automatically.
                      </>
                    ) : (
                      <>
                        {po.retail.vendor} is an online store. There isn&apos;t enough product
                        info to prefill a cart — use the item links below to add each one,
                        then the office places the order. Nothing is ordered automatically.
                      </>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {po.retail.cartUrl ? (
                      <a
                        href={po.retail.cartUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-[9px] bg-[var(--color-bv-text)] px-3.5 py-1.5 text-[11.5px] font-bold text-white hover:opacity-95"
                      >
                        Reopen {po.retail.vendor} cart ({po.retail.items.length} item
                        {po.retail.items.length > 1 ? 's' : ''})
                      </a>
                    ) : null}
                    {/* Always resolves to something for a known store (product
                        URL → /dp/ → store search), so this row is never empty
                        — previously it filtered on the stored url, which is
                        blank for every shop supply, leaving no way to act. */}
                    {buildRetailItemLinks(po.retail.vendor, po.retail.items)
                      .filter((i) => i.href && i.href !== po.retail?.cartUrl)
                      .map((i, idx) => (
                        <a
                          key={idx}
                          href={i.href}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-[9px] border border-[var(--color-bv-border)] bg-white px-3 py-1.5 text-[11px] font-bold text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
                        >
                          {i.qty > 1 ? `${i.qty}× ` : ''}
                          {i.name.slice(0, 34)}
                          {i.name.length > 34 ? '…' : ''} ↗
                        </a>
                      ))}
                  </div>
                  {po.retail.cartUrl ? null : (
                    <p className="mt-2 text-[10.5px] text-[var(--color-bv-muted)]">
                      To get a one-click prefilled cart, fill the Product URL (col N) or SKU/ASIN
                      (col O) column on the Sheet&apos;s Internal Materials tab for these items —
                      every line needs one before a cart can be built.
                    </p>
                  )}
                  <OfficeDraftPanel
                    poId={po.id}
                    poNumber={po.number}
                    retail={po.retail}
                    smtpConfigured={smtpConfigured}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex justify-center gap-3">
        <button type="button" className={btnDark} onClick={onRestart}>
          Order more materials
        </button>
        <Link
          href="/purchase-orders"
          className="inline-flex items-center rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-2 text-[12.5px] font-semibold text-[var(--color-bv-text)]"
        >
          Past orders
        </Link>
      </div>
    </div>
  );
}
