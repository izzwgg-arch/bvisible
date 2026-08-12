'use client';

// Excel estimate import: pick a takeoff workbook (.xlsx), parse it in
// the browser (SheetJS is loaded on demand), preview the detected lines
// per tab, then add everything to the estimate — still fully editable
// before saving. Sections become bundles, "Cost Each" numbers stay
// markup-able, lone "Price Each" numbers import as final prices
// (markup-exempt, R-EST-05). Reuses the JSON import's ImportResult
// contract so the builder treats both paths identically.

import { useRef, useState } from 'react';
import { formatMoney } from '@bvisible/pricing';
import { parseTakeoffRows, type TakeoffParse } from '@/lib/estimate-import/parse-takeoff';
import type { ImportedCard, ImportResult } from './json-import-panel';

/// Server-side cap in guidedEstimateSchema — importing more would fail.
const MAX_LINES = 200;

interface TabCandidate {
  sheetName: string;
  parse: TakeoffParse;
}

function toImportResult(tab: TabCandidate): ImportResult {
  const { parse, sheetName } = tab;
  const lines = parse.lines.slice(0, MAX_LINES);
  // Group consecutive runs of the same section (not by name globally) so
  // a takeoff that repeats "Interior Signage" per floor keeps each
  // floor's block as its own bundle instead of one giant merged card.
  const groups: Array<{ section: string | null; lines: typeof lines }> = [];
  for (const line of lines) {
    const last = groups[groups.length - 1];
    if (last && last.section === line.section) last.lines.push(line);
    else groups.push({ section: line.section, lines: [line] });
  }
  const cards: ImportedCard[] = [];
  for (const { section, lines: sectionLines } of groups) {
    cards.push({
      label: section || parse.title || sheetName,
      sublabel: `Imported from Excel (${sheetName}) · ${sectionLines.length} line${sectionLines.length > 1 ? 's' : ''}`,
      badge: 'Excel',
      rows: sectionLines.map((l) => ({
        kind: l.kind,
        description: l.name,
        qtyMilli: Math.round(l.qty * 1000),
        unitCostCents: l.unitCents,
        markupExempt: l.markupExempt,
        sourceKind: 'CUSTOM',
        notes: l.notes,
      })),
    });
  }
  return { title: parse.title, customerName: null, markupPercent: null, cards };
}

