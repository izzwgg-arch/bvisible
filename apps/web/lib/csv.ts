// Minimal, dependency-free CSV parser and serializer.
// Handles quoted fields, doubled-quote escapes (""), and both CRLF/LF.

/**
 * Parse a CSV string into an array of row objects keyed by header.
 * Headers are trimmed and lowercased. Empty trailing rows are skipped.
 */
export function parseCSV(text: string): Array<Record<string, string>> {
  const rows = splitCSVRows(text);
  if (rows.length === 0) return [];

  const headers = parseCSVRow(rows[0]!).map((h) => h.trim().toLowerCase());
  const result: Array<Record<string, string>> = [];

  for (let i = 1; i < rows.length; i++) {
    const raw = rows[i]!.trim();
    if (!raw) continue;
    const cells = parseCSVRow(rows[i]!);
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j] ?? ''] = (cells[j] ?? '').trim();
    }
    result.push(obj);
  }
  return result;
}

/**
 * Serialize a 2D array to a CSV string.
 * First element of the outer array is the header row.
 */
export function buildCSV(headers: string[], rows: string[][]): string {
  const lines = [csvRow(headers), ...rows.map(csvRow)];
  return lines.join('\r\n') + '\r\n';
}

// -- Internals ---------------------------------------------------------

function splitCSVRows(text: string): string[] {
  // Normalize CRLF → LF then split, but respect quoted fields that
  // contain literal newlines.
  const out: string[] = [];
  let current = '';
  let inQuote = false;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '"') {
      if (inQuote && normalized[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        inQuote = !inQuote;
        current += ch;
      }
    } else if (ch === '\n' && !inQuote) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) out.push(current);
  return out;
}

function parseCSVRow(row: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuote && row[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === ',' && !inQuote) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function csvCell(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(',');
}
