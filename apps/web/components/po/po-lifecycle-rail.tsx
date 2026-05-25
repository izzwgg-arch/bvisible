import Link from 'next/link';
import { Role } from '@bvisible/db';
import type { PoLifecycleSnapshot } from '@/lib/po/get-po-lifecycle-snapshot';
import { PO_LIFECYCLE_LADDER, PO_LIFECYCLE_LABELS } from '@/lib/po/po-lifecycle-matrix';
import { PoLifecycleControls } from './po-lifecycle-controls';

const RAIL_STEPS = PO_LIFECYCLE_LADDER.filter(
  (s) => s !== 'completed' && s !== 'reconciliation_needed',
);

export function PoLifecycleRail({
  poId,
  poNumber,
  snapshot,
  role,
  variant = 'full',
  hideNextAction = false,
}: {
  poId: string;
  poNumber: string;
  snapshot: PoLifecycleSnapshot;
  role: Role;
  variant?: 'full' | 'compact';
  hideNextAction?: boolean;
}) {
  const showOperator = role === Role.ADMIN || role === Role.SUPER_ADMIN;
  const stateIdx = RAIL_STEPS.indexOf(snapshot.state as (typeof RAIL_STEPS)[number]);
  const compact = variant === 'compact';

  if (compact) {
    return (
      <div className="flex flex-col gap-0">
        {snapshot.state !== 'canceled' && snapshot.state !== 'blocked_backordered' ? (
          <div className="flex flex-wrap gap-1">
            {RAIL_STEPS.map((step, i) => {
              const done = stateIdx >= 0 && stateIdx > i;
              const current = snapshot.state === step;
              return (
                <span
                  key={step}
                  className={`rounded-full border px-1.5 py-px text-[9px] font-semibold leading-tight ${
                    current
                      ? 'border-[var(--color-bv-accent)] bg-[var(--color-bv-accent)]/10 text-[var(--color-bv-accent)]'
                      : done
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                        : 'border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)]'
                  }`}
                >
                  {PO_LIFECYCLE_LABELS[step]}
                </span>
              );
            })}
          </div>
        ) : (
          <span className="text-[11px] font-medium text-[var(--color-bv-text)]">{snapshot.label}</span>
        )}
      </div>
    );
  }

  return (
    <div className="mb-8 flex flex-col gap-3">
      <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-4 shadow-[var(--shadow-bv-card)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
            Vendor order lifecycle
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12px] text-[var(--color-bv-text)]">{poNumber}</span>
            <span className="rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2 py-0.5 text-[10px] font-semibold">
              {snapshot.label}
            </span>
            {snapshot.staleLabel ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-amber-950">
                Stale {snapshot.staleLabel}
              </span>
            ) : null}
          </div>
        </div>
        {snapshot.state !== 'canceled' && snapshot.state !== 'blocked_backordered' ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {RAIL_STEPS.map((step, i) => {
              const done = stateIdx >= 0 && stateIdx > i;
              const current = snapshot.state === step;
              return (
                <span
                  key={step}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-tight ${
                    current
                      ? 'border-[var(--color-bv-accent)] bg-[var(--color-bv-accent)]/10 text-[var(--color-bv-accent)]'
                      : done
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                        : 'border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)]'
                  }`}
                >
                  {PO_LIFECYCLE_LABELS[step]}
                </span>
              );
            })}
          </div>
        ) : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Vendor response" value={snapshot.vendorResponseLabel} />
          <Stat label="Receipt / recon" value={snapshot.receiptProgressLabel} />
          <Stat label="Blocker" value={snapshot.isBlocked ? 'Needs attention' : 'On track'} />
        </div>
        <p className="mt-3 text-[12.5px] leading-snug text-[var(--color-bv-muted)]">{snapshot.reason}</p>
        {!hideNextAction ? (
          <Link
            href={snapshot.nextAction.href as never}
            className="mt-2 inline-flex text-[13px] font-medium text-[var(--color-bv-accent)] hover:underline"
          >
            {snapshot.nextAction.label} →
          </Link>
        ) : null}
      </section>
      {showOperator ? (
        <PoLifecycleControls poId={poId} isBlocked={snapshot.signals.isOperatorBlocked} />
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-bv-muted)]">
        {label}
      </p>
      <p className="mt-1 text-[12.5px] leading-snug text-[var(--color-bv-text)]">{value}</p>
    </div>
  );
}
