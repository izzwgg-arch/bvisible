'use client';

// Connects the estimate editor's save state to the page header.
//
// The header action bar (Approve / Send / Finalize) is a
// sibling client component of the editor, rendered by the server page,
// so it cannot reach the editor's reducer through React. The editor
// publishes its save state here and the header subscribes, which puts
// Save next to the other estimate actions where the operator expects
// it — previously the only save affordance was Cmd/Ctrl+S, because the
// button lived in a TotalsPanel variant the editor no longer renders.
//
// State lives on globalThis for the same reason as the assistant store:
// the header and the editor can end up in separate client bundles, and
// a plain module-level variable would silently split into two stores.

export interface EstimateSaveState {
  /// False when no editor is mounted (finalized view, other pages).
  present: boolean;
  /// True when the editor holds unsaved changes.
  dirty: boolean;
  saving: boolean;
  /// Editing is blocked (finalized estimate).
  readOnly: boolean;
  /// Date.now() of the last successful save in this session, if any.
  savedAt: number | null;
  error: string | null;
  save: (() => void) | null;
}

type Listener = () => void;

interface StoreState {
  value: EstimateSaveState;
  listeners: Set<Listener>;
}

export const IDLE_SAVE_STATE: EstimateSaveState = {
  present: false,
  dirty: false,
  saving: false,
  readOnly: false,
  savedAt: null,
  error: null,
  save: null,
};

const globalKey = '__bvEstimateSaveStore';
const holder = globalThis as unknown as Record<string, StoreState | undefined>;
const store: StoreState =
  holder[globalKey] ?? (holder[globalKey] = { value: IDLE_SAVE_STATE, listeners: new Set() });

function emit() {
  for (const listener of store.listeners) listener();
}

/** Editor → bridge. Pass null on unmount so the header stops showing a button. */
export function publishEstimateSaveState(next: Omit<EstimateSaveState, 'present'> | null) {
  const value: EstimateSaveState = next ? { ...next, present: true } : IDLE_SAVE_STATE;
  const prev = store.value;
  // useSyncExternalStore compares by reference, so only publish when
  // something actually changed — the editor republishes on every render.
  if (
    prev.present === value.present &&
    prev.dirty === value.dirty &&
    prev.saving === value.saving &&
    prev.readOnly === value.readOnly &&
    prev.savedAt === value.savedAt &&
    prev.error === value.error &&
    prev.save === value.save
  ) {
    return;
  }
  store.value = value;
  emit();
}

export function getEstimateSaveState(): EstimateSaveState {
  return store.value;
}

/** Server snapshot: no editor is mounted during SSR. */
export function getEstimateSaveStateServer(): EstimateSaveState {
  return IDLE_SAVE_STATE;
}

export function subscribeEstimateSaveState(cb: Listener): () => void {
  store.listeners.add(cb);
  return () => store.listeners.delete(cb);
}
