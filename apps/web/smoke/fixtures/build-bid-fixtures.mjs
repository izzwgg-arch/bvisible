// Builds the Bid Estimator smoke fixtures:
//   bid-azura-takeoff.xlsx — a two-tab takeoff (Summary + Estimating Sheet)
//     with building/floor/pod headings, repeated sign types across floors,
//     a per-character building ID, an address with a project price that
//     conflicts with the rule, subtotal / tax / total rows, and design +
//     installation service rows (deferred to Steps 5–6).
//   bid-marked-plans.pdf — a tiny valid one-page PDF used as plan evidence.
// Run: node smoke/fixtures/build-bid-fixtures.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const dir = path.dirname(fileURLToPath(import.meta.url));

const H = ['Name', 'Description', 'Qty', 'Units', 'Cost Each', 'Markup %', 'Price Each', 'Price Total'];
const estimating = [
  ['AZURA PHASE 1', null, null, null, null, null, null, null],
  ['23 Main Street, Holmdel, NJ', null, null, null, null, null, null, null],
  ['SIGNAGE QUANTITY TAKEOFF', null, null, null, null, null, null, null],
  ['Status Legend:', null, null, null, null, null, null, null],
  H,
  ['Building A', null, null, null, null, null, null, 0],
  ['Interior Signage', null, null, null, null, null, null, 0],
  ['Residential Unit ID Sign', '6" x 8" tactile acrylic with Grade 2 Braille, VHB mounted', 40, 'EA', null, null, null, null],
  ['Utility & Back-of-House ID Sign', 'Tactile acrylic with raised text and Braille', 60, 'EA', null, null, null, null],
  ['Tactile EXIT Sign', 'Raised EXIT text and Grade 2 Braille', 12, 'EA', null, null, null, null],
  ['Second Floor', null, null, null, null, null, null, null],
  ['Residential Unit ID Sign', null, 63, 'EA', null, null, null, null],
  ['Utility & Back-of-House ID Sign', null, 80, 'EA', null, null, null, null],
  ['Tactile EXIT Sign', null, 24, 'EA', null, null, null, null],
  ['Stairwell ID Sign', 'multi-line raised text and Grade 2 Braille', 12, 'EA', null, null, null, null],
  H,
  ['Pod B', null, null, null, null, null, null, null],
  ['Site & Roadway Signage', null, null, null, null, null, null, null],
  ['Reserved EV Charging Sign', '12" x 18" HIP reflective aluminum, existing posts', 46, 'EA', null, null, null, null],
  ['Exterior & Building Identification', null, null, null, null, null, null, null],
  ['Building ID', 'Exterior building ID reading "AZURA PHASE 1", 1/2" acrylic letters 7"–12" high, painted and stud mounted', 1, 'SET', null, null, null, null],
  ['Building Address', 'Illuminated address "23 MAIN STREET", approximately 18 inches high, reverse halo-lit', 1, 'SET', null, null, 250, 3000],
  ['Monument Sign', 'Double-sided monument with masonry base per detail 5/A-501', 1, 'EA', null, null, null, null],
  ['Subtotal — Signage', null, null, null, null, null, null, 12345],
  [null, null, null, null, null, null, null, null],
  ['Design & Layout / File Setup', 'Project file setup, layout, and artwork preparation', 1, 'EA', 800, null, null, 800],
  ['Installation Labor', 'Installation labor priced per crew-day', 4.5, 'DAY', 2800, null, null, 12600],
  ['Sales Tax Rate', null, null, null, null, null, null, 0.08125],
  ['Sales Tax', null, null, null, null, null, null, 1003.11],
  ['TOTAL INVESTMENT', null, null, null, null, null, null, 13348.11],
];
const summary = [
  ['AZURA PHASE 1 — SIGNAGE SUMMARY', null, null, null],
  ['Name', 'Qty', 'Price Each', 'Extended Price'],
  ['Residential Unit ID Sign', 103, 60, 6180],
  ['Reserved EV Charging Sign', 46, 50, 2300],
  ['Utility & Back-of-House ID Sign', 140, 50, 7000],
  ['Tactile EXIT Sign', 36, 50, 1800],
  ['GRAND TOTAL', null, null, 17280],
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(estimating), 'Estimating Sheet');
fs.writeFileSync(path.join(dir, 'bid-azura-takeoff.xlsx'), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

// Minimal valid single-page PDF (no external tools).
const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 68 >> stream
BT /F1 18 Tf 72 720 Td (Azura Phase 1 - Marked Plans V02) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000260 00000 n
0000000378 00000 n
trailer << /Size 6 /Root 1 0 R >>
startxref
455
%%EOF
`;
fs.writeFileSync(path.join(dir, 'bid-marked-plans.pdf'), pdf, 'latin1');
console.log('fixtures written to', dir);
