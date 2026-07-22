// DB → Google Sheet write-back. The Sheet is the source of truth, so any
// change made INSIDE the app to a Sheet-owned record is pushed back to the
// Sheet so the two never drift.
//
// Auth: a Google service account (the owner creates it once and shares the
// Sheet with its email). Credentials come from env:
//   SHEETS_WRITEBACK_SA_EMAIL  — the service account email
//   SHEETS_WRITEBACK_SA_KEY    — its private key PEM ("\n"-escaped allowed)
// Without credentials every function is a silent no-op (logged once), so
// the app works normally before the owner finishes setup.
//
// HARD RULES (owner's requirements):
//  1. The SHEET IS ALWAYS THE SOURCE OF TRUTH. Write-back mirrors app
//     edits into the Sheet; afterwards the regular pull re-imports the
//     Sheet, so any conflict resolves to whatever the Sheet says.
//  2. NO DUPLICATES, EVER — on either side:
//       · Sheet side: every write first looks the row up by name and
//         UPDATES it; a new row is appended only when no row matches.
//       · DB side: the pull upserts by sheetKey / normalized name, and
//         app creates refuse names that already exist.
//  3. We NEVER overwrite a formula cell — if the target cell holds a
//     formula, the value is logged to the "APP SYNC" tab instead.
//  4. Every write is appended to "APP SYNC" as an audit trail readable
//     inside the Sheet.

import { createSign } from 'node:crypto';
import { pricingSheetId } from './gviz';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const SYNC_TAB = 'APP SYNC';

let warnedNoCreds = false;

function creds(): { email: string; key: string } | null {
  const email = process.env.SHEETS_WRITEBACK_SA_EMAIL ?? '';
  const key = (process.env.SHEETS_WRITEBACK_SA_KEY ?? '').replace(/\\n/g, '\n');
  if (!email || !key) {
    if (!warnedNoCreds) {
      console.log('[sheet-writeback] not configured (SHEETS_WRITEBACK_SA_EMAIL / _KEY missing) — app→Sheet sync disabled');
      warnedNoCreds = true;
    }
    return null;
  }
  return { email, key };
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string | null> {
  const c = creds();
  if (!c) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: c.email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const jwt = `${unsigned}.${signer.sign(c.key).toString('base64url')}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    console.error('[sheet-writeback] token request failed:', res.status, (await res.text()).slice(0, 200));
    return null;
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function sheetsFetch(path: string, init?: RequestInit): Promise<Response | null> {
  const token = await accessToken();
  if (!token) return null;
  return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${pricingSheetId()}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
}

async function getValues(range: string, render: 'FORMATTED_VALUE' | 'FORMULA' = 'FORMATTED_VALUE'): Promise<string[][] | null> {
  const res = await sheetsFetch(`/values/${encodeURIComponent(range)}?valueRenderOption=${render}`);
  if (!res || !res.ok) return null;
  const json = (await res.json()) as { values?: string[][] };
  return json.values ?? [];
}

async function setValue(range: string, value: string | number): Promise<boolean> {
  const res = await sheetsFetch(`/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [[value]] }),
  });
  return !!res && res.ok;
}

async function appendRow(tab: string, row: Array<string | number>): Promise<boolean> {
  const res = await sheetsFetch(`/values/${encodeURIComponent(`${tab}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: [row] }),
  });
  return !!res && res.ok;
}

/// Append a human-readable entry to the APP SYNC tab (created by the
/// owner or auto-created by the first append if the tab exists). Never
/// throws — sync must not break app saves.
async function logToSheet(entity: string, name: string, field: string, value: string): Promise<void> {
  try {
    await appendRow(SYNC_TAB, [new Date().toISOString(), entity, name, field, value, 'B Visible app']);
  } catch {
    /* tab may not exist yet — owner creates "APP SYNC" once */
  }
}

