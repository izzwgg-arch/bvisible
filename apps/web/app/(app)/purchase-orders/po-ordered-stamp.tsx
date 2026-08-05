'use client';

import { useEffect, useState } from 'react';

type PoOrderedStampProps = {
  /** ISO 8601 UTC instant the PO was created. */
  iso: string;
  /** Server-rendered text, shown until the browser can localise it. */
  fallback: string;
};

/**
 * Renders when a PO was ordered, in the *viewer's* timezone.
 *
 * This has to happen in the browser. The production server runs Europe/Berlin,
 * so a server-formatted timestamp shows Berlin wall-clock time — six hours off
 * for a US user, and frequently the wrong calendar day for anything ordered
 * after early evening. Date-only display hid that; showing the time does not.
 *
 * First paint uses the server string so hydration matches, then the effect
 * swaps in the local rendering.
 */
export function PoOrderedStamp({ iso, fallback }: PoOrderedStampProps) {
  const [local, setLocal] = useState<{ date: string; time: string } | null>(null);

  useEffect(() => {
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) return;
    setLocal({
      date: new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(when),
      time: new Intl.DateTimeFormat('en', {
        hour: 'numeric',
        minute: '2-digit',
      }).format(when),
    });
  }, [iso]);

  const className = 'whitespace-nowrap text-[12px] tabular-nums text-[var(--color-bv-muted)]';

  if (local === null) {
    return <span className={className}>{fallback}</span>;
  }

  return (
    <time dateTime={iso} className={className}>
      {local.date} <span className="text-slate-400">· {local.time}</span>
    </time>
  );
}
