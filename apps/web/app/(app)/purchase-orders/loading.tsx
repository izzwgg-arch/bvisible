// Skeleton PO cards while the checklist loads — no full-page spinner.
export default function OrderedMaterialsLoading() {
  return (
    <div className="animate-pulse">
      <div className="h-8 w-64 rounded-[10px] bg-slate-200/70" />
      <div className="mt-2 h-4 w-96 max-w-full rounded bg-slate-200/50" />
      <div className="mt-6 flex gap-2">
        <div className="h-9 w-28 rounded-full bg-slate-200/70" />
        <div className="h-9 w-28 rounded-full bg-slate-200/50" />
      </div>
      <div className="mt-4 h-11 w-full max-w-xl rounded-[12px] bg-slate-200/50" />
      <div className="mt-5 space-y-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-white p-5"
          >
            <div className="h-5 w-72 max-w-full rounded bg-slate-200/70" />
            <div className="mt-4 space-y-3">
              <div className="h-10 w-full rounded-[10px] bg-slate-100" />
              <div className="h-10 w-full rounded-[10px] bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
