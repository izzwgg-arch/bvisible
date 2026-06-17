import type { ReactNode } from 'react';

export function AdminMetric({
  label,
  value,
  detail,
  tone = 'blue',
}: {
  label: string;
  value: ReactNode;
  detail: string;
  tone?: 'blue' | 'emerald' | 'amber' | 'rose' | 'violet' | 'slate';
}) {
  const toneClass = {
    blue: 'from-blue-500/12 to-cyan-400/10 text-blue-700 ring-blue-100',
    emerald: 'from-emerald-400/16 to-teal-300/10 text-emerald-700 ring-emerald-100',
    amber: 'from-amber-400/16 to-orange-300/10 text-amber-700 ring-amber-100',
    rose: 'from-rose-400/16 to-orange-300/10 text-rose-700 ring-rose-100',
    violet: 'from-violet-400/16 to-blue-300/10 text-violet-700 ring-violet-100',
    slate: 'from-slate-400/16 to-blue-200/10 text-slate-600 ring-slate-200',
  }[tone];

  return (
    <div className="rounded-[20px] border border-white/80 bg-white/90 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div
        className={`inline-flex rounded-full bg-gradient-to-br px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ring-1 ${toneClass}`}
      >
        {label}
      </div>
      <div className="mt-4 text-[27px] font-semibold tracking-[-0.04em] text-slate-950">
        {value}
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-slate-500">{detail}</p>
    </div>
  );
}

export function AdminPanel({
  title,
  eyebrow,
  description,
  action,
  children,
  className = '',
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-[24px] border border-white/80 bg-white/90 shadow-[0_24px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-blue-50/80 via-white to-cyan-50/70 px-5 py-4">
        <div>
          {eyebrow ? (
            <span className="inline-flex rounded-full border border-blue-100 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
              {eyebrow}
            </span>
          ) : null}
          <h2 className={eyebrow ? 'mt-3 text-[18px] font-semibold tracking-[-0.035em] text-slate-950' : 'text-[15px] font-semibold text-slate-950'}>
            {title}
          </h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-slate-500">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function AdminPill({
  children,
  tone = 'slate',
}: {
  children: ReactNode;
  tone?: 'blue' | 'emerald' | 'amber' | 'rose' | 'violet' | 'slate';
}) {
  const toneClass = {
    blue: 'border-blue-100 bg-blue-50 text-blue-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
    violet: 'border-violet-200 bg-violet-50 text-violet-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
  }[tone];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ${toneClass}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export const adminInputClass =
  'h-12 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[14px] text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]';

export const adminTextareaClass =
  'rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-[14px] text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]';

export const adminPrimaryButtonClass =
  'inline-flex items-center justify-center rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-[0_16px_34px_rgba(47,90,243,0.24)] transition-all hover:-translate-y-0.5 hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60';

export const adminSecondaryButtonClass =
  'inline-flex items-center justify-center rounded-[12px] border border-slate-200 bg-white px-4 py-2.5 text-[13.5px] font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60';
