import { headers } from 'next/headers';

/** Public absolute URL for links in outbound mail (trusts nginx forwarded headers). */
export async function buildAppAbsoluteUrl(path: string): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const proto = (h.get('x-forwarded-proto') ?? 'http').split(',')[0]?.trim() ?? 'http';
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${proto}://${host}${p}`;
}
