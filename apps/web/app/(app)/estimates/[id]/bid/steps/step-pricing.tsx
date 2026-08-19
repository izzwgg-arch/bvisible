'use client';

// Step 3 — Review pricing. Summary cards, the takeoff-review table (status /
// sign item / source / takeoff qty / billable qty / QB item / method / rate /
// total / explanation), per-line confirm / edit / exclude, manual line
// entry, and the admin "check for updated pricing" comparison.

import { useMemo, useState } from 'react';
import type { QbItem } from '@bvisible/db';
import type { BidWorkspaceLine, RepriceDiff } from '@/lib/bid/workflow';
import { QBME_ALLOWED_ITEMS, qbItemFromLabel, qbItemLabel } from '@/lib/estimate/qbme';
import { matchLevelLabel, pricingMethodLabel, pricingUnitLabel } from '@/lib/bid/types';
import { addManualBidLineAction, applyBidRepricingAction, checkBidRepricingAction, confirmBidLineAction, excludeBidLineAction, setBidLineOverrideAction } from '../actions';
import { useBid, StepNav } from '../bid-workspace';
import { Banner, GuideCard, Pill, StatusPill, StepHeading, money, qty } from '../bid-ui';

function rowClass(l: BidWorkspaceLine): string {
  const s = l.detail?.reviewStatus;
  if (s === 'EXCLUDED') return 'row-excluded';
  if (s === 'NEEDS_REVIEW') return 'row-warning';
  if (s === 'OFFICE_QUESTION') return 'row-question';
  if (s === 'BLOCKED') return 'row-blocked';
  return '';
}

