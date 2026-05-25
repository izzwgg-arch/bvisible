'use client';

import { startTransition, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EstimateLineKind, EstimateStatus, POStatus, POReconciliationStatus } from '@bvisible/db';
import { computeEstimate, type LineInput } from '@bvisible/pricing';
import {
  saveEstimateAction,
  updateEstimateStatusAction,
  deleteEstimateAction,
  finalizeEstimateAction,
  unfinalizeEstimateAction,
  type SaveEstimateState,
  type FinalizeEstimateResult,
} from './actions';
import { createPoFromEstimateAction } from '../../purchase-orders/actions';
import { LineGrid } from './line-grid';
import { TotalsPanel } from './totals-panel';
import { VendorCatalogIntelPanel } from './vendor-catalog-intel-panel';
import { CatalogItemPicker } from './catalog-item-picker';
import { PricingHelperPanel } from './pricing-helper-panel';
import type { EstimateCatalogPickerRow } from '@/lib/shop-material/apply-catalog-to-estimate-line';
import {
  defaultDescription,
  defaultUnitCostCents,
} from '@/lib/estimate/defaults';
import type { SaveEstimateInput } from '@/lib/validators';
import { isEstimateEditorReadOnly } from '@/lib/estimate/estimate-read-only-ui';

// ---------------------------------------------------------------------
// Types passed in from the server component.
// ---------------------------------------------------------------------

export interface EditorBootstrap {
  estimate: {
    id: string;
    number: string;
    title: string;
    status: EstimateStatus;
    notes: string;
    multiplierMilli: number;
    designFlatCents: number;
    subtotalCostCents: number;
    finalPriceCents: number;
    updatedAt: string;
    client: { id: string; companyName: string };
  };
  lines: ReadonlyArray<{
    id: string;
    kind: EstimateLineKind;
    description: string;
    qtyMilli: number;
    unitCostCents: number;
    machineId: string | null;
    notes: string | null;
  }>;
  machines: ReadonlyArray<{ id: string; name: string; ratePerHourCents: number }>;
  clients: ReadonlyArray<{ id: string; companyName: string }>;
  vendors: ReadonlyArray<{ id: string; name: string }>;
  linkedPos: ReadonlyArray<{
    id: string;
    number: string;
    status: POStatus;
    qboPoNumber: string | null;
    subtotalCents: number;
    createdAtIso: string;
    vendor: { id: string; name: string } | null;
    latestReconciliationStatus: POReconciliationStatus | null;
    receiptishAttachmentCount: number;
    ocrPendingOrProcessingCount: number;
    ocrNeedsReviewCount: number;
    reconciliationNeedsAttention: boolean;
  }>;
  canDelete: boolean;
  canUnfinalize: boolean;
  shopCatalog: ReadonlyArray<EstimateCatalogPickerRow>;
}

export interface DraftLine {
  id: string;
  kind: EstimateLineKind;
  description: string;
  qtyMilli: number;
  unitCostCents: number;
  machineId: string | null;
  notes: string | null;
}

interface EditorState {
  title: string;
  notes: string;
  multiplierMilli: number;
  designFlatCents: number;
  lines: DraftLine[];
  // Used to detect "have I changed anything since the last save?".
  // We compare a JSON snapshot at save time against the current state.
  baselineHash: string;
}

export type Action =
  | { type: 'set-meta'; field: 'title' | 'notes'; value: string }
  | { type: 'set-multiplier'; value: number }
  | { type: 'set-design-flat'; value: number }
  | { type: 'add-line'; kind: EstimateLineKind }
  | { type: 'remove-line'; id: string }
  | { type: 'move-line'; id: string; dir: -1 | 1 }
  | { type: 'set-line'; id: string; patch: Partial<DraftLine> }
  | { type: 'pick-machine'; id: string; machineId: string | null; ratePerHourCents: number | null }
  | { type: 'reset-baseline'; hash: string };

function localId(): string {
  return `tmp-${Math.random().toString(36).slice(2, 10)}`;
}

