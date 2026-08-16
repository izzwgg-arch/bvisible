'use client';

// Editor for the default CC list on purchase-order emails.
//
// One row per recipient with its own Remove button, because that is how the
// owner thinks about it ("take Lisa off POs"), rather than a comma-separated
// blob that has to be re-parsed by eye. An empty list is a first-class,
// savable state — it means the vendor is the only recipient.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { savePoCcRecipientsAction } from './actions';
import { FormError, FormNotice } from '@/components/auth/form-error';
import {
  adminInputClass,
  adminPrimaryButtonClass,
  adminSecondaryButtonClass,
} from '@/components/app/admin-ui';
import { isValidCcEmail, PO_CC_MAX_RECIPIENTS } from '@/lib/emails/po-cc-list';

interface Row {
  /// Stable key so React does not reuse an input's DOM node (and its focus /
  /// selection) for a different recipient after a removal.
  key: string;
  value: string;
}

let nextKey = 0;
function makeRow(value = ''): Row {
  nextKey += 1;
  return { key: `cc-${nextKey}`, value };
}

export function PoCcForm({ initialEmails }: { initialEmails: ReadonlyArray<string> }) {
  const router = useRouter();
  const [isSaving, startSave] = useTransition();

  const [rows, setRows] = useState<Row[]>(() =>
    initialEmails.length > 0 ? initialEmails.map((e) => makeRow(e)) : [makeRow()]
  );
  const [savedEmails, setSavedEmails] = useState<ReadonlyArray<string>>(initialEmails);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  function mutate(next: Row[]) {
    setRows(next);
    setError(null);
    setSavedNotice(null);
  }

  function updateRow(key: string, value: string) {
    mutate(rows.map((r) => (r.key === key ? { ...r, value } : r)));
  }

  function removeRow(key: string) {
    const next = rows.filter((r) => r.key !== key);
    // Always leave one field on screen — an empty card gives the operator
    // nothing to type into.
    mutate(next.length > 0 ? next : [makeRow()]);
  }

  function addRow() {
    mutate([...rows, makeRow()]);
  }

  function clearAll() {
    mutate([makeRow()]);
  }

  const filled = rows.map((r) => r.value.trim()).filter((v) => v.length > 0);
  const badRows = rows.filter((r) => r.value.trim().length > 0 && !isValidCcEmail(r.value));
  const pendingList = filled.length > 0 ? filled.join(', ') : 'nobody — the vendor only';

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSavedNotice(null);
    startSave(async () => {
      // Blank rows are dropped rather than rejected: leaving the last field
      // empty is how the operator says "no CC at all".
      const r = await savePoCcRecipientsAction({ emails: filled });
      if (!r.ok) {
        setError(r.error ?? 'Save failed.');
        return;
      }
      setSavedEmails(r.emails);
      setRows(r.emails.length > 0 ? r.emails.map((v) => makeRow(v)) : [makeRow()]);
      setSavedNotice(
        r.emails.length > 0
          ? `Saved. ${r.emails.length} recipient${r.emails.length === 1 ? '' : 's'} will be CC'd on purchase-order emails.`
          : 'Saved. Purchase orders now go to the vendor only — nobody is CC’d.'
      );
      router.refresh();
    });
  }

  return (
    <form onSubmit={save} className="grid gap-4">
      <div className="grid gap-2">
        {rows.map((row, idx) => {
          const invalid = row.value.trim().length > 0 && !isValidCcEmail(row.value);
          return (
            <div key={row.key} className="flex items-start gap-2">
              <div className="flex-1">
                <label htmlFor={row.key} className="sr-only">
                  CC recipient {idx + 1}
                </label>
                <input
                  id={row.key}
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  spellCheck={false}
                  value={row.value}
                  onChange={(e) => updateRow(row.key, e.target.value)}
                  placeholder="name@company.com"
                  aria-invalid={invalid}
                  className={`${adminInputClass} w-full ${invalid ? 'border-rose-300 bg-rose-50/60' : ''}`}
                />
                {invalid ? (
                  <p className="mt-1 text-[11.5px] font-semibold text-rose-600">
                    Not a valid email address.
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => removeRow(row.key)}
                aria-label={`Remove ${row.value.trim() || `recipient ${idx + 1}`}`}
                className="mt-1 inline-flex h-12 items-center rounded-[12px] border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-600 transition-all hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={addRow}
          disabled={rows.length >= PO_CC_MAX_RECIPIENTS}
          className={adminSecondaryButtonClass}
        >
          Add recipient
        </button>
        {filled.length > 0 ? (
          <button type="button" onClick={clearAll} className={adminSecondaryButtonClass}>
            Remove all
          </button>
        ) : null}
      </div>

      <div className="rounded-[14px] border border-slate-200 bg-slate-50/70 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Every purchase-order email will copy
        </p>
        <p className="mt-1 break-words text-[13px] font-semibold text-slate-800">{pendingList}</p>
        <p className="mt-1 text-[11.5px] leading-snug text-slate-500">
          Applies to purchase orders only. Estimates and other documents are unaffected. You can
          still change the CC list for one individual email on the Send PO screen.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
        <button type="submit" disabled={isSaving || badRows.length > 0} className={adminPrimaryButtonClass}>
          {isSaving ? 'Saving…' : 'Save CC list'}
        </button>
        <span className="text-[11.5px] text-slate-500">
          {savedEmails.length > 0
            ? `Currently saved: ${savedEmails.join(', ')}`
            : 'Currently saved: no CC recipients.'}
        </span>
      </div>

      {error ? <FormError message={error} /> : null}
      {savedNotice ? <FormNotice tone="success">{savedNotice}</FormNotice> : null}
    </form>
  );
}
