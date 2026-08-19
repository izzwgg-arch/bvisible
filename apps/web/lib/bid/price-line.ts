// Deterministic pricing for one bid line. Given the source candidate, the
// standard-sign match, the live rate sources (Sheet snapshot + app
// overrides + operating rates) it returns the billable quantity, the
// customer unit rate, the total, an ordered explanation, the pricing
// snapshot to persist, and any office questions that must be answered
// before the line can be trusted.
//
// Nothing here is probabilistic. AI never sets a quantity, size, rate or
// price — when information is missing the line gets a question instead.

import { computeLineCostCents, roundCents } from '@bvisible/pricing';
import type { BidLineReviewStatus, BidQuestionKind, QbItem } from '@bvisible/db';
import { activeMaterialPrice, type OverrideMap } from '@/lib/sheet-sync/active-price';
import { sheetItemKey, type SheetData } from '@/lib/sheet-sync/types';
import { literalRateCents } from '@/lib/sheet-sync/parse-standard-signs';
import { inferQbItem } from '@/lib/estimate/qbme';
import type { CatalogSign, MatchResult } from './match-standard-sign';
import type { ProductCandidate } from './parse-bid-takeoff';
import { multiplierMilliFromMarkupPercentMilli, type BidOperatingRates } from './rates';
import {
  BID_FORMULA_VERSION,
  PRICING_UNIT_FOR_METHOD,
  isPricingMethod,
  pricingMethodLabel,
  pricingUnitLabel,
  type BidPricingSnapshot,
  type BidQuestionChoice,
  type BidQuestionDraft,
  type ExplanationStep,
  type PricingMethod,
  type PricingSource,
  type PricingUnit,
} from './types';
import { extractSignAttributes } from './text-extract';

export interface RateSources {
  sheet: Pick<SheetData, 'materials' | 'sqftRates' | 'fetchedAt'>;
  overrides: OverrideMap;
  rates: BidOperatingRates;
  sheetSyncedAt: Date | null;
}

export interface ResolvedRate {
  rateCents: number | null;
  rateSource: BidPricingSnapshot['rateSource'];
  sheetItemKey: string | null;
  sheetTab: string | null;
  note: string | null;
  /** True when the rate came from a COST source and was marked up. */
  markedUp: boolean;
}

/** Rate ladder for a standard sign: literal → Sq Ft Pricing (final) → Meterial price (cost × markup) → sign.rateCents. */
export function resolveSignRate(sign: CatalogSign, sources: RateSources): ResolvedRate {
  const rateKey = (sign.rateKey ?? '').trim();
  if (rateKey) {
    const literal = literalRateCents(rateKey);
    if (literal !== null) {
      return { rateCents: literal, rateSource: 'SIGN_LITERAL', sheetItemKey: null, sheetTab: 'Standard Signs', note: null, markedUp: false };
    }
    const key = sheetItemKey(rateKey);
    const sq = sources.sheet.sqftRates.find((r) => r.id.toLowerCase() === key || sheetItemKey(r.name) === key);
    if (sq) {
      return { rateCents: sq.pricePerSqFtCents, rateSource: 'SHEET', sheetItemKey: sq.id, sheetTab: 'Sq Ft Pricing', note: `Final selling price from Sq Ft Pricing "${sq.name}".`, markedUp: false };
    }
    const mat = sources.sheet.materials.find((m) => m.key === key);
    if (mat && mat.priceCents > 0) {
      const active = activeMaterialPrice(sources.overrides, mat.key, mat.priceCents);
      const multiplierMilli = multiplierMilliFromMarkupPercentMilli(sources.rates.defaultMarkupPercentMilli);
      const sell = roundCents((active.priceCents * multiplierMilli) / 1000);
      return {
        rateCents: sell,
        rateSource: active.source === 'OVERRIDE' ? 'OVERRIDE' : 'SHEET',
        sheetItemKey: mat.key,
        sheetTab: 'Meterial price',
        note: `Sheet material cost ${money(active.priceCents)}${active.source === 'OVERRIDE' ? ' (app override)' : ''} × company markup ${(multiplierMilli / 1000).toFixed(2)} = ${money(sell)} selling rate.`,
        markedUp: true,
      };
    }
    if (sign.rateCents !== null && sign.rateCents > 0) {
      return { rateCents: sign.rateCents, rateSource: 'SIGN_LITERAL', sheetItemKey: null, sheetTab: 'Standard Signs', note: `Rate key "${rateKey}" not found in the Sheet — using the sign's stored rate.`, markedUp: false };
    }
    return { rateCents: null, rateSource: 'NONE', sheetItemKey: null, sheetTab: null, note: `Rate key "${rateKey}" was not found in the Sheet.`, markedUp: false };
  }
  if (sign.rateCents !== null && sign.rateCents > 0) {
    return { rateCents: sign.rateCents, rateSource: 'SIGN_LITERAL', sheetItemKey: null, sheetTab: 'Standard Signs', note: null, markedUp: false };
  }
  return { rateCents: null, rateSource: 'NONE', sheetItemKey: null, sheetTab: null, note: 'The standard sign has no rate.', markedUp: false };
}

