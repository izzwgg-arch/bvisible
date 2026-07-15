'use client';

import { useEffect, useState, type ReactNode } from 'react';

const SIDEBAR_COLLAPSED_KEY = 'bv-sidebar-collapsed';

// Client shell around the app grid so the sidebar can collapse to an
// icon rail. The nav/brand/user-menu nodes are rendered on the server
// and passed through; collapsed styling is CSS-driven via the
// `data-collapsed` attribute + `group-data-[collapsed]:*` variants, so
// the server-rendered children don't need any client state.
export function SidebarFrame({
  brand,
  nav,
  userMenu,
  children,
}: {
  brand: ReactNode;
  nav: ReactNode;
  userMenu: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true');
  }, []);

  function toggle() {
    setCollapsed((current) => {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(!current));
      return !current;
    });
  }

  return (
    <div
      className={`grid h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(242,135,68,0.18)_0,transparent_31%),radial-gradient(circle_at_top_right,rgba(18,64,100,0.14)_0,transparent_28%),linear-gradient(135deg,#fffaf4_0%,#f8f4ef_44%,#f6efe8_100%)] max-lg:block print:block print:h-auto print:overflow-visible ${
        collapsed
          ? 'grid-cols-[72px_minmax(0,1fr)]'
          : 'grid-cols-[minmax(220px,252px)_minmax(0,1fr)] min-[1500px]:grid-cols-[292px_minmax(0,1fr)]'
      }`}
    >
      <aside
        data-collapsed={collapsed ? '' : undefined}
        className={`group relative flex h-screen min-w-0 flex-col overflow-hidden border-r border-[#eadfd3]/90 bg-[#fff8f0]/92 py-4 shadow-[18px_0_54px_rgba(28,73,114,0.10)] backdrop-blur-2xl [--color-bv-bg:#f8f4ef] [--color-bv-border:#eadfd3] [--color-bv-muted:#6d7480] [--color-bv-surface:#fffdfa] [--color-bv-text:#1C4972] max-lg:hidden print:hidden ${
          collapsed ? 'px-2' : 'px-3 min-[1500px]:px-4 min-[1500px]:py-5'
        }`}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -left-28 top-0 h-64 w-64 rounded-full bg-[#d8e8f3]/75 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-20 right-[-7rem] h-72 w-72 rounded-full bg-[#F28744]/16 blur-3xl"
        />
        <div className="relative flex shrink-0 flex-col pb-3">
          <div className={collapsed ? 'hidden' : 'block'}>{brand}</div>
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`flex h-7 items-center justify-center rounded-[10px] border border-[#eadfd3] bg-white/80 text-[#6f8799] transition hover:bg-[#fff0e5] hover:text-[#F28744] ${
              collapsed ? 'mx-auto w-8' : 'ml-auto w-8'
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              className={`h-4 w-4 transition-transform ${collapsed ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 6-6 6 6 6" />
            </svg>
          </button>
        </div>
        {nav}
        <div className={`relative ${collapsed ? 'hidden' : ''}`}>{userMenu}</div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col overflow-y-auto overflow-x-hidden">
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-5 lg:px-6 xl:px-7 min-[1500px]:px-8 min-[1500px]:py-8 print:px-0 print:py-0">
          {children}
        </main>
      </div>
    </div>
  );
}
