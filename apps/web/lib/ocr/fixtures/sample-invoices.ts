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
