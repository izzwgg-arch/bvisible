'use client';

import { startTransition, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { POAttachmentKind } from '@bvisible/db';
import {
  deletePoAttachmentAction,
  uploadPoAttachmentAction,
  type UploadAttachmentState,
} from './actions';

interface AttachmentRow {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  kind: POAttachmentKind;
  createdAt: string;
  uploadedByLabel: string;
}

const KIND_OPTIONS: ReadonlyArray<POAttachmentKind> = [
  POAttachmentKind.RECEIPT,
  POAttachmentKind.INVOICE,
  POAttachmentKind.VENDOR_DOC,
  POAttachmentKind.DRAWING,
  POAttachmentKind.OTHER,
];

function kindLabel(k: POAttachmentKind): string {
  switch (k) {
    case POAttachmentKind.RECEIPT:
      return 'Receipt';
    case POAttachmentKind.INVOICE:
      return 'Invoice';
    case POAttachmentKind.VENDOR_DOC:
      return 'Vendor doc';
    case POAttachmentKind.DRAWING:
      return 'Drawing';
    case POAttachmentKind.OTHER:
      return 'Other';
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

interface AttachmentsPanelProps {
  purchaseOrderId: string;
  attachments: ReadonlyArray<AttachmentRow>;
}

export function PoAttachmentsPanel({
  purchaseOrderId,
  attachments,
}: AttachmentsPanelProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [kind, setKind] = useState<POAttachmentKind>(POAttachmentKind.RECEIPT);
  const [uploading, setUploading] = useState(false);
  const [state, setState] = useState<UploadAttachmentState>({ error: null });
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (uploading) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    data.set('purchaseOrderId', purchaseOrderId);
    data.set('kind', kind);
    setUploading(true);
    setState({ error: null });
    try {
      const result = await uploadPoAttachmentAction({ error: null }, data);
      setState(result);
      if (!result.error) {
        form.reset();
        startTransition(() => router.refresh());
      }
    } catch (err) {
      setState({
        error: err instanceof Error ? err.message : 'Upload failed.',
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(attachmentId: string) {
    if (busyId) return;
    if (!window.confirm('Remove this attachment?')) return;
    setBusyId(attachmentId);
    try {
      const r = await deletePoAttachmentAction({
        purchaseOrderId,
        attachmentId,
      });
      if (r.error) setState({ error: r.error });
      else startTransition(() => router.refresh());
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
      <div className="flex items-center justify-between border-b border-[var(--color-bv-border)] px-5 py-3">
        <h2 className="text-[14.5px] font-semibold tracking-tight text-[var(--color-bv-text)]">
          Attachments
        </h2>
        <span className="text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
          {attachments.length} file{attachments.length === 1 ? '' : 's'}
        </span>
      </div>

      <ul className="divide-y divide-[var(--color-bv-border)]">
        {attachments.map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between gap-4 px-5 py-2.5 text-[13px]"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span
                className="inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2 py-0.5 text-[11px] uppercase tracking-wider text-[var(--color-bv-muted)]"
              >
                {kindLabel(a.kind)}
              </span>
              <a
                href={`/api/po/${purchaseOrderId}/attachments/${a.id}`}
                className="min-w-0 truncate text-[var(--color-bv-text)] hover:text-[var(--color-bv-accent)]"
              >
                {a.originalFilename}
              </a>
              <span className="shrink-0 font-mono text-[11px] text-[var(--color-bv-muted)]">
                {a.mimeType.split('/')[1] ?? a.mimeType}
              </span>
              <span className="shrink-0 text-[11px] text-[var(--color-bv-muted)]">
                {fmtBytes(a.sizeBytes)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-[11px] text-[var(--color-bv-muted)]">
                {new Date(a.createdAt).toLocaleDateString()} · {a.uploadedByLabel}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(a.id)}
                disabled={busyId === a.id}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] text-[12px] text-[var(--color-bv-muted)] hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Delete attachment"
                title="Delete attachment"
              >
                ×
              </button>
            </div>
          </li>
        ))}
        {attachments.length === 0 ? (
          <li className="px-5 py-6 text-center text-[12.5px] text-[var(--color-bv-muted)]">
            No attachments yet. Upload PDFs, JPEGs, PNGs, or WEBPs (≤ 25 MB).
          </li>
        ) : null}
      </ul>

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-3 border-t border-[var(--color-bv-border)] px-5 py-3"
      >
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
            Kind
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.currentTarget.value as POAttachmentKind)}
            className="rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2 py-1.5 text-[13px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
            File
          </span>
          <input
            type="file"
            name="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            required
            className="block w-full text-[12.5px] text-[var(--color-bv-text)] file:mr-3 file:rounded-[6px] file:border file:border-[var(--color-bv-border)] file:bg-[var(--color-bv-bg)] file:px-3 file:py-1.5 file:text-[12.5px] file:font-medium file:text-[var(--color-bv-text)] hover:file:bg-[var(--color-bv-surface)]"
          />
        </label>
        <button
          type="submit"
          disabled={uploading}
          className="inline-flex items-center justify-center rounded-[6px] bg-[var(--color-bv-accent)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </form>
      {state.error ? (
        <p className="px-5 pb-3 text-[11.5px] text-rose-700">{state.error}</p>
      ) : state.uploadedAt ? (
        <p className="px-5 pb-3 text-[11.5px] text-emerald-700">Uploaded.</p>
      ) : null}
    </section>
  );
}
