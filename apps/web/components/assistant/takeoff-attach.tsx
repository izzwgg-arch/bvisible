'use client';

// Excel attachment support for the assistant chats (full page + dock).
// The workbook is parsed HERE in the browser (SheetJS on demand + the
// shared takeoff parser); only the structured line data travels with the
// chat message — the file itself never uploads.

import { useRef, useState } from 'react';
import { parseTakeoffRows } from '@/lib/estimate-import/parse-takeoff';
import type { AttachedTakeoff } from '@/lib/estimate-import/attached-takeoff';

export type { AttachedTakeoff };

export async function parseTakeoffFile(file: File): Promise<AttachedTakeoff | null> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const tabs: AttachedTakeoff['tabs'] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(ws, {
      header: 1,
      raw: true,
      defval: null,
    });
    const parse = parseTakeoffRows(rows);
    if (parse) tabs.push({ sheetName, ...parse });
  }
  return tabs.length > 0 ? { fileName: file.name, tabs } : null;
}

/// Paperclip button + pending-attachment chip. The parent owns the
/// attachment state; this renders the controls and does the parsing.
export function TakeoffAttachControl({
  takeoff,
  onChange,
  disabled,
}: {
  takeoff: AttachedTakeoff | null;
  onChange: (t: AttachedTakeoff | null) => void;
  disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setParsing(true);
    setError(null);
    try {
      const parsed = await parseTakeoffFile(file);
      if (!parsed) {
        setError('No takeoff found — the sheet needs Name, Qty, and a Cost/Price column.');
        onChange(null);
      } else {
        onChange(parsed);
      }
    } catch {
      setError('Could not read that file — is it a valid Excel workbook?');
      onChange(null);
    } finally {
      setParsing(false);
    }
  }

  const lineCount = takeoff ? takeoff.tabs.reduce((n, t) => n + t.lines.length, 0) : 0;

  return (
    <>
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
      {takeoff ? (
        <span className="inline-flex max-w-[260px] items-center gap-1.5 rounded-full bg-[#fdeee1] px-3 py-1.5 text-[11px] font-bold text-[#8a5a33]">
          <span className="truncate">
            ⇪ {takeoff.fileName} · {lineCount} lines
          </span>
          <button
            type="button"
            aria-label="Remove attachment"
            className="text-[13px] leading-none hover:opacity-70"
            onClick={() => {
              onChange(null);
              setError(null);
            }}
          >
            ×
          </button>
        </span>
      ) : (
        <button
          type="button"
          title="Attach an Excel takeoff — the assistant creates the estimate from it"
          aria-label="Attach Excel takeoff"
          disabled={disabled || parsing}
          onClick={() => fileRef.current?.click()}
          className="rounded-[10px] border border-[var(--color-bv-border)] bg-white px-3 py-2 text-[13px] font-bold text-[var(--color-bv-muted)] hover:bg-[var(--color-bv-bg)] disabled:opacity-50"
        >
          {parsing ? '…' : '⇪'}
        </button>
      )}
      {error ? (
        <span className="text-[10.5px] font-bold text-amber-700">{error}</span>
      ) : null}
    </>
  );
}
