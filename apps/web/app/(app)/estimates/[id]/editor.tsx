'use client';

import { startTransition, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
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
import {
  attachEstimateVehicleAction,
  removeEstimateVehicleAction,
} from '../../vehicles/actions';
import { createPoFromEstimateAction } from '../../purchase-orders/actions';
import { LineGrid } from './line-grid';
import { TotalsPanel } from './totals-panel';
import { EstimateToolsTabs } from './estimate-tools-tabs';
import type { EstimateCatalogPickerRow } from '@/lib/shop-material/apply-catalog-to-estimate-line';
import {
  defaultDescription,
  defaultUnitCostCents,
} from '@/lib/estimate/defaults';
import type { SaveEstimateInput } from '@/lib/validators';
import { isEstimateEditorReadOnly } from '@/lib/estimate/estimate-read-only-ui';
import { SectionCard, SectionHeading, IconDoc } from '@/components/estimate/estimate-surface';

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
    client: { id: string; companyName: string; contactName: string | null; email: string | null };
    quoteSent: boolean;
    hasInvoice: boolean;
    invoicePaid: boolean;
  };
  estimateVehicle: {
    id: string;
    trimId: string | null;
    year: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
    color: string | null;
    wrapType: string | null;
    coverageType: string | null;
    notes: string | null;
    photoUrl: string | null;
    bodyStyle: string | null;
    vehicleType: string | null;
    profile: {
      totalApproxWrapSqFt: number | null;
      sideApproxSqFt: number | null;
      roofApproxSqFt: number | null;
      hoodApproxSqFt: number | null;
      rearApproxSqFt: number | null;
      frontApproxSqFt: number | null;
    } | null;
  } | null;
  vehicleLibrary: ReadonlyArray<{
    id: string;
    year: number;
    make: string;
    model: string;
    trim: string | null;
    bodyStyle: string | null;
    vehicleType: string | null;
    photoUrl: string | null;
    totalApproxWrapSqFt: number | null;
    sideApproxSqFt: number | null;
    roofApproxSqFt: number | null;
    hoodApproxSqFt: number | null;
    rearApproxSqFt: number | null;
    frontApproxSqFt: number | null;
  }>;
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
  | { type: 'add-line'; kind: EstimateLineKind; patch?: Partial<DraftLine> }
  | { type: 'remove-line'; id: string }
  | { type: 'move-line'; id: string; dir: -1 | 1 }
  | { type: 'set-line'; id: string; patch: Partial<DraftLine> }
  | { type: 'pick-machine'; id: string; machineId: string | null; ratePerHourCents: number | null }
  | { type: 'reset-baseline'; hash: string };

function localId(): string {
  return `tmp-${Math.random().toString(36).slice(2, 10)}`;
}

function vehicleDisplayName(vehicle: {
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
}): string {
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
    .filter((part) => part !== null && part !== undefined && String(part).trim().length > 0)
    .join(' ') || 'Vehicle attached';
}

