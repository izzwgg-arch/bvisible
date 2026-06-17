'use client';

import { useRef, useState, useTransition } from 'react';
import { importVendorsAction } from './csv-actions';

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export function VendorCsvButtons() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    setImportError(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text !== 'string') {
        setImportError('Could not read file.');
        return;
      }
      startTransition(async () => {
        const r = await importVendorsAction(text);
        setResult(r);
        if (r.imported > 0) {
          window.location.reload();
        }
      });
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        onChange={onFileChange}
        aria-label="Import vendors CSV"
      />

      <button
        type="button"
        disabled={isPending}
        onClick={() => fileRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-[12px] border border-slate-200 bg-white px-4 py-2.5 text-[13.5px] font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? (
          <>
            <Spinner />
            Importing…
          </>
        ) : (
          <>
            <UploadIcon />
            Import CSV
          </>
        )}
      </button>

      <a
        href="/api/vendors/export"
        download
        className="inline-flex items-center gap-1.5 rounded-[12px] border border-slate-200 bg-white px-4 py-2.5 text-[13.5px] font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-slate-50"
      >
        <DownloadIcon />
        Export CSV
      </a>

      {result && (
        <div
          className={`mt-2 w-full rounded-[14px] border px-4 py-3 text-[13px] ${
            result.errors.length > 0
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          <span className="font-medium">
            {result.imported} imported
            {result.skipped > 0 ? `, ${result.skipped} skipped` : ''}
          </span>
          {result.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-[12px] text-amber-800">
              {result.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {importError && (
        <div className="mt-2 w-full rounded-[14px] border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">
          {importError}
        </div>
      )}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" x2="12" y1="3" y2="15" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="3" y2="15" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true" className="animate-spin">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
