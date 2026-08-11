'use client';

// Save control in the estimate page header, sitting with Approve /
// Send / Finalize. It mirrors the editor's state through the save
// bridge and is always visible while the editor is mounted, so there
// is never a moment where the operator cannot find how to save.

import { useSyncExternalStore } from 'react';
import {
  getEstimateSaveState,
  getEstimateSaveStateServer,
  subscribeEstimateSaveState,
} from '@/lib/estimate/estimate-save-bridge';

export function EstimateSaveButton() {
  const state = useSyncExternalStore(
    subscribeEstimateSaveState,
    getEstimateSaveState,
    getEstimateSaveStateServer,
  );

  // No editor mounted (finalized view), or editing is blocked.
  if (!state.present || state.readOnly) return null;

  const label = state.saving ? 'Saving…' : state.dirty ? 'Save changes' : 'Saved';
  const canSave = state.dirty && !state.saving;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => state.save?.()}
        disabled={!canSave}
        title={canSave ? 'Save this estimate (Ctrl+S)' : 'No unsaved changes'}
        aria-label={canSave ? 'Save changes' : 'No unsaved changes'}
        className={`inline-flex items-center gap-1.5 rounded-[9px] px-3.5 py-2 text-[12px] font-bold transition ${
          canSave
            ? 'bg-blue-600 text-white shadow-sm hover:bg-blue-500'
            : 'cursor-default border border-slate-200 bg-white text-slate-400'
        }`}
      >
        {!state.dirty && !state.saving ? <span aria-hidden="true">✓</span> : null}
        {label}
      </button>
      {state.error ? (
        <span className="max-w-[220px] text-right text-[10px] font-semibold leading-tight text-rose-700">
          {state.error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Replaces the header's old hardcoded "Auto-saved just now" caption.
 * There is no autosave — this reports what is actually true.
 */
export function EstimateSaveStatus() {
  const state = useSyncExternalStore(
    subscribeEstimateSaveState,
    getEstimateSaveState,
    getEstimateSaveStateServer,
  );

  if (!state.present || state.readOnly) return null;

  const { tone, text } = state.saving
    ? { tone: 'bg-blue-500', text: 'Saving…' }
    : state.error
      ? { tone: 'bg-rose-500', text: 'Not saved' }
      : state.dirty
        ? { tone: 'bg-amber-500', text: 'Unsaved\nchanges' }
        : state.savedAt
          ? { tone: 'bg-emerald-500', text: 'Saved' }
          : { tone: 'bg-slate-300', text: 'No changes\nyet' };

  return (
    <span className="inline-flex items-start gap-1.5 text-[11px] font-semibold leading-tight text-slate-500">
      <span className={`mt-0.5 h-2 w-2 rounded-full ${tone}`} />
      <span className="whitespace-pre-line">{text}</span>
    </span>
  );
}
