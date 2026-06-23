const skeletonClass = 'animate-pulse rounded-[18px] bg-white/70 shadow-sm ring-1 ring-white/80';

export default function AppLoading() {
  return (
    <div aria-label="Loading page" aria-live="polite" className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="h-9 w-56 animate-pulse rounded-full bg-white/75 ring-1 ring-white/80" />
          <div className="mt-3 h-4 w-full max-w-xl animate-pulse rounded-full bg-white/65 ring-1 ring-white/80" />
        </div>
        <div className="h-10 w-32 animate-pulse rounded-[12px] bg-white/75 ring-1 ring-white/80" />
      </div>

      <section className="grid gap-3 sm:grid-cols-4">
        <div className={`${skeletonClass} h-24`} />
        <div className={`${skeletonClass} h-24`} />
        <div className={`${skeletonClass} h-24`} />
        <div className={`${skeletonClass} h-24`} />
      </section>

      <section className={`${skeletonClass} h-20`} />

      <section className="grid gap-3">
        <div className={`${skeletonClass} h-20`} />
        <div className={`${skeletonClass} h-20`} />
        <div className={`${skeletonClass} h-20`} />
      </section>
    </div>
  );
}
