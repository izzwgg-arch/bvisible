/** Deterministic OCR text fixtures (no binary blobs in git). */

export const FIXTURE_SIMPLE_RECEIPT = [
  'WESTSIDE PRINT SUPPLY',
  'Receipt # R-10042',
  '03/14/2026',
  '',
  'Vinyl banner roll 54in    $89.50',
  'Grommet kit (100)         $12.00',
  '',
  'Subtotal                  $101.50',
  'Tax                       $8.12',
  'Total                     $109.62',
].join('\n');

export const FIXTURE_MULTI_LINE_INVOICE = [
  'ACME SIGN MATERIALS LLC',
  'Invoice INV-2026-0042',
  'Date 03/14/2026',
  '',
  'Coroplast 4mm white sheet     qty 2    $45.00',
  'Aluminum composite 3mm        2 x $62.50',
  'Mounting tape roll            $18.75',
  'Design setup fee              $120.00',
  '',
  'Subtotal                      $313.75',
  'Sales Tax                     $25.10',
  'Total                         $338.85',
].join('\n');

/** Wrapped item name on one line, price on the next (common on narrow receipts). */
export const FIXTURE_WRAPPED_LINE_RECEIPT = [
  'QUICK PRINT DEPOT',
  'Receipt 8812',
  '',
  'Heavy duty coroplast 4mm white',
  '  $45.00',
  'Mounting tape roll',
  '  $18.75',
  'Subtotal  $63.75',
  'Total     $63.75',
].join('\n');

export const FIXTURE_BLURRY_STYLE_RECEIPT = [
  'HARBOR INK & MEDIA',
  'Order 77821',
  '',
  'Latex ink cartridge CMYK  $156.00',
  'Print head cleaning kit   $24.50',
  'Shipping                $12.00',
  'Total                     $192.50',
].join('\n');

export const FIXTURE_IMAGE_RECEIPT_OCR_TEXT = [
  'HARBOR INK & MEDIA',
  'Order 77821',
  '',
  'Latex ink cartridge CMYK  $156.00',
  'Print head cleaning kit   $24.50',
  'Total                     $180.50',
].join('\n');

/** Column-aligned table invoice (common vendor PDF OCR). */
export const FIXTURE_TABLE_INVOICE = [
  'SIGN SUPPLY CO',
  'Invoice INV-2026-9911',
  'PO REF: INTERNAL-ONLY',
  'Date 05/20/2026',
  '',
  'Description                    Qty    Unit      Amount',
  'Vinyl banner 54in ROLL         1      $89.50    $89.50',
  'Grommet kit EA                 2      $6.00     $12.00',
  '',
  'Subtotal                                              $101.50',
  'Freight                                               $15.00',
  'Tax                                                    $8.12',
  'Total                                                $124.62',
].join('\n');

/** Alias used by ocr-quality.test.ts */
export const FIXTURE_TABLE_STYLE_INVOICE = FIXTURE_TABLE_INVOICE;

/** qty @ unit price pattern. */
export const FIXTURE_QTY_AT_RECEIPT = [
  'FIELD PRINT SHOP',
  'Receipt 4421',
  '',
  'Coroplast sheet white 4mm  2 @ $45.00',
  'Mounting tape 1 ROLL       $18.75',
  'Total                      $108.75',
].join('\n');

/** Unit suffix tokens on item labels. */
export const FIXTURE_UNIT_SUFFIX_RECEIPT = [
  'MATERIALS HUB',
  '',
  'ACM panel 3mm SHEET       $62.50',
  'Banner mesh SQ FT          $4.25',
  'Wire standoff EA           $3.10',
  'Subtotal                  $69.85',
].join('\n');

/** OCR noise: extra spaces, minor character substitutions. */
export const FIXTURE_OCR_NOISE_RECEIPT = [
  'HARB0R 1NK & MED1A',
  '0rder 77821',
  '',
  'Latex 1nk cartr1dge CMYK    $ 156.00',
  'Pr1nt head clean1ng k1t    $24.50',
  'Sh1pp1ng                  $12.00',
  'Tota1                     $192.50',
].join('\n');

/** Rotated-scan indicator line should not become a priced row. */
export const FIXTURE_ROTATED_SCAN_RECEIPT = [
  'SCAN ORIENTATION: ROTATED 90 DEG',
  'WESTSIDE PRINT SUPPLY',
  'Receipt R-882',
  '',
  'Vinyl banner roll 54in',
  '  $89.50',
  'Total     $89.50',
].join('\n');
