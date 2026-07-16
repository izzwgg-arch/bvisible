'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { EstimateStatus } from '@bvisible/db';

import type { EstimateQuoteLinkRowSerialized } from '@/lib/estimate/load-estimate-quote-staff-ui';
import {
  issueEstimateQuoteLinkAction,
  revokeEstimateQuoteLinkAction,
} from '@/app/(app)/estimates/[id]/estimate-quote-link-actions';
import { SectionCard, SectionHeading, IconLink } from '@/components/estimate/estimate-surface';

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
    <SectionCard className="p-4">
      <SectionHeading
        icon={<IconLink />}
        tone="blue"
        title="Customer quote link"
        subtitle="Share a read-only quote page — no login required. Internal preview and editor stay staff-only."
        badge={
          <span className="shrink-0 rounded-full bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ring-1 ring-inset ring-slate-200">
            {props.phaseBadgeLabel}
          </span>
        }
      />

      {banner ? (
        <p className="mt-3 rounded-[10px] border border-blue-200 bg-blue-50 px-3 py-2 text-[12.5px] font-medium text-blue-900">
          {banner}
        </p>
      ) : null}

      <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[10px] border border-slate-100 bg-slate-50/60 px-3 py-2 sm:col-span-2 lg:col-span-4">
          <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">
            Public URL status
          </dt>
          <dd className="mt-0.5 text-[12.5px] font-semibold text-slate-800">
            {props.activeLink ? (
              <>
                Active URL{' '}
                <span className="font-normal text-slate-400">
                  ({props.phaseBadgeLabel === 'Awaiting response' ? 'customer may respond' : 'see summary above'})
                </span>
              </>
            ) : rowForUi ? (
              <>
                No active URL ·{' '}
                <span className="font-normal text-slate-400">{linkUxPhase}</span>
              </>
            ) : (
              <span className="font-normal text-slate-400">No link issued yet</span>
            )}
          </dd>
        </div>
        <LinkField label="Row detail" value={linkUxPhase} />
        <LinkField label="Issued" value={rowForUi ? formatTs(rowForUi.createdAtIso) : '—'} />
        <LinkField
          label="Expires"
          value={rowForUi?.expiresAtIso ? formatTs(rowForUi.expiresAtIso) : 'Never'}
        />
        <LinkField
          label="Last viewed"
          value={rowForUi?.lastViewedAtIso ? formatTs(rowForUi.lastViewedAtIso) : '—'}
        />
      </dl>

      <p className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
        Estimate send status:
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
            sent
              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
              : 'bg-slate-50 text-slate-500 ring-slate-200'
          }`}
        >
          {sent ? 'Sent / progressed' : 'Draft — not emailed yet'}
        </span>
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">
          Optional expiry (customer&apos;s local time)
          <input
            type="datetime-local"
            value={expiresLocal}
            onChange={(e) => setExpiresLocal(e.target.value)}
            className="rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 shadow-sm transition focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
            disabled={pending}
          />
        </label>
      </div>

      {props.disableRegenerate && props.regenerateDisabledReason ? (
        <p className="mt-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          {props.regenerateDisabledReason}
        </p>
      ) : null}

      {issuedUrl ? (
        <div className="mt-3 rounded-[10px] border border-emerald-200 bg-emerald-50/70 px-3 py-2.5">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-emerald-700">
            Link (copy now)
          </p>
          <p className="mt-1 break-all font-mono text-[12px] text-slate-800">{issuedUrl}</p>
        </div>
      ) : null}

      {hintCopy ? <p className="mt-2 text-[12px] text-slate-400">{hintCopy}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {!props.quoteLinkRowsDesc.length ? (
          <>
            <p className="w-full text-[12px] leading-snug text-slate-500">
              No public link yet. Use{' '}
              <Link
                href={`/estimates/${props.estimateId}/preview#customer-send`}
                className="font-semibold text-blue-600 underline-offset-2 hover:underline"
              >
                Quote preview → Send to customer
              </Link>{' '}
              for email copy, or generate a link here.
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={runIssue}
              className="inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(47,90,243,0.6)] transition hover:from-blue-500 hover:to-indigo-500 disabled:opacity-60"
            >
              <IconLink width={15} height={15} />
              Generate public link
            </button>
          </>
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
              className="inline-flex items-center justify-center rounded-[10px] bg-blue-600 px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:from-blue-500 hover:to-indigo-500 disabled:opacity-60"
            >
              Regenerate link
            </button>
            <button
              type="button"
              disabled={pending || !copyEnabled}
              onClick={runCopy}
              className="inline-flex items-center justify-center rounded-[10px] border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
              title={!copyEnabled ? 'Generate or regenerate to reveal the URL for copying.' : undefined}
            >
              Copy link
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={runRevoke}
              className="inline-flex items-center justify-center rounded-[10px] border border-rose-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-rose-600 shadow-sm transition hover:border-rose-300 hover:bg-rose-50 disabled:opacity-60"
              title="Revokes every URL for this estimate (customers lose access immediately)."
            >
              Revoke all links
            </button>
          </>
        )}
      </div>

      {props.quoteLinkRowsDesc.length > 1 ? (
        <p className="mt-3 text-[11px] text-slate-400">
          {props.quoteLinkRowsDesc.length} link rotations on file — newest controls shown above.
        </p>
      ) : null}
    </SectionCard>
  );
}

function LinkField({ label, value }: { label: string; value: string }) {
  const empty = value === '—';
  return (
    <div className="rounded-[10px] border border-slate-100 bg-slate-50/60 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-[12.5px] tabular-nums ${
          empty ? 'font-normal text-slate-300' : 'font-medium text-slate-800'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
