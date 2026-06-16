import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#dbeafe_0,transparent_32%),linear-gradient(135deg,#f8fafc_0%,#eef4ff_52%,#f9fafb_100%)] px-6 py-12">
      <section className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-3xl items-center justify-center">
        <div className="w-full rounded-[28px] border border-white/80 bg-white/90 p-8 text-center shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur-xl">
          <span className="inline-flex rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
            Page not found
          </span>
          <h1 className="mt-5 text-[34px] font-semibold tracking-[-0.04em] text-slate-950">
            This workspace page is not available.
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[14px] leading-relaxed text-slate-500">
            The link may be outdated, or the page may have moved. Return to the dashboard to keep working.
          </p>
          <Link
            href="/dashboard"
            className="mt-7 inline-flex items-center justify-center rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-[0_16px_34px_rgba(47,90,243,0.24)] transition-all hover:-translate-y-0.5 hover:opacity-95"
          >
            Back to dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
