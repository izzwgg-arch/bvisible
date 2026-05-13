import { headers } from 'next/headers';

// Extract IP + user-agent from the request for audit logging. Behind
// nginx (which is our case), `x-forwarded-for` carries the real client
// IP. Fall back to `x-real-ip` if proxy chain is short, then to nothing.
export async function readRequestContext(): Promise<{
  ipAddress: string | null;
  userAgent: string | null;
}> {
  const h = await headers();
  const xff = h.get('x-forwarded-for');
  const xri = h.get('x-real-ip');
  // X-Forwarded-For is a CSV of proxies. The leftmost entry is the
  // original client (assuming we trust nginx, which we do).
  const ipAddress = (xff?.split(',')[0]?.trim() || xri || '').slice(0, 64) || null;
  const userAgent = h.get('user-agent')?.slice(0, 256) ?? null;
  return { ipAddress, userAgent };
}
