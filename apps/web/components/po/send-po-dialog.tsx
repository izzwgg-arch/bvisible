'use client';

// Confirmation shown BEFORE a purchase order is emailed.
//
// The Send PO button used to send on the first click, so nobody could see who
// was about to be copied. Now it opens this panel: the vendor recipients are
// listed, the CC list is shown and editable, and the email goes out only on
// the explicit confirm inside.
//
// Edits here apply to THIS email only. The saved company default is changed in
// the admin area (/admin/po-email-cc) and is never written from this panel —
// that separation is what makes "just this once, drop the office" safe.

import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeCcList, PO_CC_MAX_RECIPIENTS } from '@/lib/emails/po-cc-list';

export interface SendPoRecipient {
  vendorName: string;
  /// Addresses the PO will be sent To for this vendor.
  ///   string[] — known here; empty means no address on file, and the server
  ///              will report that vendor as failed.
  ///   null     — not known on this screen; the server resolves the vendor's
  ///              addresses at send time. Shown as such rather than as an
  ///              empty list, which would read as a warning that isn't true.
  emails: string[] | null;
}

export function SendPoDialog({
  open,
  recipients,
  defaultCc,
  sending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  recipients: ReadonlyArray<SendPoRecipient>;
  /// The company default from admin settings, already normalized.
  defaultCc: ReadonlyArray<string>;
  sending: boolean;
  onCancel: () => void;
  /// Receives the CC list for this send. An empty array is a real instruction
  /// ("copy nobody this time"), not "use the default".
  onConfirm: (cc: string[]) => void;
}) {
  const [ccText, setCcText] = useState('');
  const [edited, setEdited] = useState(false);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  // Re-seed from the saved default every time the panel opens, so a change in
  // the admin area shows up here and a previous one-off edit never leaks into
  // the next send.
  useEffect(() => {
    if (!open) return;
    setCcText(defaultCc.join(', '));
    setEdited(false);
    confirmRef.current?.focus();
  }, [open, defaultCc]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !sending) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, sending, onCancel]);

  const parsed = useMemo(() => normalizeCcList(ccText), [ccText]);
  const blocked = parsed.invalid.length > 0 || parsed.tooMany;

  if (!open) return null;

  const vendorCount = recipients.length;
  const missingAddress = recipients.filter((r) => r.emails !== null && r.emails.length === 0);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="send-po-title"
    >
      <div className="max-h-full w-full max-w-xl overflow-y-auto rounded-[24px] border border-white/80 bg-white p-6 shadow-[0_30px_90px_rgba(15,23,42,0.25)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="send-po-title" className="text-[20px] font-semibold tracking-[-0.03em] text-slate-950">
              Send purchase order
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
              Nothing has been emailed yet. Review the recipients, then confirm below.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          >
            Close
          </button>
        </div>

        <section className="mt-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            To — {vendorCount} vendor{vendorCount === 1 ? '' : 's'}
          </h3>
          <ul className="mt-2 grid gap-1.5">
            {recipients.map((r) => (
              <li
                key={r.vendorName}
                className="rounded-[12px] border border-slate-100 bg-slate-50/70 px-3 py-2 text-[13px]"
              >
                <span className="font-semibold text-slate-800">{r.vendorName}</span>
                <span className="ml-2 break-words text-slate-500">
                  {r.emails === null
                    ? 'the addresses on file for this vendor'
                    : r.emails.length > 0
                      ? r.emails.join(', ')
                      : 'no email on file'}
                </span>
              </li>
            ))}
          </ul>
          {missingAddress.length > 0 ? (
            <p className="mt-2 text-[12px] font-semibold text-amber-700">
              {missingAddress.map((r) => r.vendorName).join(', ')}{' '}
              {missingAddress.length === 1 ? 'has' : 'have'} no email address on file and will be
              reported as failed.
            </p>
          ) : null}
        </section>

        <section className="mt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <label
              htmlFor="send-po-cc"
              className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500"
            >
              CC on this email
            </label>
            {edited ? (
              <button
                type="button"
                onClick={() => {
                  setCcText(defaultCc.join(', '));
                  setEdited(false);
                }}
                className="text-[11.5px] font-semibold text-[var(--color-bv-accent)] hover:underline"
              >
                Reset to the saved default
              </button>
            ) : null}
          </div>
          <textarea
            id="send-po-cc"
            rows={2}
            value={ccText}
            spellCheck={false}
            onChange={(e) => {
              setCcText(e.target.value);
              setEdited(true);
            }}
            placeholder="Leave blank to send to the vendor only"
            className="mt-2 w-full rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-[13.5px] text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-[#F4A66F] focus:bg-white focus:shadow-[0_0_0_4px_rgba(242,135,68,0.16)]"
          />
          <p className="mt-1.5 text-[11.5px] leading-snug text-slate-500">
            Separate addresses with commas. Changes here apply to this email only — the saved
            default is managed in Admin → PO email CC.
          </p>

          {parsed.invalid.length > 0 ? (
            <p className="mt-2 text-[12px] font-semibold text-rose-600">
              Not a valid email address: {parsed.invalid.slice(0, 3).join(', ')}
              {parsed.invalid.length > 3 ? ` (+${parsed.invalid.length - 3} more)` : ''}
            </p>
          ) : parsed.tooMany ? (
            <p className="mt-2 text-[12px] font-semibold text-rose-600">
              That is more than {PO_CC_MAX_RECIPIENTS} CC recipients.
            </p>
          ) : (
            <p className="mt-2 rounded-[12px] border border-slate-100 bg-slate-50/70 px-3 py-2 text-[12.5px] text-slate-700">
              {parsed.emails.length === 0 ? (
                <>
                  <span className="font-semibold">No CC.</span> Only the vendor
                  {vendorCount === 1 ? '' : 's'} above will receive this purchase order.
                </>
              ) : (
                <>
                  <span className="font-semibold">Copying:</span> {parsed.emails.join(', ')}
                </>
              )}
              {edited ? <span className="ml-1 text-slate-500">(edited for this email)</span> : null}
            </p>
          )}
        </section>

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onConfirm(parsed.emails)}
            disabled={sending || blocked}
            className="rounded-[10px] bg-[var(--color-bv-accent)] px-5 py-2.5 text-[13px] font-bold text-white shadow-[0_14px_28px_rgba(47,90,243,0.22)] hover:opacity-90 disabled:opacity-50"
          >
            {sending ? 'Sending…' : `Send PO to ${vendorCount} vendor${vendorCount === 1 ? '' : 's'}`}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="rounded-[10px] border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
