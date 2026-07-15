import { describe, expect, it } from 'vitest';
import { fuzzySearch } from './fuzzy';

const MATERIALS = [
  { name: 'Dura-Bond Digital / Regular 1/8 4\' x 8\'', category: 'Rigid Sheets' },
  { name: 'Black Acrylic Sheet - 1/4 - 4\' x 8\' sheet', category: 'Acrylic Sheets' },
  { name: 'Coroplast Sheet - 4mm - 4\' x 8\'', category: 'Coroplast' },
  { name: 'Banner Material 54" x 150\'', category: 'Rolls' },
  { name: 'Application Tape 24"', category: 'Tapes' },
];

const hay = (m: (typeof MATERIALS)[number]) => `${m.name} ${m.category}`;

describe('fuzzySearch', () => {
  it('matches misspellings (durrabond → Dura-Bond)', () => {
    const hits = fuzzySearch('durrabond', MATERIALS, hay);
    expect(hits[0]?.name).toContain('Dura-Bond');
  });

  it('matches misspellings (coroplastt → Coroplast)', () => {
    const hits = fuzzySearch('coroplastt', MATERIALS, hay);
    expect(hits[0]?.name).toContain('Coroplast');
  });

  it('matches partial words (acryl 1/4)', () => {
    const hits = fuzzySearch('acryl 1/4', MATERIALS, hay);
    expect(hits[0]?.name).toContain('Acrylic');
  });

  it('matches reordered tokens', () => {
    const hits = fuzzySearch('tape application', MATERIALS, hay);
    expect(hits[0]?.name).toContain('Application Tape');
  });

  it('uses aliases (baner → Banner Material)', () => {
    const hits = fuzzySearch('baner', MATERIALS, hay, {
      aliases: [{ alias: 'baner', canonical: 'Banner Material' }],
    });
    expect(hits[0]?.name).toContain('Banner');
  });

  it('returns nothing for empty or garbage queries', () => {
    expect(fuzzySearch('', MATERIALS, hay)).toHaveLength(0);
    expect(fuzzySearch('zzqqxx', MATERIALS, hay)).toHaveLength(0);
  });
});