export interface BillableQty {
  qtyMilli: number;
  unit: PricingUnit;
  steps: ExplanationStep[];
  /** Missing information that blocks the conversion. */
  missing: string | null;
  characterCount: number | null;
  wording: string | null;
  dimensions: { widthIn: number | null; heightIn: number | null } | null;
}

export function computeBillableQty(
  method: PricingMethod,
  sourceQty: number,
  match: MatchResult['extracted'],
  sign: CatalogSign | null,
  wastePercentMilli: number | null
): BillableQty {
  const unit = PRICING_UNIT_FOR_METHOD[method];
  const steps: ExplanationStep[] = [];
  const dims = match.dimensions;
  const srcMilli = Math.max(0, Math.round(sourceQty * 1000));

  switch (method) {
    case 'PER_CHARACTER': {
      const chars = match.wording.characterCount;
      if (chars <= 0) {
        return { qtyMilli: 0, unit, steps, missing: 'sign wording (character count)', characterCount: null, wording: null, dimensions: null };
      }
      const sets = Math.max(1, sourceQty);
      const qtyMilli = Math.round(chars * sets * 1000);
      steps.push({ label: 'Wording found', value: `“${match.wording.text}” — ${chars} chargeable characters` });
      steps.push({ label: 'Billable quantity', value: `${sets} set${sets === 1 ? '' : 's'} × ${chars} characters = ${chars * sets} characters`, note: 'Source set converted to a character count using the lettering rule.' });
      return { qtyMilli, unit, steps, missing: null, characterCount: chars, wording: match.wording.text, dimensions: null };
    }
    case 'PER_SQFT': {
      let w = dims.widthIn;
      let h = dims.heightIn;
      let from = 'source description';
      if ((w === null || h === null) && sign?.widthMilli && sign?.heightMilli) {
        w = sign.widthMilli / 1000;
        h = sign.heightMilli / 1000;
        from = 'standard sign size';
      }
      if (w === null || h === null) {
        return { qtyMilli: 0, unit, steps, missing: 'sign size (width × height)', characterCount: null, wording: null, dimensions: null };
      }
      const sqftEach = Math.round(((w * h) / 144) * 10000) / 10000;
      let total = Math.round(sqftEach * sourceQty * 10000) / 10000;
      steps.push({ label: 'Size', value: `${fmt(w)}" × ${fmt(h)}" = ${sqftEach.toFixed(2)} sq ft each (from ${from})` });
      steps.push({ label: 'Area', value: `${sqftEach.toFixed(2)} sq ft × ${sourceQty} = ${total.toFixed(2)} sq ft` });
      if (wastePercentMilli && wastePercentMilli > 0) {
        const factor = 1 + wastePercentMilli / 100_000;
        total = Math.round(total * factor * 10000) / 10000;
        steps.push({ label: 'Waste factor', value: `× ${factor.toFixed(2)} = ${total.toFixed(2)} billable sq ft` });
      }
      return { qtyMilli: Math.round(total * 1000), unit, steps, missing: null, characterCount: null, wording: null, dimensions: { widthIn: w, heightIn: h } };
    }
    case 'PER_LINEAR_FT': {
      const w = dims.widthIn ?? (sign?.widthMilli ? sign.widthMilli / 1000 : null);
      if (w === null) {
        return { qtyMilli: 0, unit, steps, missing: 'length (priced per linear foot)', characterCount: null, wording: null, dimensions: null };
      }
      const lf = Math.round((w / 12) * sourceQty * 1000) / 1000;
      steps.push({ label: 'Length', value: `${fmt(w)}" = ${(w / 12).toFixed(2)} linear ft × ${sourceQty} = ${lf.toFixed(2)} linear ft` });
      return { qtyMilli: Math.round(lf * 1000), unit, steps, missing: null, characterCount: null, wording: null, dimensions: { widthIn: w, heightIn: dims.heightIn } };
    }
    case 'PER_SET':
    case 'PER_HOUR':
    case 'PER_DAY':
    case 'PER_SIGN':
    default:
      steps.push({ label: 'Billable quantity', value: `${sourceQty} ${pricingUnitLabel(unit, sourceQty)} (same as the takeoff quantity)` });
      return { qtyMilli: srcMilli, unit, steps, missing: null, characterCount: null, wording: null, dimensions: dims.widthIn !== null ? { widthIn: dims.widthIn, heightIn: dims.heightIn } : null };
  }
}

