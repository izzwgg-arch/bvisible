'use client';

// "Order materials" — two screens matching the approved mockups:
//   1. Search + results card + sticky "Current order" panel.
//   2. "Review order" with per-vendor cards, an Amazon cart card, and a
//      sticky Order summary.
// Preferred vendor preselected when the material has one (otherwise the
// cheapest); every line keeps its own vendor dropdown. Amazon / retail
// vendors split into their own cart group — office cart workflow, never
// a vendor PO email. Custom materials for anything not in the list.

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { formatMoney } from '@bvisible/pricing';
import { PageHeader } from '@/components/app-shell';
import { fuzzySearch } from '@/lib/sheet-sync/fuzzy';
import { setAssistantContext } from '@/lib/assistant/context-store';
import {
  createShopOrderAction,
  sendShopOrderPoAction,
  type ShopOrderResult,
} from './shop-order-actions';
import { buildRetailCartUrl, isRetailVendor } from '@/lib/po/retail-cart';

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
  /// Server-resolved default for the office reminder. Display + prefill only;
  /// the server decides the real recipient on every send.
  defaultOfficeReminderTo: string;
  /// Amazon Associates tag. Amazon's add-to-cart endpoint requires it; with
  /// an empty value no cart URL is built and the office gets per-item links.
  amazonAssociateTag: string;
  /// Non-null when the pricing Sheet could not be loaded.
  sheetWarning?: string | null;
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

type OtherVendorTarget = { kind: 'line'; uid: number } | { kind: 'result'; catalogId: string };

let nextUid = 1;


const inputCls =
  'rounded-[10px] border border-[var(--color-bv-border)] bg-white px-3 py-2 text-[13px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]';
const btnNavy =
  'inline-flex items-center justify-center rounded-[10px] bg-[#1C4972] px-6 py-2 text-[13px] font-bold text-white hover:opacity-95 disabled:opacity-50';
const btnAccent =
  'inline-flex items-center justify-center rounded-[12px] bg-[var(--color-bv-accent)] px-5 py-3 text-[14px] font-bold text-white hover:opacity-95 disabled:opacity-60';
const cardCls =
  'rounded-[16px] border border-[var(--color-bv-border)] bg-white shadow-[var(--shadow-bv-card)]';

/* ------------------------------ icons ------------------------------ */

function LayersIcon() {
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[#fdeee1]">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e2711d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2 2 7l10 5 10-5-10-5Z" />
        <path d="m2 12 10 5 10-5" />
        <path d="m2 17 10 5 10-5" />
      </svg>
    </span>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} width="13" height="13" viewBox="0 0 20 20" fill="none">
      <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function PriceTagIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4Z" />
      <path d="M12 8v8M9.5 9.8c0-.9.9-1.6 2.5-1.6s2.5.7 2.5 1.6c0 2.4-5 1.6-5 4 0 .9.9 1.6 2.5 1.6s2.5-.7 2.5-1.6" />
    </svg>
  );
}

function PastOrdersButton() {
  return (
    <Link
      href="/purchase-orders"
      className="inline-flex items-center justify-center gap-2 rounded-[12px] border border-[var(--color-bv-border)] bg-white px-4 py-2 text-[13.5px] font-semibold text-[var(--color-bv-text)] shadow-[var(--shadow-bv-card)] hover:bg-[var(--color-bv-bg)]"
    >
      <HistoryIcon /> Past orders
    </Link>
  );
}

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

