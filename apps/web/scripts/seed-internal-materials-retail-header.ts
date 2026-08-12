/**
 * Add the retail columns — N "Product URL" and O "SKU / ASIN" — to the
 * Sheet's "Internal Materials" tab.
 *
 * WHY: the shop-order Amazon cart can only be built when EVERY line on the
 * order resolves to an ASIN. Internal Materials is where the retail shop
 * supplies live (blue tape, adhesives, primers), and the tab shipped with no
 * column able to hold a product link or ASIN — so the cart URL was null for
 * every Amazon PO and the office was told a cart had opened when none had.
 * These two columns are the missing input.
 *
 * SAFETY: this refuses to write if anything is already present anywhere in
 * column N or O. It only ever fills two empty header cells — it never touches
 * a data row, and it never overwrites. Safe to re-run: a correct header is a
 * no-op. The write is logged to APP SYNC like every other app→Sheet write.
 *
 * It also reports which active retail rows still need a value, since the
 * columns are worthless until someone fills them in.
 *
 * Run on the production server (where the service-account creds live):
 *   cd /opt/bvisible/app
 *   ( set -a; . /opt/bvisible/shared/env/.env; set +a; \
 *     pnpm --filter @bvisible/web run sheet:internal-materials-retail-header )
 */
import { createSign } from 'node:crypto';

import { pricingSheetId } from '../lib/sheet-sync/gviz';
import {
  INTERNAL_MATERIALS_PRODUCT_URL_COL,
  INTERNAL_MATERIALS_RETAIL_HEADER,
  INTERNAL_MATERIALS_SKU_COL,
  INTERNAL_MATERIALS_TAB,
} from '../lib/sheet-sync/types';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const SYNC_TAB = 'APP SYNC';

/** Vendors whose orders are placed on the vendor's website — mirrors RETAIL_VENDOR_RE. */
const RETAIL_VENDOR_RE =
  /amazon|home\s*depot|walmart|lowe'?s|staples|office\s*depot|target|best\s*buy|ebay/i;

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

const URL_COL = colLetter(INTERNAL_MATERIALS_PRODUCT_URL_COL); // N
const SKU_COL = colLetter(INTERNAL_MATERIALS_SKU_COL); // O

function creds(): { email: string; key: string } {
  const email = process.env.SHEETS_WRITEBACK_SA_EMAIL ?? '';
  const key = (process.env.SHEETS_WRITEBACK_SA_KEY ?? '').replace(/\\n/g, '\n');
  if (!email || !key) {
    throw new Error('SHEETS_WRITEBACK_SA_EMAIL / SHEETS_WRITEBACK_SA_KEY are not set.');
  }
  return { email, key };
}

