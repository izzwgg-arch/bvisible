'use client';

// Debounced, versioned autosave for the bid workflow.
//
//   * patches are merged and flushed after DEBOUNCE_MS of quiet (never per
//     keystroke); flush() sends immediately (step change, "Save and continue");
//   * one request in flight at a time; a save that finishes late cannot
//     overwrite a newer edit because the pending patch is re-sent afterwards
//     and each response carries the server version we continue from;
//   * a stale expectedVersion (someone else saved) → `conflict` — the form
//     stays usable, the user is told to reload; nothing is silently overwritten;
//   * transient failures retry twice with backoff, then surface "Save failed"
//     with a Retry button; the browser warns before unload while unsaved.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BidWorkflowPatch, SaveWorkflowResult } from '@/lib/bid/workflow';

export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'failed' | 'conflict';

const DEBOUNCE_MS = 900;
const RETRY_DELAYS_MS = [1200, 3500];

export interface BidAutosave {
  status: AutosaveStatus;
  error: string | null;
  lastSavedAt: string | null;
  version: number;
  queue: (patch: BidWorkflowPatch) => void;
  flush: () => Promise<boolean>;
  retry: () => void;
  /**
   * Adopt a newer version that THIS user's own server-side save produced
   * (saving design, installation, or an office answer bumps the row).
   * Without this the next autosave would report a false "changed
   * elsewhere" conflict against the user's own change.
   */
  adoptVersion: (version: number, savedAt: string | null) => void;
  isDirty: boolean;
}

export function useBidAutosave(args: {
  estimateId: string;
  initialVersion: number;
  initialSavedAt: string | null;
  disabled: boolean;
  save: (payload: { estimateId: string; expectedVersion: number; patch: BidWorkflowPatch }) => Promise<SaveWorkflowResult>;
}): BidAutosave {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(args.initialSavedAt);
  const versionRef = useRef(args.initialVersion);
  const pendingRef = useRef<BidWorkflowPatch | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const attemptRef = useRef(0);
  const [version, setVersion] = useState(args.initialVersion);
  const saveFn = args.save;
  const disabled = args.disabled;
  const estimateId = args.estimateId;

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const send = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current) return inFlightRef.current;
    const patch = pendingRef.current;
    if (!patch) return true;
    pendingRef.current = null;
    setStatus('saving');
    const run = (async () => {
      try {
        const result = await saveFn({ estimateId, expectedVersion: versionRef.current, patch });
        if (result.ok) {
          versionRef.current = result.version;
          setVersion(result.version);
          setLastSavedAt(result.savedAt);
          setError(null);
          attemptRef.current = 0;
          setStatus(pendingRef.current ? 'dirty' : 'saved');
          return true;
        }
        if (result.conflict) {
          // Keep the unsent edits in memory so nothing typed is lost; the
          // user reloads to see the newer state before saving again.
          pendingRef.current = { ...patch, ...(pendingRef.current ?? {}) };
          setError(result.error);
          setStatus('conflict');
          return false;
        }
        pendingRef.current = { ...patch, ...(pendingRef.current ?? {}) };
        setError(result.error);
        setStatus('failed');
        return false;
      } catch (err) {
        pendingRef.current = { ...patch, ...(pendingRef.current ?? {}) };
        setError(err instanceof Error ? err.message : 'Save failed.');
        setStatus('failed');
        return false;
      } finally {
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = run;
    const ok = await run;
    if (ok && pendingRef.current) {
      // Edits arrived while saving — send them now, continuing from the new version.
      return send();
    }
    if (!ok && status !== 'conflict') {
      const delay = RETRY_DELAYS_MS[attemptRef.current];
      if (delay !== undefined) {
        attemptRef.current += 1;
        clearTimer();
        timerRef.current = setTimeout(() => void send(), delay);
      }
    }
    return ok;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFn, estimateId]);

  const queue = useCallback(
    (patch: BidWorkflowPatch) => {
      if (disabled) return;
      pendingRef.current = { ...(pendingRef.current ?? {}), ...patch };
      setStatus((s) => (s === 'conflict' ? 'conflict' : 'dirty'));
      clearTimer();
      timerRef.current = setTimeout(() => void send(), DEBOUNCE_MS);
    },
    [disabled, send]
  );

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimer();
    if (inFlightRef.current) {
      await inFlightRef.current;
    }
    if (!pendingRef.current) return status !== 'failed' && status !== 'conflict';
    return send();
  }, [send, status]);

  const adoptVersion = useCallback((version: number, savedAt: string | null) => {
    if (version <= versionRef.current) return;
    versionRef.current = version;
    setVersion(version);
    if (savedAt) setLastSavedAt(savedAt);
    setStatus((s) => (s === 'conflict' ? 'dirty' : s));
  }, []);

  const retry = useCallback(() => {
    attemptRef.current = 0;
    clearTimer();
    void send();
  }, [send]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pendingRef.current || status === 'saving' || status === 'failed' || status === 'conflict') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [status]);

  useEffect(() => () => clearTimer(), []);

  return useMemo(
    () => ({ status, error, lastSavedAt, version, queue, flush, retry, adoptVersion, isDirty: status === 'dirty' || status === 'saving' || status === 'failed' || status === 'conflict' }),
    [status, error, lastSavedAt, version, queue, flush, retry, adoptVersion]
  );
}
