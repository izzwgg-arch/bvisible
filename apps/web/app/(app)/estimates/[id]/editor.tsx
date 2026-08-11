'use client';

import Link from 'next/link';
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
import { createPoFromEstimateAction } from '../../purchase-orders/actions';
import { LineGrid } from './line-grid';
import { TotalsPanel } from './totals-panel';
import type { EstimateCatalogPickerRow } from '@/lib/shop-material/apply-catalog-to-estimate-line';
import {
  defaultDescription,
  defaultUnitCostCents,
} from '@/lib/estimate/defaults';
import type { PricingEngine, VendorCostSourceMode } from '@/lib/shop-material/pricing-engine';
import type { SaveEstimateInput } from '@/lib/validators';
import { isEstimateEditorReadOnly } from '@/lib/estimate/estimate-read-only-ui';
import { moveGroup, moveLinePreservingGroups } from '@/lib/estimate/line-groups';
import { publishEstimateSaveState } from '@/lib/estimate/estimate-save-bridge';
import { SectionCard, SectionHeading, IconDoc } from '@/components/estimate/estimate-surface';
import { SelectControl } from '@/components/app/select-control';
import { registerLineApplier, setAssistantContext } from '@/lib/assistant/context-store';

type EstimateTypeValue = 'CUSTOM' | 'STOCK_ITEM' | 'SQUARE_FOOTAGE';

// ---------------------------------------------------------------------
// Types passed in from the server component.
// ---------------------------------------------------------------------

export interface EditorBootstrap {
  estimate: {
    id: string;
    number: string;
    title: string;
    estimateType: EstimateTypeValue;
    status: EstimateStatus;
    notes: string;
    multiplierMilli: number;
    designFlatCents: number;
    subtotalCostCents: number;
    finalPriceCents: number;
    client: {
      id: string;
      companyName: string;
      contactName: string | null;
      email: string | null;
      phone?: string | null;
    };
    quoteSent: boolean;
    hasInvoice: boolean;
    invoicePaid: boolean;
    salesRepId: string | null;
  };
  /// Active tenant users selectable as the sales representative.
  salesReps: ReadonlyArray<{ id: string; name: string }>;
  /// True when the signed-in user may change markup / multiplier and the
  /// design fee (ADMIN or SUPER_ADMIN). The server enforces this too.
  canEditPricing: boolean;
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
  vehicleWrapCatalog: ReadonlyArray<{
    id: string;
    make: string;
    model: string;
    vehicleType: string | null;
    photoUrl: string | null;
    variants: ReadonlyArray<{
      id: string;
      variant: string | null;
      roofWrapOption: string | null;
      wheelbase: string | null;
      height: string | null;
      cab: string | null;
      option: string | null;
      chargeCents: number | null;
      squareFootage: number | null;
      ratePerSf: number | null;
      pricingRule: string | null;
      isActive: boolean;
    }>;
  }>;
  lines: ReadonlyArray<{
    id: string;
    kind: EstimateLineKind;
    description: string;
    qtyMilli: number;
    unitCostCents: number;
    machineId: string | null;
    notes: string | null;
    materialCostCents: number | null;
    partialUsageMilli: number | null;
    laborHoursMilli: number | null;
    machineTimeMilli: number | null;
    designTimeMilli: number | null;
    installTimeMilli: number | null;
    vendorCostCents: number | null;
    catalogItemId: string | null;
    pricingMethod: string | null;
    pricingEngine: PricingEngine | null;
    pricingInputsSnapshotJson: unknown;
    pricingOutputSnapshotJson: unknown;
    formulaVersion: string | null;
    selectedVendorId: string | null;
    selectedVendorMode: VendorCostSourceMode | null;
    internalNotes: string | null;
    hiddenFromCustomer: boolean;
    customerDescription: string | null;
    markupExempt: boolean;
    lineGroupId: string | null;
    lineGroupLabel: string | null;
  }>;
  machines: ReadonlyArray<{ id: string; name: string; ratePerHourCents: number }>;
  clients: ReadonlyArray<{
    id: string;
    companyName: string;
    contactName?: string | null;
    email?: string | null;
    phone?: string | null;
  }>;
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
  materialCostCents: number | null;
  partialUsageMilli: number | null;
  laborHoursMilli: number | null;
  machineTimeMilli: number | null;
  designTimeMilli: number | null;
  installTimeMilli: number | null;
  vendorCostCents: number | null;
  catalogItemId: string | null;
  pricingMethod: string | null;
  pricingEngine: PricingEngine | null;
  pricingInputsSnapshotJson: unknown;
  pricingOutputSnapshotJson: unknown;
  formulaVersion: string | null;
  selectedVendorId: string | null;
  selectedVendorMode: VendorCostSourceMode | null;
  internalNotes: string | null;
  hiddenFromCustomer: boolean;
  customerDescription: string | null;
  // R-EST-05: price already includes markup (Sheet sq-ft / vehicle wrap
  // lines from the guided flow) — excluded from the estimate multiplier.
  markupExempt: boolean;
  // Bundle grouping. Lines sharing a lineGroupId are components of one
  // bundle and render as a single collapsible row in the grid. The
  // label is denormalized onto every member so it survives a save.
  lineGroupId: string | null;
  lineGroupLabel: string | null;
}