export function StepPricing() {
  const { data, estimateId, readOnly, refresh, goToStep } = useBid();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BidWorkspaceLine | null>(null);
  const [adding, setAdding] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const [reprice, setReprice] = useState<{ diffs: RepriceDiff[]; selected: Set<string> } | null>(null);
  const [repriceBusy, setRepriceBusy] = useState(false);

  const signLines = useMemo(() => data.lines.filter((l) => !l.isService), [data.lines]);
  const visibleLines = signLines.filter((l) => showExcluded || l.detail?.reviewStatus !== 'EXCLUDED');
  const excludedCount = signLines.filter((l) => l.detail?.reviewStatus === 'EXCLUDED').length;
  const c = data.counts;
  const canReprice = data.permissions.canReprice && data.estimate.status === 'DRAFT' && !readOnly;

  async function run(id: string, fn: () => Promise<{ ok: boolean; error: string | null }>) {
    setBusyId(id);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(r.error ?? 'Something went wrong.');
      else refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function checkReprice() {
    setRepriceBusy(true);
    setError(null);
    const r = await checkBidRepricingAction({ estimateId });
    setRepriceBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setReprice({ diffs: r.diffs, selected: new Set(r.diffs.map((d) => d.lineId)) });
  }

  async function applyReprice(all: boolean) {
    if (!reprice) return;
    const ids = all ? reprice.diffs.map((d) => d.lineId) : [...reprice.selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Apply the current Sheet pricing to ${ids.length} line${ids.length === 1 ? '' : 's'}? Prior decisions stay in the line history.`)) return;
    setRepriceBusy(true);
    const r = await applyBidRepricingAction({ estimateId, lineIds: ids });
    setRepriceBusy(false);
    if (!r.ok) setError(r.error);
    setReprice(null);
    refresh();
  }

  return (
    <>
      <StepHeading
        step={3}
        title="Review what was priced"
        description="Green lines matched an approved rule. Yellow lines deserve a quick check. Blue lines need an office decision before the estimate is complete."
        actions={
          <>
            {canReprice ? (
              <button type="button" className="btn btn-secondary" disabled={repriceBusy} onClick={() => void checkReprice()}>
                {repriceBusy ? 'Checking…' : 'Check for updated pricing'}
              </button>
            ) : null}
            {!readOnly ? (
              <button type="button" className="btn btn-secondary" onClick={() => setAdding(true)}>+ Add line</button>
            ) : null}
            <StepNav back={2} next={4} nextLabel="Continue →" />
          </>
        }
      />

      {data.sheet.status !== 'OK' ? (
        <Banner tone="warn">
          <span>
            <strong>Pricing Sheet sync problem.</strong> Last successful sync: {data.sheet.syncedAt ? new Date(data.sheet.syncedAt).toLocaleString() : 'never'}. {data.sheet.lastError ? `Error: ${data.sheet.lastError}. ` : ''}Cached pricing is being used; an administrator can refresh from the Pricing backend.
          </span>
        </Banner>
      ) : null}
      {data.sheet.standardSignCount === 0 ? (
        <Banner tone="info">
          <span>
            <strong>No standard signs are available yet.</strong> The Sheet&apos;s <em>Standard Signs</em> tab is {data.sheet.tabStatus === 'MISSING' ? 'not set up' : data.sheet.tabStatus === 'UNRECOGNIZED' ? 'present but its headers were not recognized' : 'empty'}, so nothing can match automatically — lines are priced from the takeoff&apos;s own prices or go to the office. Admins: see Pricing backend → Standard signs.
          </span>
        </Banner>
      ) : null}
      {error ? (
        <Banner tone="err">
          <span>{error}</span>
        </Banner>
      ) : null}

      <div className="stats" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
        <div className="stat"><span className="stat-label">Sign lines</span><strong className="stat-value">{c.signLines}</strong><span className="stat-note">{c.takeoffQty} takeoff items</span></div>
        <div className="stat"><span className="stat-label">Takeoff quantity</span><strong className="stat-value">{c.takeoffQty}</strong><span className="stat-note">from the source</span></div>
        <div className="stat"><span className="stat-label">Automatically priced</span><strong className="stat-value">{c.autoPriced}</strong><span className="stat-note">No action needed</span></div>
        <div className="stat"><span className="stat-label">Needs a check</span><strong className="stat-value">{c.needsReview}</strong><span className="stat-note">Confirm the interpretation</span></div>
        <div className="stat"><span className="stat-label">Office decision</span><strong className="stat-value">{c.officeQuestions + c.blocked}</strong><span className="stat-note">{c.openQuestions} open question{c.openQuestions === 1 ? '' : 's'}</span></div>
        <div className="stat"><span className="stat-label">Production subtotal</span><strong className="stat-value">{money(data.totals.productionSubtotalCents)}</strong><span className="stat-note">Signs only, before design &amp; install</span></div>
      </div>

      <div className="bidw-layout-wide">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Imported sign items</h2>
              <p>Every real sign stays its own line. Click a line&apos;s explanation to see the takeoff quantity, billable quantity, rate, and formula.</p>
            </div>
            <div className="bidw-actions">
              {excludedCount > 0 ? (
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setShowExcluded((v) => !v)}>
                  {showExcluded ? 'Hide' : 'Show'} {excludedCount} excluded
                </button>
              ) : null}
              <Pill tone="green">{c.autoPriced} ready</Pill>
            </div>
          </div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Sign item</th>
                  <th>Source</th>
                  <th className="qty">Takeoff</th>
                  <th className="qty">Pricing quantity</th>
                  <th>QuickBooks item</th>
                  <th>Method</th>
                  <th className="money">Rate</th>
                  <th className="money">Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleLines.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="empty">
                      No sign lines yet. Upload a takeoff on Step 2 or add a line by hand.
                    </td>
                  </tr>
                ) : null}
                {visibleLines.map((l) => (
                  <LineRow
                    key={l.id}
                    line={l}
                    busy={busyId === l.id}
                    readOnly={readOnly}
                    onConfirm={() => void run(l.id, () => confirmBidLineAction({ estimateId, lineId: l.id }))}
                    onExclude={() => {
                      const reason = window.prompt('Why is this row not a sign line? (optional)') ?? undefined;
                      void run(l.id, () => excludeBidLineAction({ estimateId, lineId: l.id, reason: reason || null }));
                    }}
                    onEdit={() => setEditing(l)}
                    onAsk={() => void goToStep(4)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <GuideCard
          kicker="How to review this page"
          title="Focus only on lines that need judgment"
          intro="The system handles normal multiplication, but you still see why every price was selected."
          items={[
            { mark: '✓', text: <><strong>Green:</strong> Exact product, size, construction, and pricing rule matched.</> },
            { mark: '!', text: <><strong>Yellow:</strong> The price is calculated, but confirm the interpretation.</> },
            { mark: '?', text: <><strong>Blue:</strong> An office decision affects the final rate or scope — answer it on Step 4.</> },
            { mark: '×', text: <><strong>Red / gray:</strong> Blocked or excluded rows never reach the customer estimate.</> },
          ]}
          tip={<><strong>Learning built in:</strong> Click any line&apos;s explanation to see the takeoff quantity, billable quantity, and formula used. Rates come from the Sheet and standard-sign rules — never invented.</>}
        />
      </div>

      <StepNav back={2} next={4} nextLabel="Continue →" />

      {editing ? <EditLineDialog line={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} /> : null}
      {adding ? <AddLineDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} /> : null}
      {reprice ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Updated pricing available">
          <div className="modal">
            <div className="card-head">
              <div>
                <h2>Check for updated pricing</h2>
                <p>Compares each line&apos;s saved rate with the current Sheet / standard-sign rate. Nothing changes until you apply.</p>
              </div>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setReprice(null)}>Close</button>
            </div>
            <div className="card-body">
              {reprice.diffs.length === 0 ? (
                <div className="empty">Every line already uses the current pricing. Nothing to change.</div>
              ) : (
                <>
                  <div className="table-wrap">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th></th>
                          <th>Line</th>
                          <th>Old source → new source</th>
                          <th className="money">Old rate</th>
                          <th className="money">New rate</th>
                          <th className="money">Old total</th>
                          <th className="money">New total</th>
                          <th className="money">Difference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reprice.diffs.map((d) => (
                          <tr key={d.lineId}>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Apply to ${d.description}`}
                                checked={reprice.selected.has(d.lineId)}
                                onChange={(e) => {
                                  const next = new Set(reprice.selected);
                                  if (e.target.checked) next.add(d.lineId);
                                  else next.delete(d.lineId);
                                  setReprice({ ...reprice, selected: next });
                                }}
                              />
                            </td>
                            <td>
                              <span className="item-name">{d.description}</span>
                              <span className="item-meta">{d.reason}</span>
                            </td>
                            <td className="item-meta">{d.oldSource} → {d.newSource}</td>
                            <td className="money">{money(d.oldRateCents)}</td>
                            <td className="money">{money(d.newRateCents)}</td>
                            <td className="money">{money(d.oldTotalCents)}</td>
                            <td className="money">{money(d.newTotalCents)}</td>
                            <td className="money" style={{ color: d.differenceCents > 0 ? 'var(--red)' : 'var(--green)' }}>{d.differenceCents > 0 ? '+' : ''}{money(d.differenceCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="footer-actions">
                    <span className="save-note">Applying writes new pricing snapshots and an audit entry; prior decisions stay in each line&apos;s history.</span>
                    <div className="bidw-actions">
                      <button type="button" className="btn btn-quiet" onClick={() => setReprice(null)}>Keep old pricing</button>
                      <button type="button" className="btn btn-secondary" disabled={repriceBusy || reprice.selected.size === 0} onClick={() => void applyReprice(false)}>Apply selected ({reprice.selected.size})</button>
                      <button type="button" className="btn btn-primary" disabled={repriceBusy} onClick={() => void applyReprice(true)}>Apply all</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function LineRow({ line, busy, readOnly, onConfirm, onExclude, onEdit, onAsk }: { line: BidWorkspaceLine; busy: boolean; readOnly: boolean; onConfirm: () => void; onExclude: () => void; onEdit: () => void; onAsk: () => void }) {
  const [open, setOpen] = useState(false);
  const d = line.detail;
  const status = d?.reviewStatus ?? 'CONFIRMED';
  const priced = d?.pricingSource ? d.pricingSource !== 'UNPRICED' : true;
  const unit = d?.pricingUnit ?? 'SIGN';
  const billable = line.qtyMilli / 1000;
  const source = (d?.sourceQtyMilli ?? line.qtyMilli) / 1000;
  const method = line.snapshot?.pricingMethod ?? 'PER_SIGN';
  const explanation = d?.explanation ?? [];
  const excluded = status === 'EXCLUDED';
  return (
    <>
      <tr className={rowClass(line)}>
        <td>
          <StatusPill status={status} openQuestions={line.openQuestionCount} />
        </td>
        <td className="item">
          <span className="item-name">{d?.sourceItem ?? line.description}</span>
          <span className="item-meta">
            {d?.standardSignName ? `${d.standardSignName} · ${matchLevelLabel(d.matchLevel as never)}${d.matchConfidenceMilli ? ` ${Math.round(d.matchConfidenceMilli / 10)}%` : ''}` : d?.matchLevel === 'AMBIGUOUS' ? 'Several possible standard signs' : 'No standard sign matched'}
            {d?.sectionHeading ? ` · ${d.sectionHeading}` : ''}
          </span>
        </td>
        <td className="item-meta src" title={d?.sourceDescription ?? undefined}>{d?.sourceRowRef ?? '—'}</td>
        <td className="qty">{qty(d?.sourceQtyMilli ?? line.qtyMilli)} {pricingUnitLabel(d?.sourceUnit?.toUpperCase() === 'SET' ? 'SET' : 'SIGN', source)}</td>
        <td className="qty">{qty(line.qtyMilli)} {pricingUnitLabel(unit, billable)}</td>
        <td>{line.qbItem ? qbItemLabel(line.qbItem as QbItem) : <em style={{ color: 'var(--muted)' }}>—</em>}</td>
        <td className="item-meta">{pricingMethodLabel(method)}</td>
        <td className="money">{priced && !excluded ? money(line.unitCostCents) : <em style={{ color: 'var(--muted)' }}>{excluded ? '—' : 'not priced'}</em>}</td>
        <td className="money"><strong>{priced && !excluded ? money(line.computedCostCents) : '—'}</strong></td>
        <td>
          <div className="file-actions" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="link-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? 'Hide' : 'Explain'}</button>
            {!readOnly && !excluded ? (
              <>
                {status === 'NEEDS_REVIEW' ? <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onConfirm}>Confirm</button> : null}
                {status === 'OFFICE_QUESTION' && line.openQuestionCount > 0 ? <button type="button" className="btn btn-secondary btn-sm" onClick={onAsk}>Answer</button> : null}
                <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={onEdit}>Edit</button>
                <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={onExclude} title="Not a sign line — remove from the estimate">×</button>
              </>
            ) : null}
          </div>
        </td>
      </tr>
      {open ? (
        <tr className={rowClass(line)}>
          <td colSpan={10} style={{ padding: 0 }}>
            <div className="explain" style={{ borderTop: 0 }}>
              <div className="details-grid" style={{ paddingTop: 14 }}>
                {explanation.length === 0 ? <div className="detail-block"><span>Explanation</span><strong>No calculation recorded yet.</strong></div> : null}
                {explanation.map((s, i) => (
                  <div className="detail-block" key={i}>
                    <span>{s.label}</span>
                    <strong>{s.value}</strong>
                    {s.note ? <small>{s.note}</small> : null}
                  </div>
                ))}
                {line.customerDescription ? (
                  <div className="detail-block" style={{ gridColumn: '1 / -1' }}>
                    <span>Customer-facing description</span>
                    <strong>{line.customerDescription}</strong>
                  </div>
                ) : null}
                {d?.aiSuggestion && Array.isArray((d.aiSuggestion as { ranked?: unknown[] }).ranked) && ((d.aiSuggestion as { ranked: unknown[] }).ranked.length > 0) ? (
                  <div className="detail-block" style={{ gridColumn: '1 / -1', background: 'var(--blue-soft)' }}>
                    <span>AI suggestion (review required — not applied)</span>
                    <strong>
                      {((d.aiSuggestion as { ranked: Array<{ name: string; confidence: number; evidence: string }> }).ranked).map((r) => `${r.name} (${Math.round(r.confidence * 100)}%) — ${r.evidence}`).join(' · ')}
                    </strong>
                  </div>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function EditLineDialog({ line, onClose, onSaved }: { line: BidWorkspaceLine; onClose: () => void; onSaved: () => void }) {
  const { data, estimateId } = useBid();
  const [desc, setDesc] = useState(line.customerDescription ?? '');
  const [item, setItem] = useState<string>(line.qbItem ? qbItemLabel(line.qbItem as QbItem) : 'Sales');
  const [billable, setBillable] = useState(String(line.qtyMilli / 1000));
  const [rate, setRate] = useState((line.unitCostCents / 100).toFixed(2));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rateChanged = Math.round(Number(rate) * 100) !== line.unitCostCents;
  const canRate = data.permissions.canApproveCustomRate;

  async function save() {
    setBusy(true);
    setErr(null);
    const r = await setBidLineOverrideAction({
      estimateId,
      lineId: line.id,
      customerDescription: desc.trim() || null,
      qbItem: qbItemFromLabel(item),
      billableQty: Number(billable) >= 0 ? Number(billable) : null,
      rateCents: rateChanged ? Math.round(Number(rate) * 100) : null,
      reason: reason.trim() || null,
    });
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else onSaved();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit line">
      <div className="modal">
        <div className="card-head">
          <div>
            <h2>Edit line</h2>
            <p>{line.detail?.sourceItem ?? line.description}{line.detail?.sourceRowRef ? ` · ${line.detail.sourceRowRef}` : ''}</p>
          </div>
          <button type="button" className="btn btn-quiet btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <div className="field-wide">
              <label className="lbl" htmlFor="edit-desc">Customer-facing description</label>
              <textarea id="edit-desc" className="input" value={desc} onChange={(e) => setDesc(e.target.value)} />
              <p className="field-note">Complete and professional: size, material, construction, mounting, illumination, Braille where relevant. Never internal notes or costs.</p>
            </div>
            <div>
              <label className="lbl" htmlFor="edit-item">QuickBooks item</label>
              <select id="edit-item" className="input" value={item} onChange={(e) => setItem(e.target.value)}>
                {QBME_ALLOWED_ITEMS.map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="lbl" htmlFor="edit-qty">Billable quantity <small>{pricingUnitLabel(line.detail?.pricingUnit ?? 'SIGN')}</small></label>
              <input id="edit-qty" className="input" type="number" min={0} step="0.001" value={billable} onChange={(e) => setBillable(e.target.value)} />
              <p className="field-note">Takeoff quantity stays {qty(line.detail?.sourceQtyMilli ?? line.qtyMilli)} — only the billable quantity changes.</p>
            </div>
            <div>
              <label className="lbl" htmlFor="edit-rate">Unit rate ($) {!canRate ? <small>office admin only</small> : null}</label>
              <input id="edit-rate" className="input" type="number" min={0} step="0.01" value={rate} disabled={!canRate} onChange={(e) => setRate(e.target.value)} />
              {!canRate ? <p className="field-note">Rates come from the standard-sign rules. To change one, ask the office (Step 4) — an administrator can approve a project-specific rate.</p> : null}
            </div>
            <div>
              <label className="lbl" htmlFor="edit-reason">Reason {rateChanged ? <span className="req">*</span> : <small>optional</small>}</label>
              <input id="edit-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={rateChanged ? 'Why this rate applies to this project' : 'Optional note'} />
            </div>
          </div>
          {err ? <p className="field-error">{err}</p> : null}
          <div className="footer-actions">
            <span className="save-note">{rateChanged ? 'This is a project-specific custom rate — audited, never changes company pricing.' : 'Changes are saved to this estimate only.'}</span>
            <div className="bidw-actions">
              <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={busy || (rateChanged && !reason.trim())} onClick={() => void save()}>{busy ? 'Saving…' : 'Save line'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddLineDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data, estimateId } = useBid();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [q, setQ] = useState('1');
  const [rate, setRate] = useState('0.00');
  const [item, setItem] = useState<string>('Sales');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canRate = data.permissions.canApproveCustomRate;

  async function save() {
    setBusy(true);
    setErr(null);
    const r = await addManualBidLineAction({ estimateId, name: name.trim(), customerDescription: desc.trim() || name.trim(), qty: Number(q), rateCents: Math.round(Number(rate) * 100), qbItem: qbItemFromLabel(item) ?? 'SALES' });
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else onSaved();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add line">
      <div className="modal">
        <div className="card-head">
          <div>
            <h2>Add a line by hand</h2>
            <p>For items the takeoff did not list, or when a file could not be read.</p>
          </div>
          <button type="button" className="btn btn-quiet btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <div>
              <label className="lbl" htmlFor="add-name">Sign item <span className="req">*</span></label>
              <input id="add-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Elevator door-jamb floor ID sign" />
            </div>
            <div>
              <label className="lbl" htmlFor="add-item">QuickBooks item</label>
              <select id="add-item" className="input" value={item} onChange={(e) => setItem(e.target.value)}>
                {QBME_ALLOWED_ITEMS.map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>
            <div className="field-wide">
              <label className="lbl" htmlFor="add-desc">Customer-facing description</label>
              <textarea id="add-desc" className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Size, material, construction, mounting…" />
            </div>
            <div>
              <label className="lbl" htmlFor="add-qty">Quantity <span className="req">*</span></label>
              <input id="add-qty" className="input" type="number" min={0} step="0.001" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div>
              <label className="lbl" htmlFor="add-rate">Unit rate ($) {!canRate ? <small>office admin only</small> : null}</label>
              <input id="add-rate" className="input" type="number" min={0} step="0.01" value={rate} disabled={!canRate} onChange={(e) => setRate(e.target.value)} />
              {!canRate ? <p className="field-note">The line is added unpriced (red) so the office can set the rate on Step 4.</p> : null}
            </div>
          </div>
          {err ? <p className="field-error">{err}</p> : null}
          <div className="footer-actions">
            <span className="save-note">Manual lines are marked as entered by hand in the line history.</span>
            <div className="bidw-actions">
              <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={busy || !name.trim() || Number(q) <= 0} onClick={() => void save()}>{busy ? 'Adding…' : 'Add line'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
