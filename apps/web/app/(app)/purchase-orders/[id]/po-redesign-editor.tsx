'use client';

import Link from 'next/link';
import { startTransition, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  POAttachmentKind,
  POEventKind,
  POLineKind,
  POStatus,
  ShopCatalogUnit,
  VendorCostSourceMode,
} from '@bvisible/db';
import { formatMoney, formatQty, kindLabel, parseMoney, parseQty } from '@/lib/estimate/format';
import { SelectControl } from '@/components/app/select-control';
import {
  catalogPickerCostBasisCents,
  catalogPickerSellHintCents,
  resolveCatalogUnitCostCents,
  type EstimateCatalogPickerRow,
} from '@/lib/shop-material/apply-catalog-to-estimate-line';
import type { SavePurchaseOrderInput } from '@/lib/validators';
import type { OrderableCatalogEntry } from '@/lib/po/orderable-catalog';
import { fuzzySearch } from '@/lib/sheet-sync/fuzzy';
import {
  savePurchaseOrderAction,
  sendPurchaseOrderAction,
  setPoQboNumberAction,
  updatePoStatusAction,
  type SavePoState,
} from './actions';
import { PoAttachmentsPanel } from './attachments-panel';
import { PoTimelinePanel } from './timeline-panel';

type POVendorSendStatus = 'DRAFT' | 'SENT' | 'FAILED';

/// One picker result — an Items-catalog row (linked via catalogItemId) or
/// a raw Sheet catalog material (added as a plain described line).
type PickerEntry =
  | { source: 'db'; row: EstimateCatalogPickerRow }
  | { source: 'sheet'; entry: OrderableCatalogEntry };

/// Loose key for de-duplicating picker results across the two sources.
function looseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface PoRedesignBootstrap {
  po: {
    id: string;
    number: string;
    status: POStatus;
    qboPoNumber: string | null;
    notes: string;
    subtotalCents: number;
    updatedAt: string;
    vendor: VendorRef | null;
    estimate: { id: string; number: string; title: string } | null;
    createdByLabel: string;
  };
  lines: ReadonlyArray<PoDraftLine>;
  vendors: ReadonlyArray<VendorRef>;
  vendorSections: ReadonlyArray<{
    id: string;
    vendorId: string;
    status: POVendorSendStatus;
    sentAt: string | null;
    messageId: string | null;
    lastError: string | null;
    vendor: VendorRef;
  }>;
  catalog: ReadonlyArray<EstimateCatalogPickerRow>;
  /// Full Sheet materials catalog (Vendor Catalog + Meterial price +
  /// Internal Materials) — searched alongside `catalog` so every
  /// orderable material is reachable from the picker.
  sheetCatalog: ReadonlyArray<OrderableCatalogEntry>;
  sheetAliases: ReadonlyArray<{ alias: string; canonical: string }>;
  receiptSummary: {
    latestOcrStatus: string | null;
    ocrDocumentsTotal: number;
    latestReconciliationStatus: string | null;
    openSpendAlertCount: number;
    operatorMarkedReconciledAt: string | null;
  } | null;
  lifecycle: {
    label: string;
    receiptProgressLabel: string;
    vendorResponseLabel: string;
  } | null;
  events: ReadonlyArray<{
    id: string;
    kind: POEventKind;
    message: string;
    createdAt: string;
    actorLabel: string | null;
  }>;
  attachments: ReadonlyArray<{
    id: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    kind: POAttachmentKind;
    createdAt: string;
    sourceEmailId: string | null;
    uploadedByLabel: string;
  }>;
}

type VendorRef = { id: string; name: string; email: string | null; emails: string[] };

export interface PoDraftLine {
  id: string;
  kind: POLineKind;
  description: string;
  estimateLineId: string | null;
  catalogItemId: string | null;
  bundleComponentId: string | null;
  vendorId: string | null;
  selectedVendorMode: VendorCostSourceMode | null;
  vendorSku: string | null;
  unit: ShopCatalogUnit;
  qtyMilli: number;
  unitCostCents: number;
  computedCostCents: number;
  receivedQtyMilli: number;
  notes: string | null;
  vendor: VendorRef | null;
  catalogItemName: string | null;
  catalogItemCode: string | null;
  sourceEstimateLineLabel: string | null;
  sourceBundleComponentLabel: string | null;
}

