'use client';

// Preview + copy + download for the QBME block.

import { useState } from 'react';

export function QbmeBlockActions({ block, filename }: { block: string; filename: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(block);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — user can select the text manually.
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([block], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="relative rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[#12304c] p-4 shadow-[var(--shadow-bv-card)]">
      <div className="absolute right-3 top-3 flex gap-2">
        <button
          type="button"
          onClick={copy}
          className="rounded-[8px] bg-white px-3.5 py-1.5 text-[11.5px] font-bold text-[#12304c] hover:opacity-95"
        >
          {copied ? 'Copied ✓' : 'Copy block'}
        </button>
        <button
          type="button"
          onClick={download}
          className="rounded-[8px] border border-white/30 px-3.5 py-1.5 text-[11.5px] font-bold text-white hover:bg-white/10"
        >
          Download .txt
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre pt-8 font-mono text-[11.5px] leading-relaxed text-[#bde6cd]">
        {block}
      </pre>
    </section>
  );
}
