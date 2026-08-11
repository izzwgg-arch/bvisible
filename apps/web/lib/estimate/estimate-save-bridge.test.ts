import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getEstimateSaveState,
  publishEstimateSaveState,
  subscribeEstimateSaveState,
} from '@/lib/estimate/estimate-save-bridge';

const base = {
  dirty: false,
  saving: false,
  readOnly: false,
  savedAt: null,
  error: null,
  save: null,
};

describe('estimate save bridge', () => {
  beforeEach(() => {
    publishEstimateSaveState(null);
  });

  it('reports no editor mounted until one publishes', () => {
    expect(getEstimateSaveState().present).toBe(false);
  });

  it('exposes the editor state to the header', () => {
    const save = vi.fn();
    publishEstimateSaveState({ ...base, dirty: true, save });

    const state = getEstimateSaveState();
    expect(state.present).toBe(true);
    expect(state.dirty).toBe(true);

    state.save?.();
    expect(save).toHaveBeenCalledOnce();
  });

  it('notifies subscribers when the dirty flag flips', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeEstimateSaveState(listener);

    publishEstimateSaveState({ ...base, dirty: true });
    expect(listener).toHaveBeenCalledTimes(1);

    publishEstimateSaveState({ ...base, dirty: false });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    publishEstimateSaveState({ ...base, dirty: true });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not notify when nothing changed', () => {
    // The editor republishes on every render; useSyncExternalStore
    // compares by reference, so an unchanged republish must be a no-op
    // or the header would re-render in a loop.
    const save = vi.fn();
    publishEstimateSaveState({ ...base, dirty: true, save });

    const listener = vi.fn();
    subscribeEstimateSaveState(listener);
    const first = getEstimateSaveState();

    publishEstimateSaveState({ ...base, dirty: true, save });

    expect(listener).not.toHaveBeenCalled();
    expect(getEstimateSaveState()).toBe(first);
  });

  it('clears back to idle when the editor unmounts', () => {
    publishEstimateSaveState({ ...base, dirty: true, save: vi.fn() });
    publishEstimateSaveState(null);

    const state = getEstimateSaveState();
    expect(state.present).toBe(false);
    expect(state.dirty).toBe(false);
    expect(state.save).toBeNull();
  });

  it('carries the error through so the header can surface a failed save', () => {
    publishEstimateSaveState({ ...base, error: 'Estimate is finalized.' });
    expect(getEstimateSaveState().error).toBe('Estimate is finalized.');
  });
});
