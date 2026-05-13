import { NextResponse, type NextRequest } from 'next/server';

// Edge middleware. Cheap presence-check on the session cookie so we
// can short-circuit unauthenticated requests to protected routes
// without touching the DB. Real session validation happens in the page
// RSC via requireUser() (Edge can't use Prisma).
//
// Public routes (no auth required):
//   /             -> root redirector (server component decides)
//   /login        /forgot      /reset/:token       /invite/:token
//   /api/health   /_next/...   /favicon...         /static assets

const SESSION_COOKIE = 'bv_session';

const PUBLIC_PATHS = new Set<string>([
  '/login',
  '/forgot',
  '/api/health',
]);

const PUBLIC_PREFIXES = ['/reset/', '/invite/'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  for (const p of PUBLIC_PREFIXES) {
    if (pathname.startsWith(p)) return true;
  }
  return false;
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;

  // The root path is handled by app/page.tsx, which decides redirect
  // direction based on session presence. Don't gate it here.
  if (pathname === '/') return NextResponse.next();

  if (isPublic(pathname)) return NextResponse.next();

  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = ''; // build cleanly
  // Preserve the original destination so successful login can return.
  // Strip only the leading slash; keep query for deep-link drawers.
  const next = `${pathname}${search}`;
  loginUrl.searchParams.set('next', next);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on every request EXCEPT Next internals and obvious static assets.
  // We explicitly include /api so that /api/* (other than /api/health, which
  // the function above whitelists) is also gated.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|map)$).*)',
  ],
};
