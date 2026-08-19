// Sheet → standard_signs upsert (runs inside runSheetSync).
//
// Rules:
//   * The Sheet wins for SHEET-source rows on every sync (same as materials).
//   * Upsert identity is (tenantId, signKey). A Sheet row whose normalized
//     name (or alias) collides with a DIFFERENT existing sign is skipped and
//     reported — no duplicate standard signs, ever.
//   * SHEET rows that vanished from the tab are deactivated, not deleted,
//     and only when the tab was actually recognized (never on MISSING /
//     UNRECOGNIZED, which could be a transient fetch problem).
//   * APP-promoted rows are never touched by the sync.
//   * Saved estimates are never repriced by this — pricing is snapshotted.

import { QbItem, StandardSignSource, type Prisma, type PrismaClient } from '@bvisible/db';
import { qbItemFromLabel } from '@/lib/estimate/qbme';
import type { SheetStandardSign, StandardSignsTabStatus } from '@/lib/sheet-sync/types';
import { normalizeSignText } from './text-extract';

type Db = Pick<PrismaClient, 'standardSign'>;

export interface StandardSignSyncResult {
  tabStatus: StandardSignsTabStatus;
  created: number;
  updated: number;
  deactivated: number;
  skippedDuplicates: string[];
}

export function qbItemFromSheetLabel(label: string): QbItem {
  const t = label.trim();
  if (!t) return QbItem.SALES;
  const direct = qbItemFromLabel(t);
  if (direct) return direct;
  const lower = t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (/wrap/.test(lower)) return QbItem.WRAPPING;
  if (/channel/.test(lower)) return QbItem.CHANNEL_LETTERS;
  if (/canop|awning/.test(lower)) return QbItem.CANOPY;
  if (/3 ?d|dimensional/.test(lower)) return QbItem.THREE_D_LETTERING;
  if (/design/.test(lower)) return QbItem.DESIGN;
  if (/ship|freight|deliver/.test(lower)) return QbItem.SHIPPING;
  if (/install/.test(lower)) return QbItem.INSTALLATION;
  return QbItem.SALES;
}

function inchesToMilli(v: number | null): number | null {
  if (v === null || !Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * 1000);
}

function hoursToMilli(v: number | null): number | null {
  if (v === null || !Number.isFinite(v) || v < 0) return null;
  return Math.round(v * 1000);
}

export function sheetSignToRow(tenantId: string, sign: SheetStandardSign, now: Date): Prisma.StandardSignUncheckedCreateInput {
  return {
    tenantId,
    signKey: sign.signKey,
    source: StandardSignSource.SHEET,
    active: sign.active,
    category: sign.category || null,
    name: sign.name.slice(0, 400),
    nameNormalized: normalizeSignText(sign.name).slice(0, 400),
    qbItem: qbItemFromSheetLabel(sign.qbItem),
    customerDescription: sign.customerDescription || null,
    widthMilli: inchesToMilli(sign.widthIn),
    heightMilli: inchesToMilli(sign.heightIn),
    unit: (sign.unit || 'in').slice(0, 20),
    material: sign.material || null,
    thickness: sign.thickness || null,
    construction: sign.construction || null,
    mounting: sign.mounting || null,
    tactile: sign.tactile,
    braille: sign.braille,
    illumination: sign.illumination || null,
    pricingMethod: sign.pricingMethod,
    pricingUnit: sign.pricingUnit,
    rateKey: sign.rateKey || null,
    rateCents: sign.rateCents,
    minimumChargeCents: sign.minimumChargeCents,
    wastePercentMilli: sign.wastePercent === null ? null : Math.round(sign.wastePercent * 1000),
    defaultMachine: sign.defaultMachine || null,
    shopHoursMilli: hoursToMilli(sign.shopHours),
    designUnitsMilli: hoursToMilli(sign.designUnits),
    installHoursMilli: hoursToMilli(sign.installHours),
    aliases: sign.aliases.map((a) => a.slice(0, 200)),
    formulaVersion: sign.formulaVersion || null,
    notes: sign.notes || null,
    sheetRow: sign.sheetRow,
    syncedAt: now,
  };
}

const COMPARE_FIELDS: Array<keyof Prisma.StandardSignUncheckedCreateInput> = [
  'active', 'category', 'name', 'nameNormalized', 'qbItem', 'customerDescription', 'widthMilli', 'heightMilli', 'unit',
  'material', 'thickness', 'construction', 'mounting', 'tactile', 'braille', 'illumination', 'pricingMethod', 'pricingUnit',
  'rateKey', 'rateCents', 'minimumChargeCents', 'wastePercentMilli', 'defaultMachine', 'shopHoursMilli', 'designUnitsMilli',
  'installHoursMilli', 'aliases', 'formulaVersion', 'notes', 'sheetRow',
];

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

export async function syncStandardSignsFromSheet(
  db: Db,
  tenantId: string,
  signs: ReadonlyArray<SheetStandardSign>,
  tabStatus: StandardSignsTabStatus,
  now = new Date()
): Promise<StandardSignSyncResult> {
  const result: StandardSignSyncResult = { tabStatus, created: 0, updated: 0, deactivated: 0, skippedDuplicates: [] };
  if (tabStatus !== 'OK') return result;

  const existing = await db.standardSign.findMany({ where: { tenantId } });
  const byKey = new Map(existing.map((s) => [s.signKey, s]));
  const byNorm = new Map<string, (typeof existing)[number]>();
  for (const s of existing) {
    byNorm.set(s.nameNormalized, s);
    for (const a of s.aliases) byNorm.set(normalizeSignText(a), s);
  }

  const seenKeys = new Set<string>();
  const seenNorms = new Set<string>();
  for (const sign of signs) {
    const row = sheetSignToRow(tenantId, sign, now);
    const norm = row.nameNormalized;
    if (seenKeys.has(row.signKey)) {
      result.skippedDuplicates.push(row.signKey);
      continue;
    }
    seenKeys.add(row.signKey);
    const current = byKey.get(row.signKey);
    // Duplicate prevention: same normalized name / alias as a DIFFERENT sign.
    const collision = byNorm.get(norm);
    if (!current && (collision || seenNorms.has(norm))) {
      result.skippedDuplicates.push(row.signKey);
      continue;
    }
    if (current && collision && collision.signKey !== current.signKey) {
      result.skippedDuplicates.push(row.signKey);
      continue;
    }
    seenNorms.add(norm);

    if (!current) {
      await db.standardSign.create({ data: row });
      result.created += 1;
      continue;
    }
    if (current.source !== StandardSignSource.SHEET) continue; // app-owned rows are never overwritten by the Sheet
    const changed = COMPARE_FIELDS.some((f) => !sameValue((current as Record<string, unknown>)[f], (row as Record<string, unknown>)[f]));
    if (changed) {
      await db.standardSign.update({ where: { id: current.id }, data: { ...row, syncedAt: now } });
      result.updated += 1;
    } else {
      await db.standardSign.update({ where: { id: current.id }, data: { syncedAt: now } });
    }
  }

  // Sheet rows that disappeared: deactivate (never delete — line details keep their FK).
  for (const s of existing) {
    if (s.source !== StandardSignSource.SHEET) continue;
    if (seenKeys.has(s.signKey)) continue;
    if (!s.active) continue;
    await db.standardSign.update({ where: { id: s.id }, data: { active: false, syncedAt: now } });
    result.deactivated += 1;
  }
  return result;
}
