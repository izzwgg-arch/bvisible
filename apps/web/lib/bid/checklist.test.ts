import { describe, expect, it } from 'vitest';
import { buildBidChecklist, type ChecklistInput, type ChecklistLineInput } from './checklist';

function line(p: Partial<ChecklistLineInput> = {}): ChecklistLineInput {
  return { reviewStatus: 'AUTO_PRICED', priced: true, customerDescription: 'A sign', qbItem: 'SALES', isService: false, hidden: false, ...p };
}

function input(p: Partial<ChecklistInput> = {}): ChecklistInput {
  return {
    estimateStatus: 'DRAFT',
    customer: { companyName: 'Michels & Waldron', email: 'lorranyc@example.com', address: '1 Main St' },
    project: { name: 'Azura Phase 1', address: '23 Main Street, Holmdel, NJ' },
    sourceFileCount: 2,
    takeoffProcessed: true,
    lines: [line(), line({ isService: true, customerDescription: 'Design' })],
    questions: [],
    designIncluded: true,
    installIncluded: true,
    qbmeReconciled: true,
    termsPresent: true,
    taxConfigured: true,
    ...p,
  };
}

describe('buildBidChecklist', () => {
  it('is ready and sendable when everything is complete', () => {
    const c = buildBidChecklist(input());
    expect(c.blocking).toEqual([]);
    expect(c.warnings).toEqual([]);
    expect(c.ready).toBe(true);
    expect(c.canSend).toBe(true);
    expect(c.items.map((i) => i.key)).toEqual([
      'customer', 'project', 'sources', 'takeoff', 'priced', 'review', 'questions',
      'design', 'installation', 'descriptions', 'qbitems', 'estimate', 'qbme', 'reconciled', 'terms', 'tax',
    ]);
  });

  it('blocks sending on unpriced lines, missing descriptions, missing items and undecided design / installation', () => {
    const c = buildBidChecklist(input({
      lines: [line({ priced: false }), line({ customerDescription: null }), line({ qbItem: null })],
      designIncluded: null,
      installIncluded: null,
    }));
    const keys = c.blocking.map((b) => b.key);
    expect(keys).toEqual(expect.arrayContaining(['priced', 'descriptions', 'qbitems', 'design', 'installation']));
    expect(c.canSend).toBe(false);
  });

  it('open pricing questions block; non-pricing questions only warn', () => {
    const blocking = buildBidChecklist(input({ questions: [{ status: 'OPEN', affectsPrice: true }] }));
    expect(blocking.canSend).toBe(false);
    expect(blocking.items.find((i) => i.key === 'questions')?.detail).toMatch(/1 open \(1 affect pricing\)/);
    const warn = buildBidChecklist(input({ questions: [{ status: 'OPEN', affectsPrice: false }] }));
    expect(warn.canSend).toBe(true);
    expect(warn.warnings.map((w) => w.key)).toContain('questions');
  });

  it('a missing customer blocks, a missing customer email only warns (pricing may continue)', () => {
    expect(buildBidChecklist(input({ customer: { companyName: null, email: null, address: null } })).canSend).toBe(false);
    const noEmail = buildBidChecklist(input({ customer: { companyName: 'X', email: null, address: null } }));
    expect(noEmail.canSend).toBe(true);
    expect(noEmail.warnings.map((w) => w.key)).toContain('customer');
  });

  it('excluded and hidden lines are not counted against descriptions or items', () => {
    const c = buildBidChecklist(input({ lines: [line(), line({ reviewStatus: 'EXCLUDED', customerDescription: null, qbItem: null, hidden: true })] }));
    expect(c.canSend).toBe(true);
  });

  it('unconfigured tax and a QBME rounding difference warn but never block a draft', () => {
    const c = buildBidChecklist(input({ taxConfigured: false, qbmeReconciled: false }));
    expect(c.canSend).toBe(true);
    expect(c.warnings.map((w) => w.key)).toEqual(expect.arrayContaining(['tax', 'reconciled']));
    expect(c.items.find((i) => i.key === 'tax')?.detail).toMatch(/pre-tax/);
  });

  it('lines still needing a check warn without blocking the send', () => {
    const c = buildBidChecklist(input({ lines: [line({ reviewStatus: 'NEEDS_REVIEW' })] }));
    expect(c.canSend).toBe(true);
    expect(c.warnings.map((w) => w.key)).toContain('review');
  });
});

describe('sales tax checklist row', () => {
  it('reads as exempt, not as a missing setting, when the estimate is exempt', () => {
    const c = buildBidChecklist(input({ taxConfigured: true, taxExempt: true }));
    const tax = c.items.find((i) => i.key === 'tax');
    expect(tax?.state).toBe('ok');
    expect(tax?.label).toBe('Sales tax exempt');
    expect(tax?.detail).toContain('Exempt on this estimate');
  });

  it('still warns when tax is simply not configured', () => {
    const c = buildBidChecklist(input({ taxConfigured: false }));
    const tax = c.items.find((i) => i.key === 'tax');
    expect(tax?.state).toBe('warning');
    expect(tax?.label).toBe('Sales tax configured');
  });
});
