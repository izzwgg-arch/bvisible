// A parsed Excel takeoff traveling with an assistant message. The
// browser parses the workbook (SheetJS + parse-takeoff) and sends this
// structured payload alongside the chat text — the raw file never
// reaches the server and no LLM ever transcribes line items. Pure TS:
// shared by the API route (sanitizing), the assistant turn (estimate
// rows), and the chat clients (building the payload).

import type { TakeoffKind, TakeoffLine, TakeoffParse } from './parse-takeoff';

export interface AttachedTakeoffTab extends TakeoffParse {
  sheetName: string;
}

export interface AttachedTakeoff {
  fileName: string;
  tabs: AttachedTakeoffTab[];
}

/// Matches the guided import + guidedEstimateSchema server cap.
export const MAX_TAKEOFF_LINES = 200;
const MAX_TABS = 8;
const MAX_RAW_LINES_PER_TAB = 500;

const KINDS: ReadonlyArray<TakeoffKind> = ['MATERIAL', 'LABOR', 'DESIGN', 'INSTALL', 'MISC'];

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function num(v: unknown, max: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return n;
}

/// Rebuild a trustworthy AttachedTakeoff from an untrusted request body.
/// Returns null when nothing importable survives.
export function sanitizeAttachedTakeoff(raw: unknown): AttachedTakeoff | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const fileName = str(r.fileName, 200).trim() || 'takeoff.xlsx';
  const tabs: AttachedTakeoffTab[] = [];
  for (const tabRaw of Array.isArray(r.tabs) ? r.tabs.slice(0, MAX_TABS) : []) {
    if (!tabRaw || typeof tabRaw !== 'object') continue;
    const t = tabRaw as Record<string, unknown>;
    const lines: TakeoffLine[] = [];
    for (const lineRaw of Array.isArray(t.lines) ? t.lines.slice(0, MAX_RAW_LINES_PER_TAB) : []) {
      if (!lineRaw || typeof lineRaw !== 'object') continue;
      const l = lineRaw as Record<string, unknown>;
      const name = str(l.name, 400).trim();
      const qty = num(l.qty, 1_000_000);
      const unitCents = num(l.unitCents, 1_000_000_000);
      if (!name || qty === null || unitCents === null) continue;
      lines.push({
        kind: KINDS.includes(l.kind as TakeoffKind) ? (l.kind as TakeoffKind) : 'MATERIAL',
        name,
        notes: str(l.notes, 2000).trim() || null,
        section: str(l.section, 240).trim() || null,
        qty,
        unitCents: Math.round(unitCents),
        markupExempt: Boolean(l.markupExempt),
      });
    }
    if (lines.length === 0) continue;
    tabs.push({
      sheetName: str(t.sheetName, 100).trim() || `Sheet ${tabs.length + 1}`,
      title: str(t.title, 200).trim() || null,
      lines,
      skipped: (Array.isArray(t.skipped) ? t.skipped.slice(0, 20) : []).map((s) => str(s, 300)),
      priceBasis: t.priceBasis === 'cost' ? 'cost' : 'sell',
    });
  }
  return tabs.length > 0 ? { fileName, tabs } : null;
}

export function takeoffTabTotalCents(tab: AttachedTakeoffTab): number {
  return tab.lines
    .slice(0, MAX_TAKEOFF_LINES)
    .reduce((sum, l) => sum + Math.round(l.qty * l.unitCents), 0);
}

/// Short, token-cheap description of the attachment for the model — tab
/// names, line counts, pricing basis, totals. Never the line items.
export function describeTakeoffForModel(takeoff: AttachedTakeoff): string {
  const tabLines = takeoff.tabs.map((t) => {
    const total = (takeoffTabTotalCents(t) / 100).toFixed(2);
    return `- "${t.sheetName}": ${t.lines.length} lines, ${
      t.priceBasis === 'sell' ? 'final selling prices' : 'costs (markup applies)'
    }, sheet total $${total}${t.title ? `, titled "${t.title}"` : ''}`;
  });
  return `The operator attached an Excel takeoff "${takeoff.fileName}" (already parsed — you never see or transcribe the rows; the system imports them verbatim). Tabs:\n${tabLines.join('\n')}`;
}

/// Pick the tab to import: the model's choice when it names one,
/// otherwise the tab with the most lines.
export function selectTakeoffTab(
  takeoff: AttachedTakeoff,
  wanted?: string | null
): AttachedTakeoffTab {
  if (wanted) {
    const w = wanted.trim().toLowerCase();
    const hit = takeoff.tabs.find((t) => t.sheetName.trim().toLowerCase() === w);
    if (hit) return hit;
    const partial = takeoff.tabs.find((t) => t.sheetName.toLowerCase().includes(w));
    if (partial) return partial;
  }
  return [...takeoff.tabs].sort((a, b) => b.lines.length - a.lines.length)[0]!;
}

export interface TakeoffEstimateRow {
  kind: TakeoffKind;
  description: string;
  qtyMilli: number;
  unitCostCents: number;
  markupExempt: boolean;
  notes: string | null;
  /// Consecutive-run section key — rows sharing it become one bundle.
  groupKey: string | null;
  groupLabel: string | null;
}

/// Turn one tab into estimate rows, mirroring the guided Excel import:
/// consecutive runs of the same section become one bundle (so per-floor
/// repeats stay separate), single-line runs stay loose lines.
export function takeoffTabToEstimateRows(tab: AttachedTakeoffTab): TakeoffEstimateRow[] {
  const lines = tab.lines.slice(0, MAX_TAKEOFF_LINES);
  const rows: TakeoffEstimateRow[] = [];
  let runIndex = -1;
  let prevSection: string | null | undefined;
  const runSizes = new Map<number, number>();
  for (const line of lines) {
    if (line.section !== prevSection) {
      runIndex += 1;
      prevSection = line.section;
    }
    runSizes.set(runIndex, (runSizes.get(runIndex) ?? 0) + 1);
    rows.push({
      kind: line.kind,
      description: line.name,
      qtyMilli: Math.max(1, Math.round(line.qty * 1000)),
      unitCostCents: line.unitCents,
      markupExempt: line.markupExempt,
      notes: line.notes,
      groupKey: line.section ? `run-${runIndex}` : null,
      groupLabel: line.section,
    });
  }
  // A one-line "bundle" is just a loose line.
  let i = 0;
  let run = -1;
  prevSection = undefined;
  for (const line of lines) {
    if (line.section !== prevSection) {
      run += 1;
      prevSection = line.section;
    }
    if ((runSizes.get(run) ?? 0) < 2) {
      rows[i]!.groupKey = null;
      rows[i]!.groupLabel = null;
    }
    i += 1;
  }
  return rows;
}
