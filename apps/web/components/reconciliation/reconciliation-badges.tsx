import {
  POReconciliationLineMatch,
  POReconciliationLineResolution,
  POReconciliationStatus,
  SpendAlertKind,
  SpendAlertStatus,
} from '@bvisible/db';
import {
  labelPoReconciliationStatus,
  labelReconciliationLineMatch,
  labelReconciliationLineResolution,
  labelSpendAlertKind,
  labelSpendAlertStatus,
} from '@/lib/ui/status-labels';

export function matchBadgeClass(m: POReconciliationLineMatch): string {
  switch (m) {
    case POReconciliationLineMatch.MATCHED:
      return 'border-emerald-200 bg-emerald-50 text-emerald-900';
    case POReconciliationLineMatch.PRICE_VARIANCE:
    case POReconciliationLineMatch.QTY_VARIANCE:
    case POReconciliationLineMatch.PRICE_AND_QTY_VARIANCE:
      return 'border-amber-200 bg-amber-50 text-amber-950';
    case POReconciliationLineMatch.UNMATCHED_PO_LINE:
    case POReconciliationLineMatch.UNMATCHED_RECEIPT_LINE:
      return 'border-slate-200 bg-slate-50 text-slate-900';
    default:
      return 'border-violet-200 bg-violet-50 text-violet-950';
  }
}

export function reconciliationStatusBadgeClass(s: POReconciliationStatus): string {
  switch (s) {
    case POReconciliationStatus.MATCHED:
    case POReconciliationStatus.RESOLVED:
      return 'border-emerald-200 bg-emerald-50 text-emerald-900';
    case POReconciliationStatus.VARIANCE:
    case POReconciliationStatus.REVIEW_REQUIRED:
      return 'border-amber-200 bg-amber-50 text-amber-950';
    case POReconciliationStatus.PARTIAL:
      return 'border-violet-200 bg-violet-50 text-violet-950';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-800';
  }
}

export function resolutionBadgeClass(r: POReconciliationLineResolution): string {
  switch (r) {
    case POReconciliationLineResolution.CONFIRMED_PAIR:
      return 'border-emerald-200 bg-emerald-50 text-emerald-900';
    case POReconciliationLineResolution.ACCEPTED_VARIANCE:
      return 'border-amber-200 bg-amber-50 text-amber-950';
    case POReconciliationLineResolution.REJECTED_PAIR:
      return 'border-rose-200 bg-rose-50 text-rose-950';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700';
  }
}

export function spendAlertStatusChipClass(s: SpendAlertStatus): string {
  switch (s) {
    case SpendAlertStatus.OPEN:
      return 'border-amber-200 bg-amber-50 text-amber-950';
    case SpendAlertStatus.SUPERSEDED:
      return 'border-slate-200 bg-slate-100 text-slate-800';
    case SpendAlertStatus.DISMISSED:
      return 'border-neutral-200 bg-neutral-50 text-neutral-600';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-900';
  }
}

export function spendAlertKindChipClass(k: SpendAlertKind): string {
  switch (k) {
    case SpendAlertKind.PRICE_OVER_PO_EXPECTED:
      return 'border-rose-200 bg-rose-50 text-rose-950';
    case SpendAlertKind.QTY_MISMATCH:
      return 'border-amber-200 bg-amber-50 text-amber-950';
    case SpendAlertKind.UNMATCHED_RECEIPT_LINE:
    case SpendAlertKind.MISSING_PO_RECEIPT_LINE:
      return 'border-slate-200 bg-slate-50 text-slate-900';
    default:
      return 'border-violet-200 bg-violet-50 text-violet-950';
  }
}

export function MatchChip({ match }: { match: POReconciliationLineMatch }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${matchBadgeClass(match)}`}
    >
      {labelReconciliationLineMatch(match)}
    </span>
  );
}

export function ResolutionChip({ resolution }: { resolution: POReconciliationLineResolution }) {
  if (resolution === POReconciliationLineResolution.NONE) return null;
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${resolutionBadgeClass(resolution)}`}
      title="Operator review recorded on this line"
    >
      {labelReconciliationLineResolution(resolution)}
    </span>
  );
}

export function ReconciliationStatusChip({ status }: { status: POReconciliationStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${reconciliationStatusBadgeClass(status)}`}
    >
      {labelPoReconciliationStatus(status)}
    </span>
  );
}

export function SpendAlertStatusChip({ status }: { status: SpendAlertStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${spendAlertStatusChipClass(status)}`}
    >
      {labelSpendAlertStatus(status)}
    </span>
  );
}

export function SpendAlertKindChip({ kind }: { kind: SpendAlertKind }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${spendAlertKindChipClass(kind)}`}
    >
      {labelSpendAlertKind(kind)}
    </span>
  );
}