function snapshot(s: EditorState): string {
  return JSON.stringify({
    t: s.title,
    n: s.notes,
    m: s.multiplierMilli,
    d: s.designFlatCents,
    l: s.lines.map((l) => [
      l.id,
      l.kind,
      l.description,
      l.qtyMilli,
      l.unitCostCents,
      l.machineId,
      l.notes,
    ]),
  });
}

function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'set-meta':
      return { ...state, [action.field]: action.value };
    case 'set-multiplier':
      return { ...state, multiplierMilli: action.value };
    case 'set-design-flat':
      return { ...state, designFlatCents: action.value };
    case 'add-line': {
      const newLine: DraftLine = {
        id: localId(),
        kind: action.kind,
        description: defaultDescription(action.kind),
        qtyMilli: 1000,
        unitCostCents: defaultUnitCostCents(action.kind),
        machineId: null,
        notes: null,
      };
      return { ...state, lines: [...state.lines, newLine] };
    }
    case 'remove-line':
      return { ...state, lines: state.lines.filter((l) => l.id !== action.id) };
    case 'move-line': {
      const idx = state.lines.findIndex((l) => l.id === action.id);
      if (idx < 0) return state;
      const newIdx = idx + action.dir;
      if (newIdx < 0 || newIdx >= state.lines.length) return state;
      const next = state.lines.slice();
      const [item] = next.splice(idx, 1);
      if (!item) return state;
      next.splice(newIdx, 0, item);
      return { ...state, lines: next };
    }
    case 'set-line':
      return {
        ...state,
        lines: state.lines.map((l) =>
          l.id === action.id ? { ...l, ...action.patch } : l
        ),
      };
    case 'pick-machine':
      return {
        ...state,
        lines: state.lines.map((l) =>
          l.id === action.id
            ? {
                ...l,
                machineId: action.machineId,
                // Pre-fill the unit cost from the picked machine.
                // The user can still type a different cost after; we
                // leave existing custom costs alone if they cleared the
                // machine pick (machineId=null).
                unitCostCents:
                  action.ratePerHourCents !== null
                    ? action.ratePerHourCents
                    : l.unitCostCents,
              }
            : l
        ),
      };
    case 'reset-baseline':
      return { ...state, baselineHash: action.hash };
  }
}

function initialFromBootstrap(b: EditorBootstrap): EditorState {
  const lines: DraftLine[] = b.lines.map((l) => ({
    id: l.id,
    kind: l.kind,
    description: l.description,
    qtyMilli: l.qtyMilli,
    unitCostCents: l.unitCostCents,
    machineId: l.machineId,
    notes: l.notes,
  }));
  const base: EditorState = {
    title: b.estimate.title,
    notes: b.estimate.notes,
    multiplierMilli: b.estimate.multiplierMilli,
    designFlatCents: b.estimate.designFlatCents,
    lines,
    baselineHash: '',
  };
  base.baselineHash = snapshot(base);
  return base;
}

