'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { EstimateStatus } from '@bvisible/db';

import type { EstimateQuoteLinkRowSerialized } from '@/lib/estimate/load-estimate-quote-staff-ui';
import {
  issueEstimateQuoteLinkAction,
  revokeEstimateQuoteLinkAction,
} from '@/app/(app)/estimates/[id]/estimate-quote-link-actions';

export type EstimateQuoteLinkPanelProps = {
  estimateId: string;
  estimateStatus: EstimateStatus;
  /** Newest link first */
  quoteLinkRowsDesc: readonly EstimateQuoteLinkRowSerialized[];
  activeLink: EstimateQuoteLinkRowSerialized | null;
  phaseBadgeLabel: string;
  disableRegenerate: boolean;
  regenerateDisabledReason: string | null;
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

function deriveRowUxPhase(nowMs: number, row: EstimateQuoteLinkRowSerialized): string {
  if (row.respondedAtIso) {
    if (row.acceptedAtIso) return 'Responded · Accepted';
    if (row.declinedAtIso) return 'Responded · Declined';
    return 'Responded';
  }
  if (row.revokedAtIso) return 'Revoked';
  if (row.expiresAtIso) {
    const exp = new Date(row.expiresAtIso).getTime();
    if (!Number.isNaN(exp) && exp <= nowMs) return 'Expired';
  }
  return 'Active · awaiting customer';
}

export function EstimateQuoteLinkPanel(props: EstimateQuoteLinkPanelProps) {
  const router = useRouter();
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [expiresLocal, setExpiresLocal] = useState('');
  const [pending, startTransition] = useTransition();

  const nowMs = Date.now();

  const rowForUi = props.activeLink ?? props.quoteLinkRowsDesc[0] ?? null;

  const linkUxPhase = rowForUi ? deriveRowUxPhase(nowMs, rowForUi) : 'No link issued';

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

  const sent =
    props.estimateStatus === EstimateStatus.SENT ||
    props.estimateStatus === EstimateStatus.APPROVED ||
    props.estimateStatus === EstimateStatus.REJECTED ||
    props.estimateStatus === EstimateStatus.FINALIZED;

  return (
    <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-4 shadow-[var(--shadow-bv-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--color-bv-text)]">Customer quote link</h2>
          <p className="mt-1 max-w-[520px] text-[12.5px] leading-relaxed text-[var(--color-bv-muted)]">
            Share a read-only quote page — no login required. Internal preview and editor stay staff-only.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
          {props.phaseBadgeLabel}
        </span>
      </div>

      {banner ? (
        <p className="mt-3 rounded-[8px] bg-[var(--color-bv-bg)] px-3 py-2 text-[12.5px] text-[var(--color-bv-text)]">
          {banner}
        </p>
      ) : null}

      <dl className="mt-4 grid gap-2 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-4">
          <dt className="text-[var(--color-bv-muted)]">Public URL status</dt>
          <dd className="font-semibold text-[var(--color-bv-text)]">
            {props.activeLink ? (
              <>
                Active URL{' '}
                <span className="font-normal text-[var(--color-bv-muted)]">
                  ({props.phaseBadgeLabel === 'Awaiting response' ? 'customer may respond' : 'see summary above'})
                </span>
              </>
            ) : rowForUi ? (
              <>
                No active URL ·{' '}
                <span className="text-[var(--color-bv-muted)]">{linkUxPhase}</span>
              </>
            ) : (
              <span className="text-[var(--color-bv-muted)]">No link issued yet</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-bv-muted)]">Row detail</dt>
          <dd className="font-medium text-[var(--color-bv-text)]">{linkUxPhase}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-bv-muted)]">Issued</dt>
          <dd className="font-medium text-[var(--color-bv-text)]">
            {rowForUi ? formatTs(rowForUi.createdAtIso) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-bv-muted)]">Expires</dt>
          <dd className="font-medium text-[var(--color-bv-text)]">
            {rowForUi?.expiresAtIso ? formatTs(rowForUi.expiresAtIso) : 'Never'}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-bv-muted)]">Last viewed</dt>
          <dd className="font-medium text-[var(--color-bv-text)]">
            {rowForUi?.lastViewedAtIso ? formatTs(rowForUi.lastViewedAtIso) : '—'}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-[12px] text-[var(--color-bv-muted)]">
        Estimate send status:{' '}
        <strong className="text-[var(--color-bv-text)]">{sent ? 'Sent / progressed' : 'Draft — not emailed via Preview flow yet'}</strong>
      </p>

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

      {props.disableRegenerate && props.regenerateDisabledReason ? (
        <p className="mt-3 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-950">
          {props.regenerateDisabledReason}
        </p>
      ) : null}

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
        {!props.quoteLinkRowsDesc.length ? (
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
              disabled={pending || props.disableRegenerate}
              title={
                props.disableRegenerate
                  ? (props.regenerateDisabledReason ?? 'Regeneration disabled')
                  : undefined
              }
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
              title="Revokes every URL for this estimate (customers lose access immediately)."
            >
              Revoke all links
            </button>
          </>
        )}
      </div>

      {props.quoteLinkRowsDesc.length > 1 ? (
        <p className="mt-3 text-[11px] text-[var(--color-bv-muted)]">
          {props.quoteLinkRowsDesc.length} link rotations on file — newest controls shown above.
        </p>
      ) : null}
    </section>
  );
}
