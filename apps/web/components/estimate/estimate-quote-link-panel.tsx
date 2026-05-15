'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import {
  issueEstimateQuoteLinkAction,
  revokeEstimateQuoteLinkAction,
} from '@/app/(app)/estimates/[id]/estimate-quote-link-actions';

export type EstimateQuoteLinkPanelProps = {
  estimateId: string;
  activeLink: null | {
    id: string;
    expiresAtIso: string | null;
    lastViewedAtIso: string | null;
    createdAtIso: string;
  };
};

function formatTs(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return '—';
  }
}

export function EstimateQuoteLinkPanel(props: EstimateQuoteLinkPanelProps) {
  const router = useRouter();
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [expiresLocal, setExpiresLocal] = useState('');
  const [pending, startTransition] = useTransition();

  const hasActive = props.activeLink !== null;
  const copyEnabled = Boolean(issuedUrl);

  const hintCopy = useMemo(() => {
    if (copyEnabled) return null;
    return 'The full URL is shown only when you generate or rotate the link (stored securely as a hash only).';
  }, [copyEnabled]);

  function flash(msg: string) {
    setBanner(msg);
    window.setTimeout(() => setBanner(null), 6000);
  }

  function runIssue() {
    startTransition(async () => {
      const res = await issueEstimateQuoteLinkAction({
        estimateId: props.estimateId,
        expiresAtLocal: expiresLocal.trim() || undefined,
      });
      if (!res.ok) {
        flash(res.error);
        return;
      }
      setIssuedUrl(res.quoteUrl);
      flash('Public link ready — copy it below. Older links no longer work.');
      setExpiresLocal('');
      router.refresh();
    });
  }

  function runRevoke() {
    startTransition(async () => {
      const res = await revokeEstimateQuoteLinkAction({ estimateId: props.estimateId });
      if (!res.ok) {
        flash(res.error);
        return;
      }
      setIssuedUrl(null);
      flash('Public link revoked.');
      router.refresh();
    });
  }

  async function runCopy() {
    if (!issuedUrl) return;
    try {
      await navigator.clipboard.writeText(issuedUrl);
      flash('Copied to clipboard.');
    } catch {
      flash('Could not copy — select and copy manually.');
    }
  }

  return (
    <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-4 shadow-[var(--shadow-bv-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--color-bv-text)]">Customer quote link</h2>
          <p className="mt-1 max-w-[520px] text-[12.5px] leading-relaxed text-[var(--color-bv-muted)]">
            Share a read-only quote page — no login required. Internal preview and editor stay staff-only.
          </p>
        </div>
      </div>

      {banner ? (
        <p className="mt-3 rounded-[8px] bg-[var(--color-bv-bg)] px-3 py-2 text-[12.5px] text-[var(--color-bv-text)]">
          {banner}
        </p>
      ) : null}

      <dl className="mt-4 grid gap-2 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-[var(--color-bv-muted)]">Issued</dt>
          <dd className="font-medium text-[var(--color-bv-text)]">
            {props.activeLink?.createdAtIso ? formatTs(props.activeLink.createdAtIso) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-bv-muted)]">Expires</dt>
          <dd className="font-medium text-[var(--color-bv-text)]">
            {props.activeLink?.expiresAtIso ? formatTs(props.activeLink.expiresAtIso) : 'Never'}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-bv-muted)]">Last viewed</dt>
          <dd className="font-medium text-[var(--color-bv-text)]">
            {props.activeLink?.lastViewedAtIso ? formatTs(props.activeLink.lastViewedAtIso) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-bv-muted)]">Link status</dt>
          <dd className="font-medium text-[var(--color-bv-text)]">{hasActive ? 'Active' : 'None'}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-[var(--color-bv-muted)]">
          Optional expiry (customer&apos;s local time)
          <input
            type="datetime-local"
            value={expiresLocal}
            onChange={(e) => setExpiresLocal(e.target.value)}
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-2 py-1.5 text-[13px] text-[var(--color-bv-text)]"
            disabled={pending}
          />
        </label>
      </div>

      {issuedUrl ? (
        <div className="mt-3 rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-bv-muted)]">
            Link (copy now)
          </p>
          <p className="mt-1 break-all font-mono text-[12px] text-[var(--color-bv-text)]">{issuedUrl}</p>
        </div>
      ) : null}

      {hintCopy ? <p className="mt-2 text-[12px] text-[var(--color-bv-muted)]">{hintCopy}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {!hasActive ? (
          <button
            type="button"
            disabled={pending}
            onClick={runIssue}
            className="inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[13px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm hover:opacity-95 disabled:opacity-60"
          >
            Generate public link
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={runIssue}
              className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)] disabled:opacity-60"
            >
              Regenerate link
            </button>
            <button
              type="button"
              disabled={pending || !copyEnabled}
              onClick={runCopy}
              className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)] disabled:opacity-60"
              title={!copyEnabled ? 'Generate or regenerate to reveal the URL for copying.' : undefined}
            >
              Copy link
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={runRevoke}
              className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)] disabled:opacity-60"
            >
              Revoke link
            </button>
          </>
        )}
      </div>
    </section>
  );
}
