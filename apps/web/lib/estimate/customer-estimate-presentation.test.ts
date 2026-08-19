// Customer-facing estimate presentation rules that are NOT allowed to be
// hardcoded: sales tax comes from the company setting, terms come from one
// shared place, and the company identity can never fall back to the stale
// Florida address / 407 phone that used to float around older data.

import { describe, expect, it } from 'vitest';
import { computeSalesTax, formatTaxPercent } from './sales-tax';
import { DEFAULT_ESTIMATE_TERMS, buildEstimateTerms } from './estimate-terms';
import { BVISIBLE_BUSINESS_INFO, guardStaleBusinessInfo, isStaleAddress, isStalePhone } from '@/lib/company/business-info';

describe('sales tax', () => {
  it('applies the configured rate (percent × 1000) and rounds to the cent', () => {
    const t = computeSalesTax(3_601_000, 8125); // $36,010.00 at 8.125%
    expect(t.applied).toBe(true);
    expect(t.taxCents).toBe(292_581);
    expect(t.totalCents).toBe(3_893_581);
    expect(t.label).toBe('8.125%');
  });

  it('0 means no tax line — the estimate is pre-tax and says so', () => {
    const t = computeSalesTax(100_000, 0);
    expect(t).toEqual({ percentMilli: 0, taxCents: 0, totalCents: 100_000, label: '', applied: false });
  });

  it('never invents a rate from a negative or fractional input', () => {
    expect(computeSalesTax(100_000, -5).applied).toBe(false);
    expect(computeSalesTax(-100, 8125).totalCents).toBe(0);
    expect(formatTaxPercent(8875)).toBe('8.875%');
    expect(formatTaxPercent(7000)).toBe('7%');
  });
});

describe('estimate terms', () => {
  it('always carries the standard terms and appends project assumptions without duplicates', () => {
    const terms = buildEstimateTerms({ additional: ['Final electrical connection is excluded and must be completed by a licensed electrician.', 'All products include a one (1) year limited warranty.', '', null] });
    expect(terms.slice(0, DEFAULT_ESTIMATE_TERMS.length)).toEqual([...DEFAULT_ESTIMATE_TERMS]);
    expect(terms.filter((t) => /one \(1\) year limited warranty/.test(t))).toHaveLength(1);
    expect(terms[terms.length - 1]).toMatch(/Final electrical connection is excluded/);
    expect(terms).toEqual(expect.arrayContaining([expect.stringMatching(/change order/i), expect.stringMatching(/licensed electrician/i)]));
  });
});

describe('company business info', () => {
  it('uses the live company record when it is sane', () => {
    const info = guardStaleBusinessInfo({ name: 'B Visible Signs & Printing', phone: '845-238-0478', email: 'Sales@bvisible.us', address: '97 Route 17M\nHarriman, NY 10926', slogan: 'Signs & Printing' });
    expect(info.address).toBe('97 Route 17M\nHarriman, NY 10926');
    expect(info.phone).toBe('845-238-0478');
  });

  it('refuses a stale Florida address or 407 phone and falls back to Harriman', () => {
    expect(isStalePhone('407-374-1527')).toBe(true);
    expect(isStalePhone('(407) 374 1527')).toBe(true);
    expect(isStalePhone('845-238-0478')).toBe(false);
    expect(isStaleAddress('1234 Sample Way, Orlando, FL 32801')).toBe(true);
    expect(isStaleAddress('97 Route 17M, Harriman, NY 10926')).toBe(false);
    const info = guardStaleBusinessInfo({ name: null, phone: '407-374-1527', email: null, address: '1234 Sample Way, Orlando, FL 32801', slogan: null });
    expect(info.phone).toBe(BVISIBLE_BUSINESS_INFO.phone);
    expect(info.address).toBe(BVISIBLE_BUSINESS_INFO.address);
    expect(info.address).toContain('Harriman, NY 10926');
    expect(info.name).toBe('B Visible');
  });

  it('the canonical fallbacks are the Harriman details, never a 407 number', () => {
    expect(BVISIBLE_BUSINESS_INFO.address).toBe('97 Route 17M\nHarriman, NY 10926');
    expect(BVISIBLE_BUSINESS_INFO.phone).toBe('845-238-0478');
    expect(isStalePhone(BVISIBLE_BUSINESS_INFO.phone)).toBe(false);
    expect(isStaleAddress(BVISIBLE_BUSINESS_INFO.address)).toBe(false);
  });
});
