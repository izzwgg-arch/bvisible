'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { importVehiclesAction } from '../actions';
import type { VehicleImportResult } from '@/lib/vehicles/import';

export function VehicleImportClient() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [text, setText] = useState('');
  const [filename, setFilename] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [recentOnly, setRecentOnly] = useState(true);
  const [make, setMake] = useState('');
  const [result, setResult] = useState<VehicleImportResult | null>(null);
  const format = filename.toLowerCase().endsWith('.json') ? 'json' : 'csv';

  const errorReportUrl = useMemo(() => {
    if (!result?.errors.length) return null;
    const blob = new Blob([result.errors.join('\n') + '\n'], { type: 'text/plain' });
    return URL.createObjectURL(blob);
  }, [result]);

  function onFile(file: File) {
    setFilename(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => setText(typeof ev.target?.result === 'string' ? ev.target.result : '');
    reader.readAsText(file, 'utf-8');
  }

  function runImport() {
    if (!text.trim()) return;
    startTransition(async () => {
      const r = await importVehiclesAction({
        text,
        format,
        dryRun,
        recentYears: recentOnly ? 10 : undefined,
        make: make.trim() || undefined,
      });
      setResult(r);
      if (!dryRun && r.errors.length === 0) window.setTimeout(() => window.location.reload(), 600);
    });
  }

  return (
    <section className="rounded-[22px] border border-white/80 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.currentTarget.value = '';
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => fileRef.current?.click()} className="rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13px] font-bold text-white shadow-[0_16px_34px_rgba(47,90,243,0.24)]">
          Upload CSV/JSON
        </button>
        <span className="text-[13px] font-semibold text-slate-600">{filename || 'No file selected'}</span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <label className="flex items-center gap-2 rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] font-semibold text-slate-700">
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.currentTarget.checked)} />
          Dry run
        </label>
        <label className="flex items-center gap-2 rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] font-semibold text-slate-700">
          <input type="checkbox" checked={recentOnly} onChange={(e) => setRecentOnly(e.currentTarget.checked)} />
          Last 10 years only
        </label>
        <input
          value={make}
          onChange={(e) => setMake(e.currentTarget.value)}
          placeholder="Single make filter"
          className="rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-500/10"
        />
        <button type="button" disabled={!text.trim() || isPending} onClick={runImport} className="rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-[13px] font-bold text-slate-700 shadow-sm disabled:opacity-60">
          {isPending ? 'Running...' : dryRun ? 'Preview import' : 'Import vehicles'}
        </button>
      </div>

      {result ? (
        <div className="mt-5 rounded-[18px] border border-slate-200 bg-slate-50/70 p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Metric label="Rows" value={result.totalRows} />
            <Metric label="Makes created" value={result.makesCreated} />
            <Metric label="Trims created" value={result.trimsCreated} />
            <Metric label="Skipped" value={result.skippedRows} />
            <Metric label="Dimensions" value={`${result.dimensionsCreated}/${result.dimensionsUpdated}`} />
            <Metric label="Photos" value={`${result.photosCreated}/${result.photosUpdated}`} />
            <Metric label="Mode" value={result.dryRun ? 'Dry run' : 'Import'} />
            <Metric label="Errors" value={result.errors.length} />
          </div>

          {result.preview.length > 0 ? (
            <div className="mt-5 overflow-x-auto rounded-[14px] border border-slate-200 bg-white">
              <table className="w-full min-w-[760px] text-[12.5px]">
                <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-[0.16em] text-slate-400">
                  <tr><th className="px-3 py-2">Year</th><th>Make</th><th>Model</th><th>Trim</th><th>Wrap sq ft</th><th>Source</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.preview.map((row, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-bold">{row.year}</td>
                      <td>{row.make}</td>
                      <td>{row.model}</td>
                      <td>{row.trim ?? '-'}</td>
                      <td>{row.totalApproxWrapSqFt ?? '-'}</td>
                      <td>{row.sourceName ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {result.errors.length > 0 ? (
            <div className="mt-4 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
              <p className="font-bold">Validation/import errors</p>
              <ul className="mt-2 list-disc pl-4">
                {result.errors.slice(0, 8).map((error, i) => <li key={i}>{error}</li>)}
              </ul>
              {errorReportUrl ? (
                <a href={errorReportUrl} download="vehicle-import-errors.txt" className="mt-3 inline-flex font-bold text-amber-950 underline">
                  Download error report
                </a>
              ) : null}
            </div>
          ) : (
            <div className="mt-4 rounded-[14px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-emerald-900">
              {result.dryRun ? 'Dry run completed. Uncheck dry run to import.' : 'Import completed successfully.'}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[14px] border border-white bg-white px-4 py-3 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</p>
      <p className="mt-1 text-[20px] font-black tracking-tight text-slate-950">{value}</p>
    </div>
  );
}
