/**
 * Put (or repair) the header row on the Sheet's "APP SYNC" tab.
 *
 * Every app→Sheet write is logged there with the value that was in the cell
 * beforehand, so each entry can be reversed. The header names those columns
 * so the tab is readable without consulting the code.
 *
 * Safe to re-run: if the header is already in row 1 it changes nothing, and
 * when it is missing a blank row is INSERTED above the existing entries
 * rather than overwriting one.
 *
 * Run on the production server:
 *   cd /opt/bvisible/app
 *   ( set -a; . /opt/bvisible/shared/env/.env; set +a; \
 *     pnpm --filter @bvisible/web run sheet:app-sync-header )
 */
import { createSign } from 'node:crypto';

import { pricingSheetId } from '../lib/sheet-sync/gviz';
import { SYNC_HEADER } from '../lib/sheet-sync/writeback';

const SYNC_TAB = 'APP SYNC';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

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

  // Locate the tab and its numeric id (needed for insert/format calls).
  const metaRes = await fetch(`${api}?fields=sheets.properties`, { headers: auth });
  if (!metaRes.ok) throw new Error(`Cannot read spreadsheet: ${metaRes.status}`);
  const meta = (await metaRes.json()) as {
    sheets: Array<{ properties: { sheetId: number; title: string } }>;
  };
  const tab = meta.sheets.find((s) => s.properties.title === SYNC_TAB);
  if (!tab) {
    throw new Error(`No "${SYNC_TAB}" tab in the Sheet — create it first (the app never does).`);
  }
  const tabId = tab.properties.sheetId;

  // Already correct? Then this is a no-op.
  const firstRowRes = await fetch(
    `${api}/values/${encodeURIComponent(`${SYNC_TAB}!A1:I1`)}`,
    { headers: auth },
  );
  const firstRow = ((await firstRowRes.json()) as { values?: string[][] }).values?.[0] ?? [];
  if (firstRow[0] === SYNC_HEADER[0] && firstRow[4] === SYNC_HEADER[4]) {
    console.log('Header already present — nothing to do.');
    return;
  }

  // Push existing entries down so none is overwritten, then freeze + bold row 1.
  const hasExistingRows = firstRow.length > 0;
  const requests: unknown[] = [];
  if (hasExistingRows) {
    requests.push({
      insertDimension: {
        range: { sheetId: tabId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        inheritFromBefore: false,
      },
    });
  }
  requests.push(
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId: tabId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
  );

  const batchRes = await fetch(`${api}:batchUpdate`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ requests }),
  });
  if (!batchRes.ok) {
    throw new Error(`batchUpdate failed: ${batchRes.status} ${await batchRes.text()}`);
  }

  const writeRes = await fetch(
    `${api}/values/${encodeURIComponent(`${SYNC_TAB}!A1:I1`)}?valueInputOption=RAW`,
    { method: 'PUT', headers: auth, body: JSON.stringify({ values: [[...SYNC_HEADER]] }) },
  );
  if (!writeRes.ok) {
    throw new Error(`Header write failed: ${writeRes.status} ${await writeRes.text()}`);
  }

  console.log(
    `Header written to "${SYNC_TAB}" (${SYNC_HEADER.length} columns)` +
      (hasExistingRows ? ', existing entries shifted down one row.' : '.'),
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
