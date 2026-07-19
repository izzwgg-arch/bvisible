import { NextResponse, type NextRequest } from 'next/server';

// Edge middleware. Cheap presence-check on the session cookie so we
// can short-circuit unauthenticated requests to protected routes
// without touching the DB. Real session validation happens in the page
// RSC via requireUser() (Edge can't use Prisma).
//
// Public routes (no auth required):
//   /             -> root redirector (server component decides)
//   /login        /forgot      /reset/:token       /invite/:token
//   /quote/[token] -> read-only customer estimate quote (tokenized)
//   /api/health   /_next/...   /favicon...         /static assets

const SESSION_COOKIE = 'bv_session';

const MOBILE_API_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

const PUBLIC_PATHS = new Set<string>([
  '/login',
  '/forgot',
  '/api/health',
  // Internal-only ingest tick. Authenticated by the route handler via
  // constant-time compare against INGEST_TICK_SECRET (apps/web/app/api/
  // internal/email-ingest/tick/route.ts). The middleware can't see the
  // header conveniently and shouldn't redirect a service-to-service POST
  // to /login. The 127.0.0.1 bind + UFW keep this off the public net.
  '/api/internal/email-ingest/tick',
  // Internal OCR worker tick. Authenticated by the route handler via
  // constant-time compare against OCR_TICK_SECRET (or INGEST_TICK_SECRET
  // fallback) in apps/web/app/api/internal/ocr/tick/route.ts.
  '/api/internal/ocr/tick',
  // Same posture for the IMAP-test endpoint: shared-secret authed,
  // service-to-service. The in-app SUPER_ADMIN form does NOT call this
  // route — it goes through a server action — so no browser path needs
  // a session cookie here.
  '/api/internal/email-ingest/test',
  // Recycle-bin nightly purge. Guarded in the route by rejecting any
  // request carrying X-Forwarded-For (i.e. anything through nginx); only a
  // direct 127.0.0.1 call from the systemd timer is accepted.
  '/api/internal/recycle-purge',
]);

const PUBLIC_PREFIXES = ['/reset/', '/invite/'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  for (const p of PUBLIC_PREFIXES) {
    if (pathname.startsWith(p)) return true;
  }
  return false;
}

function withPublicQuoteHeaders(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'private, no-store, max-age=0');
  res.headers.set('Pragma', 'no-cache');
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  return res;
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;

  // Mobile REST API: Bearer JWT only (no browser session cookie).
  // OPTIONS preflight + CORS so Expo/React Native can call from device.
  if (pathname.startsWith('/api/v1')) {
    if (req.method === 'OPTIONS') {
      return new NextResponse(null, { status: 204, headers: MOBILE_API_CORS });
    }
    const res = NextResponse.next();
    for (const [k, v] of Object.entries(MOBILE_API_CORS)) {
      res.headers.set(k, v);
    }
    return res;
  }

  // The root path is handled by app/page.tsx, which decides redirect
  // direction based on session presence. Don't gate it here.
  if (pathname === '/') return NextResponse.next();

  if (pathname === '/quote' || pathname.startsWith('/quote/')) {
    return withPublicQuoteHeaders(NextResponse.next());
  }

  if (isPublic(pathname)) return NextResponse.next();

  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  // Build the redirect from the FORWARDED host/proto, not from
  // req.nextUrl. Behind nginx, req.nextUrl.host is whatever Host header
  // nginx forwards (defaults to 127.0.0.1:3000), which produces a
  // broken absolute Location like https://localhost:3000/login. We
  // trust x-forwarded-host because nginx is the only thing reaching
  // this process — port 3000 binds to 127.0.0.1 only.
  const forwardedHost = req.headers.get('x-forwarded-host');
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const host = forwardedHost ?? req.headers.get('host') ?? req.nextUrl.host;
  const proto = forwardedProto ?? (host.endsWith(':3000') ? 'http' : 'https');

  const loginUrl = new URL(`${proto}://${host}/login`);
  // Preserve the original destination so successful login can return.
  loginUrl.searchParams.set('next', `${pathname}${search}`);
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