export function EstimateEditor({ bootstrap }: { bootstrap: EditorBootstrap }) {
  const readOnly = isEstimateEditorReadOnly(bootstrap.estimate.status);
  const [state, dispatch] = useReducer(reducer, bootstrap, initialFromBootstrap);
  const [vendorIntelLineId, setVendorIntelLineId] = useState<string | null>(null);
  const [catalogLineId, setCatalogLineId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveEstimateState>({ error: null });
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [poBusy, setPoBusy] = useState(false);
  const [poMsg, setPoMsg] = useState<string | null>(null);
  const [finalizeBusy, setFinalizeBusy] = useState(false);
  const [finalizeMsg, setFinalizeMsg] = useState<string | null>(null);
  const router = useRouter();

  const dirty = useMemo(() => snapshot(state) !== state.baselineHash, [state]);

  // Run the pricing engine on every render. It's pure JS over a small
  // array; React renders the editor on the same ticks anyway.
  const computed = useMemo(() => {
    const lines: LineInput[] = state.lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      qtyMilli: l.qtyMilli,
      unitCostCents: l.unitCostCents,
    }));
    return computeEstimate({
      multiplierMilli: state.multiplierMilli,
      designFlatCents: state.designFlatCents,
      lines,
    });
  }, [state.lines, state.multiplierMilli, state.designFlatCents]);

  const vendorIntelLine = useMemo(() => {
    if (!vendorIntelLineId) return null;
    return state.lines.find((l) => l.id === vendorIntelLineId) ?? null;
  }, [vendorIntelLineId, state.lines]);

  const stateRef = useRef(state);
  stateRef.current = state;

  function guardedDispatch(action: Action) {
    if (readOnly) return;
    dispatch(action);
  }

  async function handleSave() {
    if (readOnly || saving) return;
    setSaving(true);
    setSaveState({ error: null });
    const snapBefore = snapshot(stateRef.current);
    const payload: SaveEstimateInput = {
      estimateId: bootstrap.estimate.id,
      title: stateRef.current.title,
      notes: stateRef.current.notes ?? null,
      multiplierMilli: stateRef.current.multiplierMilli,
      designFlatCents: stateRef.current.designFlatCents,
      lines: stateRef.current.lines.map((l) => ({
        id: l.id,
        kind: l.kind,
        description: l.description,
        qtyMilli: l.qtyMilli,
        unitCostCents: l.unitCostCents,
        machineId: l.machineId ?? null,
        notes: l.notes ?? null,
      })),
    };
    try {
      const result = await saveEstimateAction({ error: null }, payload);
      setSaveState(result);
      if (!result.error) {
        dispatch({ type: 'reset-baseline', hash: snapBefore });
        // Refresh the RSC tree so the page header / list shows the
        // latest saved totals next time the user navigates.
        startTransition(() => router.refresh());
      }
    } catch (err) {
      setSaveState({
        error:
          err instanceof Error ? err.message : 'Save failed. Try again.',
      });
    } finally {
      setSaving(false);
    }
  }

  // Cmd/Ctrl+S anywhere inside the editor saves. Listening at the
  // editor root (not window) means it only fires when an editor input
  // has focus, which avoids accidentally saving when the browser
  // chrome takes the keystroke for itself.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    function onKey(e: KeyboardEvent) {
      if (readOnly) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSave();
      }
    }
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStatusChange(next: EstimateStatus) {
    if (statusBusy) return;
    setStatusBusy(true);
    try {
      const r = await updateEstimateStatusAction({
        estimateId: bootstrap.estimate.id,
        status: next,
      });
      if (r.error) setSaveState({ error: r.error });
      else startTransition(() => router.refresh());
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    if (!window.confirm('Delete this estimate? It will be hidden from the list. This is reversible only by support.')) {
      return;
    }
    setDeleting(true);
    try {
      await deleteEstimateAction(bootstrap.estimate.id);
    } finally {
      setDeleting(false);
    }
  }

  async function handleCreatePo(vendorId: string | null) {
    if (poBusy) return;
    setPoBusy(true);
    setPoMsg(null);
    try {
      const r = await createPoFromEstimateAction({
        estimateId: bootstrap.estimate.id,
        vendorId: vendorId ?? null,
      });
      if (r.error || !r.purchaseOrderId) {
        setPoMsg(r.error ?? 'Could not create PO.');
      } else {
        router.push(`/purchase-orders/${r.purchaseOrderId}` as never);
      }
    } finally {
      setPoBusy(false);
    }
  }

  async function handleFinalize() {
    if (finalizeBusy) return;
    setFinalizeBusy(true);
    setFinalizeMsg(null);
    try {
      const r: FinalizeEstimateResult = await finalizeEstimateAction({
        estimateId: bootstrap.estimate.id,
      });
      if (!r.ok) {
        setFinalizeMsg(r.message ?? 'Could not finalize.');
      } else {
        startTransition(() => router.refresh());
      }
    } finally {
      setFinalizeBusy(false);
    }
  }

  async function handleUnfinalize() {
    if (finalizeBusy) return;
    if (
      !window.confirm(
        'Unfinalize this estimate? It will return to APPROVED so it can be edited.'
      )
    ) {
      return;
    }
    setFinalizeBusy(true);
    setFinalizeMsg(null);
    try {
      const r = await unfinalizeEstimateAction({
        estimateId: bootstrap.estimate.id,
      });
      if (r.error) setFinalizeMsg(r.error);
      else startTransition(() => router.refresh());
    } finally {
      setFinalizeBusy(false);
    }
  }

  return (
    <div ref={rootRef} className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-4">
        <MetaCard
          title={state.title}
          notes={state.notes}
          readOnly={readOnly}
          dispatch={guardedDispatch}
        />
        <LineGrid
          lines={state.lines}
          machines={bootstrap.machines}
          lineCosts={computed.lineCosts}
          readOnly={readOnly}
          onVendorIntelLineFocus={setVendorIntelLineId}
          onAnyLineFocus={setCatalogLineId}
          dispatch={guardedDispatch}
        />
        <CatalogItemPicker
          catalog={bootstrap.shopCatalog}
          machines={bootstrap.machines}
          activeLineId={catalogLineId}
          lines={state.lines}
          readOnly={readOnly}
          dispatch={guardedDispatch}
        />
        <PricingHelperPanel
          activeLineId={catalogLineId}
          lines={state.lines}
          readOnly={readOnly}
          dispatch={guardedDispatch}
        />
        <VendorCatalogIntelPanel
          line={vendorIntelLine}
          readOnly={readOnly}
          onApplyManagedCost={
            readOnly
              ? undefined
              : (lineId, cents) =>
                  guardedDispatch({
                    type: 'set-line',
                    id: lineId,
                    patch: { unitCostCents: cents },
                  })
          }
        />
      </div>

      <TotalsPanel
        bootstrap={bootstrap}
        breakdown={computed.breakdown}
        subtotalCostCents={computed.subtotalCostCents}
        finalPriceCents={computed.finalPriceCents}
        multiplierMilli={state.multiplierMilli}
        designFlatCents={state.designFlatCents}
        readOnly={readOnly}
        dispatch={guardedDispatch}
        dirty={dirty}
        saving={saving}
        statusBusy={statusBusy}
        deleting={deleting}
        saveState={saveState}
        onSave={handleSave}
        onStatusChange={handleStatusChange}
        onDelete={bootstrap.canDelete ? handleDelete : null}
        poBusy={poBusy}
        poMsg={poMsg}
        finalizeBusy={finalizeBusy}
        finalizeMsg={finalizeMsg}
        onCreatePo={handleCreatePo}
        onFinalize={handleFinalize}
        onUnfinalize={bootstrap.canUnfinalize ? handleUnfinalize : null}
      />
    </div>
  );
}

