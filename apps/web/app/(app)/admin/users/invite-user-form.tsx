'use client';

import { useActionState } from 'react';
import { Role } from '@bvisible/db';
import { inviteUserAction, type InviteUserState } from './actions';
import { FormError } from '@/components/auth/form-error';

const INITIAL: InviteUserState = { error: null };

export function InviteUserForm({ canChooseAdmin }: { canChooseAdmin: boolean }) {
  const [state, formAction, pending] = useActionState(inviteUserAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="off"
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">Role</span>
        <select
          name="role"
          defaultValue={Role.USER}
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
        >
          <option value={Role.USER}>User</option>
          {canChooseAdmin ? <option value={Role.ADMIN}>Admin</option> : null}
        </select>
      </label>
      <FormError message={state.error} />
      <button
        type="submit"
        disabled={pending}
        className="mt-1 self-start inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[14px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Creating invite…' : 'Create invite'}
      </button>
    </form>
  );
}