function colLetter(index0: number): string {
  let n = index0 + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/// Find the row (1-based) of a material in "Meterial price" by name
/// (column A, case-insensitive).
async function findRowByName(tab: string, nameCol: number, name: string): Promise<number | null> {
  const col = colLetter(nameCol);
  const values = await getValues(`${tab}!${col}:${col}`);
  if (!values) return null;
  const needle = name.trim().toLowerCase();
  for (let i = 0; i < values.length; i += 1) {
    if ((values[i]?.[0] ?? '').trim().toLowerCase() === needle) return i + 1;
  }
  return null;
}

/// Guarded single-cell update: refuses to overwrite formulas (appends to
/// APP SYNC instead) so the owner's sheet logic is never destroyed.
async function guardedUpdate(tab: string, row: number, col0: number, value: string | number, ctx: { entity: string; name: string; field: string }): Promise<'updated' | 'formula-skipped' | 'failed'> {
  const cell = `${tab}!${colLetter(col0)}${row}`;
  const formula = await getValues(cell, 'FORMULA');
  const raw = formula?.[0]?.[0] ?? '';
  if (typeof raw === 'string' && raw.startsWith('=')) {
    await logToSheet(ctx.entity, ctx.name, `${ctx.field} (cell ${cell} is a formula — NOT overwritten)`, String(value));
    return 'formula-skipped';
  }
  const ok = await setValue(cell, value);
  if (ok) await logToSheet(ctx.entity, ctx.name, ctx.field, String(value));
  return ok ? 'updated' : 'failed';
}

/* ------------------------- public write-backs ------------------------- */
// All are fire-and-forget safe: they never throw and never block a save
// on failure — the Sheet pull (5 min / webhook) remains the reconciler.

/// Material price changed in the app → update the Sheet's cheapest-price
/// column (col K = index 10) for that material row.
export async function writebackMaterialPrice(name: string, priceCents: number): Promise<void> {
  try {
    if (!creds()) return;
    const row = await findRowByName('Meterial price', 0, name);
    if (row == null) {
      await logToSheet('material', name, 'price (row not found in Sheet)', `$${(priceCents / 100).toFixed(2)}`);
      return;
    }
    await guardedUpdate('Meterial price', row, 10, priceCents / 100, { entity: 'material', name, field: 'price' });
  } catch (e) {
    console.error('[sheet-writeback] material price failed:', e);
  }
}

/// Material renamed in the app → update the Sheet name cell (col A).
export async function writebackMaterialRename(oldName: string, newName: string): Promise<void> {
  try {
    if (!creds()) return;
    const row = await findRowByName('Meterial price', 0, oldName);
    if (row == null) {
      await logToSheet('material', oldName, 'rename (row not found in Sheet)', newName);
      return;
    }
    await guardedUpdate('Meterial price', row, 0, newName, { entity: 'material', name: oldName, field: 'renamed to' });
  } catch (e) {
    console.error('[sheet-writeback] material rename failed:', e);
  }
}

/// New catalog item created in the app → put it in the Sheet, WITHOUT ever
/// creating a duplicate: if a row with the same name already exists, we
/// update its price instead of appending. The Sheet stays the single
/// master list.
export async function writebackMaterialCreate(name: string, category: string, priceCents: number): Promise<void> {
  try {
    if (!creds()) return;
    const existing = await findRowByName('Meterial price', 0, name);
    if (existing != null) {
      // Anti-duplicate guardrail: row already in the Sheet — sync the
      // price into it rather than appending a second copy.
      await guardedUpdate('Meterial price', existing, 10, priceCents / 100, { entity: 'material', name, field: 'price (create matched existing row)' });
      return;
    }
    const row: Array<string | number> = [name, category, name, '', '', '', '', '', '', '', priceCents / 100, 'B Visible app'];
    const ok = await appendRow('Meterial price', row);
    if (ok) await logToSheet('material', name, 'created', `$${(priceCents / 100).toFixed(2)} (${category})`);
  } catch (e) {
    console.error('[sheet-writeback] material create failed:', e);
  }
}

/// Vendor created/edited in the app → update or append the Vendor
/// Directory row (name in col A, email col B, phone col D).
export async function writebackVendor(name: string, fields: { newName?: string; email?: string; phone?: string }): Promise<void> {
  try {
    if (!creds()) return;
    const row = await findRowByName('Vendor Directory', 0, name);
    if (row == null) {
      const ok = await appendRow('Vendor Directory', [fields.newName ?? name, fields.email ?? '', '', fields.phone ?? '', '', '', 'TRUE', 'B Visible app']);
      if (ok) await logToSheet('vendor', fields.newName ?? name, 'created', fields.email ?? '');
      return;
    }
    if (fields.newName && fields.newName !== name) {
      await guardedUpdate('Vendor Directory', row, 0, fields.newName, { entity: 'vendor', name, field: 'renamed to' });
    }
    if (fields.email != null) {
      await guardedUpdate('Vendor Directory', row, 1, fields.email, { entity: 'vendor', name, field: 'email' });
    }
    if (fields.phone != null) {
      await guardedUpdate('Vendor Directory', row, 3, fields.phone, { entity: 'vendor', name, field: 'phone' });
    }
  } catch (e) {
    console.error('[sheet-writeback] vendor failed:', e);
  }
}

/// True when write-back is configured (used for status displays).
export function writebackConfigured(): boolean {
  return creds() != null;
}