type EditorState = { notes: string; qboPoNumber: string; lines: PoDraftLine[]; baselineHash: string };
type Action =
  | { type: 'set-notes'; value: string }
  | { type: 'set-qbo'; value: string }
  | { type: 'add-line'; line: PoDraftLine }
  | { type: 'remove-line'; id: string }
  | { type: 'set-line'; id: string; patch: Partial<PoDraftLine> }
  | { type: 'reset-baseline'; hash: string };

function localId(): string {
  return `tmp-${Math.random().toString(36).slice(2, 10)}`;
}

function snapshot(state: EditorState): string {
  return JSON.stringify({
    notes: state.notes,
    qboPoNumber: state.qboPoNumber,
    lines: state.lines.map((line) => [
      line.id,
      line.description,
      line.vendorId,
      line.vendorSku,
      line.unit,
      line.qtyMilli,
      line.unitCostCents,
      line.receivedQtyMilli,
      line.notes,
    ]),
  });
}

function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'set-notes':
      return { ...state, notes: action.value };
    case 'set-qbo':
      return { ...state, qboPoNumber: action.value };
    case 'add-line':
      return { ...state, lines: [...state.lines, action.line] };
    case 'remove-line':
      return { ...state, lines: state.lines.filter((line) => line.id !== action.id) };
    case 'set-line':
      return {
        ...state,
        lines: state.lines.map((line) => (line.id === action.id ? { ...line, ...action.patch } : line)),
      };
    case 'reset-baseline':
      return { ...state, baselineHash: action.hash };
  }
}

function initialFromBootstrap(bootstrap: PoRedesignBootstrap): EditorState {
  const state: EditorState = {
    notes: bootstrap.po.notes,
    qboPoNumber: bootstrap.po.qboPoNumber ?? '',
    lines: bootstrap.lines.map((line) => ({ ...line })),
    baselineHash: '',
  };
  state.baselineHash = snapshot(state);
  return state;
}

