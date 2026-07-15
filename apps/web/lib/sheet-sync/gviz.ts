// Server-side Google Visualization (GViz) reader for the live pricing
// Sheet. The Sheet is link-viewable, so the JSON endpoint needs no key.
// The response is JS wrapped in `google.visualization.Query.setResponse(…)`
// — we strip the wrapper and JSON.parse the payload.

const DEFAULT_SHEET_ID = '1mvk26cMgwpPE3nEYSHmOtKTNcoRvTvdIJGNssDR1yiI';

export function pricingSheetId(): string {
  return process.env.BVISIBLE_PRICING_SHEET_ID?.trim() || DEFAULT_SHEET_ID;
}

export function pricingSheetUrl(): string {
  return `https://docs.google.com/spreadsheets/d/${pricingSheetId()}/edit`;
}

export type GvizCell = { v?: string | number | boolean | null; f?: string } | null;
export interface GvizTable {
  cols?: Array<{ label?: string }>;
  rows?: Array<{ c?: GvizCell[] }>;
}

export function gvizValue(row: { c?: GvizCell[] }, index: number): string | number | boolean {
  const v = row.c?.[index]?.v;
  return v === null || v === undefined ? '' : v;
}

export function gvizString(row: { c?: GvizCell[] }, index: number): string {
  return String(gvizValue(row, index)).trim();
}

export function gvizNumber(row: { c?: GvizCell[] }, index: number): number {
  const n = Number(gvizValue(row, index));
  return Number.isFinite(n) ? n : 0;
}

export function gvizBool(row: { c?: GvizCell[] }, index: number): boolean {
  const v = gvizValue(row, index);
  return v === true || String(v).toUpperCase() === 'TRUE';
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export async function fetchSheetTab(tab: string): Promise<GvizTable> {
  const url = `https://docs.google.com/spreadsheets/d/${pricingSheetId()}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}&t=${Date.now()}`;
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { 'user-agent': 'bvisible-sheet-sync/1.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`Google Sheet tab "${tab}" returned HTTP ${res.status}`);
  }
  const text = await res.text();
  const start = text.indexOf('setResponse(');
  const end = text.lastIndexOf(')');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Google Sheet tab "${tab}" returned an unexpected payload — is the Sheet shared as "anyone with the link can view"?`);
  }
  const payload = JSON.parse(text.slice(start + 'setResponse('.length, end)) as {
    status?: string;
    errors?: Array<{ message?: string }>;
    table?: GvizTable;
  };
  if (payload.status === 'error') {
    throw new Error(payload.errors?.[0]?.message ?? `Google Sheet error on tab "${tab}"`);
  }
  return payload.table ?? {};
}
