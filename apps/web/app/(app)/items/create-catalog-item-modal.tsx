'use client';

import Link from 'next/link';
import { useState } from 'react';

export function CreateCatalogItemModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-[0_16px_34px_rgba(47,90,243,0.24)] transition-all hover:-translate-y-0.5 hover:opacity-95"
      >
        Create catalog item
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="create-catalog-item-title">
          <div className="w-full max-w-2xl rounded-[24px] border border-white/80 bg-white p-6 shadow-[0_30px_90px_rgba(15,23,42,0.25)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="create-catalog-item-title" className="text-[24px] font-semibold tracking-[-0.035em] text-slate-950">
                  Create catalog item
                </h2>
                <p className="mt-1 text-[13.5px] leading-relaxed text-slate-500">
                  Choose whether this is a single item or a bundle of multiple priced components.
                </p>
                <p className="mt-4 text-[16px] font-semibold text-slate-900">Create what?</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-500 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <ChoiceCard
                title="Single Item"
                description="One material, labor item, machine charge, install item, or misc item."
                href="/items/new"
                buttonLabel="Create single item"
              />
              <ChoiceCard
                title="Bundle"
                description="A grouped product made from multiple items, shown as one line to customers."
                href="/items/bundles/new"
                buttonLabel="Create bundle"
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ChoiceCard({
  title,
  description,
  href,
  buttonLabel,
}: {
  title: string;
  description: string;
  href: string;
  buttonLabel: string;
}) {
  return (
    <article className="flex min-h-[180px] flex-col justify-between rounded-[18px] border border-slate-200 bg-slate-50/70 p-5">
      <div>
        <h3 className="text-[17px] font-semibold text-slate-950">{title}</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-500">{description}</p>
      </div>
      <Link href={href} className="mt-5 inline-flex items-center justify-center rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13px] font-semibold text-white">
        {buttonLabel}
      </Link>
    </article>
  );
}