async function accessToken(): Promise<string> {
  const { email, key } = creds();
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const jwt = `${unsigned}.${signer.sign(key, 'base64url')}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!json.access_token) {
    throw new Error(`Token request failed: ${json.error_description ?? res.status}`);
  }
  return json.access_token;
}

async function main(): Promise<void> {
  const token = await accessToken();
  const sheetId = pricingSheetId();
  const api = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const metaRes = await fetch(`${api}?fields=sheets.properties`, { headers: auth });
  if (!metaRes.ok) throw new Error(`Cannot read spreadsheet: ${metaRes.status}`);
  const meta = (await metaRes.json()) as {
    sheets: Array<{ properties: { sheetId: number; title: string } }>;
  };
  const tab = meta.sheets.find((s) => s.properties.title === INTERNAL_MATERIALS_TAB);
  if (!tab) throw new Error(`No "${INTERNAL_MATERIALS_TAB}" tab in the Sheet.`);
  const tabId = tab.properties.sheetId;

  // Read both columns whole. Two guards come out of this: the no-op check
  // (header already correct) and the refusal (anything else living there).
  const colsRes = await fetch(
    `${api}/values/${encodeURIComponent(`${INTERNAL_MATERIALS_TAB}!${URL_COL}:${SKU_COL}`)}`,
    { headers: auth },
  );
  if (!colsRes.ok) throw new Error(`Cannot read ${URL_COL}:${SKU_COL}: ${colsRes.status}`);
  const rows = ((await colsRes.json()) as { values?: string[][] }).values ?? [];

  const header = rows[0] ?? [];
  const headerCorrect =
    header[0] === INTERNAL_MATERIALS_RETAIL_HEADER[0] &&
    header[1] === INTERNAL_MATERIALS_RETAIL_HEADER[1];

  // Any non-empty cell below row 1, or a DIFFERENT header, means these columns
  // are already in use for something else. Stop rather than destroy it.
  const occupiedBelow = rows
    .slice(1)
    .flatMap((r, i) => (r ?? []).map((v, c) => ({ v, ref: `${colLetter(INTERNAL_MATERIALS_PRODUCT_URL_COL + c)}${i + 2}` })))
    .filter((x) => String(x.v ?? '').trim() !== '');

  if (!headerCorrect && (header.some((h) => String(h ?? '').trim() !== '') || occupiedBelow.length > 0)) {
    console.error(
      `REFUSING to write: ${URL_COL}/${SKU_COL} on "${INTERNAL_MATERIALS_TAB}" already hold data.\n` +
        `  header: ${JSON.stringify(header)}\n` +
        `  ${occupiedBelow.length} non-empty cell(s) below, e.g. ${occupiedBelow.slice(0, 5).map((x) => x.ref).join(', ')}\n` +
        'Move that content or point the retail columns elsewhere (types.ts INTERNAL_MATERIALS_*_COL).',
    );
    process.exit(1);
  }

  if (headerCorrect) {
    console.log('Header already present — nothing to write.');
  } else {
    const writeRes = await fetch(
      `${api}/values/${encodeURIComponent(`${INTERNAL_MATERIALS_TAB}!${URL_COL}1:${SKU_COL}1`)}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify({ values: [[...INTERNAL_MATERIALS_RETAIL_HEADER]] }),
      },
    );
    if (!writeRes.ok) {
      throw new Error(`Header write failed: ${writeRes.status} ${await writeRes.text()}`);
    }

    // Match the tab's existing header styling.
    await fetch(`${api}:batchUpdate`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: tabId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: INTERNAL_MATERIALS_PRODUCT_URL_COL,
                endColumnIndex: INTERNAL_MATERIALS_SKU_COL + 1,
              },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: 'userEnteredFormat.textFormat.bold',
            },
          },
        ],
      }),
    });

    // Audit trail, same as every other app→Sheet write.
    await fetch(
      `${api}/values/${encodeURIComponent(`${SYNC_TAB}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          values: [
            [
              new Date().toISOString(),
              'sheet-schema',
              INTERNAL_MATERIALS_TAB,
              `added retail columns ${URL_COL}/${SKU_COL}`,
              '',
              INTERNAL_MATERIALS_RETAIL_HEADER.join(' | '),
              `${INTERNAL_MATERIALS_TAB}!${URL_COL}1:${SKU_COL}1`,
              `Clear ${URL_COL}1 and ${SKU_COL}1 (both were empty before).`,
              'B Visible app',
            ],
          ],
        }),
      },
    ).catch(() => {
      /* APP SYNC tab may not exist — never fail the seed over the log */
    });

    console.log(
      `Wrote "${INTERNAL_MATERIALS_RETAIL_HEADER[0]}" to ${URL_COL}1 and ` +
        `"${INTERNAL_MATERIALS_RETAIL_HEADER[1]}" to ${SKU_COL}1 on "${INTERNAL_MATERIALS_TAB}".`,
    );
  }

  // The columns do nothing until they hold values — report what is still blank
  // so the office knows exactly how much work is left and where.
  const dataRes = await fetch(
    `${api}/values/${encodeURIComponent(`${INTERNAL_MATERIALS_TAB}!A1:${SKU_COL}`)}`,
    { headers: auth },
  );
  const data = ((await dataRes.json()) as { values?: string[][] }).values ?? [];
  const pending: string[] = [];
  for (let i = 1; i < data.length; i += 1) {
    const r = data[i] ?? [];
    const active = String(r[12] ?? '').toUpperCase() === 'TRUE';
    if (!active) continue;
    const vendorText = `${r[7] ?? ''} ${r[8] ?? ''} ${r[9] ?? ''}`;
    if (!RETAIL_VENDOR_RE.test(vendorText)) continue;
    const hasUrl = String(r[INTERNAL_MATERIALS_PRODUCT_URL_COL] ?? '').trim() !== '';
    const hasSku = String(r[INTERNAL_MATERIALS_SKU_COL] ?? '').trim() !== '';
    if (hasUrl || hasSku) continue;
    const vendor = RETAIL_VENDOR_RE.exec(vendorText)?.[0] ?? '?';
    pending.push(`  row ${i + 1}  [${vendor}]  ${r[3] ?? ''} ${r[4] ?? ''} ${r[5] ?? ''}`.trimEnd());
  }

  if (pending.length === 0) {
    console.log('\nEvery active retail row already has a product URL or SKU.');
  } else {
    console.log(
      `\n${pending.length} active retail row(s) still need a product URL or ASIN.\n` +
        'An Amazon cart needs one for EVERY line on the order, so until these are\n' +
        'filled the shop-order flow falls back to per-item store searches:\n',
    );
    for (const line of pending) console.log(line);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
