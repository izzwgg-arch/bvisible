import { logoutAction } from '@/app/(app)/settings/actions';
import Link from 'next/link';

export function UserMenu({
  email,
  name,
  workspaceLabel,
  roleLabel,
}: {
  email: string;
  name: string | null;
  workspaceLabel: string;
  roleLabel: string;
}) {
  return (
    <div className="mt-4 shrink-0 rounded-[22px] border border-[#eadfd3]/90 bg-white/78 p-3 shadow-[0_18px_42px_rgba(28,73,114,0.10)] backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <div
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#F28744]/25 bg-[#fff0e5] text-[#F28744] shadow-[0_10px_22px_rgba(242,135,68,0.14)]"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
            <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
          </svg>
        </div>
        <div className="min-w-0 flex-1 leading-snug">
          <span className="block truncate text-[13px] font-semibold text-[#1C4972]">
            {name || email}
          </span>
          <span className="mt-0.5 block text-[11.5px] text-[#6d7480]">
            {workspaceLabel}
          </span>
          <span className="mt-2 inline-flex rounded-full border border-[#eadfd3] bg-[#f8f4ef] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6d7480]">
            {roleLabel}
          </span>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Link
          href="/settings"
          className="inline-flex flex-1 items-center justify-center rounded-[12px] border border-[#eadfd3] bg-white px-3 py-2 text-[12px] font-semibold text-[#1C4972] transition-colors hover:bg-[#f8f4ef]"
        >
          Settings
        </Link>
        <form action={logoutAction} className="flex-1">
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-[12px] bg-[#F28744] px-3 py-2 text-[12px] font-semibold text-white shadow-[0_12px_24px_rgba(242,135,68,0.22)] transition-opacity hover:opacity-90"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
