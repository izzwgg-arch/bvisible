'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import type { OcrJobStatus } from '@bvisible/db';
import {
  OcrStaleBadge,
  OcrStatusChip,
  formatOcrRelativeTime,
} from '@/app/(app)/admin/ocr-review/ocr-review-ui';

export interface OcrQueueRow {
  id: string;
  status: OcrJobStatus;
  updatedAt: string;
  lineCount: number;
  attachmentLabel: string;
  attachmentTitle: string;
  poId: string | null;
  poNumber: string | null;
  vendorName: string | null;
}

export function OcrQueueTable({ rows, nowIso }: { rows: OcrQueueRow[]; nowIso: string }) {
  const now = new Date(nowIso);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      ) {
        return;
      }
      if (e.key !== 'j' && e.key !== 'k') return;
      const links = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('[data-ocr-queue-row]')
      );
      if (links.length === 0) return;
      const active = document.activeElement;
      const idx = links.findIndex((el) => el === active || el.contains(active as Node));
      const nextIdx =
        e.key === 'j'
          ? Math.min(links.length - 1, idx < 0 ? 0 : idx + 1)
          : Math.max(0, idx <= 0 ? 0 : idx - 1);
      if (nextIdx === idx && idx >= 0) return;
      e.preventDefault();
      const link = links[nextIdx];
      if (!link) return;
      link.focus();
      if (e.shiftKey) link.click();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [rows.length]);

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
      <table className="w-full border-collapse text-left text-[12px]">
        <thead className="border-b border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[10px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
          <tr>
            <th className="px-2.5 py-1.5">Status</th>
            <th className="px-2.5 py-1.5">PO</th>
            <th className="px-2.5 py-1.5">Vendor</th>
            <th className="px-2.5 py-1.5">Attachment</th>
            <th className="px-2.5 py-1.5 text-center">Lines</th>
            <th className="px-2.5 py-1.5 text-right">Updated</th>
            <th className="w-16 px-2.5 py-1.5 text-right" aria-label="Review" />
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr
              key={d.id}
              className="group border-t border-[var(--color-bv-border)] hover:bg-[var(--color-bv-bg)]/60"
            >
              <td className="px-2.5 py-1">
                <div className="flex flex-wrap items-center gap-1">
                  <OcrStatusChip status={d.status} />
                  <OcrStaleBadge status={d.status} updatedAt={new Date(d.updatedAt)} />
                </div>
              </td>
              <td className="px-2.5 py-1">
                {d.poId && d.poNumber ? (
                  <Link
                    className="relative z-[1] font-medium text-emerald-700 underline-offset-2 hover:underline"
                    href={`/purchase-orders/${d.poId}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {d.poNumber}
                  </Link>
                ) : (
                  <span className="text-[var(--color-bv-muted)]">—</span>
                )}
              </td>
              <td className="max-w-[120px] truncate px-2.5 py-1 text-[var(--color-bv-muted)]">
                {d.vendorName ?? '—'}
              </td>
              <td className="max-w-[200px] px-2.5 py-1">
                <Link
                  data-ocr-queue-row
                  className="block truncate font-medium text-[var(--color-bv-text)] underline-offset-2 hover:text-emerald-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-bv-accent)]"
                  href={`/admin/ocr-review/${d.id}`}
                  title={d.attachmentTitle}
                >
                  {d.attachmentLabel}
                </Link>
              </td>
              <td className="px-2.5 py-1 text-center tabular-nums">
                <span className="inline-flex min-w-[1.5rem] justify-center rounded-full bg-[var(--color-bv-bg)] px-1 py-0.5 text-[10px] font-medium text-[var(--color-bv-muted)]">
                  {d.lineCount}
                </span>
              </td>
              <td
                className="px-2.5 py-1 text-right tabular-nums text-[11px] text-[var(--color-bv-muted)]"
                title={d.updatedAt}
              >
                {formatOcrRelativeTime(new Date(d.updatedAt), now)}
              </td>
              <td className="px-2.5 py-1 text-right">
                <Link
                  data-ocr-queue-row
                  href={`/admin/ocr-review/${d.id}`}
                  className="inline-flex items-center rounded-md border border-transparent px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800 opacity-70 transition-opacity group-hover:opacity-100 hover:border-emerald-200 hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-bv-accent)]"
                >
                  Review →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-1 text-[10px] text-[var(--color-bv-muted)]">
        Tip: focus a row link, then <kbd className="font-mono">j</kbd>/<kbd className="font-mono">k</kbd>{' '}
        to move · Shift+click opens review
      </p>
    </div>
  );
}
