'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveTenantInboxAction,
  deleteTenantInboxAction,
  testInboxConnectionAction,
} from './actions';
import { FormError, FormNotice } from '@/components/auth/form-error';
import {
  adminInputClass,
  adminPrimaryButtonClass,
  adminSecondaryButtonClass,
} from '@/components/app/admin-ui';

// Default-form values used both on create and on edit. On edit, the
// `existing` row hydrates them. The password field is ALWAYS empty on
// initial render — we never echo a stored password back to the
// browser, even via defaultValue.
interface FormValues {
  host: string;
  port: number;
  secure: boolean;
  mailbox: string;
  username: string;
  password: string;
  pollIntervalSeconds: number;
  enabled: boolean;
}

interface ExistingHydration {
  host: string;
  port: number;
  secure: boolean;
  mailbox: string;
  username: string;
  pollIntervalSeconds: number;
  enabled: boolean;
}

interface TestPanelState {
  open: boolean;
  loading: boolean;
  ok: boolean | null;
  message: string | null;
  durationMs: number | null;
  mailboxCount: number | null;
}

const DEFAULT_NEW: FormValues = {
  host: 'imap.gmail.com',
  port: 993,
  secure: true,
  mailbox: 'INBOX',
  username: '',
  password: '',
  pollIntervalSeconds: 60,
  enabled: true,
};

