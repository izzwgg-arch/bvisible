import Link from 'next/link';

export const DEFAULT_PAGE_SIZE = 100;

export function parsePageParam(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function pageSkip(page: number, pageSize = DEFAULT_PAGE_SIZE): number {
  return (Math.max(1, page) - 1) * pageSize;
}

export function PaginationControls({
  basePath,
  page,
  pageSize = DEFAULT_PAGE_SIZE,
  total,
  params = {},
}: {
  basePath: string;
  page: number;
  pageSize?: number;
  total: number;
  params?: Record<string, string | number | null | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(total, currentPage * pageSize);

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white/80 px-5 py-4 text-[12.5px] text-slate-500">
      <div>
        Showing <span className="font-semibold text-slate-800">{start}-{end}</span> of{' '}
        <span className="font-semibold text-slate-800">{total}</span>
      </div>
      <div className="flex items-center gap-2">
        <PageButton
          disabled={currentPage <= 1}
          href={pageHref(basePath, params, currentPage - 1)}
          label="Previous"
        />
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-600">
          Page {currentPage} of {totalPages}
        </span>
        <PageButton
          disabled={currentPage >= totalPages}
          href={pageHref(basePath, params, currentPage + 1)}
          label="Next"
        />
      </div>
    </nav>
  );
}

function PageButton({ disabled, href, label }: { disabled: boolean; href: string; label: string }) {
  if (disabled) {
    return (
      <span className="rounded-[12px] border border-slate-100 bg-slate-50 px-4 py-2 font-semibold text-slate-300">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="rounded-[12px] border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50"
    >
      {label}
    </Link>
  );
}

function pageHref(
  basePath: string,
  params: Record<string, string | number | null | undefined>,
  page: number,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '' || (key === 'page' && Number(value) <= 1)) continue;
    search.set(key, String(value));
  }
  if (page > 1) search.set('page', String(page));
  else search.delete('page');
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}
