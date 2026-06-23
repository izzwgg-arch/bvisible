'use client';

import { useActionState, useState } from 'react';
import { createEstimateAction, type CreateEstimateState } from '../actions';
import { SelectControl } from '@/components/app/select-control';
import { FormError } from '@/components/auth/form-error';

const INITIAL: CreateEstimateState = { error: null };

interface ClientOption {
  id: string;
  companyName: string;
}

export function NewEstimateForm({
  clients,
  defaultClientId = null,
}: {
  clients: ReadonlyArray<ClientOption>;
  defaultClientId?: string | null;
}) {
  const [state, formAction, pending] = useActionState(createEstimateAction, INITIAL);
  const initialClientId =
    defaultClientId && clients.some((client) => client.id === defaultClientId)
      ? defaultClientId
      : '';
  const [selectedClientId, setSelectedClientId] = useState(initialClientId);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">
          Client <span className="text-rose-600">*</span>
        </span>
        <SelectControl
          name="clientId"
          required
          value={selectedClientId}
          onChange={(event) => setSelectedClientId(event.currentTarget.value)}
          searchable
          searchPlaceholder="Search all clients..."
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
        >
          <option value="" disabled>
            Select client…
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.companyName}
            </option>
          ))}
        </SelectControl>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">
          Job title <span className="text-rose-600">*</span>
        </span>
        <input
          name="title"
          type="text"
          required
          maxLength={160}
          autoComplete="off"
          placeholder="e.g. Storefront channel letters — east elevation"
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">
          Estimate type <span className="text-rose-600">*</span>
        </span>
        <SelectControl
          name="estimateType"
          required
          defaultValue="CUSTOM"
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
        >
          <option value="CUSTOM">Custom estimate</option>
          <option value="STOCK_ITEM">Stock item estimate</option>
          <option value="SQUARE_FOOTAGE">Square footage estimate</option>
        </SelectControl>
      </label>
      <FormError message={state.error} />
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[14px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create & add lines'}
        </button>
      </div>
    </form>
  );
}