/// Mirrors isValidEmail on the server so the field and the action agree about
/// what is acceptable. The server still re-validates — this only stops an
/// obvious typo before the order is created.
function looksLikeEmail(value: string): boolean {
  const v = value.trim();
  return v.length > 0 && v.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
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

function draftButtonLabel(groupCount: number, retailCount: number): string {
  if (groupCount <= 1) return 'Save as draft';
  if (retailCount > 0) return 'Save as drafts';
  return `Save ${groupCount} drafts`;
}

/* ------------------------------ vendor dropdown ------------------------------ */

/// Mockup-style vendor dropdown: collapsed trigger shows only the vendor
/// name; the popover lists every vendor with its price, "Preferred" /
/// "Best price" labels, a checkmark on the selection, and "Other vendor…".
function VendorDropdown({
  value,
  options,
  preferredVendor,
  materialName,
  onPick,
  onOther,
  variant,
  underline,
}: {
  value: string;
  options: Array<{ vendor: string; priceCents: number }>;
  preferredVendor: string;
  materialName: string;
  onPick: (vendor: string, priceCents: number) => void;
  onOther?: () => void;
  variant: 'box' | 'bare';
  underline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const best = cheapestOption(options);

  useEffect(() => {
    if (!open) return;
    function close(e: PointerEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const q = query.trim().toLowerCase();
  const visible = q ? options.filter((o) => o.vendor.toLowerCase().includes(q)) : options;

  return (
    <span ref={wrapRef} className="relative inline-block">
      {variant === 'box' ? (
        <button
          type="button"
          aria-label={`Vendor for ${materialName}`}
          aria-expanded={open}
          onClick={() => {
            setQuery('');
            setOpen((v) => !v);
          }}
          className="inline-flex min-w-[92px] items-center justify-between gap-2 rounded-[10px] border border-[var(--color-bv-border)] bg-white px-3.5 py-2 text-[13px] font-semibold text-[var(--color-bv-text)] shadow-[0_1px_2px_rgba(28,73,114,0.05)] hover:border-slate-300"
        >
          <span className="truncate">{value}</span>
          <ChevronDown className="shrink-0 text-slate-400" />
        </button>
      ) : (
        <span className="inline-flex items-center gap-1 text-[12.5px] text-[var(--color-bv-muted)]">
          Vendor:{' '}
          <button
            type="button"
            aria-label={`Vendor for ${materialName}`}
            aria-expanded={open}
            onClick={() => {
              setQuery('');
              setOpen((v) => !v);
            }}
            className={`inline-flex items-center gap-0.5 font-bold text-[var(--color-bv-text)] ${
              underline ? 'border-b border-dashed border-[rgba(28,73,114,0.45)]' : ''
            }`}
          >
            {value}
            <ChevronDown className="text-slate-400" />
          </button>
        </span>
      )}

      {open ? (
        <span className="absolute left-0 top-full z-50 mt-1.5 block w-60 max-w-[calc(100vw-2rem)] rounded-[14px] border border-slate-200 bg-white p-1.5 shadow-[0_18px_50px_rgba(15,23,42,0.16)]">
          {options.length >= 5 ? (
            <span className="relative mb-1 block">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search vendors..."
                className="h-9 w-full rounded-[10px] border border-slate-200 bg-slate-50 pl-8 pr-2.5 text-[12.5px] font-medium text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-white"
              />
            </span>
          ) : null}
          <span className="block max-h-64 overflow-y-auto">
            {visible.map((o) => {
              const selected = sameVendor(o.vendor, value);
              const tags: string[] = [];
              if (preferredVendor && sameVendor(o.vendor, preferredVendor)) tags.push('Preferred');
              if (best && o.vendor === best.vendor) tags.push('Best price');
              return (
                <button
                  key={o.vendor}
                  type="button"
                  onClick={() => {
                    onPick(o.vendor, o.priceCents);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left hover:bg-[#f4f7ff]"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--color-bv-text)]">
                    {o.vendor}
                  </span>
                  <span className="text-[12.5px] tabular-nums text-[var(--color-bv-text)]">
                    {formatMoney(o.priceCents)}
                  </span>
                  {tags.length > 0 ? (
                    <span className={`whitespace-nowrap text-[11px] font-semibold text-[#2563eb]`}>
                      {tags.join(' · ')}
                    </span>
                  ) : null}
                  <span className={`w-3.5 text-[13px] text-[var(--color-bv-text)] ${selected ? '' : 'invisible'}`}>
                    ✓
                  </span>
                </button>
              );
            })}
            {visible.length === 0 ? (
              <span className="block px-3 py-3 text-center text-[12px] text-slate-400">No matches</span>
            ) : null}
          </span>
          {onOther ? (
            <>
              <span className="my-1 block border-t border-slate-100" />
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOther();
                }}
                className="block w-full rounded-[10px] px-3 py-2 text-left text-[13px] font-medium text-[var(--color-bv-muted)] hover:bg-[#f4f7ff] hover:text-[var(--color-bv-text)]"
              >
                Other vendor…
              </button>
            </>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/// Inline mini-form shown when "Other vendor…" is picked.
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
        className={btnNavy}
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
  const btn = `grid place-items-center rounded-[8px] text-[16px] font-bold text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)] disabled:opacity-40 ${small ? 'h-7 w-7' : 'h-9 w-9'}`;
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
        className={`w-11 border-0 bg-transparent text-center text-[14px] font-bold text-[var(--color-bv-text)] outline-none ${small ? 'py-0.5' : 'py-1.5'}`}
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
  const [otherFor, setOtherFor] = useState<OtherVendorTarget | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customVendor, setCustomVendor] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  // Held in the flow's own state (not the form DOM) so a manual address
  // survives rerenders and moving between build/review steps. Initialised
  // once from the server default and never silently reset afterwards.
  const [officeReminderTo, setOfficeReminderTo] = useState(props.defaultOfficeReminderTo);
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

  function removeVendorGroup(vendorName: string) {
    setLines((prev) => prev.filter((l) => l.vendor !== vendorName));
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
      const baseOptions =
        item.vendorPrices.length > 0
          ? [...item.vendorPrices]
          : [{ vendor: pick.vendor, priceCents: pick.priceCents }];
      if (override && !baseOptions.some((o) => sameVendor(o.vendor, override.vendor))) {
        baseOptions.push(override);
      }
      return [
        ...prev,
        {
          uid: nextUid++,
          name: item.name,
          detail: [item.spec, item.size].filter(Boolean).join(' • '),
          vendor: pick.vendor,
          vendorMode: pick.mode,
          qty: 1,
          unitPriceCents: pick.priceCents,
          catalogId: item.id,
          vendorSku: item.vendorSku,
          productUrl: item.productUrl,
          preferredVendor: item.preferredVendor,
          vendorOptions: baseOptions,
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

  function applyOtherVendor(target: OtherVendorTarget, vendor: string, priceCents: number) {
    if (target.kind === 'line') {
      const line = lines.find((l) => l.uid === target.uid);
      if (!line) return;
      updateLine(line.uid, {
        vendor,
        unitPriceCents: priceCents || line.unitPriceCents,
        vendorMode: 'manual',
        vendorOptions: [
          ...line.vendorOptions.filter((o) => !sameVendor(o.vendor, vendor)),
          { vendor, priceCents: priceCents || line.unitPriceCents },
        ],
      });
    } else {
      const item = props.catalog.find((c) => c.id === target.catalogId);
      if (item) addItem(item, { vendor, priceCents: priceCents || item.priceCents });
    }
    setOtherFor(null);
  }

  const groups = useMemo(() => groupLines(lines), [lines]);
  const regularGroups = groups.filter(([v]) => !isRetailVendor(v));
  const retailGroups = groups.filter(([v]) => isRetailVendor(v));
  const combinedTotal = lines.reduce((s, l) => s + lineTotal(l), 0);

  function buildPayload(mode: 'send' | 'draft'): string {
    return JSON.stringify({
      mode,
      requestId: requestIdRef.current,
      // Per-order override only. Blank means "use the server default" — the
      // server re-validates and never trusts this to pick the address.
      officeReminderTo: officeReminderTo.trim(),
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
        })),
        props.amazonAssociateTag
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

  const searchHeading = search.trim()
    ? search.trim().charAt(0).toUpperCase() + search.trim().slice(1)
    : '';

  return (
    <form action={formAction} className="pb-8">
      <input type="hidden" name="payload" id="shop-order-payload" />

      {step === 'review' ? (
        <ReviewScreen
          regularGroups={regularGroups}
          retailGroups={retailGroups}
          lines={lines}
          combinedTotal={combinedTotal}
          vendorNotes={vendorNotes}
          setVendorNotes={setVendorNotes}
          noteOpenFor={noteOpenFor}
          setNoteOpenFor={setNoteOpenFor}
          otherFor={otherFor}
          setOtherFor={setOtherFor}
          applyOtherVendor={applyOtherVendor}
          updateLine={updateLine}
          removeLine={removeLine}
          removeVendorGroup={removeVendorGroup}
          pending={pending}
          error={state.error}
          onBack={() => setStep('build')}
          setPayload={setPayload}
          openFirstRetailCart={openFirstRetailCart}
          groupCount={groups.length}
          officeReminderTo={officeReminderTo}
          setOfficeReminderTo={setOfficeReminderTo}
        />
      ) : (
        <>
          <PageHeader
            title="Order materials"
            subtitle="Search, add quantities, and review your order."
            actions={<PastOrdersButton />}
          />

          {props.sheetWarning ? (
            <div className="mb-4 rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-900">
              {props.sheetWarning}
            </div>
          ) : null}

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              {/* search */}
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-bv-text)]" />
                <input
                  className="w-full rounded-[14px] border-2 border-[var(--color-bv-accent)] bg-white py-3.5 pl-11 pr-5 text-[15px] text-[var(--color-bv-text)] shadow-[var(--shadow-bv-card)] outline-none placeholder:text-slate-400"
                  placeholder="Search materials..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={() => setCustomOpen((v) => !v)}
                className={`mt-2.5 text-[13px] font-semibold text-[#2563eb] hover:underline`}
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
                  <button type="button" className={btnNavy} onClick={addCustom}>
                    Add
                  </button>
                </div>
              ) : null}

              {/* results */}
              {results.length > 0 ? (
                <div className="mt-6">
                  <h2 className="text-[20px] font-bold text-[var(--color-bv-text)]">{searchHeading}</h2>
                  <p className="mb-3 mt-1 flex items-center gap-1.5 text-[12.5px] text-[var(--color-bv-muted)]">
                    <PriceTagIcon />
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
                        otherFor={otherFor}
                        setOtherFor={setOtherFor}
                        applyOtherVendor={applyOtherVendor}
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

            <div className="lg:sticky lg:top-5">
              <CurrentOrderPanel
                groups={groups}
                regularCount={regularGroups.length}
                retailVendors={retailGroups.map(([v]) => v)}
                otherFor={otherFor}
                setOtherFor={setOtherFor}
                applyOtherVendor={applyOtherVendor}
                updateLine={updateLine}
                removeLine={removeLine}
                pending={pending}
                onReview={() => setStep('review')}
                setPayload={setPayload}
                groupCount={groups.length}
              />
            </div>
          </div>
        </>
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
  otherFor,
  setOtherFor,
  applyOtherVendor,
}: {
  item: CatalogEntry;
  line: OrderLine | undefined;
  onAdd: (override?: { vendor: string; priceCents: number }) => void;
  updateLine: (uid: number, patch: Partial<OrderLine>) => void;
  removeLine: (uid: number) => void;
  otherFor: OtherVendorTarget | null;
  setOtherFor: (t: OtherVendorTarget | null) => void;
  applyOtherVendor: (t: OtherVendorTarget, vendor: string, priceCents: number) => void;
}) {
  const pick = line
    ? { vendor: line.vendor, priceCents: line.unitPriceCents }
    : defaultVendorFor(item);
  const options = line
    ? line.vendorOptions
    : item.vendorPrices.length > 0
      ? item.vendorPrices
      : [{ vendor: pick.vendor, priceCents: pick.priceCents }];
  const spec = [item.spec, item.size].filter(Boolean).join(' • ');
  const otherTarget: OtherVendorTarget = line
    ? { kind: 'line', uid: line.uid }
    : { kind: 'result', catalogId: item.id };
  const otherOpen =
    otherFor != null &&
    ((otherFor.kind === 'line' && line && otherFor.uid === line.uid) ||
      (otherFor.kind === 'result' && otherFor.catalogId === item.id));

  return (
    <div className={`px-4 py-3 transition-colors sm:px-5 ${line ? 'bg-[#e9f6ec]' : ''}`}>
      <div className="flex flex-wrap items-center gap-3">
        <LayersIcon />
        <div className="min-w-[160px] flex-1">
          <div className="truncate text-[14px] font-bold text-[var(--color-bv-text)]">
            {item.name}
          </div>
          {spec ? (
            <div className="truncate text-[12px] text-[var(--color-bv-muted)]">{spec}</div>
          ) : null}
        </div>
        <div className="w-20 text-right text-[14.5px] font-bold tabular-nums text-[var(--color-bv-text)]">
          {formatMoney(pick.priceCents)}
        </div>
        <VendorDropdown
          value={pick.vendor}
          options={options}
          preferredVendor={item.preferredVendor}
          materialName={item.name}
          variant="box"
          onPick={(vendor, priceCents) => {
            if (line) {
              updateLine(line.uid, { vendor, unitPriceCents: priceCents, vendorMode: 'manual' });
            } else {
              onAdd({ vendor, priceCents });
            }
          }}
          onOther={() => setOtherFor(otherTarget)}
        />
        {line ? (
          <QtyStepper
            qty={line.qty}
            onChange={(q) => (q < 1 ? removeLine(line.uid) : updateLine(line.uid, { qty: q }))}
          />
        ) : (
          <button type="button" className={btnNavy} onClick={() => onAdd()}>
            Add
          </button>
        )}
      </div>
      {otherOpen ? (
        <OtherVendorForm
          onApply={(vendor, priceCents) => applyOtherVendor(otherTarget, vendor, priceCents)}
          onCancel={() => setOtherFor(null)}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------ current order panel ------------------------------ */

function CurrentOrderPanel({
  groups,
  regularCount,
  retailVendors,
  otherFor,
  setOtherFor,
  applyOtherVendor,
  updateLine,
  removeLine,
  pending,
  onReview,
  setPayload,
  groupCount,
}: {
  groups: Array<[string, OrderLine[]]>;
  regularCount: number;
  retailVendors: string[];
  otherFor: OtherVendorTarget | null;
  setOtherFor: (t: OtherVendorTarget | null) => void;
  applyOtherVendor: (t: OtherVendorTarget, vendor: string, priceCents: number) => void;
  updateLine: (uid: number, patch: Partial<OrderLine>) => void;
  removeLine: (uid: number) => void;
  pending: boolean;
  onReview: () => void;
  setPayload: (mode: 'send' | 'draft') => void;
  groupCount: number;
}) {
  const itemCount = groups.reduce((s, [, ls]) => s + ls.length, 0);

  return (
    <div className={`${cardCls} p-5`}>
      <h2 className="text-[19px] font-bold text-[var(--color-bv-text)]">Current order</h2>
      <p className="text-[12.5px] text-[var(--color-bv-muted)]">
        {itemCount === 0 ? 'Nothing added yet' : `${itemCount} item${itemCount === 1 ? '' : 's'}`}
      </p>

      {groups.map(([vendorName, vendorLines]) => (
        <div key={vendorName} className="mt-4">
          <div className="text-[14.5px] font-bold text-[var(--color-bv-text)]">{vendorName}</div>
          {vendorLines.map((l) => (
            <div key={l.uid} className="mt-2.5 border-b border-[var(--color-bv-border)] pb-3.5 last:border-0 last:pb-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 text-[13px] font-semibold text-[var(--color-bv-text)]">
                  {l.name}
                  {l.detail ? (
                    <span className="font-normal"> — {l.detail.split(' • ')[0]}</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${l.name}`}
                  className="text-slate-300 hover:text-red-500"
                  onClick={() => removeLine(l.uid)}
                >
                  ✕
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <VendorDropdown
                  value={l.vendor}
                  options={l.vendorOptions}
                  preferredVendor={l.preferredVendor}
                  materialName={l.name}
                  variant="bare"
                  underline
                  onPick={(vendor, priceCents) =>
                    updateLine(l.uid, { vendor, unitPriceCents: priceCents, vendorMode: 'manual' })
                  }
                  onOther={() => setOtherFor({ kind: 'line', uid: l.uid })}
                />
                <div className="flex items-center gap-3">
                  <QtyStepper
                    small
                    qty={l.qty}
                    onChange={(q) => updateLine(l.uid, { qty: q })}
                  />
                  <div className="w-16 text-right text-[13.5px] font-bold tabular-nums text-[var(--color-bv-text)]">
                    {formatMoney(lineTotal(l))}
                  </div>
                </div>
              </div>
              {otherFor?.kind === 'line' && otherFor.uid === l.uid ? (
                <OtherVendorForm
                  onApply={(vendor, priceCents) =>
                    applyOtherVendor({ kind: 'line', uid: l.uid }, vendor, priceCents)
                  }
                  onCancel={() => setOtherFor(null)}
                />
              ) : null}
            </div>
          ))}
        </div>
      ))}

      {itemCount > 0 ? (
        <>
          <div className="mt-4 flex items-center gap-1.5 text-[12px] text-[var(--color-bv-muted)]">
            <InfoIcon />
            {countsLabel(regularCount, retailVendors)} will be created
          </div>
          <button type="button" className={`${btnAccent} mt-3 w-full`} onClick={onReview}>
            Review order
          </button>
          <button
            type="submit"
            className={`mt-2.5 w-full text-center text-[13.5px] font-bold text-[#2563eb] hover:underline disabled:opacity-50`}
            disabled={pending}
            onClick={() => setPayload('draft')}
          >
            {pending ? 'Saving…' : draftButtonLabel(groupCount, retailVendors.length)}
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
  regularGroups,
  retailGroups,
  lines,
  combinedTotal,
  vendorNotes,
  setVendorNotes,
  noteOpenFor,
  setNoteOpenFor,
  otherFor,
  setOtherFor,
  applyOtherVendor,
  updateLine,
  removeLine,
  removeVendorGroup,
  pending,
  error,
  onBack,
  setPayload,
  openFirstRetailCart,
  groupCount,
  officeReminderTo,
  setOfficeReminderTo,
}: {
  regularGroups: Array<[string, OrderLine[]]>;
  retailGroups: Array<[string, OrderLine[]]>;
  lines: OrderLine[];
  combinedTotal: number;
  vendorNotes: Record<string, string>;
  setVendorNotes: (v: Record<string, string>) => void;
  noteOpenFor: Record<string, boolean>;
  setNoteOpenFor: (v: Record<string, boolean>) => void;
  otherFor: OtherVendorTarget | null;
  setOtherFor: (t: OtherVendorTarget | null) => void;
  applyOtherVendor: (t: OtherVendorTarget, vendor: string, priceCents: number) => void;
  updateLine: (uid: number, patch: Partial<OrderLine>) => void;
  removeLine: (uid: number) => void;
  removeVendorGroup: (vendorName: string) => void;
  pending: boolean;
  error: string | null;
  onBack: () => void;
  /// Lifted to the flow so a manually entered address survives rerenders and
  /// moving between the build and review steps.
  officeReminderTo: string;
  setOfficeReminderTo: (v: string) => void;
  setPayload: (mode: 'send' | 'draft') => void;
  openFirstRetailCart: () => void;
  groupCount: number;
}) {
  const regularCount = regularGroups.length;
  const retailVendors = retailGroups.map(([v]) => v);
  const retailItemCount = retailGroups.reduce((s, [, ls]) => s + ls.length, 0);
  const hasRetail = retailGroups.length > 0;
  const [menuFor, setMenuFor] = useState<string | null>(null);

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
        className={
          retail
            ? 'overflow-visible rounded-[16px] border border-[#f2e3cf] bg-[#fdf6ee] shadow-[var(--shadow-bv-card)]'
            : `${cardCls} overflow-visible`
        }
      >
        <div className="px-5 pt-4">
          <div className="flex items-center gap-2.5">
            <span className="text-[17px] font-bold text-[var(--color-bv-text)]">{vendorName}</span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-bold text-[var(--color-bv-text)] ${retail ? 'bg-white/80' : 'bg-[#e8eefc]'}`}
            >
              {vendorLines.length} item{vendorLines.length === 1 ? '' : 's'}
            </span>
            <span className="relative ml-auto">
              <button
                type="button"
                aria-label={`Actions for ${vendorName}`}
                aria-expanded={menuFor === vendorName}
                onClick={() => setMenuFor(menuFor === vendorName ? null : vendorName)}
                className="grid h-8 w-8 place-items-center rounded-[8px] text-slate-400 hover:bg-black/5 hover:text-[var(--color-bv-text)]"
              >
                ⋯
              </button>
              {menuFor === vendorName ? (
                <>
                  <span className="fixed inset-0 z-30" aria-hidden onClick={() => setMenuFor(null)} />
                  <span className="absolute right-0 top-9 z-40 block w-48 overflow-hidden rounded-[12px] border border-slate-200 bg-white py-1 shadow-[0_18px_50px_rgba(15,23,42,0.16)]">
                    <button
                      type="button"
                      className="block w-full px-3.5 py-2 text-left text-[12.5px] font-semibold text-rose-600 hover:bg-rose-50"
                      onClick={() => {
                        removeVendorGroup(vendorName);
                        setMenuFor(null);
                      }}
                    >
                      Remove these items
                    </button>
                  </span>
                </>
              ) : null}
            </span>
          </div>
          {retail ? null : (
            <div className="mt-0.5 text-[12px] text-[var(--color-bv-muted)]">
              Purchase order {index + 1} of {regularGroups.length}
            </div>
          )}
        </div>

        <div className={`mt-2 divide-y ${retail ? 'divide-[#f2e3cf]' : 'divide-[var(--color-bv-border)]'}`}>
          {vendorLines.map((l) => (
            <div key={l.uid} className="px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-3.5">
                <LayersIcon />
                <div className="min-w-[170px] flex-1">
                  <div className="text-[14px] font-bold text-[var(--color-bv-text)]">
                    {l.name}
                    {retail && l.detail ? (
                      <span className="font-semibold"> — {l.detail}</span>
                    ) : null}
                  </div>
                  {!retail && l.detail ? (
                    <div className="text-[12px] text-[var(--color-bv-muted)]">{l.detail}</div>
                  ) : null}
                  <div className="mt-1">
                    <VendorDropdown
                      value={l.vendor}
                      options={l.vendorOptions}
                      preferredVendor={l.preferredVendor}
                      materialName={l.name}
                      variant="bare"
                      onPick={(vendor, priceCents) =>
                        updateLine(l.uid, { vendor, unitPriceCents: priceCents, vendorMode: 'manual' })
                      }
                      onOther={() => setOtherFor({ kind: 'line', uid: l.uid })}
                    />
                  </div>
                </div>
                <QtyStepper qty={l.qty} onChange={(q) => updateLine(l.uid, { qty: q })} />
                <div className="w-[70px] text-right text-[13px] tabular-nums text-[var(--color-bv-muted)]">
                  {formatMoney(l.unitPriceCents)}
                </div>
                <div className="w-[76px] text-right text-[14.5px] font-bold tabular-nums text-[var(--color-bv-text)]">
                  {formatMoney(lineTotal(l))}
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${l.name}`}
                  className="text-slate-400 hover:text-red-500"
                  onClick={() => removeLine(l.uid)}
                >
                  <TrashIcon />
                </button>
              </div>
              {otherFor?.kind === 'line' && otherFor.uid === l.uid ? (
                <OtherVendorForm
                  onApply={(vendor, priceCents) =>
                    applyOtherVendor({ kind: 'line', uid: l.uid }, vendor, priceCents)
                  }
                  onCancel={() => setOtherFor(null)}
                />
              ) : null}
            </div>
          ))}
        </div>

        <div
          className={`flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3.5 ${retail ? 'border-[#f2e3cf]' : 'border-[var(--color-bv-border)]'}`}
        >
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
              className={`text-[13px] font-bold text-[#2563eb] hover:underline`}
              onClick={() => setNoteOpenFor({ ...noteOpenFor, [vendorName]: true })}
            >
              + Add note for {vendorName}
            </button>
          )}
          <div className="ml-auto flex items-baseline gap-3">
            <span className="text-[12.5px] text-[var(--color-bv-muted)]">
              {retail ? `${vendorName} total` : 'PO total'}
            </span>
            <span className="text-[18px] font-bold tabular-nums text-[var(--color-bv-text)]">
              {formatMoney(groupTotal)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onBack}
            className={`mb-1 inline-flex items-center gap-1.5 text-[13px] font-bold text-[#2563eb] hover:underline`}
          >
            ← Back to materials
          </button>
          <h1 className="text-[clamp(1.75rem,3vw,2.125rem)] font-semibold tracking-[-0.04em] text-[var(--color-bv-text)]">
            Review order
          </h1>
          <p className="mt-1 text-[13.5px] text-slate-500">
            {hasRetail
              ? countsLabel(regularCount, retailVendors)
              : 'Check quantities and vendors before creating your purchase orders.'}
          </p>
        </div>
        <PastOrdersButton />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          {hasRetail ? null : (
            <h2 className="mb-3 text-[18px] font-bold text-[var(--color-bv-text)]">
              {countsLabel(regularCount, retailVendors)}
            </h2>
          )}
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
          <h3 className="text-[19px] font-bold text-[var(--color-bv-text)]">Order summary</h3>
          <dl className="mt-3.5 space-y-2 text-[13.5px]">
            <SummaryRow label="Materials" value={String(lines.length)} />
            <SummaryRow label="Purchase orders" value={String(regularCount)} />
            {retailGroups.length > 0 ? (
              <SummaryRow label="Amazon cart items" value={String(retailItemCount)} />
            ) : null}
          </dl>
          <div className="mt-3.5 space-y-2 border-t border-[var(--color-bv-border)] pt-3.5 text-[13.5px]">
            {regularGroups.map(([v, ls]) => (
              <SummaryRow
                key={v}
                label={hasRetail ? `${v} PO` : v}
                value={formatMoney(ls.reduce((s, l) => s + lineTotal(l), 0))}
              />
            ))}
            {retailGroups.map(([v, ls]) => (
              <SummaryRow
                key={v}
                label={`${v} cart`}
                value={formatMoney(ls.reduce((s, l) => s + lineTotal(l), 0))}
              />
            ))}
          </div>
          <div className="mt-3.5 flex items-baseline justify-between border-t border-[var(--color-bv-border)] pt-3.5">
            <span className="text-[16px] font-bold text-[var(--color-bv-text)]">Total</span>
            <span className="text-[22px] font-bold tabular-nums text-[var(--color-bv-text)]">
              {formatMoney(combinedTotal)}
            </span>
          </div>

          {/* Secondary by design: the standard address is already filled in
              and the employee normally never touches this. Only shown when
              the order actually has an online-store PO to remind about. */}
          {retailGroups.length > 0 ? (
            <div className="mt-3.5 border-t border-[var(--color-bv-border)] pt-3.5">
              <label
                htmlFor="office-reminder-to"
                className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--color-bv-muted)]"
              >
                Office reminder
              </label>
              <input
                id="office-reminder-to"
                type="email"
                value={officeReminderTo}
                onChange={(e) => setOfficeReminderTo(e.currentTarget.value)}
                className="mt-1.5 w-full rounded-[10px] border border-[var(--color-bv-border)] px-3 py-2 text-[12.5px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]"
              />
              {officeReminderTo.trim() && !looksLikeEmail(officeReminderTo) ? (
                <p className="mt-1 text-[10.5px] font-semibold text-rose-600">
                  Enter a valid email address.
                </p>
              ) : (
                <p className="mt-1 text-[10.5px] text-[var(--color-bv-muted)]">
                  Emailed automatically when the order is created. Applies to this order only.
                </p>
              )}
            </div>
          ) : null}

          <button
            type="submit"
            className={`${btnAccent} mt-4 w-full`}
            disabled={
              pending ||
              lines.length === 0 ||
              (retailGroups.length > 0 && !looksLikeEmail(officeReminderTo))
            }
            onClick={() => {
              setPayload('send');
              openFirstRetailCart();
            }}
          >
            {pending ? 'Creating…' : primaryButtonLabel(regularCount, retailVendors)}
          </button>
          <button
            type="submit"
            className="mt-2.5 w-full rounded-[12px] border-[1.5px] border-[var(--color-bv-accent)] bg-white px-5 py-2.5 text-[14px] font-bold text-[var(--color-bv-accent)] hover:bg-[#fff4eb] disabled:opacity-50"
            disabled={pending || lines.length === 0}
            onClick={() => setPayload('draft')}
          >
            {pending ? 'Saving…' : draftButtonLabel(groupCount, retailVendors.length)}
          </button>
          <p className="mt-2.5 text-center text-[12px] text-[var(--color-bv-muted)]">
            You can edit or resend them later.
          </p>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-[var(--color-bv-muted)]">{label}</dt>
      <dd className="font-bold tabular-nums text-[var(--color-bv-text)]">{value}</dd>
    </div>
  );
}

/* ---------- results: POs created (sent or drafts) ---------- */

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

              {/* The retail result now lives on the order-ready page: one
                  compact line here, the full picture there. The old panel —
                  the "Amazon is an online store" explanation, Sheet-column
                  setup instructions, the raw email textarea, Copy email
                  text / Open in mail app / Hide office review email — is
                  gone. The reminder is already sent by the time this renders,
                  so there is nothing left for the employee to do here. */}
              {po.retail ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-4 py-3">
                  <span className="text-[11.5px] font-semibold text-[var(--color-bv-text)]">
                    {po.retail.officeReminderSent
                      ? `Office reminder sent to ${po.retail.officeReminderTo ?? 'the office'}.`
                      : 'Office reminder could not be sent — open the order to retry.'}
                  </span>
                  <Link
                    href={`/purchase-orders/${po.id}/order-ready`}
                    className="rounded-[9px] bg-[#1C4972] px-3.5 py-1.5 text-[11.5px] font-bold text-white hover:opacity-95"
                  >
                    View order
                  </Link>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex justify-center gap-3">
        <button type="button" className={btnNavy} onClick={onRestart}>
          Order more materials
        </button>
        <Link
          href="/purchase-orders"
          className="inline-flex items-center rounded-[10px] border border-[var(--color-bv-border)] bg-white px-4 py-2 text-[12.5px] font-semibold text-[var(--color-bv-text)]"
        >
          Past orders
        </Link>
      </div>
    </div>
  );
}
