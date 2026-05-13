import { cn } from '@/lib/cn';

export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div
        aria-hidden
        className="grid h-8 w-8 place-items-center rounded-[10px] bg-[var(--color-bv-accent)] text-[15px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-sm"
      >
        BV
      </div>
      <div className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-tight text-[var(--color-bv-text)]">
          B Visible
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-bv-muted)]">
          Operations
        </span>
      </div>
    </div>
  );
}