export interface PricedLine {
  billableQtyMilli: number;
  rateCents: number;
  totalCents: number;
  pricingMethod: PricingMethod;
  pricingUnit: PricingUnit;
  pricingSource: PricingSource;
  qbItem: QbItem;
  customerDescription: string;
  reviewStatus: BidLineReviewStatus;
  explanation: ExplanationStep[];
  snapshot: BidPricingSnapshot;
  questions: BidQuestionDraft[];
  /** True when the line is priced (rate known) — false leaves $0 explicitly incomplete. */
  priced: boolean;
}

export interface PriceLineInput {
  candidate: Pick<ProductCandidate, 'name' | 'description' | 'qty' | 'unit' | 'costCents' | 'priceCents' | 'priceConflict' | 'sectionHeading'> & { extendedCents?: number | null };
  match: MatchResult;
  sources: RateSources;
  sourceRef: string | null;
}

/** Compose the customer-facing description from the sign definition + source evidence. */
export function composeCustomerDescription(sign: CatalogSign | null, candidate: PriceLineInput['candidate'], match: MatchResult, wording: string | null): string {
  const attrs = extractSignAttributes(`${candidate.name} ${candidate.description ?? ''}`);
  const parts: string[] = [];
  if (sign?.customerDescription?.trim()) {
    let t = sign.customerDescription.trim();
    t = t.replace(/\{wording\}/gi, wording ?? '').replace(/\{name\}/gi, sign.name).trim();
    if (wording && !t.includes(wording)) t = `${t} — ${wording}`;
    return t.replace(/\s+—\s*$/, '');
  }
  const name = sign?.name ?? candidate.name;
  parts.push(name);
  const dims = match.extracted.dimensions;
  const w = dims.widthIn ?? (sign?.widthMilli ? sign.widthMilli / 1000 : null);
  const h = dims.heightIn ?? (sign?.heightMilli ? sign.heightMilli / 1000 : null);
  const details: string[] = [];
  if (w && h) details.push(`${fmt(w)} × ${fmt(h)}-inch`);
  else if (dims.heightOnlyIn) details.push(`approximately ${fmt(dims.heightOnlyIn)} inches high`);
  const material = sign?.material ?? attrs.material;
  if (material) details.push(material);
  if (sign?.tactile || attrs.tactile) details.push('raised characters');
  if (sign?.braille || attrs.braille) details.push('Grade 2 Braille');
  if (sign?.illumination && !/none|non/i.test(sign.illumination)) details.push(`${sign.illumination} illuminated`);
  else if (attrs.illumination === 'HALO') details.push('reverse halo-lit');
  else if (attrs.illumination === 'FACE') details.push('face-lit');
  const mounting = attrs.mounting;
  if (mounting) details.push(mounting);
  if (wording) parts.push(`— ${wording}`);
  if (details.length > 0) parts.push(`(${details.join(', ')})`);
  let text = parts.join(' ');
  if (!w && !h && !dims.heightOnlyIn && candidate.description) {
    // No structured details — fall back to the source description, trimmed.
    text = `${name} — ${candidate.description.replace(/\s+/g, ' ').trim().slice(0, 240)}`;
  }
  return text.replace(/\s+/g, ' ').trim();
}

function qbItemFor(sign: CatalogSign | null, candidate: PriceLineInput['candidate']): QbItem {
  if (sign) return sign.qbItem;
  return inferQbItem({ kind: 'MATERIAL', description: `${candidate.name} ${candidate.description ?? ''}` });
}

