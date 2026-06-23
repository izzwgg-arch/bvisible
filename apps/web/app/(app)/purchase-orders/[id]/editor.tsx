'use client';

import { startTransition, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  POAttachmentKind,
  POEventKind,
  POLineKind,
  POStatus,
} from '@bvisible/db';
import {
  deletePurchaseOrderAction,
  savePurchaseOrderAction,
  updatePoStatusAction,
  type SavePoState,
} from './actions';
import { PoLineGrid } from './line-grid';
import { PoMetaPanel } from './meta-panel';
import { PoTimelinePanel } from './timeline-panel';
import { PoAttachmentsPanel } from './attachments-panel';
import type { SavePurchaseOrderInput } from '@/lib/validators';

// ---------------------------------------------------------------------
// Bootstrap shape (everything the editor needs from the server).
// ---------------------------------------------------------------------

export interface PoEditorBootstrap {
  po: {
    id: string;
    number: string;
    status: POStatus;
    qboPoNumber: string | null;
    notes: string;
    subtotalCents: number;
    updatedAt: string;
    vendor: { id: string; name: string } | null;
    estimate: { id: string; number: string; title: string } | null;
    createdByLabel: string;
  };
  lines: ReadonlyArray<{
    id: string;
    kind: POLineKind;
    description: string;
    qtyMilli: number;
    unitCostCents: number;
    notes: string | null;
  }>;
  vendors: ReadonlyArray<{ id: string; name: string }>;
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
  canDelete: boolean;
}

export interface PoDraftLine {
  id: string;
  kind: POLineKind;
  description: string;
  qtyMilli: number;
  unitCostCents: number;
  notes: string | null;
}

interface EditorState {
  notes: string;
  lines: PoDraftLine[];
  baselineHash: string;
}

export type PoEditorAction =
  | { type: 'set-notes'; value: string }
  | { type: 'add-line'; kind: POLineKind }
  | { type: 'remove-line'; id: string }
  | { type: 'move-line'; id: string; dir: -1 | 1 }
  | { type: 'set-line'; id: string; patch: Partial<PoDraftLine> }
  | { type: 'reset-baseline'; hash: string };