export function ExcelImportPanel({
  onImport,
  onClose,
}: {
  onImport: (result: ImportResult) => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [tabs, setTabs] = useState<TabCandidate[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setTabs([]);
    setFileName(file.name);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const found: TabCandidate[] = [];
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        if (!ws) continue;
        const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(ws, {
          header: 1,
          raw: true,
          defval: null,
        });
        const parse = parseTakeoffRows(rows);
        if (parse) found.push({ sheetName, parse });
      }
      if (found.length === 0) {
        setError(
          'No takeoff tab recognized — the sheet needs a header row with Name, Qty, and a Cost Each or Price Each column.'
        );
      } else {
        // Most complete tab first — usually the detailed estimating sheet.
        found.sort((a, b) => b.parse.lines.length - a.parse.lines.length);
        setTabs(found);
        setSelected(0);
      }
    } catch (e) {
      setError(
        `Could not read that file${e instanceof Error ? ` — ${e.message}` : ''}. Is it a valid Excel workbook?`
      );
    } finally {
      setBusy(false);
    }
  }

  const active = tabs[selected] ?? null;
  const previewTotalCents = active
    ? active.parse.lines
        .slice(0, MAX_LINES)
        .reduce((sum, l) => sum + Math.round(l.qty * l.unitCents), 0)
    : 0;
  const truncated = active ? Math.max(0, active.parse.lines.length - MAX_LINES) : 0;

  return (
    <div
      id="excel-import-panel"
      className="mt-4 rounded-[14px] border border-[var(--color-bv-border)] bg-white p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[13.5px] font-bold text-[var(--color-bv-text)]">
            Import estimate from Excel
          </div>
          <div className="text-[11px] text-[var(--color-bv-muted)]">
            Pick a takeoff workbook — sections, quantities, and prices are detected automatically
            and everything stays editable before saving.
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-[9px] border border-[var(--color-bv-border)] px-3 py-1.5 text-[11.5px] font-bold text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)] disabled:opacity-50"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? 'Reading…' : fileName ? 'Choose another file' : 'Choose Excel file'}
          </button>
          <button
            type="button"
            className="rounded-[9px] border border-[var(--color-bv-border)] px-3 py-1.5 text-[11.5px] font-bold text-[var(--color-bv-muted)] hover:bg-[var(--color-bv-bg)]"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />

      {fileName && !busy ? (
        <div className="mt-2 text-[11px] text-[var(--color-bv-muted)]">
          File: <b className="text-[var(--color-bv-text)]">{fileName}</b>
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11.5px] text-amber-900">
          {error}
        </div>
      ) : null}

      {tabs.length > 1 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
            Import from tab:
          </span>
          {tabs.map((t, i) => (
            <button
              key={t.sheetName}
              type="button"
              onClick={() => setSelected(i)}
              className={`rounded-full px-3 py-1 text-[11px] font-bold ${
                i === selected
                  ? 'bg-[var(--color-bv-accent)] text-white'
                  : 'border border-[var(--color-bv-border)] bg-white text-[var(--color-bv-muted)]'
              }`}
            >
              {t.sheetName} · {t.parse.lines.length}
            </button>
          ))}
        </div>
      ) : null}

      {active ? (
        <>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className="rounded-[10px] bg-[var(--color-bv-accent)] px-4 py-2 text-[12.5px] font-bold text-white hover:opacity-95"
              onClick={() => onImport(toImportResult(active))}
            >
              Add {Math.min(active.parse.lines.length, MAX_LINES)} line
              {active.parse.lines.length > 1 ? 's' : ''} to estimate →
            </button>
            <span className="text-[11px] text-[var(--color-bv-muted)]">
              Sheet total {formatMoney(previewTotalCents)} ·{' '}
              {active.parse.priceBasis === 'sell'
                ? 'prices import as final selling prices (never marked up again)'
                : 'costs import as costs — your markup applies'}
            </span>
          </div>

          {truncated > 0 ? (
            <div className="mt-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11.5px] text-amber-900">
              This tab has {active.parse.lines.length} lines — only the first {MAX_LINES} import
              (estimate limit). The remaining {truncated} can be added in the editor.
            </div>
          ) : null}

          {active.parse.skipped.length > 0 ? (
            <div className="mt-3 rounded-[10px] border border-[var(--color-bv-border)] bg-[#fafbfc] px-3 py-2.5 text-[11.5px] text-[var(--color-bv-muted)]">
              <b>Skipped (totals are recalculated by the app):</b>
              <ul className="mt-1 list-disc pl-5">
                {active.parse.skipped.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-3 max-h-80 overflow-y-auto divide-y divide-[var(--color-bv-border)] rounded-[10px] border border-[var(--color-bv-border)]">
            {active.parse.lines.slice(0, MAX_LINES).map((l, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-[var(--color-bv-text)]">
                    {l.name}
                  </div>
                  <div className="truncate text-[11px] text-[var(--color-bv-muted)]">
                    {l.section ? `${l.section} · ` : ''}
                    {l.kind !== 'MATERIAL' ? `${l.kind} · ` : ''}
                    qty {l.qty} × {formatMoney(l.unitCents)} ={' '}
                    {formatMoney(Math.round(l.qty * l.unitCents))}
                  </div>
                </div>
                <span className="whitespace-nowrap text-[10px] font-bold text-[var(--color-bv-muted)]">
                  {l.markupExempt ? 'final price' : 'markup applies'}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
