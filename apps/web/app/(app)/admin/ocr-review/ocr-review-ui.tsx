import { OcrJobStatus } from '@bvisible/db';
import {
  STALE_OCR_REVIEW_MS,
  isPastStaleThreshold,
  staleAgeLabel,
} from '@/lib/workflow/operational-stale';
import { labelOcrJobStatus } from '@/lib/ui/status-labels';

const REVIEW_STATUSES: OcrJobStatus[] = [
  OcrJobStatus.REVIEW_REQUIRED,
  OcrJobStatus.PENDING,
  OcrJobStatus.PROCESSING,
];

export function isOcrQueueStale(
  status: OcrJobStatus,
  updatedAt: Date,
  now: Date = new Date()
): boolean {
  if (!REVIEW_STATUSES.includes(status)) return false;
  return isPastStaleThreshold(updatedAt, STALE_OCR_REVIEW_MS, now);
}

export function ocrStatusChipClass(status: OcrJobStatus): string {
  switch (status) {
    case OcrJobStatus.REVIEW_REQUIRED:
      return 'bg-amber-500/15 text-amber-950 ring-1 ring-amber-500/25';
    case OcrJobStatus.PENDING:
    case OcrJobStatus.PROCESSING:
      return 'bg-sky-500/12 text-sky-950 ring-1 ring-sky-500/20';
    case OcrJobStatus.FAILED:
      return 'bg-red-500/12 text-red-950 ring-1 ring-red-500/25';
    case OcrJobStatus.CONFIRMED:
      return 'bg-emerald-500/12 text-emerald-950 ring-1 ring-emerald-500/20';
    case OcrJobStatus.REJECTED:
      return 'bg-slate-500/12 text-slate-700 ring-1 ring-slate-500/20';
    default:
      return 'bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)] ring-1 ring-[var(--color-bv-border)]';
  }
}

export function OcrStatusChip({ status }: { status: OcrJobStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ocrStatusChipClass(status)}`}
    >
      {labelOcrJobStatus(status)}
    </span>
  );
}

export function OcrStaleBadge({
  status,
  updatedAt,
}: {
  status: OcrJobStatus;
  updatedAt: Date;
}) {
  const now = new Date();
  if (!isOcrQueueStale(status, updatedAt, now)) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-950 ring-1 ring-orange-500/25">
      Stale {staleAgeLabel(updatedAt, now)}
    </span>
  );
}

export function formatOcrRelativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return date.toISOString().slice(0, 10);
}

export function ocrFailureHint(lastError: string | null): string | null {
  if (!lastError) return null;
  const lower = lastError.toLowerCase();
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'Engine timed out — retry upload or open attachment manually.';
  }
  if (lower.includes('unsupported') || lower.includes('mime')) {
    return 'Unsupported file type — confirm the attachment is a PDF or image.';
  }
  if (lower.includes('empty') || lower.includes('no text')) {
    return 'No readable text — scan quality or blank page.';
  }
  return null;
}
