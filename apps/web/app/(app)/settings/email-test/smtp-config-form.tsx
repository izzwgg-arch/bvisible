'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveSmtpConfigAction, testSmtpConfigAction } from './smtp-actions';
import { FormError, FormNotice } from '@/components/auth/form-error';
import {
  adminInputClass,
  adminPrimaryButtonClass,
  adminSecondaryButtonClass,
} from '@/components/app/admin-ui';

interface ExistingSmtpConfig {
  id: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  replyTo: string | null;
}

interface FormValues {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  replyTo: string;
}

const GMAIL_DEFAULTS: FormValues = {
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  user: '',
  password: '',
  from: '',
  replyTo: '',
};

export function SmtpConfigForm({ existing }: { existing: ExistingSmtpConfig | null }) {
  const router = useRouter();
  const [isSaving, startSaveTransition] = useTransition();
  const [isTesting, startTestTransition] = useTransition();

  const [values, setValues] = useState<FormValues>(() => ({
    host: existing?.host ?? GMAIL_DEFAULTS.host,
    port: existing?.port ?? GMAIL_DEFAULTS.port,
    secure: existing?.secure ?? GMAIL_DEFAULTS.secure,
    user: existing?.user ?? '',
    password: '',
    from: existing?.from ?? '',
    replyTo: existing?.replyTo ?? '',
  }));

  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [testState, setTestState] = useState<{
    shown: boolean;
    loading: boolean;
    ok: boolean | null;
    message: string | null;
    durationMs: number | null;
  }>({ shown: false, loading: false, ok: null, message: null, durationMs: null });

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
      const r = await saveSmtpConfigAction({
        host: values.host,
        port: values.port,
        secure: values.secure,
        user: values.user,
        password: values.password || undefined,
        from: values.from,
        replyTo: values.replyTo || undefined,
      });
      if (!r.ok) {
        setSaveError(r.error ?? 'Save failed.');
        return;
      }
      setValues((p) => ({ ...p, password: '' }));
      setSaveOk(true);
      router.refresh();
    });
  }

  function onTest() {
    setTestState({ shown: true, loading: true, ok: null, message: null, durationMs: null });
    startTestTransition(async () => {
      const r = await testSmtpConfigAction({
        host: values.host,
        port: values.port,
        secure: values.secure,
        user: values.user,
        password: values.password || undefined,
        from: values.from,
      });
      setTestState({
        shown: true,
        loading: false,
        ok: r.ok,
        message: r.ok ? 'SMTP connection verified.' : (r.error ?? 'Test failed.'),
        durationMs: r.durationMs,
      });
    });
  }

  const submitting = isSaving || isTesting;

  return (
    <form onSubmit={onSave} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="SMTP host" htmlFor="smtp-host" hint="e.g. smtp.gmail.com">
          <input
            id="smtp-host"
            type="text"
            required
            value={values.host}
            onChange={(e) => update('host', e.target.value)}
            className={adminInputClass}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label="Port" htmlFor="smtp-port" hint="465 (TLS) or 587 (STARTTLS)">
          <input
            id="smtp-port"
            type="number"
            min={1}
            max={65535}
            required
            value={values.port}
            onChange={(e) =>
              update('port', Number.parseInt(e.target.value || '0', 10) || 0)
            }
            className={adminInputClass}
          />
        </Field>
      </div>

      <Field label="Username" htmlFor="smtp-user" hint="Your Gmail or SMTP account address">
        <input
          id="smtp-user"
          type="text"
          required
          value={values.user}
          onChange={(e) => update('user', e.target.value)}
          className={adminInputClass}
          autoComplete="off"
          spellCheck={false}
          placeholder="you@gmail.com"
        />
      </Field>

      <Field
        label="App password"
        htmlFor="smtp-password"
        hint={
          existing
            ? 'Leave blank to keep the saved password. Paste a new one to rotate.'
            : 'Required on first save. For Gmail: use a 16-character App Password (not your account password).'
        }
      >
        <input
          id="smtp-password"
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={values.password}
          onChange={(e) => update('password', e.target.value)}
          placeholder={existing ? '•••••••• (saved)' : 'paste App Password'}
          className={adminInputClass}
        />
      </Field>

      <Field
        label="From address"
        htmlFor="smtp-from"
        hint="Shown in recipients' inboxes. e.g. B Visible <you@gmail.com>"
      >
        <input
          id="smtp-from"
          type="text"
          required
          value={values.from}
          onChange={(e) => update('from', e.target.value)}
          className={adminInputClass}
          autoComplete="off"
          placeholder="B Visible <you@gmail.com>"
        />
      </Field>

      <div className="flex items-center gap-3">
        <Toggle
          id="smtp-secure"
          label="TLS on connect (port 465)"
          checked={values.secure}
          onChange={(v) => update('secure', v)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
        <button
          type="submit"
          disabled={submitting}
          className={adminPrimaryButtonClass}
        >
          {isSaving ? 'Saving…' : existing ? 'Save changes' : 'Save credentials'}
        </button>
        <button
          type="button"
          onClick={onTest}
          disabled={submitting}
          className={adminSecondaryButtonClass}
        >
          {isTesting ? 'Testing…' : 'Test connection'}
        </button>
      </div>

      {saveError ? <FormError message={saveError} /> : null}
      {saveOk ? <FormNotice tone="success">SMTP credentials saved.</FormNotice> : null}

      {testState.shown ? (
        testState.loading ? (
          <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] text-slate-700">
            Opening SMTP connection…
          </div>
        ) : testState.ok ? (
          <div className="rounded-[14px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
            {testState.message}
            {testState.durationMs ? (
              <span className="ml-2 text-[11.5px] text-emerald-700">({testState.durationMs} ms)</span>
            ) : null}
          </div>
        ) : (
          <div className="rounded-[14px] border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">
            {testState.message}
            {testState.durationMs ? (
              <span className="ml-2 text-[11.5px] text-rose-700">({testState.durationMs} ms)</span>
            ) : null}
          </div>
        )
      ) : null}
    </form>
  );
}

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
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-[var(--color-bv-accent)] focus:ring-0"
      />
      {label}
    </label>
  );
}