function fmt(n: number): string {
  return String(Number(n.toFixed(2)));
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function snapshotBase(input: PriceLineInput, method: PricingMethod, unit: PricingUnit): BidPricingSnapshot {
  return {
    engine: input.match.sign ? 'STANDARD_SIGN' : 'BID_RATE',
    formulaVersion: BID_FORMULA_VERSION,
    pricingMethod: method,
    pricingUnit: unit,
    pricingSource: 'UNPRICED',
    standardSignKey: input.match.sign?.signKey ?? null,
    standardSignId: input.match.sign?.id ?? null,
    sheetItemKey: null,
    sheetTab: null,
    sheetRow: null,
    sheetSyncedAt: input.sources.sheetSyncedAt?.toISOString() ?? null,
    rateSource: 'NONE',
    rateCents: 0,
    minimumChargeCents: input.match.sign?.minimumChargeCents ?? null,
    minimumApplied: false,
    wastePercentMilli: null,
    markupExempt: true,
    sourceQtyMilli: Math.round(input.candidate.qty * 1000),
    billableQtyMilli: 0,
    dimensions: null,
    characterCount: null,
    wording: null,
    projectSpecific: false,
    approvedById: null,
    approvedAt: null,
    decisionReason: null,
    computedTotalCents: 0,
  };
}

/** Apply a minimum charge by raising the unit rate so qty × rate ≥ minimum. */
export function applyMinimumCharge(qtyMilli: number, rateCents: number, minimumCents: number | null): { rateCents: number; applied: boolean } {
  if (!minimumCents || minimumCents <= 0 || qtyMilli <= 0) return { rateCents, applied: false };
  const total = computeLineCostCents({ qtyMilli, unitCostCents: rateCents });
  if (total >= minimumCents) return { rateCents, applied: false };
  const raised = Math.ceil((minimumCents * 1000) / qtyMilli);
  return { rateCents: raised, applied: true };
}

export function priceBidLine(input: PriceLineInput): PricedLine {
  const { candidate, match, sources } = input;
  const sign = match.sign;
  const explanation: ExplanationStep[] = [];
  const questions: BidQuestionDraft[] = [];
  const sourceQty = Math.max(0, candidate.qty);

  explanation.push({
    label: 'Source',
    value: `${candidate.name}${candidate.description ? ` — ${candidate.description.slice(0, 160)}` : ''}`,
    note: input.sourceRef ?? undefined,
  });
  explanation.push({ label: 'Takeoff quantity', value: `${sourceQty}${candidate.unit ? ` ${candidate.unit}` : ''}` });

  const method: PricingMethod = sign && isPricingMethod(sign.pricingMethod) ? sign.pricingMethod : 'PER_SIGN';
  const billable = computeBillableQty(method, sourceQty, match.extracted, sign, sign?.wastePercentMilli ?? null);
  const unit = billable.unit;
  const snapshot = snapshotBase(input, method, unit);
  snapshot.billableQtyMilli = billable.qtyMilli;
  snapshot.dimensions = billable.dimensions;
  snapshot.characterCount = billable.characterCount;
  snapshot.wording = billable.wording;
  snapshot.wastePercentMilli = sign?.wastePercentMilli ?? null;

  const customerDescription = composeCustomerDescription(sign, candidate, match, billable.wording);
  const qbItem = qbItemFor(sign, candidate);

  const unpriced = (status: BidLineReviewStatus, reason: string): PricedLine => {
    explanation.push({ label: 'Rate', value: 'Not priced yet', note: reason });
    return {
      billableQtyMilli: billable.qtyMilli,
      rateCents: 0,
      totalCents: 0,
      pricingMethod: method,
      pricingUnit: unit,
      pricingSource: 'UNPRICED',
      qbItem,
      customerDescription,
      reviewStatus: status,
      explanation,
      snapshot: { ...snapshot, pricingSource: 'UNPRICED', rateSource: 'NONE' },
      questions,
      priced: false,
    };
  };

  // ---- Matched a standard sign -------------------------------------------
  if (sign) {
    explanation.push({ label: 'Standard sign', value: `${sign.name} (${sign.signKey})`, note: match.evidence[0] });
    if (match.conflicts.length > 0) explanation.push({ label: 'Attribute conflicts', value: match.conflicts.join(' ') });
    if (match.missingNoncritical.length > 0) explanation.push({ label: 'Assumed', value: match.missingNoncritical.join('; ') });
    explanation.push(...billable.steps);

    if (billable.missing) {
      questions.push({
        kind: method === 'PER_CHARACTER' ? 'MISSING_SPEC' : 'SIZE',
        title: `${candidate.name} — ${billable.missing} needed`,
        sourceRef: input.sourceRef,
        sourceText: candidate.description ?? candidate.name,
        systemFound: `Matched standard sign "${sign.name}", priced ${pricingMethodLabel(method)}.`,
        whyUnsafe: `The source does not state the ${billable.missing}, so the billable quantity cannot be calculated.`,
        whyMatters: `${pricingMethodLabel(method)} pricing multiplies the rate by that quantity — a guess would change the price.`,
        choices: [{ key: 'custom', label: 'Enter the missing information', detail: 'Provide the size or wording from the plans.', custom: true }],
      });
      return unpriced('OFFICE_QUESTION', `Cannot calculate ${billable.missing}.`);
    }

    const rate = resolveSignRate(sign, sources);
    if (rate.rateCents === null) {
      questions.push(rateQuestion(input, sign, `The standard sign "${sign.name}" has no usable rate (${rate.note ?? 'no rate key'}).`, method, billable.qtyMilli, []));
      return unpriced('OFFICE_QUESTION', rate.note ?? 'No rate found for this standard sign.');
    }

    // Source carries an explicit selling price that disagrees with the rule → office decides.
    // For per-unit methods the source price is per sign; for converted units
    // (characters, sq ft) it only counts when the extended total proves it is
    // per billable unit (e.g. 12 characters × $250 = $3,000).
    const sourcePrice = candidate.priceCents;
    const perBillableUnit =
      method === 'PER_SIGN' ||
      method === 'PER_SET' ||
      (candidate.extendedCents !== null && candidate.extendedCents !== undefined && sourcePrice !== null && candidate.extendedCents === computeLineCostCents({ qtyMilli: billable.qtyMilli, unitCostCents: sourcePrice }));
    if (sourcePrice !== null && !candidate.priceConflict && sourcePrice > 0 && sourcePrice !== rate.rateCents && perBillableUnit) {
      questions.push({
        kind: 'PROJECT_PRICE',
        title: `${candidate.name} — pricing conflict`,
        sourceRef: input.sourceRef,
        sourceText: `${candidate.name} @ ${money(sourcePrice)} each in the takeoff`,
        systemFound: `The current rule for "${sign.name}" is ${money(rate.rateCents)} ${pricingMethodLabel(method)}.`,
        whyUnsafe: `The takeoff lists ${money(sourcePrice)} each — a project-specific price may have been approved.`,
        whyMatters: `Rate × ${billable.qtyMilli / 1000} ${pricingUnitLabel(unit)} changes the line total by ${money(Math.abs(sourcePrice - rate.rateCents) * (billable.qtyMilli / 1000))}.`,
        choices: [
          { key: 'rule', label: money(rate.rateCents), detail: 'Use current pricing rule', rateCents: rate.rateCents, totalCents: computeLineCostCents({ qtyMilli: billable.qtyMilli, unitCostCents: rate.rateCents }) },
          { key: 'source', label: money(sourcePrice), detail: 'Use the price on the takeoff (project-specific)', rateCents: sourcePrice, totalCents: computeLineCostCents({ qtyMilli: billable.qtyMilli, unitCostCents: sourcePrice }) },
          { key: 'custom', label: 'Custom', detail: 'Enter another approved rate', custom: true },
        ],
      });
    }

    const min = applyMinimumCharge(billable.qtyMilli, rate.rateCents, sign.minimumChargeCents);
    const rateCents = min.rateCents;
    const totalCents = computeLineCostCents({ qtyMilli: billable.qtyMilli, unitCostCents: rateCents });
    explanation.push({ label: 'Rate', value: `${money(rate.rateCents)} ${pricingMethodLabel(method)}`, note: rate.note ?? undefined });
    if (min.applied) explanation.push({ label: 'Minimum charge', value: `${money(sign.minimumChargeCents!)} minimum → rate raised to ${money(rateCents)}` });
    explanation.push({ label: 'Markup', value: 'Selling rate — no estimate markup applied (never marked up twice)' });
    explanation.push({ label: 'Total', value: `${billable.qtyMilli / 1000} ${pricingUnitLabel(unit, billable.qtyMilli / 1000)} × ${money(rateCents)} = ${money(totalCents)}` });

    let status: BidLineReviewStatus;
    if (questions.length > 0) status = 'OFFICE_QUESTION';
    else if (match.level === 'EXACT' && match.missingNoncritical.length === 0 && !rate.markedUp) status = 'AUTO_PRICED';
    else status = 'NEEDS_REVIEW';
    if (match.conflicts.length > 0 && questions.length === 0) {
      questions.push({
        kind: 'STANDARD_SIGN',
        title: `${candidate.name} — confirm the standard sign`,
        sourceRef: input.sourceRef,
        sourceText: candidate.description ?? candidate.name,
        systemFound: `Closest standard sign is "${sign.name}" at ${money(rate.rateCents)} ${pricingMethodLabel(method)}.`,
        whyUnsafe: match.conflicts.join(' '),
        whyMatters: 'A different size, material or illumination usually means a different rate.',
        choices: [
          { key: 'sign', label: sign.name, detail: `Use ${money(rate.rateCents)} ${pricingMethodLabel(method)}`, rateCents: rate.rateCents, totalCents, standardSignKey: sign.signKey, standardSignId: sign.id, pricingMethod: method },
          ...match.alternatives.slice(0, 2).map((alt) => altChoice(alt.sign, sources, billable.qtyMilli)),
          { key: 'custom', label: 'Custom', detail: 'Enter a project-specific rate', custom: true },
        ],
      });
      status = 'OFFICE_QUESTION';
    }

    return {
      billableQtyMilli: billable.qtyMilli,
      rateCents,
      totalCents,
      pricingMethod: method,
      pricingUnit: unit,
      pricingSource: 'STANDARD_SIGN',
      qbItem,
      customerDescription,
      reviewStatus: status,
      explanation,
      snapshot: {
        ...snapshot,
        pricingSource: 'STANDARD_SIGN',
        rateSource: rate.rateSource,
        sheetItemKey: rate.sheetItemKey,
        sheetTab: rate.sheetTab,
        rateCents,
        minimumApplied: min.applied,
        computedTotalCents: totalCents,
      },
      questions,
      priced: true,
    };
  }

  // ---- No standard sign ----------------------------------------------------
  explanation.push(...billable.steps);
  if (match.level === 'AMBIGUOUS') {
    questions.push({
      kind: 'STANDARD_SIGN',
      title: `${candidate.name} — which standard sign applies?`,
      sourceRef: input.sourceRef,
      sourceText: candidate.description ?? candidate.name,
      systemFound: match.evidence.join(' '),
      whyUnsafe: 'More than one standard sign fits the wording; choosing automatically could apply the wrong rate.',
      whyMatters: 'The candidates carry different rates or sizes.',
      choices: [
        ...match.alternatives.slice(0, 4).map((alt) => altChoice(alt.sign, sources, Math.round(sourceQty * 1000))),
        { key: 'custom', label: 'Custom', detail: 'Enter a project-specific rate', custom: true },
      ],
    });
    return unpriced('OFFICE_QUESTION', 'Several standard signs could apply.');
  }

  // Explicit selling price on the takeoff → usable, but a human confirms.
  if (candidate.priceCents !== null && candidate.priceCents > 0 && !candidate.priceConflict) {
    const rateCents = candidate.priceCents;
    const totalCents = computeLineCostCents({ qtyMilli: billable.qtyMilli, unitCostCents: rateCents });
    explanation.push({ label: 'Rate', value: `${money(rateCents)} each — price stated on the takeoff (no standard sign matched)` });
    explanation.push({ label: 'Total', value: `${sourceQty} × ${money(rateCents)} = ${money(totalCents)}` });
    return {
      billableQtyMilli: billable.qtyMilli,
      rateCents,
      totalCents,
      pricingMethod: 'PER_SIGN',
      pricingUnit: 'SIGN',
      pricingSource: 'SOURCE_PRICE',
      qbItem,
      customerDescription,
      reviewStatus: 'NEEDS_REVIEW',
      explanation,
      snapshot: { ...snapshot, engine: 'BID_RATE', pricingSource: 'SOURCE_PRICE', rateSource: 'SOURCE', rateCents, computedTotalCents: totalCents },
      questions,
      priced: true,
    };
  }

  // Cost on the takeoff → mark up with the company default, flag for review.
  if (candidate.costCents !== null && candidate.costCents > 0 && !candidate.priceConflict) {
    const multiplierMilli = multiplierMilliFromMarkupPercentMilli(sources.rates.defaultMarkupPercentMilli);
    const rateCents = roundCents((candidate.costCents * multiplierMilli) / 1000);
    const totalCents = computeLineCostCents({ qtyMilli: billable.qtyMilli, unitCostCents: rateCents });
    explanation.push({ label: 'Rate', value: `Takeoff cost ${money(candidate.costCents)} × company markup ${(multiplierMilli / 1000).toFixed(2)} = ${money(rateCents)} selling rate` });
    explanation.push({ label: 'Total', value: `${sourceQty} × ${money(rateCents)} = ${money(totalCents)}` });
    return {
      billableQtyMilli: billable.qtyMilli,
      rateCents,
      totalCents,
      pricingMethod: 'PER_SIGN',
      pricingUnit: 'SIGN',
      pricingSource: 'SOURCE_PRICE',
      qbItem,
      customerDescription,
      reviewStatus: 'NEEDS_REVIEW',
      explanation,
      snapshot: { ...snapshot, engine: 'BID_RATE', pricingSource: 'SOURCE_PRICE', rateSource: 'SOURCE', rateCents, computedTotalCents: totalCents },
      questions,
      priced: true,
    };
  }

  questions.push({
    kind: 'STANDARD_SIGN',
    title: `${candidate.name} — no standard sign or price`,
    sourceRef: input.sourceRef,
    sourceText: candidate.description ?? candidate.name,
    systemFound: match.evidence.join(' ') || 'No standard sign resembles this item and the takeoff carries no price.',
    whyUnsafe: 'Without a matching rule or an approved price the system would have to invent a rate.',
    whyMatters: `${sourceQty} unit${sourceQty === 1 ? '' : 's'} at an unknown rate — the line total is undefined until answered.`,
    choices: [
      ...match.alternatives.slice(0, 3).map((alt) => altChoice(alt.sign, sources, Math.round(sourceQty * 1000))),
      { key: 'custom', label: 'Custom rate', detail: 'Enter a project-specific rate and description', custom: true },
      { key: 'exclude', label: 'Not a sign line', detail: 'Exclude this row from the estimate' },
    ],
  });
  return unpriced('OFFICE_QUESTION', 'No standard sign and no source price.');
}

function altChoice(sign: CatalogSign, sources: RateSources, qtyMilli: number): BidQuestionChoice {
  const rate = resolveSignRate(sign, sources);
  const method: PricingMethod = isPricingMethod(sign.pricingMethod) ? sign.pricingMethod : 'PER_SIGN';
  const total = rate.rateCents !== null && method === 'PER_SIGN' ? computeLineCostCents({ qtyMilli, unitCostCents: rate.rateCents }) : undefined;
  return {
    key: `sign:${sign.signKey}`,
    label: sign.name,
    detail: rate.rateCents !== null ? `${money(rate.rateCents)} ${pricingMethodLabel(method)}` : 'No rate on file',
    rateCents: rate.rateCents ?? undefined,
    totalCents: total,
    standardSignKey: sign.signKey,
    standardSignId: sign.id,
    pricingMethod: method,
    qbItem: sign.qbItem,
  };
}

function rateQuestion(input: PriceLineInput, sign: CatalogSign, why: string, method: PricingMethod, qtyMilli: number, extra: BidQuestionChoice[]): BidQuestionDraft {
  return {
    kind: 'RATE' as BidQuestionKind,
    title: `${input.candidate.name} — which rate applies?`,
    sourceRef: input.sourceRef,
    sourceText: input.candidate.description ?? input.candidate.name,
    systemFound: `Matched standard sign "${sign.name}" (${pricingMethodLabel(method)}), ${qtyMilli / 1000} billable ${pricingUnitLabel(PRICING_UNIT_FOR_METHOD[method], qtyMilli / 1000)}.`,
    whyUnsafe: why,
    whyMatters: 'The rate multiplies every billable unit on the line.',
    choices: [...extra, { key: 'custom', label: 'Custom rate', detail: 'Enter the approved rate', custom: true }],
  };
}