function formatVehicleSqFt(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(value % 1 ? 1 : 0)} sq ft`
    : 'Missing';
}

function makeDraftLine(kind: EstimateLineKind): DraftLine {
  return {
    id: localId(),
    kind,
    description: defaultDescription(kind),
    qtyMilli: 1000,
    unitCostCents: defaultUnitCostCents(kind),
    machineId: null,
    notes: null,
  };
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
      const newLine = { ...makeDraftLine(action.kind), ...action.patch };
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
  if (lines.length === 0 && !isEstimateEditorReadOnly(b.estimate.status)) {
    lines.push(makeDraftLine(EstimateLineKind.MATERIAL));
  }
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

export function EstimateEditor({
  bootstrap,
  supportTabs,
}: {
  bootstrap: EditorBootstrap;
  supportTabs?: ReactNode;
}) {
  const readOnly = isEstimateEditorReadOnly(bootstrap.estimate.status);
  const [state, dispatch] = useReducer(reducer, bootstrap, initialFromBootstrap);
  const [vendorIntelLineId, setVendorIntelLineId] = useState<string | null>(null);
  const [catalogLineId, setCatalogLineId] = useState<string | null>(
    () => state.lines[0]?.id ?? null
  );
  const [saveState, setSaveState] = useState<SaveEstimateState>({ error: null });
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [poBusy, setPoBusy] = useState(false);
  const [poMsg, setPoMsg] = useState<string | null>(null);
  const [finalizeBusy, setFinalizeBusy] = useState(false);
  const [finalizeMsg, setFinalizeMsg] = useState<string | null>(null);
  const [vehicleBusy, setVehicleBusy] = useState(false);
  const [vehicleMsg, setVehicleMsg] = useState<string | null>(null);
  const [vehiclePickId, setVehiclePickId] = useState<string>(() => bootstrap.estimateVehicle?.trimId ?? bootstrap.vehicleLibrary[0]?.id ?? '');
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

  const previousLineCountRef = useRef(state.lines.length);
  useEffect(() => {
    const previousLineCount = previousLineCountRef.current;
    previousLineCountRef.current = state.lines.length;

    if (state.lines.length === 0) {
      setCatalogLineId(null);
      return;
    }

    if (state.lines.length > previousLineCount) {
      setCatalogLineId(state.lines[state.lines.length - 1]?.id ?? null);
      return;
    }

    if (!catalogLineId || !state.lines.some((line) => line.id === catalogLineId)) {
      setCatalogLineId(state.lines[state.lines.length - 1]?.id ?? null);
    }
  }, [catalogLineId, state.lines]);

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

  async function handleAttachVehicle() {
    if (readOnly || vehicleBusy || !vehiclePickId) return;
    setVehicleBusy(true);
    setVehicleMsg(null);
    try {
      const r = await attachEstimateVehicleAction({
        estimateId: bootstrap.estimate.id,
        trimId: vehiclePickId,
        coverageType: 'Full wrap',
        wrapType: 'Vehicle wrap',
      });
      if (r.error) setVehicleMsg(r.error);
      else startTransition(() => router.refresh());
    } finally {
      setVehicleBusy(false);
    }
  }

  async function handleRemoveVehicle() {
    if (readOnly || vehicleBusy) return;
    setVehicleBusy(true);
    setVehicleMsg(null);
    try {
      const r = await removeEstimateVehicleAction(bootstrap.estimate.id);
      if (r.error) setVehicleMsg(r.error);
      else startTransition(() => router.refresh());
    } finally {
      setVehicleBusy(false);
    }
  }

  const totalsPanelProps = {
    bootstrap,
    breakdown: computed.breakdown,
    subtotalCostCents: computed.subtotalCostCents,
    finalPriceCents: computed.finalPriceCents,
    multiplierMilli: state.multiplierMilli,
    designFlatCents: state.designFlatCents,
    lineCount: state.lines.length,
    readOnly,
    dispatch: guardedDispatch,
    dirty,
    saving,
    statusBusy,
    deleting,
    saveState,
    onSave: handleSave,
    onStatusChange: handleStatusChange,
    onDelete: bootstrap.canDelete ? handleDelete : null,
    poBusy,
    poMsg,
    finalizeBusy,
    finalizeMsg,
    onCreatePo: handleCreatePo,
    onFinalize: handleFinalize,
    onUnfinalize: bootstrap.canUnfinalize ? handleUnfinalize : null,
  };

  return (
    <div
      ref={rootRef}
      className="w-full px-6 pb-7"
    >
      <div className="-mx-6 grid min-h-[128px] border-b border-slate-200 bg-white xl:grid-cols-[324px_minmax(0,1fr)_560px]">
        <div className="border-r border-slate-200">
          <TotalsPanel {...totalsPanelProps} variant="context" />
        </div>
        <JobSummaryCard title={state.title} vehicle={bootstrap.estimateVehicle} />
        <div className="min-h-full border-l border-slate-200">
          <TotalsPanel {...totalsPanelProps} variant="workflow" />
        </div>
      </div>

      <div className="grid items-start gap-5 py-5 xl:grid-cols-[300px_minmax(0,1fr)_520px]">
        <div className="flex min-w-0 flex-col gap-3">
          <ProjectContextRail
            title={state.title}
            notes={state.notes}
            readOnly={readOnly}
            vehicle={bootstrap.estimateVehicle}
            vehicleLibrary={bootstrap.vehicleLibrary}
            vehiclePickId={vehiclePickId}
            vehicleBusy={vehicleBusy}
            vehicleMsg={vehicleMsg}
            onVehiclePick={setVehiclePickId}
            onAttachVehicle={handleAttachVehicle}
            onRemoveVehicle={handleRemoveVehicle}
            dispatch={guardedDispatch}
          />
          <TotalsPanel {...totalsPanelProps} variant="fulfillment" />
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <LineGrid
            lines={state.lines}
            machines={bootstrap.machines}
            lineCosts={computed.lineCosts}
            multiplierMilli={state.multiplierMilli}
            readOnly={readOnly}
            customer={bootstrap.estimate.client}
            onVendorIntelLineFocus={setVendorIntelLineId}
            onAnyLineFocus={setCatalogLineId}
            dispatch={guardedDispatch}
          />
          <TotalsPanel {...totalsPanelProps} variant="pricing" />
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <EstimateToolsTabs
            catalog={bootstrap.shopCatalog}
            machines={bootstrap.machines}
            catalogLineId={catalogLineId}
            lines={state.lines}
            readOnly={readOnly}
            vendorIntelLine={vendorIntelLine}
            estimateVehicle={bootstrap.estimateVehicle}
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
            dispatch={guardedDispatch}
            onCatalogApply={() => guardedDispatch({ type: 'add-line', kind: EstimateLineKind.MATERIAL })}
          />
          {supportTabs}
          <TotalsPanel {...totalsPanelProps} variant="admin" />
        </div>
      </div>
    </div>
  );
}

function JobSummaryCard({
  title,
  vehicle,
}: {
  title: string;
  vehicle: EditorBootstrap['estimateVehicle'];
}) {
  const vehicleName = vehicle ? vehicleDisplayName(vehicle) : 'No vehicle';
  return (
    <section className="flex h-full items-center gap-7 bg-white px-7 py-4">
      <div className="relative grid h-[76px] w-[112px] shrink-0 place-items-center overflow-hidden rounded-[8px] bg-gradient-to-b from-slate-100 to-white ring-1 ring-slate-200">
        {vehicle?.photoUrl ? (
          <img src={vehicle.photoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <>
            <div className="absolute bottom-5 h-8 w-20 rounded-[8px] bg-slate-200 shadow-inner" />
            <div className="absolute bottom-7 left-6 h-7 w-12 skew-x-[-14deg] rounded-t-[8px] bg-white ring-1 ring-slate-300" />
            <div className="absolute bottom-4 left-6 h-4 w-4 rounded-full bg-slate-700 ring-4 ring-white" />
            <div className="absolute bottom-4 right-6 h-4 w-4 rounded-full bg-slate-700 ring-4 ring-white" />
          </>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-[17px] font-black tracking-[-0.02em] text-slate-950">
            {vehicleName}
          </h2>
        </div>
        <dl className="mt-4 grid grid-cols-4 gap-5 text-[11px]">
          <div>
            <dt className="font-semibold text-slate-400">Project</dt>
            <dd className="mt-1 truncate font-bold text-slate-800">{title || 'Untitled'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-400">Wrap coverage</dt>
            <dd className="mt-1 truncate font-bold text-slate-800">{vehicle?.coverageType ?? 'No vehicle'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-400">Wrap sq ft</dt>
            <dd className="mt-1 truncate font-bold text-slate-800">{formatVehicleSqFt(vehicle?.profile?.totalApproxWrapSqFt)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-400">Body</dt>
            <dd className="mt-1 truncate font-bold text-slate-800">{vehicle?.bodyStyle ?? vehicle?.vehicleType ?? 'Optional'}</dd>
          </div>
        </dl>
        <p className="sr-only">{title}</p>
      </div>
    </section>
  );
}

function ProjectContextRail({
  title,
  notes,
  readOnly,
  vehicle,
  vehicleLibrary,
  vehiclePickId,
  vehicleBusy,
  vehicleMsg,
  onVehiclePick,
  onAttachVehicle,
  onRemoveVehicle,
  dispatch,
}: {
  title: string;
  notes: string;
  readOnly: boolean;
  vehicle: EditorBootstrap['estimateVehicle'];
  vehicleLibrary: EditorBootstrap['vehicleLibrary'];
  vehiclePickId: string;
  vehicleBusy: boolean;
  vehicleMsg: string | null;
  onVehiclePick: (id: string) => void;
  onAttachVehicle: () => void;
  onRemoveVehicle: () => void;
  dispatch: React.Dispatch<Action>;
}) {
  return (
    <aside className="flex flex-col gap-3">
      <ContextCard title="Vehicle" action={vehicle ? 'Attached' : 'Optional'}>
        <p className="font-bold leading-snug text-slate-950">{vehicle ? vehicleDisplayName(vehicle) : 'No vehicle'}</p>
        <p className="mt-1 text-[11px] leading-snug text-slate-500">
          {vehicle ? `${vehicle.bodyStyle ?? vehicle.vehicleType ?? 'Vehicle'} · ${formatVehicleSqFt(vehicle.profile?.totalApproxWrapSqFt)}` : 'Estimates can stay vehicle-free.'}
        </p>
        {!readOnly ? (
          <div className="mt-3 grid gap-2">
            <select
              value={vehiclePickId}
              onChange={(e) => onVehiclePick(e.currentTarget.value)}
              className="w-full rounded-[6px] border border-slate-200 bg-white px-2 py-2 text-[11px] font-bold text-slate-700"
            >
              {vehicleLibrary.length === 0 ? <option value="">No vehicles in library</option> : null}
              {vehicleLibrary.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.year} {row.make} {row.model}{row.trim ? ` ${row.trim}` : ''}
                </option>
              ))}
            </select>
            <button type="button" onClick={onAttachVehicle} disabled={vehicleBusy || !vehiclePickId} className="w-full rounded-[6px] border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-blue-700 disabled:opacity-60">
              {vehicle ? 'Change vehicle' : 'Add vehicle'}
            </button>
            {vehicle ? (
              <button type="button" onClick={onRemoveVehicle} disabled={vehicleBusy} className="w-full rounded-[6px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700 disabled:opacity-60">
                Remove vehicle
              </button>
            ) : null}
            {vehicleMsg ? <p className="text-[11px] font-semibold text-rose-700">{vehicleMsg}</p> : null}
          </div>
        ) : null}
      </ContextCard>
      <ContextCard title="Wrap Details" action="Edit">
        <p className="text-[11px] leading-relaxed text-slate-500">
          {vehicle?.profile ? 'Wrap square footage is an estimate and can be edited in the vehicle tool.' : 'Attach a vehicle with a wrap profile to show coverage helpers.'}
        </p>
      </ContextCard>
      <ContextCard title="Internal Notes" action="Edit">
        <MetaCard title={title} notes={notes} readOnly={readOnly} dispatch={dispatch} compact />
      </ContextCard>
    </aside>
  );
}

function ContextCard({
  title,
  action,
  children,
}: {
  title: string;
  action: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[8px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-black text-slate-950">{title}</h3>
        <button type="button" className="text-[10px] font-bold text-blue-600">
          {action}
        </button>
      </div>
      {children}
    </section>
  );
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className="truncate font-bold text-slate-800">{value}</dd>
    </div>
  );
}

function MetaCard({
  title,
  notes,
  readOnly,
  dispatch,
  compact = false,
}: {
  title: string;
  notes: string;
  readOnly: boolean;
  dispatch: React.Dispatch<Action>;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div>
        {readOnly ? (
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-700">
            {notes.trim() ? notes : 'Customer wants brand colors with matte laminate. Logo on both sides and rear. No design changes included.'}
          </p>
        ) : (
          <>
            <textarea
              value={notes}
              onChange={(e) =>
                dispatch({ type: 'set-meta', field: 'notes', value: e.currentTarget.value })
              }
              rows={5}
              maxLength={4000}
              placeholder="Customer wants brand colors with matte laminate. Logo on both sides and rear. No design changes included."
              className="min-h-[82px] w-full resize-none rounded-[6px] border-0 bg-transparent p-0 text-[11px] leading-relaxed text-slate-700 outline-none placeholder:text-slate-500"
            />
            <button type="button" className="mt-3 w-full rounded-[6px] border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-blue-700">
              Add internal note
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <SectionCard className="p-4">
      <SectionHeading
        icon={<IconDoc />}
        title="Project context"
        subtitle="Estimate title and team notes."
      />
      <div className="mt-4 grid gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            Title
          </span>
          {readOnly ? (
            <p className="text-[15px] font-semibold text-slate-900">{title}</p>
          ) : (
            <input
              value={title}
              onChange={(e) =>
                dispatch({ type: 'set-meta', field: 'title', value: e.currentTarget.value })
              }
              maxLength={160}
              placeholder="e.g. Storefront window graphics"
              className="rounded-[12px] border border-slate-200 bg-white px-3 py-2.5 text-[13px] font-semibold text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
            />
          )}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            Internal notes
          </span>
          {readOnly ? (
            <p className="whitespace-pre-wrap text-[13.5px] text-slate-700">
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
              placeholder="Optional internal notes — only your team can see these."
              className="min-h-[110px] resize-y rounded-[12px] border border-slate-200 bg-white px-3 py-2.5 text-[12.5px] leading-relaxed text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
            />
          )}
        </label>
      </div>
    </SectionCard>
  );
}
