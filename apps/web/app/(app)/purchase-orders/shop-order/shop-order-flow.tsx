'use client';

// "What materials do you need?" — search the Sheet's Vendor Catalog
// (misspelling-tolerant via the ALIASES tab), lowest-price vendor
// preselected, then review grouped by vendor before creating one PO per
// vendor. Optional custom materials for anything not in the list.

import { useActionState, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { formatMoney } from '@bvisible/pricing';
import { fuzzySearch } from '@/lib/sheet-sync/fuzzy';
import {
  createShopOrderAction,
  sendShopOrderPoAction,
  type ShopOrderResult,
} from './shop-order-actions';

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
}

export interface FlowProps {
  catalog: CatalogEntry[];
  aliases: Array<{ alias: string; canonical: string }>;
  vendorEmails: Record<string, string>;
  smtpConfigured: boolean;
}

interface OrderLine {
  uid: number;
  name: string;
  detail: string;
  vendor: string;
  qty: number;
  unitPriceCents: number;
  catalogId: string;
  vendorSku: string;
  vendorOptions: Array<{ vendor: string; priceCents: number }>;
}

let nextUid = 1;

const inputCls =
  'rounded-[10px] border border-[var(--color-bv-border)] bg-white px-3 py-2 text-[13px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]';
const btnDark =
  'inline-flex items-center justify-center rounded-[10px] bg-[var(--color-bv-text)] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:opacity-95 disabled:opacity-50';
const cardCls =
  'rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]';

