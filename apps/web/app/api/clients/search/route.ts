import { NextResponse } from 'next/server';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';

// GET /api/clients/search?q=acme[&id=<clientId>]
// Typeahead backing for the customer picker. Returns a capped slice of the
// tenant's customers rather than the whole book (1,800+ and growing), so the
// New estimate page no longer has to ship every customer to the browser.
//
// `id` pins one specific customer into the response even when it doesn't
// match `q` — the picker needs the selected row present in its option list to
// render its own label.
export const dynamic = 'force-dynamic';

const LIMIT = 50;

export async function GET(request: Request) {
  const me = await requireTenantId();

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const pinnedId = (url.searchParams.get('id') ?? '').trim();

  const [matches, pinned] = await Promise.all([
    prisma.client.findMany({
      where: {
        tenantId: me.tenantId,
        deletedAt: null,
        ...(q ? { companyName: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      orderBy: [{ companyName: 'asc' }],
      select: { id: true, companyName: true },
      take: LIMIT,
    }),
    pinnedId
      ? prisma.client.findFirst({
          where: { id: pinnedId, tenantId: me.tenantId, deletedAt: null },
          select: { id: true, companyName: true },
        })
      : Promise.resolve(null),
  ]);

  const clients =
    pinned && !matches.some((c) => c.id === pinned.id) ? [pinned, ...matches] : matches;

  return NextResponse.json({ clients, limit: LIMIT, truncated: matches.length === LIMIT });
}