export function InboxForm({
  tenantId,
  existing,
}: {
  tenantId: string;
  existing: ExistingHydration | null;
}) {
  const router = useRouter();
  const [isSaving, startSaveTransition] = useTransition();
  const [isTesting, startTestTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  const [values, setValues] = useState<FormValues>(() => ({
    host: existing?.host ?? DEFAULT_NEW.host,
    port: existing?.port ?? DEFAULT_NEW.port,
    secure: existing?.secure ?? DEFAULT_NEW.secure,
    mailbox: existing?.mailbox ?? DEFAULT_NEW.mailbox,
    username: existing?.username ?? DEFAULT_NEW.username,
    password: '',
    pollIntervalSeconds:
      existing?.pollIntervalSeconds ?? DEFAULT_NEW.pollIntervalSeconds,
    enabled: existing?.enabled ?? DEFAULT_NEW.enabled,
  }));

  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<boolean>(false);
  const [test, setTest] = useState<TestPanelState>({
    open: false,
    loading: false,
    ok: null,
    message: null,
    durationMs: null,
    mailboxCount: null,
  });

  function update<K extends keyof FormValues>(key: K, v: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: v }));
    if (saveOk) setSaveOk(false);
    if (saveError) setSaveError(null);
  }

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaveError(null);
    setSaveOk(false);
    startSaveTransition(async () => {
      const r = await saveTenantInboxAction({
        tenantId,
        host: values.host,
        port: values.port,
        secure: values.secure,
        mailbox: values.mailbox,
        username: values.username,
        password: values.password ? values.password : undefined,
        pollIntervalSeconds: values.pollIntervalSeconds,
        enabled: values.enabled,
      });
      if (!r.ok) {
        setSaveError(r.error ?? 'Save failed.');
        return;
      }
      // Wipe the password field after a successful save so a refresh
      // doesn't leave it in the DOM. The server keeps the sealed
      // cipher; we never round-trip the plaintext back.
      setValues((p) => ({ ...p, password: '' }));
      setSaveOk(true);
      router.refresh();
    });
  }

  function onTest() {
    setTest({
      open: true,
      loading: true,
      ok: null,
      message: null,
      durationMs: null,
      mailboxCount: null,
    });
    startTestTransition(async () => {
      const r = await testInboxConnectionAction({
        tenantId,
        host: values.host,
        port: values.port,
        secure: values.secure,
        mailbox: values.mailbox,
        username: values.username,
        password: values.password ? values.password : undefined,
      });
      if (!r.ok || !r.result) {
        setTest({
          open: true,
          loading: false,
          ok: false,
          message: r.error ?? 'Test failed.',
          durationMs: null,
          mailboxCount: null,
        });
        return;
      }
      const res = r.result;
      if (res.ok) {
        setTest({
          open: true,
          loading: false,
          ok: true,
          message: `Connected. ${res.mailboxCount} mailbox${res.mailboxCount === 1 ? '' : 'es'} visible. Selected mailbox "${res.mailbox}" exists.`,
          durationMs: res.durationMs,
          mailboxCount: res.mailboxCount,
        });
      } else {
        setTest({
          open: true,
          loading: false,
          ok: false,
          message: res.message,
          durationMs: res.durationMs,
          mailboxCount: null,
        });
      }
    });
  }

  function onDelete() {
    if (
      !confirm(
        'Delete this inbox? The tenant will stop receiving vendor email until a new inbox is configured.'
      )
    ) {
      return;
    }
    startDeleteTransition(async () => {
      const r = await deleteTenantInboxAction({ tenantId });
      if (!r.ok) {
        setSaveError(r.error ?? 'Delete failed.');
        return;
      }
      router.refresh();
    });
  }

  const submitting = isSaving || isTesting || isDeleting;

  return (
    <form onSubmit={onSave} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="IMAP host"
          htmlFor="host"
          hint="e.g. imap.gmail.com"
        >
          <input
            id="host"
            name="host"
            type="text"
            required
            value={values.host}
            onChange={(e) => update('host', e.target.value)}
            className={inputCls}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label="Port" htmlFor="port" hint="993 (TLS) or 143 (STARTTLS)">
          <input
            id="port"
            name="port"
            type="number"
            min={1}
            max={65535}
            required
            value={values.port}
            onChange={(e) =>
              update('port', Number.parseInt(e.target.value || '0', 10) || 0)
            }
            className={inputCls}
          />
        </Field>
      </div>

      <Field
        label="Mailbox / folder"
        htmlFor="mailbox"
        hint="The folder to scan. Most providers use INBOX."
      >
        <input
          id="mailbox"
          name="mailbox"
          type="text"
          required
          value={values.mailbox}
          onChange={(e) => update('mailbox', e.target.value)}
          className={inputCls}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>

      <Field label="Username" htmlFor="username">
        <input
          id="username"
          name="username"
          type="text"
          required
          value={values.username}
          onChange={(e) => update('username', e.target.value)}
          className={inputCls}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        hint={
          existing
            ? 'Leave blank to keep the existing password. Type a new value to rotate.'
            : 'Required on first setup. The plaintext is encrypted before it lands in the database.'
        }
      >
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={values.password}
          onChange={(e) => update('password', e.target.value)}
          placeholder={existing ? '•••••••• (configured)' : 'paste IMAP password'}
          className={inputCls}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Poll interval (seconds)"
          htmlFor="pollIntervalSeconds"
          hint="30–3600. Server tick fires every minute, then sleeps until this elapses."
        >
          <input
            id="pollIntervalSeconds"
            name="pollIntervalSeconds"
            type="number"
            min={30}
            max={3600}
            required
            value={values.pollIntervalSeconds}
            onChange={(e) =>
              update(
                'pollIntervalSeconds',
                Number.parseInt(e.target.value || '0', 10) || 0
              )
            }
            className={inputCls}
          />
        </Field>

        <div className="flex flex-col justify-end gap-2 pb-1">
          <Toggle
            id="secure"
            label="Use TLS (recommended)"
            checked={values.secure}
            onChange={(v) => update('secure', v)}
          />
          <Toggle
            id="enabled"
            label="Enabled"
            checked={values.enabled}
            onChange={(v) => update('enabled', v)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-5">
        <button
          type="submit"
          disabled={submitting}
          className={adminPrimaryButtonClass}
        >
          {isSaving ? 'Saving…' : existing ? 'Save changes' : 'Save inbox'}
        </button>
        <button
          type="button"
          onClick={onTest}
          disabled={submitting}
          className={adminSecondaryButtonClass}
        >
          {isTesting ? 'Testing…' : 'Test connection'}
        </button>
        {existing ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={submitting}
            className="ml-auto inline-flex items-center justify-center rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13.5px] font-semibold text-rose-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isDeleting ? 'Deleting…' : 'Delete inbox'}
          </button>
        ) : null}
      </div>

      {saveError ? <FormError message={saveError} /> : null}
      {saveOk ? <FormNotice tone="success">Inbox saved.</FormNotice> : null}

      {test.open ? <TestResultPanel state={test} /> : null}
    </form>
  );
}

const inputCls =
  adminInputClass;

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-2">
      <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="text-[11.5px] leading-snug text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

function Toggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="inline-flex cursor-pointer items-center gap-2 rounded-[14px] border border-slate-100 bg-slate-50/70 px-3 py-2 text-[13.5px] font-medium text-slate-700"
    >
      <input
        id={id}
        name={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-[var(--color-bv-accent)] focus:ring-0"
      />
      {label}
    </label>
  );
}

function TestResultPanel({ state }: { state: TestPanelState }) {
  if (state.loading) {
    return (
      <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] text-slate-700">
        Opening IMAP connection…
      </div>
    );
  }
  if (state.ok === true) {
    return (
      <div
        role="status"
        className="rounded-[14px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800"
      >
        {state.message}
        {state.durationMs ? (
          <span className="ml-2 text-[11.5px] text-emerald-700">
            ({state.durationMs} ms)
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <div
      role="alert"
      className="rounded-[14px] border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800"
    >
      {state.message}
      {state.durationMs ? (
        <span className="ml-2 text-[11.5px] text-rose-700">
          ({state.durationMs} ms)
        </span>
      ) : null}
    </div>
  );
}
