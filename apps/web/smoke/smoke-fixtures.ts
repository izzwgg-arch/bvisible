/**
 * Documented smoke fixture identifiers — read-only allowlists for Playwright.
 * Mutations are only permitted on rows matching isSmokePoNumber().
 */

/** PO numbers that may be opened read-only in smoke (email/OCR fixtures). */
export const SMOKE_PO_READ_ONLY_NUMBERS = [
  'PO-901001',
  'PO-901002',
  'PO-901003',
  'PO-901004',
] as const;

/** PO numbers safe for operator lifecycle button clicks (SMOKE- prefix only). */
export function isSmokePoNumberForMutation(number: string): boolean {
  return number.startsWith('SMOKE-');
}

export function isSmokePoNumberForRead(number: string): boolean {
  return isSmokePoNumberForMutation(number) || (SMOKE_PO_READ_ONLY_NUMBERS as readonly string[]).includes(number);
}

export function isSmokeEstimateTitle(title: string): boolean {
  return title.startsWith('SMOKE-');
}

export function isSmokeClientName(name: string): boolean {
  return name.startsWith('SMOKE-');
}