export function PoRedesignEditor({ bootstrap }: { bootstrap: PoRedesignBootstrap }) {
  const [state, dispatch] = useReducer(reducer, bootstrap, initialFromBootstrap);
  const [saveState, setSaveState] = useState<SavePoState>({ error: null });
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMessage, setSendMessage] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerHighlight, setPickerHighlight] = useState(0);
  const router = useRouter();
  const stateRef = useRef(state);
  const pickerInputRef = useRef<HTMLInputElement | null>(null);
  stateRef.current = state;

  const dirty = useMemo(() => snapshot(state) !== state.baselineHash, [state]);
  const lines = useMemo(
    () => state.lines.map((line) => ({ ...line, computedCostCents: Math.round((line.qtyMilli * line.unitCostCents) / 1000) })),
    [state.lines],
  );
  const subtotalCents = useMemo(() => lines.reduce((sum, line) => sum + line.computedCostCents, 0), [lines]);
  const vendorGroups = useMemo(() => buildVendorGroups(lines, bootstrap.vendors, bootstrap.vendorSections), [lines, bootstrap.vendors, bootstrap.vendorSections]);
  const vendorCount = vendorGroups.length;
  const receivedTotal = lines.reduce((sum, line) => sum + Math.min(line.receivedQtyMilli, line.qtyMilli), 0);
  const qtyTotal = lines.reduce((sum, line) => sum + Math.max(0, line.qtyMilli), 0);
  // Items-catalog rows AND the full Sheet materials catalog, merged and
  // de-duplicated — the picker reaches every orderable material, with the
  // same misspelling-tolerant search as the Order materials flow.
  const pickerRows = useMemo<PickerEntry[]>(() => {
    const q = pickerQuery.trim().toLowerCase();
    const dbRows = bootstrap.catalog
      .filter((row) => {
        if (row.kind !== 'MATERIAL') return false;
        if (!q) return true;
        return [row.name, row.nameNormalized, kindLabel(row.kind), row.itemType === 'BUNDLE' ? 'bundle' : 'item']
          .join(' ')
          .toLowerCase()
          .includes(q);
      })
      .slice(0, q ? 20 : 24);
    const out: PickerEntry[] = dbRows.map((row) => ({ source: 'db', row }));
    if (q) {
      const seen = new Set(dbRows.map((row) => looseName(row.name)));
      const sheetMatches = fuzzySearch(
        pickerQuery.trim(),
        bootstrap.sheetCatalog as OrderableCatalogEntry[],
        (item) => `${item.name} ${item.category} ${item.subcategory} ${item.spec} ${item.size}`,
        { limit: 20, aliases: bootstrap.sheetAliases as Array<{ alias: string; canonical: string }> }
      );
      for (const entry of sheetMatches) {
        const key = looseName(`${entry.name} ${entry.spec} ${entry.size}`);
        const nameKey = looseName(entry.name);
        if (seen.has(nameKey) || seen.has(key)) continue;
        seen.add(key);
        out.push({ source: 'sheet', entry });
        if (out.length >= 30) break;
      }
    }
    return out;
  }, [bootstrap.catalog, bootstrap.sheetCatalog, bootstrap.sheetAliases, pickerQuery]);

  useEffect(() => {
    if (!pickerOpen) return;
    window.requestAnimationFrame(() => pickerInputRef.current?.focus());

    function closePickerOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-po-item-picker]')) return;
      setPickerOpen(false);
    }

    document.addEventListener('pointerdown', closePickerOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closePickerOnOutsidePointer);
  }, [pickerOpen]);

  async function save() {
    if (saving) return;
    setSaving(true);
    setSaveState({ error: null });
    const current = stateRef.current;
    const payload: SavePurchaseOrderInput = {
      purchaseOrderId: bootstrap.po.id,
      notes: current.notes,
      lines: current.lines.map((line) => ({
        id: line.id,
        kind: line.kind,
        description: line.description,
        estimateLineId: line.estimateLineId,
        catalogItemId: line.catalogItemId,
        bundleComponentId: line.bundleComponentId,
        vendorId: line.vendorId,
        selectedVendorMode: line.selectedVendorMode,
        vendorSku: line.vendorSku,
        unit: line.unit,
        qtyMilli: line.qtyMilli,
        unitCostCents: line.unitCostCents,
        receivedQtyMilli: line.receivedQtyMilli,
        notes: line.notes,
      })),
    };
    const qbo = current.qboPoNumber.trim();
    const result = await savePurchaseOrderAction({ error: null }, payload);
    if (!result.error && qbo !== (bootstrap.po.qboPoNumber ?? '')) {
      const qboResult = await setPoQboNumberAction({
        purchaseOrderId: bootstrap.po.id,
        qboPoNumber: qbo.length > 0 ? qbo : null,
      });
      if (qboResult.error) result.error = qboResult.error;
    }
    setSaveState(result);
    if (!result.error) {
      dispatch({ type: 'reset-baseline', hash: snapshot(current) });
      startTransition(() => router.refresh());
    }
    setSaving(false);
  }

  async function send() {
    if (sending) return;
    if (dirty) await save();
    setSending(true);
    setSendMessage(null);
    const result = await sendPurchaseOrderAction(bootstrap.po.id);
    setSending(false);
    setSendMessage(result.error ?? `Sent ${result.sentCount ?? 0} vendor email${result.sentCount === 1 ? '' : 's'}.`);
    startTransition(() => router.refresh());
  }

  async function markReceived() {
    const result = await updatePoStatusAction({ purchaseOrderId: bootstrap.po.id, status: POStatus.RECEIVED });
    if (result.error) setSaveState({ error: result.error });
    else startTransition(() => router.refresh());
  }

  function applyCatalogItem(row: EstimateCatalogPickerRow) {
    const unitCostCents = resolveCatalogUnitCostCents({ row, machinesById: new Map() });
    const vendorId = row.selectedVendorId ?? row.preferredVendorId ?? row.catalogCheapestVendorId ?? null;
    const qtyMilli = Math.max(1000, row.defaultQtyMilli);
    dispatch({
      type: 'add-line',
      line: {
        id: localId(),
        kind: POLineKind.MATERIAL,
        description: row.name,
        estimateLineId: null,
        catalogItemId: row.id,
        bundleComponentId: null,
        vendorId,
        selectedVendorMode: row.selectedVendorMode,
        vendorSku: null,
        unit: row.catalogUnit,
        qtyMilli,
        unitCostCents,
        computedCostCents: Math.round((qtyMilli * unitCostCents) / 1000),
        receivedQtyMilli: 0,
        notes: null,
        vendor: bootstrap.vendors.find((vendor) => vendor.id === vendorId) ?? null,
        catalogItemName: row.name,
        catalogItemCode: null,
        sourceEstimateLineLabel: null,
        sourceBundleComponentLabel: null,
      },
    });
    setPickerQuery('');
    setPickerHighlight(0);
    setPickerOpen(false);
  }

  /// Adds a raw Sheet material as a PO line: preferred vendor first,
  /// otherwise cheapest; the vendor row is matched by name against the
  /// tenant's vendors (synced from the Sheet's Vendor Directory).
  function applySheetItem(entry: OrderableCatalogEntry) {
    const preferred = entry.preferredVendor
      ? entry.vendorPrices.find(
          (o) => o.vendor.trim().toLowerCase() === entry.preferredVendor.trim().toLowerCase()
        )
      : undefined;
    const cheapest = [...entry.vendorPrices].sort((a, b) => a.priceCents - b.priceCents)[0];
    const pick = preferred ?? cheapest ?? { vendor: entry.vendor, priceCents: entry.priceCents };
    const vendor =
      bootstrap.vendors.find(
        (v) => v.name.trim().toLowerCase() === pick.vendor.trim().toLowerCase()
      ) ?? null;
    const detail = [entry.spec, entry.size].filter(Boolean).join(' • ');
    const qtyMilli = 1000;
    dispatch({
      type: 'add-line',
      line: {
        id: localId(),
        kind: POLineKind.MATERIAL,
        description: detail ? `${entry.name} — ${detail}` : entry.name,
        estimateLineId: null,
        catalogItemId: null,
        bundleComponentId: null,
        vendorId: vendor?.id ?? null,
        selectedVendorMode: preferred
          ? VendorCostSourceMode.PREFERRED
          : VendorCostSourceMode.CHEAPEST,
        vendorSku: entry.vendorSku || null,
        unit: ShopCatalogUnit.EACH,
        qtyMilli,
        unitCostCents: pick.priceCents,
        computedCostCents: Math.round((qtyMilli * pick.priceCents) / 1000),
        receivedQtyMilli: 0,
        notes: null,
        vendor,
        catalogItemName: null,
        catalogItemCode: null,
        sourceEstimateLineLabel: null,
        sourceBundleComponentLabel: null,
      },
    });
    setPickerQuery('');
    setPickerHighlight(0);
    setPickerOpen(false);
  }

  function applyPickerEntry(item: PickerEntry) {
    if (item.source === 'db') applyCatalogItem(item.row);
    else applySheetItem(item.entry);
  }

  function handlePickerKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setPickerOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setPickerHighlight((current) => (pickerRows.length === 0 ? 0 : Math.min(current + 1, pickerRows.length - 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setPickerHighlight((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const item = pickerRows[pickerHighlight];
      if (item) applyPickerEntry(item);
    }
  }

  return (
    <div className="min-h-screen text-slate-900">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-4 rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[12px] text-slate-500">
            <Link href="/purchase-orders" className="hover:text-[var(--color-bv-accent)]">Purchase Orders</Link>
            <span>/</span>
            <span className="font-semibold text-slate-700">{bootstrap.po.number}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-bold tracking-[-0.03em] text-[#1C4972]">Purchase Order {bootstrap.po.number}</h1>
            <StatusPill status={bootstrap.po.status} />
          </div>
          <p className="mt-1 text-[12.5px] text-slate-500">
            {bootstrap.po.estimate ? <>Created from Estimate <Link href={`/estimates/${bootstrap.po.estimate.id}` as never} className="font-semibold text-[var(--color-bv-accent)]">#{bootstrap.po.estimate.number}</Link> · {bootstrap.po.estimate.title}</> : 'Manual purchase order'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">Auto-saved just now</span>
          <Link href="/purchase-orders" className="rounded-[8px] border border-slate-200 bg-white px-4 py-2 text-[12px] font-bold text-slate-700 shadow-sm hover:bg-slate-50">Back</Link>
          <Link href={`/po-print/${bootstrap.po.id}` as never} target="_blank" className="rounded-[8px] border border-slate-200 bg-white px-4 py-2 text-[12px] font-bold text-slate-700 shadow-sm hover:bg-slate-50">Print / PDF</Link>
          <button type="button" onClick={save} disabled={saving || !dirty} className="rounded-[8px] border border-slate-200 bg-white px-4 py-2 text-[12px] font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
          <button type="button" onClick={send} disabled={sending || lines.length === 0} className="rounded-[8px] bg-[var(--color-bv-accent)] px-4 py-2 text-[12px] font-bold text-white shadow-[0_14px_28px_rgba(47,90,243,0.22)] hover:opacity-90 disabled:opacity-50">Send PO</button>
          <button type="button" onClick={markReceived} className="rounded-[8px] border border-emerald-200 bg-emerald-50 px-4 py-2 text-[12px] font-bold text-emerald-700 hover:bg-emerald-100">Mark Received</button>
        </div>
      </header>

      <section className="mb-4 grid gap-3 rounded-[14px] border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-5">
        <Metric label="Vendor count" value={vendorCount.toString()} detail={`${bootstrap.vendors.length} available`} />
        <Metric label="Linked estimate" value={bootstrap.po.estimate ? `#${bootstrap.po.estimate.number}` : 'Manual'} detail={bootstrap.po.estimate?.title ?? 'No source estimate'} />
        <Metric label="PO date" value={dateLabel(bootstrap.po.updatedAt)} detail="Last updated" />
        <Metric label="Receipt status" value={bootstrap.lifecycle?.receiptProgressLabel ?? 'No OCR yet'} detail={`${bootstrap.attachments.length} attachment${bootstrap.attachments.length === 1 ? '' : 's'}`} />
        <Metric label="Terms" value="Net 30" detail="Default vendor terms" />
      </section>

      {sendMessage || saveState.error ? (
        <div className={`mb-4 rounded-[12px] border px-4 py-3 text-[12.5px] font-semibold ${saveState.error || sendMessage?.includes('failed') ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {saveState.error ?? sendMessage}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <main className="min-w-0 space-y-4">
          <section id="po-vendors" className="space-y-4">
            {vendorGroups.map((group) => (
              <VendorSection
                key={group.key}
                group={group}
                vendors={bootstrap.vendors}
                dispatch={dispatch}
              />
            ))}

            <div className="relative" data-po-item-picker>
              {pickerOpen ? (
                <div className="w-[360px] max-w-full">
                  <input
                    ref={pickerInputRef}
                    value={pickerQuery}
                    onChange={(event) => {
                      setPickerQuery(event.currentTarget.value);
                      setPickerHighlight(0);
                    }}
                    onKeyDown={handlePickerKeyDown}
                    placeholder="Type to search items..."
                    aria-label="Search catalog items"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-[6px] border border-transparent bg-white px-2 py-1.5 text-[13px] font-semibold text-[#1C4972] outline-none ring-1 ring-[#eadfd3] transition placeholder:text-slate-400 focus:ring-2 focus:ring-[#F28744]"
                  />
                  <PoItemPickerDropdown
                    rows={pickerRows}
                    highlight={pickerHighlight}
                    onPick={applyPickerEntry}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setPickerOpen(true);
                    setPickerQuery('');
                    setPickerHighlight(0);
                  }}
                  className="inline-flex items-center justify-center rounded-[10px] bg-[#F28744] px-4 py-2.5 text-[12px] font-black text-white shadow-sm transition hover:bg-[#df7430]"
                >
                  + Add Item
                </button>
              )}
            </div>
          </section>

          <PoAttachmentsPanel purchaseOrderId={bootstrap.po.id} attachments={bootstrap.attachments} />

          <section id="po-notes" className="rounded-[14px] border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-[14px] font-bold text-[#1C4972]">Internal notes</h2>
            <textarea value={state.notes} onChange={(event) => dispatch({ type: 'set-notes', value: event.currentTarget.value })} rows={4} className="mt-3 w-full rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] outline-none focus:border-[var(--color-bv-accent)] focus:bg-white" placeholder="Notes for your team. Not sent to vendors." />
          </section>

          <div id="po-timeline">
            <PoTimelinePanel purchaseOrderId={bootstrap.po.id} events={bootstrap.events} />
          </div>
        </main>

        <aside className="sticky top-4 h-fit space-y-4">
          <section className="rounded-[14px] border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-[14px] font-bold text-[#1C4972]">PO Summary</h2>
            <SummaryRow label="Subtotal" value={formatMoney(subtotalCents)} />
            <SummaryRow label="Vendor count" value={vendorCount.toString()} />
            <SummaryRow label="Receipt status" value={qtyTotal > 0 ? `${formatQty(receivedTotal)} / ${formatQty(qtyTotal)} received` : 'No lines'} />
            <SummaryRow label="Reconciliation" value={bootstrap.receiptSummary?.latestReconciliationStatus ?? 'Not run'} />
            <SummaryRow label="Linked estimate" value={bootstrap.po.estimate?.number ?? 'None'} />
            <label className="mt-3 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">QuickBooks PO number</label>
            <input value={state.qboPoNumber} onChange={(event) => dispatch({ type: 'set-qbo', value: event.currentTarget.value })} placeholder="Pending" className="mt-1 w-full rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[12px] outline-none focus:border-[var(--color-bv-accent)] focus:bg-white" />
          </section>

          <section className="rounded-[14px] border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-[14px] font-bold text-[#1C4972]">PO Status</h2>
            <div className="mt-3 space-y-2">
              {[POStatus.DRAFT, POStatus.SENT, POStatus.ORDERED, POStatus.PARTIALLY_RECEIVED, POStatus.RECEIVED].map((status) => (
                <button key={status} type="button" onClick={() => updatePoStatusAction({ purchaseOrderId: bootstrap.po.id, status }).then(() => startTransition(() => router.refresh()))} className={`flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12px] font-semibold ${bootstrap.po.status === status ? 'bg-blue-50 text-[var(--color-bv-accent)]' : 'text-slate-500 hover:bg-slate-50'}`}>
                  <span className={`h-2.5 w-2.5 rounded-full border ${bootstrap.po.status === status ? 'border-[var(--color-bv-accent)] bg-[var(--color-bv-accent)]' : 'border-slate-300'}`} />
                  {statusLabel(status)}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-[14px] border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-[14px] font-bold text-[#1C4972]">Quick Actions</h2>
            <div className="mt-3 grid gap-2 text-[12px] font-semibold">
              <button type="button" onClick={send} className="text-left text-slate-600 hover:text-[var(--color-bv-accent)]">Send vendor emails</button>
              <a href="#po-attachments" className="text-slate-600 hover:text-[var(--color-bv-accent)]">Upload receipt / invoice</a>
              <Link href={`/purchase-orders/${bootstrap.po.id}/reconciliation` as never} className="text-slate-600 hover:text-[var(--color-bv-accent)]">Open OCR reconciliation</Link>
              <button type="button" onClick={markReceived} className="text-left text-emerald-700 hover:text-emerald-800">Mark as received</button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function VendorSection({
  group,
  vendors,
  dispatch,
}: {
  group: VendorGroup;
  vendors: ReadonlyArray<VendorRef>;
  dispatch: React.Dispatch<Action>;
}) {
  return (
    <section className="overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-[14px] font-bold text-[#1C4972]">{group.vendor?.name ?? 'Unassigned vendor'}</h2>
          <StatusBadge label={sendStatusLabel(group.sendStatus)} />
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">{group.lines.length} item{group.lines.length === 1 ? '' : 's'}</span>
        </div>
        <div className="flex items-center gap-4 text-[11.5px] text-slate-500">
          <span>{[...(group.vendor?.emails ?? []), group.vendor?.email].filter((e, i, a) => e && a.indexOf(e) === i).join(', ') || 'No vendor email'}</span>
          <span className="font-bold text-slate-900">{formatMoney(group.subtotalCents)}</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-[12px]">
          <thead className="border-b border-slate-100 bg-slate-50 text-left text-[10px] uppercase tracking-[0.12em] text-slate-400">
            <tr>
              <th className="px-4 py-2">#</th>
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2">Vendor SKU</th>
              <th className="px-4 py-2">Source</th>
              <th className="px-4 py-2 text-right">Qty</th>
              <th className="px-4 py-2">Unit</th>
              <th className="px-4 py-2 text-right">Unit Cost</th>
              <th className="px-4 py-2 text-right">Total</th>
              <th className="px-4 py-2 text-right">Received</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {group.lines.map((line, index) => (
              <tr key={line.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2 text-slate-500">{index + 1}</td>
                <td className="px-4 py-2">
                  <input value={line.description} onChange={(event) => dispatch({ type: 'set-line', id: line.id, patch: { description: event.currentTarget.value } })} className="w-full rounded border border-transparent px-2 py-1 font-semibold text-slate-800 outline-none focus:border-slate-200 focus:bg-slate-50" />
                  <p className="px-2 text-[10.5px] text-slate-400">{line.catalogItemName ?? 'Manual material'}</p>
                </td>
                <td className="px-4 py-2"><input value={line.vendorSku ?? ''} onChange={(event) => dispatch({ type: 'set-line', id: line.id, patch: { vendorSku: event.currentTarget.value || null } })} className="w-full rounded border border-transparent px-2 py-1 font-mono text-[11.5px] outline-none focus:border-slate-200 focus:bg-slate-50" placeholder="SKU" /></td>
                <td className="px-4 py-2 text-slate-500">{line.sourceBundleComponentLabel ? `Bundle: ${line.sourceBundleComponentLabel}` : line.sourceEstimateLineLabel ?? 'Manual'}</td>
                <td className="px-4 py-2"><NumberInput value={formatQty(line.qtyMilli)} onCommit={(value) => dispatch({ type: 'set-line', id: line.id, patch: { qtyMilli: parseQty(value) ?? line.qtyMilli } })} /></td>
                <td className="px-4 py-2">
                  <SelectControl value={line.unit} onChange={(event) => dispatch({ type: 'set-line', id: line.id, patch: { unit: event.currentTarget.value as ShopCatalogUnit } })} className="rounded border border-slate-200 bg-white px-2 py-1">
                    {Object.values(ShopCatalogUnit).map((unit) => <option key={unit} value={unit}>{unitLabel(unit)}</option>)}
                  </SelectControl>
                </td>
                <td className="px-4 py-2"><NumberInput value={formatMoney(line.unitCostCents)} onCommit={(value) => dispatch({ type: 'set-line', id: line.id, patch: { unitCostCents: parseMoney(value) ?? line.unitCostCents } })} /></td>
                <td className="px-4 py-2 text-right font-bold tabular-nums">{formatMoney(line.computedCostCents)}</td>
                <td className="px-4 py-2"><NumberInput value={formatQty(line.receivedQtyMilli)} onCommit={(value) => dispatch({ type: 'set-line', id: line.id, patch: { receivedQtyMilli: Math.max(0, parseQty(value) ?? line.receivedQtyMilli) } })} /></td>
                <td className="px-4 py-2 text-right">
                  <SelectControl value={line.vendorId ?? ''} onChange={(event) => dispatch({ type: 'set-line', id: line.id, patch: { vendorId: event.currentTarget.value || null, vendor: vendors.find((vendor) => vendor.id === event.currentTarget.value) ?? null } })} searchable searchPlaceholder="Search vendors..." className="mr-2 max-w-[150px] rounded border border-slate-200 bg-white px-2 py-1">
                    <option value="">No vendor</option>
                    {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
                  </SelectControl>
                  <button type="button" onClick={() => dispatch({ type: 'remove-line', id: line.id })} className="text-rose-500 hover:text-rose-700">Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2">
        <span className="text-[12px] font-bold text-slate-700">Vendor subtotal {formatMoney(group.subtotalCents)}</span>
      </div>
    </section>
  );
}

function PoItemPickerDropdown({
  rows,
  highlight,
  onPick,
}: {
  rows: ReadonlyArray<PickerEntry>;
  highlight: number;
  onPick: (item: PickerEntry) => void;
}) {
  return (
    <div className="mt-1 w-[360px] max-w-full overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-2xl">
      <div className="max-h-[360px] overflow-y-auto py-1">
        {rows.length === 0 ? (
          <EmptyPickerState title="No material matches" detail="Try a different name — the search covers every Sheet material." />
        ) : (
          rows.map((item, index) => {
            const rowCls = `grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2 text-left ${index === highlight ? 'bg-blue-50' : 'hover:bg-slate-50'}`;
            if (item.source === 'db') {
              const row = item.row;
              const cost = catalogPickerCostBasisCents({ row, machinesById: new Map() });
              const sell = catalogPickerSellHintCents({ row, machinesById: new Map() });
              return (
                <button
                  key={`db:${row.id}`}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onPick(item)}
                  className={rowCls}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-black text-slate-900">{row.name}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-slate-400">
                      <span>{kindLabel(row.kind)}</span>
                      {row.itemType === 'BUNDLE' ? (
                        <span className="rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-violet-700">
                          Bundle{row.componentCount > 0 ? ` · ${row.componentCount}` : ''}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="text-right text-[11px] font-bold tabular-nums text-slate-700">
                    <span className="block">{formatMoney(sell)}</span>
                    <span className="block text-slate-400">cost {formatMoney(cost)}</span>
                  </span>
                </button>
              );
            }
            const entry = item.entry;
            const spec = [entry.spec, entry.size].filter(Boolean).join(' • ');
            const preferred = entry.preferredVendor
              ? entry.vendorPrices.find(
                  (o) => o.vendor.trim().toLowerCase() === entry.preferredVendor.trim().toLowerCase()
                )
              : undefined;
            const cheapest = [...entry.vendorPrices].sort((a, b) => a.priceCents - b.priceCents)[0];
            const pick = preferred ?? cheapest ?? { vendor: entry.vendor, priceCents: entry.priceCents };
            return (
              <button
                key={`sheet:${entry.id}`}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(item)}
                className={rowCls}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-black text-slate-900">{entry.name}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-slate-400">
                    {spec ? <span>{spec}</span> : <span>{entry.category}</span>}
                  </span>
                </span>
                <span className="text-right text-[11px] font-bold tabular-nums text-slate-700">
                  <span className="block">{formatMoney(pick.priceCents)}</span>
                  <span className="block text-slate-400">{pick.vendor || 'Vendor TBD'}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function EmptyPickerState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="px-3 py-5 text-center">
      <p className="text-[12px] font-black text-slate-700">{title}</p>
      <p className="mt-1 text-[11px] font-semibold text-slate-400">{detail}</p>
    </div>
  );
}

type VendorGroup = {
  key: string;
  vendor: VendorRef | null;
  lines: PoDraftLine[];
  subtotalCents: number;
  sendStatus: POVendorSendStatus | 'DRAFT';
};

function buildVendorGroups(lines: PoDraftLine[], vendors: ReadonlyArray<VendorRef>, sections: PoRedesignBootstrap['vendorSections']): VendorGroup[] {
  const map = new Map<string, VendorGroup>();
  for (const line of lines) {
    const key = line.vendorId ?? 'unassigned';
    const vendor = line.vendor ?? vendors.find((v) => v.id === line.vendorId) ?? null;
    const section = sections.find((s) => s.vendorId === line.vendorId);
    const group = map.get(key) ?? { key, vendor, lines: [], subtotalCents: 0, sendStatus: section?.status ?? 'DRAFT' };
    group.lines.push(line);
    group.subtotalCents += line.computedCostCents;
    map.set(key, group);
  }
  if (map.size === 0) map.set('unassigned', { key: 'unassigned', vendor: null, lines: [], subtotalCents: 0, sendStatus: 'DRAFT' });
  return [...map.values()].sort((a, b) => (a.vendor?.name ?? 'Unassigned').localeCompare(b.vendor?.name ?? 'Unassigned'));
}

function NumberInput({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  return <input value={draft} onChange={(event) => setDraft(event.currentTarget.value)} onBlur={() => onCommit(draft)} className="w-full rounded border border-transparent px-2 py-1 text-right tabular-nums outline-none focus:border-slate-200 focus:bg-slate-50" />;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p><p className="mt-2 truncate text-[13px] font-bold text-slate-900">{value}</p><p className="mt-1 truncate text-[11.5px] text-slate-500">{detail}</p></div>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="mt-3 flex justify-between gap-3 border-b border-slate-100 pb-2 text-[12.5px]"><span className="text-slate-500">{label}</span><span className="text-right font-bold text-slate-900">{value}</span></div>;
}

function StatusPill({ status }: { status: POStatus }) {
  return <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-[var(--color-bv-accent)]">{statusLabel(status)}</span>;
}

function StatusBadge({ label }: { label: string }) {
  return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700">{label}</span>;
}

function statusLabel(status: POStatus): string {
  return status.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function sendStatusLabel(status: POVendorSendStatus | 'DRAFT'): string {
  return status.toLowerCase().replace(/_/g, ' ');
}

function unitLabel(unit: string): string {
  return unit.toLowerCase().replace(/_/g, ' ');
}

function dateLabel(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
