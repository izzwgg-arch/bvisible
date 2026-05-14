/** Safe JSON parse for small mobile API bodies (never logged). */
export async function parseJsonBody(req: Request): Promise<unknown | null> {
  try {
    const text = await req.text();
    if (!text.trim()) return {};
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
