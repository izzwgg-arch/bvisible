import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A syntactically valid throwaway RSA key so creds() resolves and the JWT
// signing path runs. Generated for this test only; it authenticates nothing.
import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

/**
 * The APP SYNC log is the rollback record: every write must land there with
 * the value that was in the cell *before* the app touched it, plus the exact
 * cell it wrote. Without those two columns an entry is an audit note, not
 * something you can undo. These tests pin that contract.
 */

type Call = { url: string; method: string; body: unknown };

let calls: Call[] = [];

/** Rows appended to the APP SYNC tab, in order. */
function syncRows(): string[][] {
  return calls
    .filter((c) => c.url.includes('APP%20SYNC') && c.method === 'POST')
    .flatMap((c) => (c.body as { values: string[][] }).values);
}

/** Column indexes — must match SYNC_HEADER in writeback.ts. */
const COL = { when: 0, entity: 1, name: 2, field: 3, was: 4, now: 5, cell: 6, undo: 7, source: 8 };

beforeEach(() => {
  vi.resetModules();
  calls = [];
  process.env.SHEETS_WRITEBACK_SA_EMAIL = 'test@example.iam.gserviceaccount.com';
  process.env.SHEETS_WRITEBACK_SA_KEY = privateKey.replace(/\n/g, '\\n');

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      let body: unknown = null;
      if (typeof init?.body === 'string') {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      calls.push({ url, method, body });

      // Token endpoint.
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'test-token' }), { status: 200 });
      }
      // Append.
      if (url.includes(':append')) {
        return new Response(
          JSON.stringify({ updates: { updatedRange: "'Meterial price'!A338:L338" } }),
          { status: 200 },
        );
      }
      // Reads: the name column for row lookup, or a single cell for the guard.
      if (method === 'GET') {
        if (/!A%3AA|!A:A/.test(url)) {
          // Column A of "Meterial price": row 3 holds our material.
          return new Response(
            JSON.stringify({ values: [['Name'], ['Other item'], ['Vinyl Roll 54"']] }),
            { status: 200 },
          );
        }
        // Single-cell FORMULA read — the pre-write value.
        return new Response(JSON.stringify({ values: [['12.5']] }), { status: 200 });
      }
      // PUT (the actual write).
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SHEETS_WRITEBACK_SA_EMAIL;
  delete process.env.SHEETS_WRITEBACK_SA_KEY;
});

describe('sheet write-back rollback record', () => {
  it('records the previous cell value and the cell it wrote', async () => {
    const { writebackMaterialPrice } = await import('./writeback');
    await writebackMaterialPrice('Vinyl Roll 54"', 1399);

    const rows = syncRows();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    expect(row[COL.entity]).toBe('material');
    expect(row[COL.name]).toBe('Vinyl Roll 54"');
    expect(row[COL.was]).toBe('12.5'); // what the cell held before
    expect(row[COL.now]).toBe('13.99'); // what the app wrote
    expect(row[COL.cell]).toBe('Meterial price!K3'); // price column, matched row
    expect(row[COL.undo]).toContain('12.5');
    expect(row[COL.source]).toBe('B Visible app');
  });

  it('writes the new value to the same cell it names in the log', async () => {
    const { writebackMaterialPrice } = await import('./writeback');
    await writebackMaterialPrice('Vinyl Roll 54"', 1399);

    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toBeDefined();
    // The cell recorded for rollback must be the cell actually written.
    expect(decodeURIComponent(put!.url)).toContain('Meterial price!K3');
    expect((put!.body as { values: number[][] }).values[0]![0]).toBe(13.99);
  });

  it('keeps a formula cell intact and says there is nothing to undo', async () => {
    const { writebackMaterialPrice } = await import('./writeback');
    // Re-stub so the guard read returns a formula.
    const original = globalThis.fetch as unknown as (i: string, r?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === undefined && !/!A%3AA|!A:A/.test(url) && !url.includes('oauth2')) {
        calls.push({ url, method: 'GET', body: null });
        return new Response(JSON.stringify({ values: [['=B3*1.2']] }), { status: 200 });
      }
      return original(String(input), init);
    });

    await writebackMaterialPrice('Vinyl Roll 54"', 1399);

    expect(calls.some((c) => c.method === 'PUT')).toBe(false); // never overwritten
    const row = syncRows()[0]!;
    expect(row[COL.field]).toContain('NOT overwritten');
    expect(row[COL.was]).toBe('=B3*1.2');
    expect(row[COL.undo]).toContain('Nothing to undo');
  });

  it('records the created range for an appended row, since undo means deleting it', async () => {
    const { writebackMaterialCreate } = await import('./writeback');
    await writebackMaterialCreate('Brand New Item', 'Vinyl', 2500);

    const row = syncRows()[0]!;
    expect(row[COL.field]).toContain('created');
    expect(row[COL.was]).toBe(''); // nothing existed before
    expect(row[COL.cell]).toBe("'Meterial price'!A338:L338");
    expect(row[COL.undo]).toMatch(/Delete the whole row/i);
  });

  it('logs nothing to undo when no matching Sheet row was found', async () => {
    const { writebackMaterialPrice } = await import('./writeback');
    await writebackMaterialPrice('Not In The Sheet', 500);

    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    const row = syncRows()[0]!;
    expect(row[COL.field]).toContain('no matching row');
    expect(row[COL.undo]).toContain('Nothing to undo');
  });
});