function localId(): string {
  return `tmp-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultDescription(kind: POLineKind): string {
  switch (kind) {
    case POLineKind.MATERIAL:
      return 'Material';
    case POLineKind.MACHINE:
      return 'Machine time';
    case POLineKind.LABOR:
      return 'Labor';
    case POLineKind.DESIGN:
      return 'Design';
    case POLineKind.INSTALL:
      return 'Install';
    case POLineKind.MISC:
      return 'Misc';
  }
}

function snapshot(s: EditorState): string {
  return JSON.stringify({
    n: s.notes,
    l: s.lines.map((l) => [
      l.id,
      l.kind,
      l.description,
      l.qtyMilli,
      l.unitCostCents,
      l.notes,
    ]),
  });
}

function reducer(state: EditorState, action: PoEditorAction): EditorState {
  switch (action.type) {
    case 'set-notes':
      return { ...state, notes: action.value };
    case 'add-line': {
      const newLine: PoDraftLine = {
        id: localId(),
        kind: action.kind,
        description: defaultDescription(action.kind),
        qtyMilli: 1000,
        unitCostCents: 0,
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
    case 'reset-baseline':
      return { ...state, baselineHash: action.hash };
  }
}

function initialFromBootstrap(b: PoEditorBootstrap): EditorState {
  const lines: PoDraftLine[] = b.lines.map((l) => ({
    id: l.id,
    kind: l.kind,
    description: l.description,
    qtyMilli: l.qtyMilli,
    unitCostCents: l.unitCostCents,
    notes: l.notes,
  }));
  const base: EditorState = { notes: b.po.notes, lines, baselineHash: '' };
  base.baselineHash = snapshot(base);
  return base;
}

function lineCost(qtyMilli: number, unitCostCents: number): number {
  return Math.round((qtyMilli * unitCostCents) / 1000);
}

export function PoEditor({ bootstrap }: { bootstrap: PoEditorBootstrap }) {
  const [state, dispatch] = useReducer(reducer, bootstrap, initialFromBootstrap);
  const [saveState, setSaveState] = useState<SavePoState>({ error: null });
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  const dirty = useMemo(() => snapshot(state) !== state.baselineHash, [state]);

  const lineCosts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const l of state.lines) out[l.id] = lineCost(l.qtyMilli, l.unitCostCents);
    return out;
  }, [state.lines]);

  const subtotalCents = useMemo(
    () => Object.values(lineCosts).reduce((a, b) => a + b, 0),
    [lineCosts]
  );

  const stateRef = useRef(state);
  stateRef.current = state;

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaveState({ error: null });
    const snapBefore = snapshot(stateRef.current);
    const payload: SavePurchaseOrderInput = {
      purchaseOrderId: bootstrap.po.id,
      notes: stateRef.current.notes ?? null,
      lines: stateRef.current.lines.map((l) => ({
        id: l.id,
        kind: l.kind,
        description: l.description,
        estimateLineId: null,
        catalogItemId: null,
        bundleComponentId: null,
        vendorId: bootstrap.po.vendor?.id ?? null,
        selectedVendorMode: null,
        vendorSku: null,
        unit: 'EACH',
        qtyMilli: l.qtyMilli,
        unitCostCents: l.unitCostCents,
        receivedQtyMilli: 0,
        notes: l.notes ?? null,
      })),
    };
    try {
      const result = await savePurchaseOrderAction({ error: null }, payload);
      setSaveState(result);
      if (!result.error) {
        dispatch({ type: 'reset-baseline', hash: snapBefore });
        startTransition(() => router.refresh());
      }
    } catch (err) {
      setSaveState({
        error: err instanceof Error ? err.message : 'Save failed. Try again.',
      });
    } finally {
      setSaving(false);
    }
  }

  // Same Cmd/Ctrl+S helper as the estimate editor — keystroke is bound
  // to the editor root, not window, so it only fires when an editor
  // input has focus.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSave();
      }
    }
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStatusChange(next: POStatus) {
    if (statusBusy) return;
    setStatusBusy(true);
    try {
      const r = await updatePoStatusAction({
        purchaseOrderId: bootstrap.po.id,
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
    if (
      !window.confirm(
        'Delete this PO? It will be hidden from the list. This is reversible only by support.'
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      await deletePurchaseOrderAction(bootstrap.po.id);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div ref={rootRef} className="mt-4 grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="flex flex-col gap-3">
        <PoLineGrid
          lines={state.lines}
          lineCosts={lineCosts}
          dispatch={dispatch}
        />
        <PoAttachmentsPanel
          purchaseOrderId={bootstrap.po.id}
          attachments={bootstrap.attachments}
        />
        <PoNotesCard notes={state.notes} dispatch={dispatch} />
        <PoTimelinePanel
          purchaseOrderId={bootstrap.po.id}
          events={bootstrap.events}
        />
      </div>

      <PoMetaPanel
        bootstrap={bootstrap}
        subtotalCents={subtotalCents}
        dirty={dirty}
        saving={saving}
        statusBusy={statusBusy}
        deleting={deleting}
        saveState={saveState}
        onSave={handleSave}
        onStatusChange={handleStatusChange}
        onDelete={bootstrap.canDelete ? handleDelete : null}
      />
    </div>
  );
}

function PoNotesCard({
  notes,
  dispatch,
}: {
  notes: string;
  dispatch: React.Dispatch<PoEditorAction>;
}) {
  return (
    <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-4 shadow-[var(--shadow-bv-card)]">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-bv-muted)]">
          Internal notes
        </span>
        <textarea
          value={notes}
          onChange={(e) =>
            dispatch({ type: 'set-notes', value: e.currentTarget.value })
          }
          rows={2}
          maxLength={4000}
          placeholder="Optional context for this PO."
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13.5px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
        />
      </label>
    </section>
  );
}
