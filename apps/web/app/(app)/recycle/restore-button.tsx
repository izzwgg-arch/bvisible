'use client';

import { useActionState } from 'react';
import { restoreRecordAction } from './actions';

export function RestoreButton({ entity, id }: { entity: string; id: string }) {
  const [state, action, pending] = useActionState(restoreRecordAction, { error: null });
  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--color-bv-accent)] px-3 py-1.5 text-[12px] font-bold text-white hover:opacity-95 disabled:opacity-60"
      >
        {pending ? 'Restoring…' : '↩ Restore'}
      </button>
      {state.error ? <span className="text-[10.5px] text-rose-600">{state.error}</span> : null}
    </form>
  );
}
