/** Extract client meta from an inbound HTTP Request (nginx-forwarded). */
export function requestMeta(req: Request): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const xff = req.headers.get('x-forwarded-for');
  const xri = req.headers.get('x-real-ip');
  const ipAddress =
    (xff?.split(',')[0]?.trim() || xri || '').slice(0, 64) || null;
  const userAgent = req.headers.get('user-agent')?.slice(0, 256) ?? null;
  return { ipAddress, userAgent };
}

export function publicRequestBaseUrl(req: Request): string {
  const host =
    req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  const proto = (
    req.headers.get('x-forwarded-proto') ?? 'https'
  ).split(',')[0]?.trim();
  return `${proto}://${host}`;
}