export function ShopOrderFlow(props: FlowProps) {
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [notes, setNotes] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customVendor, setCustomVendor] = useState('');
  const [customPrice, setCustomPrice] = useState('');

  const [state, formAction, pending] = useActionState<ShopOrderResult, FormData>(
    createShopOrderAction,
    { error: null }
  );

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

  function addItem(item: CatalogEntry) {
    setLines((prev) => [
      ...prev,
      {
        uid: nextUid++,
        name: item.name,
        detail: [item.spec, item.size].filter(Boolean).join(' · '),
        vendor: item.vendor || item.vendorPrices[0]?.vendor || 'Vendor TBD',
        qty: 1,
        unitPriceCents: item.priceCents,
        catalogId: item.id,
        vendorSku: item.vendorSku,
        vendorOptions:
          item.vendorPrices.length > 0
            ? item.vendorPrices
            : [{ vendor: item.vendor || 'Vendor TBD', priceCents: item.priceCents }],
      },
    ]);
    setSearch('');
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
        qty: 1,
        unitPriceCents: priceCents,
        catalogId: '',
        vendorSku: '',
        vendorOptions: [{ vendor: customVendor.trim(), priceCents }],
      },
    ]);
    setCustomName('');
    setCustomVendor('');
    setCustomPrice('');
    setCustomOpen(false);
  }

  function updateLine(uid: number, patch: Partial<OrderLine>) {
    setLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
  }

  const vendors = useMemo(() => {
    const map = new Map<string, OrderLine[]>();
    for (const l of lines) {
      const bucket = map.get(l.vendor) ?? [];
      bucket.push(l);
      map.set(l.vendor, bucket);
    }
    return Array.from(map.entries());
  }, [lines]);

  const combinedTotal = lines.reduce((s, l) => s + Math.round(l.qty * l.unitPriceCents), 0);

  function buildPayload(sendEmails: boolean) {
    return JSON.stringify({
      notes,
      sendEmails,
      lines: lines.map((l) => ({
        name: l.name,
        detail: l.detail,
        vendor: l.vendor,
        qty: l.qty,
        unitPriceCents: l.unitPriceCents,
        catalogId: l.catalogId,
        vendorSku: l.vendorSku,
      })),
    });
  }

  /* ---------- review & send screen (drafts created, nothing sent) ---------- */
  if (state.created && state.created.length > 0) {
    return (
      <ReviewAndSend
        created={state.created}
        smtpConfigured={props.smtpConfigured}
        onRestart={() => {
          setLines([]);
          setNotes('');
          window.location.reload();
        }}
      />
    );
  }

  return (
    <form action={formAction} className="pb-8">
      <input type="hidden" name="payload" id="shop-order-payload" />

      {/* search */}
      <input
        className="w-full rounded-[var(--radius-bv)] border-2 border-[var(--color-bv-accent)] bg-white px-5 py-3.5 text-[15px] text-[var(--color-bv-text)] shadow-[var(--shadow-bv-card)] outline-none"
        placeholder="Start typing: Durabond, vinyl, acrylic, blade…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <button
        type="button"
        onClick={() => setCustomOpen((v) => !v)}
        className="mt-2 rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-1.5 text-[11.5px] font-semibold text-[var(--color-bv-muted)]"
      >
        + Order a custom material not in the list
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
        <div className="mt-3 space-y-2">
          {results.map((item) => (
            <div key={item.id} className={`${cardCls} flex items-center gap-4 px-4 py-3`}>
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[#fdeee1] text-[10px] font-bold text-[#b05c1e]">
                {item.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold text-[var(--color-bv-text)]">
                  {item.name}
                </div>
                <div className="truncate text-[11px] text-[var(--color-bv-muted)]">
                  {[item.category, item.spec, item.size].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[8.5px] font-bold uppercase tracking-[0.13em] text-[var(--color-bv-muted)]">
                  Lowest price
                </div>
                <div className="text-[14px] font-bold text-[var(--color-bv-text)]">
                  {formatMoney(item.priceCents)}
                </div>
                <div className="text-[10.5px] font-bold text-[var(--color-bv-accent)]">
                  {item.vendor}
                </div>
              </div>
              <button type="button" className={btnDark} onClick={() => addItem(item)}>
                + Add
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* steps helper */}
      {lines.length === 0 && results.length === 0 ? (
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {[
            ['1', 'Search a material', 'Even if spelling is not exact — Sheet aliases cover it.'],
            ['2', 'Enter quantity', 'Change the vendor on any line when needed.'],
            ['3', 'Review & create', 'One PO per vendor, drafts or emailed from your shop mailbox.'],
          ].map(([n, t, b]) => (
            <div key={n} className={`${cardCls} p-5`}>
              <div className="grid h-8 w-8 place-items-center rounded-[9px] bg-[var(--color-bv-text)] text-[13px] font-bold text-white">
                {n}
              </div>
              <div className="mt-2.5 text-[13.5px] font-bold text-[var(--color-bv-text)]">{t}</div>
              <div className="mt-1 text-[11.5px] text-[var(--color-bv-muted)]">{b}</div>
            </div>
          ))}
        </div>
      ) : null}

      {/* review */}
      {lines.length > 0 ? (
        <div className="mt-7">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-bv-accent)]">
            Review order
          </div>
          <h2 className="mt-1 text-[22px] font-bold text-[var(--color-bv-text)]">
            {vendors.length} purchase order{vendors.length > 1 ? 's' : ''} will be created
          </h2>
          <p className="text-[12.5px] text-[var(--color-bv-muted)]">
            The lowest vendor is the default. Change any line before creating the POs.
          </p>

          <div className="mt-4 space-y-4">
            {vendors.map(([vendorName, vendorLines]) => {
              const vendorTotal = vendorLines.reduce(
                (s, l) => s + Math.round(l.qty * l.unitPriceCents),
                0
              );
              return (
                <div key={vendorName} className={`${cardCls} overflow-hidden`}>
                  <div className="flex items-center justify-between bg-[var(--color-bv-text)] px-5 py-3.5 text-white">
                    <div>
                      <div className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-white/60">
                        Vendor
                      </div>
                      <div className="text-[16px] font-bold">{vendorName}</div>
                      {props.vendorEmails[vendorName] ? (
                        <div className="text-[10px] text-white/60">
                          {props.vendorEmails[vendorName]}
                        </div>
                      ) : (
                        <div className="text-[10px] text-amber-300">
                          No order email on file — PO saves as draft
                        </div>
                      )}
                    </div>
                    <div className="text-[18px] font-bold text-[#ffb98a]">
                      {formatMoney(vendorTotal)}
                    </div>
                  </div>
                  {vendorLines.map((l) => (
                    <div
                      key={l.uid}
                      className="flex flex-wrap items-center gap-3 border-t border-[var(--color-bv-border)] px-5 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-[var(--color-bv-text)]">
                          {l.name}
                        </div>
                        <div className="truncate text-[11px] text-[var(--color-bv-muted)]">
                          {l.detail}
                        </div>
                      </div>
                      <select
                        className={inputCls}
                        value={l.vendor}
                        onChange={(e) => {
                          const nextVendor = e.target.value;
                          const opt = l.vendorOptions.find((o) => o.vendor === nextVendor);
                          updateLine(l.uid, {
                            vendor: nextVendor,
                            unitPriceCents: opt?.priceCents ?? l.unitPriceCents,
                          });
                        }}
                      >
                        {l.vendorOptions.map((o) => (
                          <option key={o.vendor} value={o.vendor}>
                            {o.vendor} — {formatMoney(o.priceCents)}
                          </option>
                        ))}
                      </select>
                      <input
                        className={`${inputCls} w-20 text-right`}
                        type="number"
                        min={0.001}
                        step="any"
                        value={l.qty}
                        onChange={(e) => updateLine(l.uid, { qty: Number(e.target.value) || 0 })}
                      />
                      <div className="w-24 text-right text-[13.5px] font-bold text-[var(--color-bv-text)]">
                        {formatMoney(Math.round(l.qty * l.unitPriceCents))}
                      </div>
                      <button
                        type="button"
                        aria-label="Remove"
                        className="text-slate-400 hover:text-red-500"
                        onClick={() => setLines((prev) => prev.filter((x) => x.uid !== l.uid))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <label className="mt-4 block">
            <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
              Notes for suppliers
            </span>
            <textarea
              className={`${inputCls} w-full`}
              rows={2}
              placeholder="Optional delivery or order notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>

          {state.error ? (
            <div className="mt-3 rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-900">
              {state.error}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-4 rounded-[var(--radius-bv)] bg-[var(--color-bv-text)] px-6 py-4 text-white shadow-[var(--shadow-bv-elevated)]">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/60">
                Combined total
              </div>
              <div className="text-[22px] font-bold">{formatMoney(combinedTotal)}</div>
              <div className="text-[10px] text-white/60">
                {vendors.length} separate vendor PO{vendors.length > 1 ? 's' : ''} · nothing is
                emailed until you click Send PO
              </div>
            </div>
            <div className="flex-1" />
            <button
              type="submit"
              className="rounded-[11px] bg-[var(--color-bv-accent)] px-5 py-3 text-[13.5px] font-bold text-white hover:opacity-95 disabled:opacity-60"
              disabled={pending}
              onClick={() => {
                const el = document.getElementById('shop-order-payload') as HTMLInputElement | null;
                if (el) el.value = buildPayload(false);
              }}
            >
              {pending ? 'Creating…' : `Create PO${vendors.length > 1 ? 's' : ''} — review before sending →`}
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

/* ---------- review & send: drafts saved; PDF + explicit Send PO per vendor ---------- */

function ReviewAndSend({
  created,
  smtpConfigured,
  onRestart,
}: {
  created: NonNullable<ShopOrderResult['created']>;
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

  return (
    <div className="mx-auto max-w-2xl">
      <div className="text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-500 text-2xl text-white shadow-[var(--shadow-bv-card)]">
          ✓
        </div>
        <div className="mt-4 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-bv-accent)]">
          Drafts saved — review &amp; send
        </div>
        <h2 className="mt-1 text-[26px] font-bold text-[var(--color-bv-text)]">
          {created.length} draft PO{created.length > 1 ? 's' : ''} created
        </h2>
        <p className="mt-1 text-[12.5px] text-[var(--color-bv-muted)]">
          Nothing has been emailed. Check each PDF, edit the PO if needed, then click Send PO.
        </p>
      </div>

      <div className="mt-5 space-y-3">
        {created.map((po) => {
          const s = sendState[po.id] ?? { status: 'idle' as const, message: '' };
          const noEmail = po.emailStatus === 'NO_VENDOR_EMAIL';
          return (
            <div key={po.id} className={`${cardCls} px-5 py-4`}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-bold text-[var(--color-bv-text)]">
                    {po.number} · {po.vendor}
                  </div>
                  <div className="text-[11.5px] text-[var(--color-bv-muted)]">
                    {s.status === 'sent'
                      ? `✓ ${s.message}`
                      : s.status === 'error'
                        ? `⚠ ${s.message}`
                        : noEmail
                          ? 'Draft saved · no vendor email on file'
                          : 'Draft saved · not sent yet'}
                  </div>
                </div>
                <div className="text-[15px] font-bold text-[var(--color-bv-text)]">
                  {formatMoney(po.totalCents)}
                </div>
                <Link
                  href={`/purchase-orders/${po.id}`}
                  className="rounded-[9px] border border-[var(--color-bv-border)] px-3 py-1.5 text-[11.5px] font-bold text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
                >
                  Edit / open
                </Link>
                <Link
                  href={`/po-print/${po.id}`}
                  target="_blank"
                  className="rounded-[9px] border border-[var(--color-bv-border)] px-3 py-1.5 text-[11.5px] font-bold text-[var(--color-bv-accent)] hover:bg-[var(--color-bv-bg)]"
                >
                  Generate PDF
                </Link>
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
                  {s.status === 'sending' ? 'Sending…' : s.status === 'sent' ? 'Sent ✓' : 'Send PO'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex justify-center gap-3">
        <button type="button" className={btnDark} onClick={onRestart}>
          Start another shop order
        </button>
        <Link
          href="/purchase-orders"
          className="inline-flex items-center rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-2 text-[12.5px] font-semibold text-[var(--color-bv-text)]"
        >
          All purchase orders
        </Link>
      </div>
    </div>
  );
}
