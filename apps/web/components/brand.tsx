import { cn } from '@/lib/cn';

export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div
        aria-hidden
        className="grid h-10 w-10 place-items-center rounded-[14px] border border-blue-100 bg-[linear-gradient(135deg,#2563eb,#06b6d4)] text-[14px] font-semibold text-white shadow-[0_16px_30px_rgba(37,99,235,0.22)]"
      >
        BV
      </div>
      <div className="flex flex-col leading-none">
        <span className="text-[16px] font-semibold tracking-tight text-[var(--color-bv-text)]">
          B Visible
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-bv-muted)]">
          Ops intelligence
        </span>
      </div>
    </div>
  );
}
