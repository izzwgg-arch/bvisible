'use client';

// Step 7 — Customer-ready estimate + QBME + completion checklist. Both
// outputs are rendered from the SAME saved lines (loadEstimatePdfData →
// renderEstimatePdfBody / buildQbmeExport) so they agree line by line with
// the PDF and the public quote. Estimate actions reuse the existing
// send / approve / finalize / PO / preview flows — no second workflow.

import Link from 'next/link';
import { useActionState, useCallback, useEffect, useState } from 'react';
import { EstimateStatus } from '@bvisible/db';
import type { BidFinalOutputs } from '@/lib/bid/final-outputs';
import { createPoFromEstimateAction } from '../../../../purchase-orders/actions';
import { finalizeEstimateAction, updateEstimateStatusAction } from '../../actions';
import { getBidFinalOutputsAction } from '../actions';
import { sendEstimateEmailAction, type SendEstimateEmailState } from '../../preview/actions';
import { useBid, StepNav } from '../bid-workspace';
import { Banner, GuideCard, Pill, StepHeading, money } from '../bid-ui';

const INITIAL_SEND: SendEstimateEmailState = { ok: false, error: null, messageId: null };

export function StepFinal() {
  const { data, estimateId, finalOutputs, readOnly, refresh } = useBid();
  // The server snapshot is only the first paint: an edit made moments ago on
  // another step may not be in it yet, and the customer estimate / QBME must
  // never show stale numbers. Refresh on mount and after every action here.
  const [out, setOut] = useState<BidFinalOutputs | null>(finalOutputs);
  const [refreshingOut, setRefreshingOut] = useState(false);
  const reloadOutputs = useCallback(async () => {
    setRefreshingOut(true);
    try {
      const r = await getBidFinalOutputsAction({ estimateId });
      if (r.ok && r.outputs) setOut(r.outputs);
    } catch {
      // Keep the last good document on screen rather than blanking it.
    } finally {
      setRefreshingOut(false);
    }
  }, [estimateId]);
  useEffect(() => {
    void reloadOutputs();
  }, [reloadOutputs, data.estimate.updatedAt, data.lines.length, data.totals.subtotalCents]);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sendState, sendAction, sendPending] = useActionState(sendEstimateEmailAction, INITIAL_SEND);
  const checklist = data.checklist;
  const canSend = checklist.canSend && !!data.estimate.client.email;

  useEffect(() => {
    if (sendState.ok) refresh();
  }, [sendState.ok, refresh]);

  async function copyQbme() {
    if (!out) return;
    try {
      await navigator.clipboard.writeText(out.qbmeBlock);
      setCopied('ok');
    } catch {
      setCopied('fail');
      const el = document.getElementById('qbme-output');
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
    setTimeout(() => setCopied(null), 2500);
  }

  function downloadQbme() {
    if (!out) return;
    const url = URL.createObjectURL(new Blob([out.qbmeBlock], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.estimate.number}-qbme.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function setStatus(status: EstimateStatus) {
    setBusy(status);
    setActionError(null);
    const r = await updateEstimateStatusAction({ estimateId, status });
    setBusy(null);
    if (r.error) setActionError(r.error);
    else {
      refresh();
      void reloadOutputs();
    }
  }

  async function finalize() {
    if (!window.confirm('Finalize this estimate? Lines and pricing lock; a purchase order is created from the internal materials.')) return;
    setBusy('finalize');
    setActionError(null);
    const r = await finalizeEstimateAction({ estimateId });
    setBusy(null);
    if (!r.ok) setActionError(r.message ?? 'Could not finalize.');
    else refresh();
  }

  async function createPo() {
    setBusy('po');
    setActionError(null);
    const r = await createPoFromEstimateAction({ estimateId, vendorId: null });
    setBusy(null);
    if (r.error) setActionError(r.error);
    else refresh();
  }

  const status = data.estimate.status;
  const approved = status === EstimateStatus.APPROVED || status === EstimateStatus.FINALIZED;

  return (
    <>
      <StepHeading
        step={7}
        title="Ready estimate and QuickBooks output"
        description="The finish shows the complete customer estimate first, then the matching QBME block with every line kept separate."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => window.print()}>Print estimate</button>
            <a className="btn btn-secondary" href={`/estimates/${estimateId}/preview/pdf`}>Download PDF</a>
            <button type="button" className="btn btn-orange" onClick={() => void copyQbme()} disabled={!out}>{copied === 'ok' ? 'QBME copied ✓' : copied === 'fail' ? 'Copy failed — text selected' : 'Copy QBME'}</button>
          </>
        }
      />

      {checklist.blocking.length > 0 ? (
        <Banner tone="warn">
          <span>
            <strong>{checklist.blocking.length} item{checklist.blocking.length === 1 ? '' : 's'} still block sending:</strong> {checklist.blocking.map((b) => b.label.toLowerCase()).join(', ')}. The estimate is saved as a draft — fix the items in the checklist below, then send.
          </span>
        </Banner>
      ) : null}
      {actionError || sendState.error ? <Banner tone="err"><span>{actionError ?? sendState.error}</span></Banner> : null}
      {sendState.ok ? <Banner tone="ok"><span>Estimate emailed to the customer{sendState.messageId ? ` (message ${sendState.messageId})` : ''}. It can be sent again at any time.</span></Banner> : null}

      <div className="finish-stack">
        <article className="estimate-sheet" aria-label="Customer-ready estimate">
          <div className="estimate-band" />
          {out ? (
            <>
              <style dangerouslySetInnerHTML={{ __html: scopeCss(out.estimateCss) }} />
              <div className="bv-quote-document" dangerouslySetInnerHTML={{ __html: out.estimateHtml }} />
            </>
          ) : (
            <div className="empty">The customer estimate could not be rendered.</div>
          )}
        </article>

        <div className="final-grid">
          <section className="card qbme-card" aria-label="QuickBooks Magic Estimator output">
            <div className="card-body">
              <div className="qbme-intro">
                <div>
                  <h2>QBME — ready to paste into QuickBooks{refreshingOut ? ' · refreshing…' : ''}</h2>
                  <p>The Item, Description, Qty, and Rate match the customer estimate above line for line. Amount stays empty for QuickBooks to calculate; no tax line, no customer information.</p>
                </div>
                <div className="bidw-actions">
                  <button type="button" className="btn btn-primary" onClick={() => void copyQbme()} disabled={!out}>{copied === 'ok' ? 'Copied ✓' : 'Copy QBME'}</button>
                  <button type="button" className="btn btn-secondary" onClick={downloadQbme} disabled={!out}>Download .txt</button>
                </div>
              </div>
              <pre className="qbme-out" id="qbme-output" tabIndex={0} aria-label="QBME block">{out?.qbmeBlock ?? ''}</pre>
              {out ? (
                <div className="qbme-sum">
                  <span>{out.lineCount} complete estimate line{out.lineCount === 1 ? '' : 's'} • amount left empty for QuickBooks calculation • {out.qbmeReconciled ? 'Σ QTY × RATE reconciles with the pre-tax subtotal' : `rounding difference of ${money(Math.abs(out.qbmeDriftCents))} vs. the pre-tax subtotal — see the QBME page`}</span>
                  <strong>Pre-tax subtotal: {money(out.qbmeSubtotalCents)}{out.taxPercentMilli > 0 ? ` • with tax (${out.taxLabel}): ${money(out.totalCents)}` : ' • tax not included'}</strong>
                </div>
              ) : null}
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Description</th>
                      <th className="qty">Qty</th>
                      <th className="money">Rate</th>
                      <th className="money">Qty × Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(out?.qbmeLines ?? []).map((l, i) => (
                      <tr key={i}>
                        <td><strong>{l.item}</strong></td>
                        <td className="item-meta">{l.description}</td>
                        <td className="qty">{l.qty}</td>
                        <td className="money">${l.rate}</td>
                        <td className="money">{money(l.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <div className="bidw-stack">
            <div className="card completion-card">
              <div className="card-head">
                <div>
                  <h2>Completion check</h2>
                  <p>Every priced line is included in both outputs.</p>
                </div>
                <Pill tone={checklist.blocking.length > 0 ? 'red' : checklist.warnings.length > 0 ? 'yellow' : 'green'}>{checklist.blocking.length > 0 ? `${checklist.blocking.length} blocking` : checklist.warnings.length > 0 ? `${checklist.warnings.length} to review` : 'Ready'}</Pill>
              </div>
              <div className="card-body">
                <div className="checklist">
                  {checklist.items.map((it) => (
                    <div key={it.key} className={`check-row ${it.state}`}>
                      <span className="check-circle" aria-hidden="true">{it.state === 'ok' ? '✓' : it.state === 'blocking' ? '!' : it.state === 'warning' ? '?' : '•'}</span>
                      <strong>{it.label}</strong>
                      <span title={it.detail}>{it.state === 'ok' ? 'Done' : it.state === 'blocking' ? 'Required' : it.state === 'warning' ? 'Check' : 'Pending'}</span>
                    </div>
                  ))}
                </div>
                <div className="price-lines" style={{ marginTop: 16 }}>
                  <div className="price-line"><span>Production (signs)</span><strong>{money(data.totals.productionSubtotalCents)}</strong></div>
                  <div className="price-line"><span>Design</span><strong>{data.workflow.designIncluded ? money(data.totals.designCents) : 'Excluded'}</strong></div>
                  <div className="price-line"><span>Installation</span><strong>{data.workflow.installIncluded ? money(data.totals.installCents) : 'Excluded'}</strong></div>
                  <div className="price-line"><span>Subtotal</span><strong>{money(data.totals.subtotalCents)}</strong></div>
                  <div className="price-line"><span>{data.totals.taxPercentMilli > 0 ? `Sales tax (${data.totals.taxLabel})` : 'Sales tax'}</span><strong>{data.totals.taxPercentMilli > 0 ? money(data.totals.taxCents) : 'Not included'}</strong></div>
                </div>
                <div className="grand"><span>{data.totals.taxPercentMilli > 0 ? 'Estimated total' : 'Estimated total (pre-tax)'}</span><strong>{money(data.totals.totalCents)}</strong></div>
              </div>
            </div>

            <div className="card no-print">
              <div className="card-head">
                <div>
                  <h2>Estimate actions</h2>
                  <p>Status: <strong>{data.estimate.statusLabel}</strong>{data.estimate.linkedPoCount > 0 ? ` · ${data.estimate.linkedPoCount} linked PO${data.estimate.linkedPoCount === 1 ? '' : 's'}` : ''}</p>
                </div>
              </div>
              <div className="card-body" style={{ display: 'grid', gap: 9 }}>
                <form action={sendAction} style={{ display: 'grid', gap: 6 }}>
                  <input type="hidden" name="estimateId" value={estimateId} />
                  <button type="submit" className="btn btn-primary" disabled={sendPending || !canSend} title={!canSend ? (!data.estimate.client.email ? 'Add a customer email on Step 1 first' : 'Resolve the blocking checklist items first') : 'Emails the customer estimate with a public accept/decline link'}>
                    {sendPending ? 'Sending…' : sendState.ok ? 'Send to customer again' : 'Send to customer'}
                  </button>
                  {!canSend ? <span className="save-note">{!data.estimate.client.email ? 'Customer email missing.' : 'Blocked by the checklist above.'} You can still <Link href={`/estimates/${estimateId}/preview`}>open the preview</Link>.</span> : null}
                </form>
                <Link href={`/estimates/${estimateId}/preview`} className="btn btn-secondary">Preview, print &amp; public quote link</Link>
                <Link href={`/estimates/${estimateId}/qbme`} className="btn btn-secondary">Open QBME page</Link>
                {!readOnly ? (
                  <>
                    <button type="button" className="btn btn-secondary" disabled={busy !== null || approved} onClick={() => void setStatus(EstimateStatus.APPROVED)}>{approved ? 'Approved ✓' : busy === 'APPROVED' ? 'Approving…' : 'Mark approved'}</button>
                    {status === EstimateStatus.APPROVED && data.estimate.linkedPoCount === 0 ? (
                      <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => void createPo()}>{busy === 'po' ? 'Creating…' : 'Create PO from estimate'}</button>
                    ) : null}
                    {status === EstimateStatus.APPROVED ? (
                      <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => void finalize()}>{busy === 'finalize' ? 'Finalizing…' : 'Finalize estimate'}</button>
                    ) : null}
                    {status !== EstimateStatus.REJECTED && status !== EstimateStatus.FINALIZED ? (
                      <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => void setStatus(EstimateStatus.REJECTED)}>Mark declined</button>
                    ) : null}
                  </>
                ) : null}
                <Link href={`/estimates/${estimateId}`} className="btn btn-quiet">Open estimate record (timeline, POs, links)</Link>
              </div>
            </div>

            <GuideCard
              kicker="What happens next"
              title="Two outputs, one set of saved lines"
              intro="The customer estimate, the PDF, the public quote link, and the QBME all read the same lines in the same order."
              items={[
                { mark: '1', text: 'Print or download the PDF for the bid package.' },
                { mark: '2', text: 'Send to the customer — they accept or decline from the public link.' },
                { mark: '3', text: 'Paste the QBME block into the QuickBooks Magic Estimator; QuickBooks applies tax.' },
              ]}
              tip={<><strong>Approval &amp; finalize</strong> follow the existing rules: approve → PO → QuickBooks PO number → finalize. Nothing here bypasses them.</>}
            />
          </div>
        </div>
      </div>

      <StepNav back={6}>
        <button type="button" className="btn btn-secondary" onClick={() => window.print()}>Print estimate</button>
      </StepNav>
    </>
  );
}

/** Scope the PDF stylesheet to the embedded sheet so it cannot restyle the workspace. */
function scopeCss(css: string): string {
  return css
    .replace(/\bbody\s*\{[^}]*\}/g, '')
    .replace(/(^|\})\s*([^{}@][^{}]*)\{/g, (m, close: string, selector: string) => {
      const scoped = selector
        .split(',')
        .map((s) => `.bidw .estimate-sheet ${s.trim()}`)
        .join(', ');
      return `${close} ${scoped}{`;
    });
}
