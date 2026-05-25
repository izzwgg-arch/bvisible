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
  sourceEmailId: string | null;
}

const KIND_OPTIONS: ReadonlyArray<POAttachmentKind> = [
  POAttachmentKind.RECEIPT,
  POAttachmentKind.INVOICE,
  POAttachmentKind.VENDOR_INVOICE,
  POAttachmentKind.INSTALL_PHOTO,
  POAttachmentKind.FIELD_DOCUMENT,
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
    case POAttachmentKind.VENDOR_INVOICE:
      return 'Vendor invoice';
    case POAttachmentKind.INSTALL_PHOTO:
      return 'Install photo';
    case POAttachmentKind.FIELD_DOCUMENT:
      return 'Field document';
    case POAttachmentKind.VENDOR_DOC:
      return 'Vendor doc';
    case POAttachmentKind.DRAWING:
      return 'Drawing';
    case POAttachmentKind.OTHER:
      return 'Other';
    case POAttachmentKind.EMAIL_ATTACHMENT:
      return 'Email';
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

const COLLAPSE_AFTER = 6;

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
  const [showAll, setShowAll] = useState(false);

  const emailCount = attachments.filter((a) => a.sourceEmailId != null).length;
  const visible =
    showAll || attachments.length <= COLLAPSE_AFTER
      ? attachments
      : attachments.slice(0, COLLAPSE_AFTER);

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
    <section
      id="po-attachments"
      className="scroll-mt-24 rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]"
    >
      <div className="sticky top-[var(--po-ops-sticky,0)] z-[1] flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-2.5">
        <div>
          <h2 className="text-[13.5px] font-semibold tracking-tight text-[var(--color-bv-text)]">
            Attachments
          </h2>
          {emailCount > 0 ? (
            <p className="text-[11px] text-sky-800">
              {emailCount} from vendor email — triggers OCR when uploaded via ingestion
            </p>
          ) : null}
        </div>
        <span className="text-[11px] text-[var(--color-bv-muted)]">
          {attachments.length} file{attachments.length === 1 ? '' : 's'}
        </span>
      </div>

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-2 border-b border-[var(--color-bv-border)] bg-[var(--color-bv-bg)]/50 px-4 py-2.5"
      >
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-bv-muted)]">
            Kind
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.currentTarget.value as POAttachmentKind)}
            className="rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2 py-1 text-[12px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]"
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[140px] flex-1 flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-bv-muted)]">
            File
          </span>
          <input
            type="file"
            name="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            required
            className="block w-full text-[12px] text-[var(--color-bv-text)] file:mr-2 file:rounded-[6px] file:border file:border-[var(--color-bv-border)] file:bg-[var(--color-bv-surface)] file:px-2 file:py-1 file:text-[11px] file:font-medium"
          />
        </label>
        <button
          type="submit"
          disabled={uploading}
          className="inline-flex items-center justify-center rounded-[6px] bg-[var(--color-bv-accent)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-bv-accent-foreground)] hover:opacity-90 disabled:opacity-60"
        >
          {uploading ? '…' : 'Upload'}
        </button>
      </form>

      <ul className="divide-y divide-[var(--color-bv-border)]">
        {visible.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-[12.5px] sm:flex-nowrap">
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-semibold uppercase ${
                a.sourceEmailId
                  ? 'border-sky-300 bg-sky-50 text-sky-900'
                  : 'border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)]'
              }`}
            >
              {a.sourceEmailId ? '✉ Email' : kindLabel(a.kind)}
            </span>
            <a
              href={`/api/po/${purchaseOrderId}/attachments/${a.id}`}
              className="min-w-0 flex-1 truncate font-medium text-[var(--color-bv-text)] hover:text-[var(--color-bv-accent)]"
            >
              {a.originalFilename}
            </a>
            <span className="shrink-0 font-mono text-[10px] text-[var(--color-bv-muted)]">
              {fmtBytes(a.sizeBytes)}
            </span>
            <span className="hidden shrink-0 text-[10px] text-[var(--color-bv-muted)] sm:inline">
              {new Date(a.createdAt).toLocaleDateString()}
            </span>
            <button
              type="button"
              onClick={() => handleDelete(a.id)}
              disabled={busyId === a.id}
              className="shrink-0 rounded border border-[var(--color-bv-border)] px-1.5 py-0.5 text-[11px] text-[var(--color-bv-muted)] hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
              aria-label="Delete attachment"
            >
              Remove
            </button>
          </li>
        ))}
        {attachments.length === 0 ? (
          <li className="px-4 py-5 text-center text-[12px] text-[var(--color-bv-muted)]">
            No attachments — upload receipts or vendor docs to start OCR.
          </li>
        ) : null}
      </ul>
      {attachments.length > COLLAPSE_AFTER && !showAll ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-full border-t border-[var(--color-bv-border)] px-4 py-2 text-[12px] font-medium text-[var(--color-bv-accent)] hover:bg-[var(--color-bv-bg)]"
        >
          Show {attachments.length - COLLAPSE_AFTER} more
        </button>
      ) : null}
      {state.error ? (
        <p className="px-4 pb-2 text-[11.5px] text-rose-700">{state.error}</p>
      ) : state.uploadedAt ? (
        <p className="px-4 pb-2 text-[11.5px] text-emerald-700">Uploaded.</p>
      ) : null}
    </section>
  );
}
