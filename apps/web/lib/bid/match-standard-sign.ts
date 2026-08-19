// Deterministic standard-sign matching (runs BEFORE any AI assistance).
//
// Ladder: exact sign key → exact normalized name → approved alias (sign
// aliases + the Sheet ALIASES tab) → strong fuzzy name similarity. Then the
// candidate's extracted attributes (size, braille/tactile, illumination,
// material) are compared with the sign's definition:
//   EXACT      identity agrees, no attribute conflicts, nothing price-critical missing → auto-price (green)
//   PROBABLE   strong name/alias/fuzzy match but a non-critical attribute is missing or one
//              soft attribute disagrees → priced, yellow, confirmation required when price-relevant
//   AMBIGUOUS  several signs score within a hair of each other → blue office question, never guess
//   NONE       nothing safe → custom line / office question
//
// Pure and unit-tested. Nothing here invents quantities, sizes, or rates.

import { diceSimilarity, fuzzyScore } from '@/lib/sheet-sync/fuzzy';
import type { SheetAlias } from '@/lib/sheet-sync/types';
import type { BidMatchLevel, QbItem } from '@bvisible/db';
import { extractDimensions, extractSignAttributes, extractWording, normalizeSignText, type ExtractedDimensions, type SignAttributes } from './text-extract';
import { normalizeSignKey } from '@/lib/sheet-sync/parse-standard-signs';
import type { PricingMethod } from './types';

export interface CatalogSign {
  id: string;
  signKey: string;
  name: string;
  nameNormalized: string;
  aliases: ReadonlyArray<string>;
  category: string | null;
  qbItem: QbItem;
  customerDescription: string | null;
  widthMilli: number | null;
  heightMilli: number | null;
  material: string | null;
  tactile: boolean | null;
  braille: boolean | null;
  illumination: string | null;
  pricingMethod: string;
  pricingUnit: string;
  rateKey: string | null;
  rateCents: number | null;
  minimumChargeCents: number | null;
  wastePercentMilli?: number | null;
  active: boolean;
}

export interface StandardSignCatalog {
  signs: ReadonlyArray<CatalogSign>;
  sheetAliases: ReadonlyArray<SheetAlias>;
}

export interface MatchCandidateInput {
  name: string;
  description: string | null;
  sectionHeading?: string | null;
}

export interface ScoredSign {
  sign: CatalogSign;
  score: number;
  via: 'KEY' | 'NAME' | 'ALIAS' | 'FUZZY';
}

export interface MatchResult {
  level: BidMatchLevel;
  sign: CatalogSign | null;
  confidenceMilli: number;
  alternatives: ScoredSign[];
  evidence: string[];
  conflicts: string[];
  /** Fields the pricing rule needs that the source did not supply. */
  missingCritical: string[];
  missingNoncritical: string[];
  extracted: {
    dimensions: ExtractedDimensions;
    attributes: SignAttributes;
    wording: ReturnType<typeof extractWording>;
  };
}

const STRONG_FUZZY = 0.86;
const AMBIGUITY_GAP = 0.08;
const WEAK_FUZZY = 0.62;

function signHaystacks(sign: CatalogSign): string[] {
  return [sign.nameNormalized, ...sign.aliases.map((a) => normalizeSignText(a))].filter(Boolean);
}

function similarity(candidate: string, sign: CatalogSign): number {
  let best = 0;
  for (const hay of signHaystacks(sign)) {
    if (!hay) continue;
    if (hay === candidate) return 1;
    // token-order-insensitive: score both directions and take the mean of
    // the best direction and Dice on the whole string.
    const a = fuzzyScore(candidate, hay);
    const b = fuzzyScore(hay, candidate);
    const dice = diceSimilarity(candidate.replace(/\s+/g, ''), hay.replace(/\s+/g, ''));
    best = Math.max(best, Math.max(a, b) * 0.7 + dice * 0.3);
  }
  return best;
}

function tolerantEqual(a: number, b: number, tolerance = 0.12): boolean {
  if (a === b) return true;
  const larger = Math.max(a, b);
  return larger > 0 && Math.abs(a - b) / larger <= tolerance;
}

function isPricingMethod(v: string): v is PricingMethod {
  return ['PER_SIGN', 'PER_SET', 'PER_SQFT', 'PER_CHARACTER', 'PER_LINEAR_FT', 'PER_HOUR', 'PER_DAY'].includes(v);
}