function MetaCard({
  title,
  notes,
  readOnly,
  dispatch,
}: {
  title: string;
  notes: string;
  readOnly: boolean;
  dispatch: React.Dispatch<Action>;
}) {
  return (
    <section
      className={`rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)] ${
        readOnly ? 'bg-[var(--color-bv-bg)]/40' : ''
      }`}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">Title</span>
        {readOnly ? (
          <p className="text-[14.5px] font-medium text-[var(--color-bv-text)]">{title}</p>
        ) : (
          <input
            value={title}
            onChange={(e) =>
              dispatch({ type: 'set-meta', field: 'title', value: e.currentTarget.value })
            }
            maxLength={160}
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14.5px] font-medium text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
          />
        )}
      </label>
      <label className="mt-3 flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">Notes</span>
        {readOnly ? (
          <p className="whitespace-pre-wrap text-[13.5px] text-[var(--color-bv-text)]">
            {notes.trim() ? notes : '—'}
          </p>
        ) : (
          <textarea
            value={notes}
            onChange={(e) =>
              dispatch({ type: 'set-meta', field: 'notes', value: e.currentTarget.value })
            }
            rows={2}
            maxLength={4000}
            placeholder="Optional internal notes."
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13.5px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
          />
        )}
      </label>
    </section>
  );
}
