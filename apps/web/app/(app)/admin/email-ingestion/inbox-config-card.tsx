import type { DiagInbox } from '@/lib/email-ingest/config';

function fmt(d: Date | null): string {
  if (!d) return '—';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

export function InboxConfigCard({ diag }: { diag: DiagInbox }) {
  const ok = diag.configured && !diag.lastErrorMessage;
  return (
    <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-bv-text)]">
          Inbox configuration
        </h2>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : diag.configured
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-slate-200 bg-slate-50 text-slate-600'
          }`}
        >
          {!diag.configured ? 'not configured' : ok ? 'healthy' : 'errored'}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-[140px_1fr] gap-y-1.5 text-[12.5px]">
        <dt className="text-[var(--color-bv-muted)]">Source</dt>
        <dd className="text-[var(--color-bv-text)]">{diag.source}</dd>
        <dt className="text-[var(--color-bv-muted)]">Host</dt>
        <dd className="text-[var(--color-bv-text)]">{diag.host ?? '—'}</dd>
        <dt className="text-[var(--color-bv-muted)]">Port</dt>
        <dd className="text-[var(--color-bv-text)]">{diag.port ?? '—'}</dd>
        <dt className="text-[var(--color-bv-muted)]">TLS</dt>
        <dd className="text-[var(--color-bv-text)]">
          {diag.secure === null ? '—' : diag.secure ? 'on' : 'off'}
        </dd>
        <dt className="text-[var(--color-bv-muted)]">Mailbox</dt>
        <dd className="text-[var(--color-bv-text)]">{diag.mailbox ?? '—'}</dd>
        <dt className="text-[var(--color-bv-muted)]">Username</dt>
        <dd className="text-[var(--color-bv-text)]">{diag.maskedUsername ?? '—'}</dd>
        <dt className="text-[var(--color-bv-muted)]">Poll interval</dt>
        <dd className="text-[var(--color-bv-text)]">
          {diag.pollIntervalSeconds ? `${diag.pollIntervalSeconds}s` : '—'}
        </dd>
        <dt className="text-[var(--color-bv-muted)]">Last polled</dt>
        <dd className="text-[var(--color-bv-text)]">{fmt(diag.lastPolledAt)}</dd>
        <dt className="text-[var(--color-bv-muted)]">Last error</dt>
        <dd className="text-[var(--color-bv-text)]">{fmt(diag.lastErrorAt)}</dd>
      </dl>
      {diag.lastErrorMessage ? (
        <p className="mt-3 rounded-[6px] border border-rose-200 bg-rose-50 p-2 text-[12px] text-rose-800">
          {diag.lastErrorMessage}
        </p>
      ) : null}
      <p className="mt-3 text-[11.5px] text-[var(--color-bv-muted)]">
        IMAP password is encrypted at rest with AES-256-GCM. The display
        above never includes credentials. Configure via the env file (or
        a future per-tenant inbox form).
      </p>
    </section>
  );
}