export function matchStandardSign(input: MatchCandidateInput, catalog: StandardSignCatalog): MatchResult {
  const nameNorm = normalizeSignText(input.name);
  const fullText = `${input.name} ${input.description ?? ''}`;
  const extracted = {
    dimensions: extractDimensions(fullText),
    attributes: extractSignAttributes(fullText),
    wording: extractWording(fullText),
  };
  const evidence: string[] = [];
  const active = catalog.signs.filter((s) => s.active);

  const base: MatchResult = {
    level: 'NONE',
    sign: null,
    confidenceMilli: 0,
    alternatives: [],
    evidence,
    conflicts: [],
    missingCritical: [],
    missingNoncritical: [],
    extracted,
  };
  if (!nameNorm || active.length === 0) {
    if (active.length === 0) evidence.push('No active standard signs are available (Sheet "Standard Signs" tab is empty or missing).');
    return base;
  }

  // 1. exact sign key ("[unit-id]" or the key itself as the item name)
  const keyForm = normalizeSignKey(input.name);
  const bracket = /\[([a-z0-9\-_ ]+)\]/i.exec(input.name)?.[1];
  const byKey = active.find((s) => s.signKey === keyForm || (bracket && s.signKey === normalizeSignKey(bracket)));

  // 2. exact normalized name / 3. alias
  const sheetAliasCanonical = catalog.sheetAliases.find((a) => normalizeSignText(a.alias) === nameNorm)?.canonical;
  const canonicalNorm = sheetAliasCanonical ? normalizeSignText(sheetAliasCanonical) : null;
  const byName = active.find((s) => s.nameNormalized === nameNorm);
  const byAlias = active.find(
    (s) => s.aliases.some((a) => normalizeSignText(a) === nameNorm) || (canonicalNorm !== null && s.nameNormalized === canonicalNorm)
  );

  // 4. fuzzy ranking over everything (used for alternatives + probable)
  const scored: ScoredSign[] = active
    .map((sign) => ({ sign, score: similarity(nameNorm, sign), via: 'FUZZY' as const }))
    .filter((s) => s.score >= WEAK_FUZZY * 0.75)
    .sort((a, b) => b.score - a.score);

  let chosen: ScoredSign | null = null;
  if (byKey) {
    chosen = { sign: byKey, score: 1, via: 'KEY' };
    evidence.push(`Sign key "${byKey.signKey}" matched exactly.`);
  } else if (byName) {
    chosen = { sign: byName, score: 1, via: 'NAME' };
    evidence.push(`Name "${input.name}" matches standard sign "${byName.name}" exactly.`);
  } else if (byAlias) {
    chosen = { sign: byAlias, score: 1, via: 'ALIAS' };
    evidence.push(`"${input.name}" is an approved alias of "${byAlias.name}".`);
  }

  const top = scored[0] ?? null;
  const second = scored[1] ?? null;
  const alternatives = scored.filter((s) => !chosen || s.sign.id !== chosen.sign.id).slice(0, 4);

  if (!chosen) {
    if (top && top.score >= STRONG_FUZZY) {
      if (second && top.score - second.score < AMBIGUITY_GAP && second.score >= WEAK_FUZZY) {
        evidence.push(`Several standard signs look alike: "${top.sign.name}" (${pct(top.score)}) and "${second.sign.name}" (${pct(second.score)}).`);
        return { ...base, level: 'AMBIGUOUS', confidenceMilli: milli(top.score), alternatives: scored.slice(0, 4) };
      }
      chosen = top;
      evidence.push(`Name is very close to "${top.sign.name}" (${pct(top.score)} similar).`);
    } else if (top && top.score >= WEAK_FUZZY) {
      if (second && top.score - second.score < AMBIGUITY_GAP) {
        evidence.push(`Possible matches: "${top.sign.name}" (${pct(top.score)}) and "${second.sign.name}" (${pct(second.score)}) — too close to choose.`);
        return { ...base, level: 'AMBIGUOUS', confidenceMilli: milli(top.score), alternatives: scored.slice(0, 4) };
      }
      evidence.push(`Closest standard sign is "${top.sign.name}" (${pct(top.score)} similar) — not close enough to price automatically.`);
      return { ...base, level: 'NONE', confidenceMilli: milli(top.score), alternatives: scored.slice(0, 4) };
    } else {
      evidence.push('No standard sign name, key, or alias resembles this item.');
      return { ...base, level: 'NONE', confidenceMilli: 0, alternatives: scored.slice(0, 3) };
    }
  }

  // Attribute checks against the chosen sign.
  const sign = chosen.sign;
  const conflicts: string[] = [];
  const missingCritical: string[] = [];
  const missingNoncritical: string[] = [];
  const dims = extracted.dimensions;
  const attrs = extracted.attributes;
  const method = isPricingMethod(sign.pricingMethod) ? sign.pricingMethod : 'PER_SIGN';

  if (sign.widthMilli && sign.heightMilli) {
    if (dims.widthIn !== null && dims.heightIn !== null) {
      const sameOrder = tolerantEqual(dims.widthIn * 1000, sign.widthMilli) && tolerantEqual(dims.heightIn * 1000, sign.heightMilli);
      const swapped = tolerantEqual(dims.widthIn * 1000, sign.heightMilli) && tolerantEqual(dims.heightIn * 1000, sign.widthMilli);
      if (sameOrder || swapped) evidence.push(`Size ${fmtIn(dims.widthIn)} × ${fmtIn(dims.heightIn)} agrees with the standard sign.`);
      else conflicts.push(`Source size ${fmtIn(dims.widthIn)} × ${fmtIn(dims.heightIn)} differs from the standard ${fmtIn(sign.widthMilli / 1000)} × ${fmtIn(sign.heightMilli / 1000)}.`);
    } else if (method === 'PER_SQFT') {
      missingCritical.push('size (priced per square foot)');
    } else {
      missingNoncritical.push('size not stated in the source — standard size assumed');
    }
  } else if (method === 'PER_SQFT' && (dims.widthIn === null || dims.heightIn === null)) {
    missingCritical.push('size (priced per square foot)');
  }

  if (method === 'PER_CHARACTER' && extracted.wording.characterCount === 0) {
    missingCritical.push('sign wording (priced per character)');
  }

  if (sign.braille === true && !attrs.braille) missingNoncritical.push('Braille not mentioned in the source — included per the standard sign');
  if (sign.braille === false && attrs.braille) conflicts.push('Source mentions Braille but the standard sign has none.');
  if (sign.tactile === true && !attrs.tactile) missingNoncritical.push('tactile / raised copy not mentioned — included per the standard sign');

  const signIll = (sign.illumination ?? '').toLowerCase();
  if (signIll && signIll !== 'none' && !/non/.test(signIll)) {
    if (attrs.illumination === 'NON_ILLUMINATED') conflicts.push('Source says non-illuminated; the standard sign is illuminated.');
    else if (!attrs.illuminated) missingNoncritical.push('illumination not stated in the source');
  } else if (signIll && (/non/.test(signIll) || signIll === 'none') && attrs.illuminated) {
    conflicts.push('Source describes an illuminated sign; the standard sign is not illuminated.');
  }

  if (sign.material && attrs.material) {
    const sm = sign.material.toLowerCase();
    if (!sm.includes(attrs.material.toLowerCase()) && !attrs.material.toLowerCase().includes(sm.split(/[\s,/]/)[0] ?? '')) {
      conflicts.push(`Source material "${attrs.material}" differs from the standard "${sign.material}".`);
    } else {
      evidence.push(`Material (${attrs.material}) agrees with the standard sign.`);
    }
  }

  const identityStrong = chosen.via !== 'FUZZY' || chosen.score >= 0.95;
  let level: BidMatchLevel;
  let confidence: number;
  if (conflicts.length === 0 && identityStrong && missingCritical.length === 0) {
    level = 'EXACT';
    confidence = missingNoncritical.length === 0 ? 1000 : 940;
  } else if (conflicts.length <= 1 || identityStrong) {
    level = 'PROBABLE';
    confidence = Math.min(920, Math.max(600, milli(chosen.score) - conflicts.length * 150 - missingCritical.length * 100));
  } else {
    level = 'NONE';
    confidence = milli(chosen.score * 0.5);
  }

  return {
    level,
    sign: level === 'NONE' ? null : sign,
    confidenceMilli: confidence,
    alternatives,
    evidence,
    conflicts,
    missingCritical,
    missingNoncritical,
    extracted,
  };
}

function milli(score: number): number {
  return Math.max(0, Math.min(1000, Math.round(score * 1000)));
}

function pct(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function fmtIn(inches: number): string {
  return `${Number(inches.toFixed(2))}"`;
}
