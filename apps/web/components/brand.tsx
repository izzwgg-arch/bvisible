import { cn } from '@/lib/cn';

export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center', className)}>
      <div className="w-full max-w-[228px] rounded-[20px] border border-white/75 bg-white/58 px-3 py-2 shadow-[0_10px_28px_rgba(28,73,114,0.10)] backdrop-blur-xl">
        <img
          src="/brand/b-visible-logo.png"
          alt="B Visible Signs and Printing"
          className="h-auto w-full object-contain drop-shadow-[0_1px_0_rgba(255,255,255,0.55)]"
        />
      </div>
    </div>
  );
}