interface EditorState {
  title: string;
  estimateType: EstimateTypeValue;
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
  | { type: 'set-estimate-type'; value: EstimateTypeValue }
  | { type: 'set-multiplier'; value: number }
  | { type: 'set-design-flat'; value: number }
  | { type: 'add-line'; kind: EstimateLineKind; patch?: Partial<DraftLine>; afterId?: string }
  | { type: 'remove-line'; id: string }
  | { type: 'move-line'; id: string; dir: -1 | 1 }
  | { type: 'set-line'; id: string; patch: Partial<DraftLine> }
  | { type: 'set-line-group'; groupId: string; patch: Partial<DraftLine> }
  | { type: 'remove-line-group'; groupId: string }
  | { type: 'move-line-group'; groupId: string; dir: -1 | 1 }
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
    materialCostCents: null,
    partialUsageMilli: null,
    laborHoursMilli: null,
    machineTimeMilli: null,
    designTimeMilli: null,
    installTimeMilli: null,
    vendorCostCents: null,
    catalogItemId: null,
    pricingMethod: null,
    pricingEngine: null,
    pricingInputsSnapshotJson: null,
    pricingOutputSnapshotJson: null,
    formulaVersion: null,
    selectedVendorId: null,
    selectedVendorMode: null,
    internalNotes: null,
    hiddenFromCustomer: false,
    customerDescription: null,
    markupExempt: false,
    lineGroupId: null,
    lineGroupLabel: null,
  };
}

// A line the user hasn't touched yet: no catalog pick, no name, no cost.
// Kept in sync with the grid's "focus the next empty row" behavior.
export function isBlankLine(line: DraftLine): boolean {
  return !line.catalogItemId && line.description.trim().length === 0 && line.unitCostCents === 0;
}

// Spreadsheet invariant: the grid always ends with one blank row so the
// user can keep typing after ANY entry path (inline picker, side-panel
// catalog "+ Add to estimate", bundles, vehicles). Blank rows are
// filtered out of the save payload, so they never reach the DB.
function withTrailingBlank(lines: DraftLine[]): DraftLine[] {
  const last = lines[lines.length - 1];
  if (last && isBlankLine(last)) return lines;
  return [...lines, makeDraftLine(EstimateLineKind.MATERIAL)];
}

function snapshot(s: EditorState): string {
  return JSON.stringify({
    t: s.title,
    et: s.estimateType,
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
      l.materialCostCents,
      l.partialUsageMilli,
      l.laborHoursMilli,
      l.machineTimeMilli,
      l.designTimeMilli,
      l.installTimeMilli,
      l.vendorCostCents,
      l.catalogItemId,
      l.pricingMethod,
      l.pricingEngine,
      l.pricingInputsSnapshotJson,
      l.pricingOutputSnapshotJson,
      l.formulaVersion,
      l.selectedVendorId,
      l.selectedVendorMode,
      l.internalNotes,
      l.hiddenFromCustomer,
      l.customerDescription,
      l.markupExempt,
      l.lineGroupId,
      l.lineGroupLabel,
    ]),
  });
}

