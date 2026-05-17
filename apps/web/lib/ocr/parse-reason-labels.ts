/** Operator-facing labels for deterministic parse reasons (no secrets). */
export function labelOcrParseReason(code: string | null | undefined): string {
  switch (code) {
    case 'label_dollar_price':
      return 'Price at end of line ($)';
    case 'label_trailing_price':
      return 'Price at end of line';
    case 'label_colon_price':
      return 'Label: price';
    case 'label_equals_price':
      return 'Label = price';
    case 'label_dash_price':
      return 'Label — price';
    case 'qty_times_unit_price':
      return 'Quantity × unit price';
    case 'qty_label_unit_price':
      return 'Qty label + unit price';
    case 'qty_at_unit_price':
      return 'Quantity @ unit price';
    default:
      return code?.replace(/_/g, ' ') ?? 'Parsed from OCR text';
  }
}
