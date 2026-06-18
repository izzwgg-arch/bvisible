'use client';

import { useActionState } from 'react';
import { Role } from '@bvisible/db';
import { inviteUserAction, type InviteUserState } from './actions';
import { SelectControl } from '@/components/app/select-control';
import { FormError } from '@/components/auth/form-error';
import { adminInputClass, adminPrimaryButtonClass } from '@/components/app/admin-ui';

const INITIAL: InviteUserState = { error: null };

export function InviteUserForm({ canChooseAdmin }: { canChooseAdmin: boolean }) {
  const [state, formAction, pending] = useActionState(inviteUserAction, INITIAL);

  return (
    <form action={formAction} className="grid gap-4">
      <label className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="off"
          placeholder="operator@company.com"
          className={adminInputClass}
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Role</span>
        <SelectControl
          name="role"
          defaultValue={Role.USER}
          className={adminInputClass}
        >
          <option value={Role.USER}>User</option>
          {canChooseAdmin ? <option value={Role.ADMIN}>Admin</option> : null}
        </SelectControl>
      </label>
      <FormError message={state.error} />
      <button
        type="submit"
        disabled={pending}
        className={adminPrimaryButtonClass}
      >
        {pending ? 'Creating invite…' : 'Create invite'}
      </button>
    </form>
  );
}