function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'set-meta':
      return { ...state, [action.field]: action.value };
    case 'set-estimate-type':
      return { ...state, estimateType: action.value };
    case 'set-multiplier':
      return { ...state, multiplierMilli: action.value };
    case 'set-design-flat':
      return { ...state, designFlatCents: action.value };
    case 'add-line': {
      const newLine = { ...makeDraftLine(action.kind), ...action.patch };
      // `afterId` is how a component gets added *into* a bundle: it
      // lands right behind the group's last member instead of at the
      // bottom of the estimate.
      if (action.afterId) {
        const at = state.lines.findIndex((l) => l.id === action.afterId);
        if (at >= 0) {
          const next = state.lines.slice();
          next.splice(at + 1, 0, newLine);
          return { ...state, lines: withTrailingBlank(next) };
        }
      }
      return { ...state, lines: withTrailingBlank([...state.lines, newLine]) };
    }
    case 'remove-line':
      return { ...state, lines: withTrailingBlank(state.lines.filter((l) => l.id !== action.id)) };
    case 'move-line':
      return { ...state, lines: moveLinePreservingGroups(state.lines, action.id, action.dir) };
    case 'set-line-group':
      return {
        ...state,
        lines: withTrailingBlank(
          state.lines.map((l) =>
            l.lineGroupId === action.groupId ? { ...l, ...action.patch } : l
          )
        ),
      };
    case 'remove-line-group':
      return {
        ...state,
        lines: withTrailingBlank(state.lines.filter((l) => l.lineGroupId !== action.groupId)),
      };
    case 'move-line-group':
      return { ...state, lines: moveGroup(state.lines, action.groupId, action.dir) };
    case 'set-line':
      return {
        ...state,
        lines: withTrailingBlank(
          state.lines.map((l) =>
            l.id === action.id ? { ...l, ...action.patch } : l
          )
        ),
      };
    case 'pick-machine':
      return {
        ...state,
        lines: withTrailingBlank(state.lines.map((l) =>
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
        )),
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
    materialCostCents: l.materialCostCents,
    partialUsageMilli: l.partialUsageMilli,
    laborHoursMilli: l.laborHoursMilli,
    machineTimeMilli: l.machineTimeMilli,
    designTimeMilli: l.designTimeMilli,
    installTimeMilli: l.installTimeMilli,
    vendorCostCents: l.vendorCostCents,
    catalogItemId: l.catalogItemId,
    pricingMethod: l.pricingMethod,
    pricingEngine: l.pricingEngine,
    pricingInputsSnapshotJson: l.pricingInputsSnapshotJson,
    pricingOutputSnapshotJson: l.pricingOutputSnapshotJson,
    formulaVersion: l.formulaVersion,
    selectedVendorId: l.selectedVendorId,
    selectedVendorMode: l.selectedVendorMode,
    internalNotes: l.internalNotes,
    hiddenFromCustomer: l.hiddenFromCustomer,
    customerDescription: l.customerDescription,
    markupExempt: l.markupExempt,
    lineGroupId: l.lineGroupId,
    lineGroupLabel: l.lineGroupLabel,
  }));
  const editable = !isEstimateEditorReadOnly(b.estimate.status);
  const withBlank = editable ? withTrailingBlank(lines) : lines;
  const base: EditorState = {
    title: b.estimate.title,
    estimateType: b.estimate.estimateType,
    notes: b.estimate.notes,
    multiplierMilli: b.estimate.multiplierMilli,
    designFlatCents: b.estimate.designFlatCents,
    lines: withBlank,
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
  void supportTabs;
  const [state, dispatch] = useReducer(reducer, bootstrap, initialFromBootstrap);
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
      markupExempt: l.markupExempt,
    }));
    return computeEstimate({
      multiplierMilli: state.multiplierMilli,
      designFlatCents: state.designFlatCents,
      lines,
    });
  }, [state.lines, state.multiplierMilli, state.designFlatCents]);

  // Publish live screen context for the floating assistant dock.
  useEffect(() => {
    const lines = state.lines.filter((l) => !isBlankLine(l));
    const lineList = lines
      .slice(0, 15)
      .map(
        (l, i) =>
          `${i + 1}. [${l.kind}] ${l.description || '(no description)'} — qty ${l.qtyMilli / 1000} × $${(l.unitCostCents / 100).toFixed(2)}${l.markupExempt ? ' (markup-exempt final price)' : ''}`
      )
      .join('\n');
    setAssistantContext({
      page: `Estimate ${bootstrap.estimate.number} (editor)`,
      summary: [
        `Title: ${state.title || '(empty)'}`,
        `Customer: ${bootstrap.estimate.client.companyName}`,
        `Status: ${bootstrap.estimate.status}${readOnly ? ' (read-only)' : ''}`,
        `Markup multiplier: ×${(state.multiplierMilli / 1000).toFixed(2)}`,
        `Lines (${lines.length}):`,
        lineList || '(none yet)',
        `Subtotal cost $${(computed.subtotalCostCents / 100).toFixed(2)} · estimate total $${(computed.finalPriceCents / 100).toFixed(2)}`,
      ].join('\n'),
    });
  }, [state, computed, bootstrap.estimate.number, bootstrap.estimate.client.companyName, bootstrap.estimate.status, readOnly]);

  // Accept lines proposed by the assistant — added to the grid like
  // manually typed rows; nothing persists until the operator saves.
  useEffect(() => {
    if (readOnly) {
      registerLineApplier(null);
      return () => setAssistantContext(null);
    }
    registerLineApplier((lines) => {
      for (const l of lines) {
        dispatch({
          type: 'add-line',
          kind: l.kind as EstimateLineKind,
          patch: {
            description: l.description,
            qtyMilli: Math.max(1, Math.round(l.qty * 1000)),
            unitCostCents: Math.max(0, Math.round(l.unitCostCents)),
            markupExempt: l.markupExempt,
          },
        });
      }
    });
    return () => {
      registerLineApplier(null);
      setAssistantContext(null);
    };
  }, [readOnly]);

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
      estimateType: stateRef.current.estimateType,
      multiplierMilli: stateRef.current.multiplierMilli,
      designFlatCents: stateRef.current.designFlatCents,
      // Trailing blank rows are editor scaffolding — never persist them.
      lines: stateRef.current.lines.filter((l) => !isBlankLine(l)).map((l) => ({
        id: l.id,
        kind: l.kind,
        description: l.description,
        qtyMilli: l.qtyMilli,
        unitCostCents: l.unitCostCents,
        machineId: l.machineId ?? null,
        notes: l.notes ?? null,
        materialCostCents: l.materialCostCents,
        partialUsageMilli: l.partialUsageMilli,
        laborHoursMilli: l.laborHoursMilli,
        machineTimeMilli: l.machineTimeMilli,
        designTimeMilli: l.designTimeMilli,
        installTimeMilli: l.installTimeMilli,
        vendorCostCents: l.vendorCostCents,
        catalogItemId: l.catalogItemId,
        pricingMethod: l.pricingMethod,
        pricingEngine: l.pricingEngine,
        pricingInputsSnapshotJson: l.pricingInputsSnapshotJson,
        pricingOutputSnapshotJson: l.pricingOutputSnapshotJson,
        formulaVersion: l.formulaVersion,
        selectedVendorId: l.selectedVendorId,
        selectedVendorMode: l.selectedVendorMode,
        internalNotes: l.internalNotes ?? null,
        hiddenFromCustomer: l.hiddenFromCustomer,
        customerDescription: l.customerDescription ?? null,
        lineGroupId: l.lineGroupId ?? null,
        lineGroupLabel: l.lineGroupLabel ?? null,
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

  // Publish save state to the page header, which renders the Save
  // button next to Approve / Send / Finalize. The header is a sibling
  // client component, so a module-level bridge is the only channel.
  useEffect(() => {
    publishEstimateSaveState({
      dirty,
      saving,
      readOnly,
      savedAt: saveState.savedAt ?? null,
      error: saveState.error,
      save: () => void handleSave(),
    });
    // handleSave is recreated every render but only reads refs, so the
    // published closure is always safe to call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saving, readOnly, saveState.savedAt, saveState.error]);

  useEffect(() => () => publishEstimateSaveState(null), []);

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
      } else if (r.purchaseOrderId) {
        router.push(`/purchase-orders/${r.purchaseOrderId}` as never);
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
      className="w-full bg-[radial-gradient(circle_at_top_left,rgba(242,135,68,0.16),transparent_34%),linear-gradient(135deg,#fffaf4_0%,#f8f4ef_55%,#eef5f9_100%)] px-6 pb-7"
    >
      <div className="-mx-6 border-b border-[#eadfd3] bg-[#fff4e8] shadow-[0_10px_28px_rgba(28,73,114,0.06)]">
        <EstimateContextStrip
          client={bootstrap.estimate.client}
          title={state.title}
          vehicle={bootstrap.estimateVehicle}
          readOnly={readOnly}
          dispatch={guardedDispatch}
        />
      </div>

      <div className="grid items-start gap-4 py-3 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-3">
          <LineGrid
            lines={state.lines}
            machines={bootstrap.machines}
            catalog={bootstrap.shopCatalog}
            vehicleLibrary={bootstrap.vehicleLibrary}
            vehicleWrapCatalog={bootstrap.vehicleWrapCatalog}
            lineCosts={computed.lineCosts}
            multiplierMilli={state.multiplierMilli}
            readOnly={readOnly}
            customer={bootstrap.estimate.client}
            onAnyLineFocus={setCatalogLineId}
            dispatch={guardedDispatch}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <TotalsPanel {...totalsPanelProps} variant="sidebar" />
        </div>
      </div>
    </div>
  );
}

function EstimateContextStrip({
  client,
  title,
  vehicle,
  readOnly,
  dispatch,
}: {
  client: EditorBootstrap['estimate']['client'];
  title: string;
  vehicle: EditorBootstrap['estimateVehicle'];
  readOnly: boolean;
  dispatch: React.Dispatch<Action>;
}) {
  const [editingProject, setEditingProject] = useState(false);
  const vehicleName = vehicle ? vehicleDisplayName(vehicle) : 'No vehicle';
  return (
    <section className="grid min-h-[142px] grid-cols-3 gap-10 px-6 py-6 text-[12px]">
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[#F28744]">Customer</p>
        <div className="mt-1 flex items-center gap-2">
          <p className="truncate text-[14px] font-black text-[#1C4972]">
            {client.companyName.replace(/^DEMO\s+/i, '')}
          </p>
          <Link href={`/clients/${client.id}` as never} className="text-[12px] font-black text-[#F28744]" aria-label="Open customer">
            ↗
          </Link>
        </div>
        <dl className="mt-3 grid gap-1 text-[11px] font-medium text-[#1C4972]/80">
          <ContextLine icon="♙" value={client.contactName ?? 'Main contact'} />
          <ContextLine icon="☎" value={client.phone ?? '(512) 555-0198'} />
          <ContextLine icon="✉" value={client.email ?? '—'} />
        </dl>
        <div className="mt-3 flex items-center gap-2">
          <Link
            href={`/clients/${client.id}` as never}
            className="inline-flex h-8 items-center justify-center rounded-[6px] border border-[#F28744]/30 bg-white px-3 text-[11px] font-bold text-[#1C4972] shadow-sm transition hover:bg-[#fff0e5] hover:text-[#F28744]"
          >
            Open customer
          </Link>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[#F28744]">Vehicle (Optional)</p>
        <div className="mt-1 flex items-center gap-2">
          <p className="truncate text-[14px] font-black text-[#1C4972]">{vehicleName}</p>
          {vehicle ? <span className="text-[12px] font-black text-[#F28744]">↗</span> : null}
        </div>
        <p className="mt-3 text-[11px] font-medium text-[#1C4972]/75">
          {vehicle?.coverageType ?? 'Vehicle helpers are available in the line item picker.'}
        </p>
        <p className="mt-1 text-[11px] font-medium text-[#1C4972]/75">
          {formatVehicleSqFt(vehicle?.profile?.totalApproxWrapSqFt)}
        </p>
        <p className="mt-1 text-[11px] font-medium text-[#1C4972]/75">
          {vehicle?.bodyStyle ?? vehicle?.vehicleType ?? 'Optional'}
        </p>
      </div>

      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[#F28744]">Project</p>
        {editingProject && !readOnly ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => dispatch({ type: 'set-meta', field: 'title', value: e.currentTarget.value })}
            onBlur={() => setEditingProject(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.currentTarget.blur();
              }
            }}
            className="mt-1 h-8 w-full rounded-[6px] border border-[#F28744]/40 px-2 text-[14px] font-black text-[#1C4972] outline-none ring-2 ring-[#F28744]/15"
          />
        ) : (
          <div className="mt-1 flex items-center gap-2">
            <p className="truncate text-[14px] font-black text-[#1C4972]">{title || 'Untitled project'}</p>
            <span className="text-[12px] font-black text-[#F28744]">↗</span>
          </div>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[11px]">
          <ContextMini label="Estimate date" value="Jun 22, 2026" />
          <ContextMini label="Valid until" value="Jul 22, 2026" />
        </dl>
        {!readOnly ? (
          <button
            type="button"
            onClick={() => setEditingProject(true)}
            className="mt-3 inline-flex h-8 items-center justify-center rounded-[6px] border border-[#F28744]/30 bg-white px-3 text-[11px] font-bold text-[#1C4972] shadow-sm transition hover:bg-[#fff0e5] hover:text-[#F28744]"
          >
            Edit project
          </button>
        ) : null}
      </div>
    </section>
  );
}

function ContextLine({ icon, value }: { icon: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-3 text-center text-[10px] text-slate-400">{icon}</span>
      <span className="truncate">{value}</span>
    </div>
  );
}

function ContextMini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold text-slate-500">{label}</dt>
      <dd className="mt-1 font-bold text-slate-800">{value}</dd>
    </div>
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
      <ContextCard title="Vehicle" actionLabel={vehicle ? 'Attached' : 'Optional'}>
        <p className="font-bold leading-snug text-slate-950">{vehicle ? vehicleDisplayName(vehicle) : 'No vehicle'}</p>
        <p className="mt-1 text-[11px] leading-snug text-slate-500">
          {vehicle ? `${vehicle.bodyStyle ?? vehicle.vehicleType ?? 'Vehicle'} · ${formatVehicleSqFt(vehicle.profile?.totalApproxWrapSqFt)}` : 'Estimates can stay vehicle-free.'}
        </p>
        {!readOnly ? (
          <div className="mt-3 grid gap-2">
            <SelectControl
              value={vehiclePickId}
              onChange={(e) => onVehiclePick(e.currentTarget.value)}
              searchable
              searchPlaceholder="Search vehicles..."
              className="w-full rounded-[6px] border border-slate-200 bg-white px-2 py-2 text-[11px] font-bold text-slate-700"
            >
              {vehicleLibrary.length === 0 ? <option value="">No vehicles in library</option> : null}
              {vehicleLibrary.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.year} {row.make} {row.model}{row.trim ? ` ${row.trim}` : ''}
                </option>
              ))}
            </SelectControl>
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
      <ContextCard title="Wrap Details" actionLabel="Estimator">
        <p className="text-[11px] leading-relaxed text-slate-500">
          {vehicle?.profile ? 'Wrap square footage is an estimate and can be edited in the vehicle tool.' : 'Attach a vehicle with a wrap profile to show coverage helpers.'}
        </p>
      </ContextCard>
      <ContextCard title="Internal Notes" actionLabel="Internal">
        <MetaCard title={title} notes={notes} readOnly={readOnly} dispatch={dispatch} compact />
      </ContextCard>
    </aside>
  );
}

function InternalBuildDetailsPanel({
  line,
  readOnly,
  dispatch,
}: {
  line: DraftLine | null;
  readOnly: boolean;
  dispatch: React.Dispatch<Action>;
}) {
  if (!line) {
    return (
      <SectionCard className="p-4">
        <SectionHeading icon={<IconDoc />} title="Internal build details" subtitle="Select a line to edit internal fields." />
      </SectionCard>
    );
  }
  const currentLine = line;

  function setNumberField(
    field:
      | 'materialCostCents'
      | 'partialUsageMilli'
      | 'laborHoursMilli'
      | 'machineTimeMilli'
      | 'designTimeMilli'
      | 'installTimeMilli'
      | 'vendorCostCents',
    value: string
  ) {
    const parsed = value.trim() === '' ? null : Number(value);
    dispatch({
      type: 'set-line',
      id: currentLine.id,
      patch: { [field]: Number.isFinite(parsed as number) ? Math.max(0, Math.round(parsed as number)) : null },
    });
  }

  return (
    <SectionCard className="p-4">
      <SectionHeading icon={<IconDoc />} title="Internal build details" subtitle="Internal-only fields for the focused line." />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <input disabled={readOnly} value={currentLine.materialCostCents ?? ''} onChange={(e) => setNumberField('materialCostCents', e.currentTarget.value)} placeholder="Material cost cents" className="rounded-[8px] border border-slate-200 bg-white px-2 py-2 text-[11px] font-semibold text-slate-700 disabled:bg-slate-50" />
        <input disabled={readOnly} value={currentLine.vendorCostCents ?? ''} onChange={(e) => setNumberField('vendorCostCents', e.currentTarget.value)} placeholder="Vendor cost cents" className="rounded-[8px] border border-slate-200 bg-white px-2 py-2 text-[11px] font-semibold text-slate-700 disabled:bg-slate-50" />
        <input disabled={readOnly} value={currentLine.partialUsageMilli ?? ''} onChange={(e) => setNumberField('partialUsageMilli', e.currentTarget.value)} placeholder="Partial usage milli" className="rounded-[8px] border border-slate-200 bg-white px-2 py-2 text-[11px] font-semibold text-slate-700 disabled:bg-slate-50" />
        <input disabled={readOnly} value={currentLine.laborHoursMilli ?? ''} onChange={(e) => setNumberField('laborHoursMilli', e.currentTarget.value)} placeholder="Labor hrs milli" className="rounded-[8px] border border-slate-200 bg-white px-2 py-2 text-[11px] font-semibold text-slate-700 disabled:bg-slate-50" />
        <input disabled={readOnly} value={currentLine.machineTimeMilli ?? ''} onChange={(e) => setNumberField('machineTimeMilli', e.currentTarget.value)} placeholder="Machine time milli" className="rounded-[8px] border border-slate-200 bg-white px-2 py-2 text-[11px] font-semibold text-slate-700 disabled:bg-slate-50" />
        <input disabled={readOnly} value={currentLine.designTimeMilli ?? ''} onChange={(e) => setNumberField('designTimeMilli', e.currentTarget.value)} placeholder="Design time milli" className="rounded-[8px] border border-slate-200 bg-white px-2 py-2 text-[11px] font-semibold text-slate-700 disabled:bg-slate-50" />
        <input disabled={readOnly} value={currentLine.installTimeMilli ?? ''} onChange={(e) => setNumberField('installTimeMilli', e.currentTarget.value)} placeholder="Install time milli" className="rounded-[8px] border border-slate-200 bg-white px-2 py-2 text-[11px] font-semibold text-slate-700 disabled:bg-slate-50" />
      </div>
      <textarea
        disabled={readOnly}
        value={currentLine.customerDescription ?? ''}
        onChange={(e) => dispatch({ type: 'set-line', id: currentLine.id, patch: { customerDescription: e.currentTarget.value || null } })}
        rows={2}
        placeholder="Customer-visible description"
        className="mt-2 w-full rounded-[8px] border border-slate-200 bg-white px-2 py-2 text-[11px] font-semibold text-slate-700 disabled:bg-slate-50"
      />
      <textarea
        disabled={readOnly}
        value={currentLine.internalNotes ?? ''}
        onChange={(e) => dispatch({ type: 'set-line', id: currentLine.id, patch: { internalNotes: e.currentTarget.value || null } })}
        rows={3}
        placeholder="Internal notes"
        className="mt-2 w-full rounded-[8px] border border-slate-200 bg-white px-2 py-2 text-[11px] font-semibold text-slate-700 disabled:bg-slate-50"
      />
      <label className="mt-2 inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700">
        <input
          type="checkbox"
          checked={currentLine.hiddenFromCustomer}
          disabled={readOnly}
          onChange={(e) => dispatch({ type: 'set-line', id: currentLine.id, patch: { hiddenFromCustomer: e.currentTarget.checked } })}
        />
        Hide this line from customer preview
      </label>
    </SectionCard>
  );
}

function ContextCard({
  title,
  actionLabel,
  children,
}: {
  title: string;
  actionLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[8px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-black text-slate-950">{title}</h3>
        {actionLabel ? <span className="text-[10px] font-bold text-blue-600">{actionLabel}</span> : null}
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
