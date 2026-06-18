import type { DiagInbox } from '@/lib/email-ingest/config';
import { AdminPanel, AdminPill } from '@/components/app/admin-ui';

function fmt(d: Date | null): string {
  if (!d) return '—';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

export function InboxConfigCard({ diag }: { diag: DiagInbox }) {
  const ok = diag.configured && !diag.lastErrorMessage;
  return (
    <AdminPanel
      title="Inbox configuration"
      eyebrow="IMAP status"
      description="Connection details are masked; credentials never render in the browser."
      action={<AdminPill tone={ok ? 'emerald' : diag.configured ? 'amber' : 'slate'}>{!diag.configured ? 'not configured' : ok ? 'healthy' : 'errored'}</AdminPill>}
    >
      <dl className="grid grid-cols-[120px_1fr] gap-y-2 p-5 text-[12.5px]">
        <dt className="text-slate-500">Source</dt>
        <dd className="font-medium text-slate-900">{diag.source}</dd>
        <dt className="text-slate-500">Host</dt>
        <dd className="font-mono text-[12px] text-slate-900">{diag.host ?? '—'}</dd>
        <dt className="text-slate-500">Port</dt>
        <dd className="font-mono text-[12px] text-slate-900">{diag.port ?? '—'}</dd>
        <dt className="text-slate-500">TLS</dt>
        <dd className="font-medium text-slate-900">{diag.secure === null ? '—' : diag.secure ? 'on' : 'off'}</dd>
        <dt className="text-slate-500">Mailbox</dt>
        <dd className="font-mono text-[12px] text-slate-900">{diag.mailbox ?? '—'}</dd>
        <dt className="text-slate-500">Username</dt>
        <dd className="font-mono text-[12px] text-slate-900">{diag.maskedUsername ?? '—'}</dd>
        <dt className="text-slate-500">Poll interval</dt>
        <dd className="font-medium text-slate-900">{diag.pollIntervalSeconds ? `${diag.pollIntervalSeconds}s` : '—'}</dd>
        <dt className="text-slate-500">Last polled</dt>
        <dd className="text-slate-900">{fmt(diag.lastPolledAt)}</dd>
        <dt className="text-slate-500">Last error</dt>
        <dd className="text-slate-900">{fmt(diag.lastErrorAt)}</dd>
      </dl>
      {diag.lastErrorMessage ? (
        <p className="mx-5 rounded-[14px] border border-rose-200 bg-rose-50 p-3 text-[12px] text-rose-800">
          {diag.lastErrorMessage}
        </p>
      ) : null}
      <p className="px-5 pb-5 pt-3 text-[11.5px] leading-relaxed text-slate-500">
        IMAP password is encrypted at rest with AES-256-GCM. The display
        above never includes credentials. Configure via the env file (or
        a future per-tenant inbox form).
      </p>
    </AdminPanel>
  );
}
