'use client';

// Small presentational pieces shared by the seven step screens.

import type { ReactNode } from 'react';
import type { BidLineReviewStatus } from '@bvisible/db';
import { reviewStatusLabel, reviewStatusTone, type BidTone } from '@/lib/bid/types';

export function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format((cents || 0) / 100);
}

export function moneyShort(cents: number): string {
  const dollars = (cents || 0) / 100;
  return Number.isInteger(dollars)
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(dollars)
    : money(cents);
}

export function qty(milli: number): string {
  return String(Number((milli / 1000).toFixed(3)));
}

export function Pill({ tone, children, title }: { tone: BidTone; children: ReactNode; title?: string }) {
  return (
    <span className={`pill pill-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function StatusPill({ status, openQuestions }: { status: BidLineReviewStatus; openQuestions?: number }) {
  const tone = reviewStatusTone(status);
  let label = reviewStatusLabel(status);
  if (status === 'OFFICE_QUESTION' && openQuestions === 0) label = 'Office answered';
  return <Pill tone={tone}>{label}</Pill>;
}

export function GuideCard({ kicker, title, intro, items, tip, tipTone }: { kicker: string; title: string; intro?: string; items: Array<{ mark: string; text: ReactNode }>; tip?: ReactNode; tipTone?: 'orange' | 'blue' | 'red' }) {
  return (
    <aside className="card guide" aria-label={title}>
      <div className="guide-accent" />
      <div className="card-body">
        <span className="guide-kicker">{kicker}</span>
        <h2>{title}</h2>
        {intro ? <p>{intro}</p> : null}
        <ul className="guide-list">
          {items.map((it, i) => (
            <li key={i}>
              <b>{it.mark}</b>
              <span>{it.text}</span>
            </li>
          ))}
        </ul>
        {tip ? <div className={`tip ${tipTone === 'blue' ? 'blue' : tipTone === 'red' ? 'red' : ''}`}>{tip}</div> : null}
      </div>
    </aside>
  );
}

export function StepHeading({ step, title, description, actions }: { step: number; title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="bidw-heading">
      <div>
        <p className="bidw-eyebrow">Step {step} of 7</p>
        <h1>{title}</h1>
        <p className="bidw-desc">{description}</p>
      </div>
      {actions ? <div className="bidw-actions">{actions}</div> : null}
    </div>
  );
}

export function Banner({ tone, children }: { tone: 'info' | 'warn' | 'err' | 'ok'; children: ReactNode }) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'err' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Field({ id, label, required, hint, children, note, error, wide }: { id: string; label: string; required?: 'now' | 'before-send' | 'optional'; hint?: string; children: ReactNode; note?: string; error?: string | null; wide?: boolean }) {
  return (
    <div className={wide ? 'field-wide' : undefined}>
      <label className="lbl" htmlFor={id}>
        {label}
        {required === 'now' ? <span className="req"> *</span> : null}
        {required === 'before-send' ? <small>required before sending</small> : null}
        {required === 'optional' ? <small>optional</small> : null}
        {hint ? <small>{hint}</small> : null}
      </label>
      {children}
      {error ? <p className="field-error">{error}</p> : note ? <p className="field-note">{note}</p> : null}
    </div>
  );
}

export function fileTypeClass(mime: string): { cls: string; label: string } {
  if (mime === 'application/pdf') return { cls: 'file-type pdf', label: 'PDF' };
  if (mime.startsWith('image/')) return { cls: 'file-type img', label: mime.replace('image/', '').toUpperCase().slice(0, 4) };
  if (mime.includes('spreadsheet') || mime === 'application/vnd.ms-excel') return { cls: 'file-type', label: mime === 'application/vnd.ms-excel' ? 'XLS' : 'XLSX' };
  if (mime === 'text/csv') return { cls: 'file-type', label: 'CSV' };
  if (mime.includes('wordprocessingml')) return { cls: 'file-type doc', label: 'DOCX' };
  return { cls: 'file-type doc', label: 'FILE' };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
