'use client';

// Step 5 — Design. Live recommendation from unique layouts + variable data +
// proofing + production files at the company design rate; approved hours may
// be overridden; include or intentionally exclude (confirmed).

import { useEffect, useMemo, useRef, useState } from 'react';
import { recommendDesignHours, startingFilesLabel, variableDataLabel } from '@/lib/bid/design-calc';
import type { DesignInputs } from '@/lib/bid/types';
import { saveDesignAction } from '../actions';
import { useBid, StepNav } from '../bid-workspace';
import { Banner, GuideCard, Pill, StepHeading, money } from '../bid-ui';

export function StepDesign() {
  const { data, estimateId, readOnly, refresh, autosave } = useBid();
  const wf = data.workflow;
  const [inputs, setInputs] = useState<DesignInputs>(wf.designInputs);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  // Optimistic: the pill and "Continue" should update the moment the save
  // returns, not only after the server component re-renders.
  const [justDecided, setJustDecided] = useState<boolean | null>(null);
  const rate = data.rates.designHourlyCents;

  // Re-seed from the server ONLY when a newer version arrives and nothing is
  // unsaved — otherwise a background refresh would wipe what the estimator is
  // typing (e.g. approved hours).
  const seededVersion = useRef(wf.version);
  useEffect(() => {
    if (wf.version > seededVersion.current && !autosave.isDirty) {
      seededVersion.current = wf.version;
      setInputs(wf.designInputs);
    }
  }, [wf.version, wf.designInputs, autosave.isDirty]);

  const rec = useMemo(() => recommendDesignHours(inputs), [inputs]);
  const hours = inputs.approvedHours ?? rec.recommendedHours;
  const total = Math.round(hours * rate);
  const dirtyVsSaved = wf.designIncluded === null || wf.designHoursMilli !== Math.round(hours * 1000) || JSON.stringify(wf.designInputs) !== JSON.stringify(inputs);

  function set<K extends keyof DesignInputs>(k: K, v: DesignInputs[K]) {
    const next = { ...inputs, [k]: v };
    setInputs(next);
    autosave.queue({ designInputs: next });
  }

  async function save(included: boolean) {
    if (!included && !window.confirm('Exclude design from this estimate? The customer estimate will not carry a Design line. You can include it again later.')) return;
    setBusy(true);
    setErr(null);
    await autosave.flush();
    const r = await saveDesignAction({ estimateId, included, inputs });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setJustDecided(included);
    setSavedNote(included ? `Design line saved: ${(r.qtyMilli ?? 0) / 1000} h × ${money(r.rateCents ?? rate)} = ${money(r.totalCents ?? 0)}.` : 'Design intentionally excluded from this estimate.');
    refresh();
  }

  const included = justDecided ?? wf.designIncluded;
  const decided = included !== null;

  return (
    <>
      <StepHeading
        step={5}
        title="Estimate design and file preparation"
        description="Design is based on the work required to prepare unique layouts and variable information — not simply the total number of signs."
        actions={<StepNav back={4} next={6} nextLabel="Continue to installation →" nextDisabled={!decided} nextTitle={!decided ? 'Include design or confirm it is excluded first' : undefined} />}
      />

      <div className="bidw-layout">
        <div className="bidw-stack">
          {savedNote ? <Banner tone="ok"><span>{savedNote}</span></Banner> : null}
          {err ? <Banner tone="err"><span>{err}</span></Banner> : null}
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Design calculation</h2>
                <p>The recommendation is visible and can be adjusted. Rate: {money(rate)} per hour (company design rate).</p>
              </div>
              <Pill tone={included === true ? 'green' : included === false ? 'gray' : 'yellow'}>
                {included === true ? (dirtyVsSaved && justDecided === null ? 'Included — unsaved changes' : 'Included') : included === false ? 'Excluded' : 'Decide'}
              </Pill>
            </div>
            <div className="card-body">
              <div className="calc">
                <div>
                  <div className="form-grid">
                    <div>
                      <label className="lbl" htmlFor="unique-layouts">Unique sign layouts</label>
                      <input id="unique-layouts" className="input" type="number" min={0} step={1} value={inputs.uniqueLayouts} disabled={readOnly} onChange={(e) => set('uniqueLayouts', Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                      <p className="field-note">Different templates — {data.counts.signLines} sign type{data.counts.signLines === 1 ? '' : 's'} on this estimate.</p>
                    </div>
                    <div>
                      <label className="lbl" htmlFor="variable-sets">Variable-data sets</label>
                      <input id="variable-sets" className="input" type="number" min={0} step={1} value={inputs.variableDataSets} disabled={readOnly} onChange={(e) => set('variableDataSets', Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                      <p className="field-note">Room / unit / floor lists to populate.</p>
                    </div>
                    <div>
                      <label className="lbl" htmlFor="template-status">Starting files</label>
                      <select id="template-status" className="input" value={inputs.startingFiles} disabled={readOnly} onChange={(e) => set('startingFiles', e.target.value as DesignInputs['startingFiles'])}>
                        {(['EXISTING_TEMPLATES', 'SOME_NEW_ARTWORK', 'FROM_SCRATCH'] as const).map((v) => (
                          <option key={v} value={v}>{startingFilesLabel(v)}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="lbl" htmlFor="data-status">Variable data</label>
                      <select id="data-status" className="input" value={inputs.variableData} disabled={readOnly} onChange={(e) => set('variableData', e.target.value as DesignInputs['variableData'])}>
                        {(['CLEAN_SPREADSHEET', 'MANUAL_ENTRY', 'NOT_SUPPLIED'] as const).map((v) => (
                          <option key={v} value={v}>{variableDataLabel(v)}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="lbl" htmlFor="proof-rounds">Proofing rounds included</label>
                      <input id="proof-rounds" className="input" type="number" min={0} step={1} value={inputs.proofingRounds} disabled={readOnly} onChange={(e) => set('proofingRounds', Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                    </div>
                    <div>
                      <label className="lbl" htmlFor="design-hours">Approved design hours</label>
                      <input id="design-hours" className="input" type="number" min={0} step={0.25} value={inputs.approvedHours ?? ''} placeholder={String(rec.recommendedHours)} disabled={readOnly} onChange={(e) => set('approvedHours', e.target.value === '' ? null : Math.max(0, Number(e.target.value)))} />
                      <p className="field-note">Recommendation: {rec.recommendedHours} hours for setup, variable copy, proofing, and production-ready files. Leave blank to use it.</p>
                    </div>
                    <label className="toggle-row field-wide">
                      <input type="checkbox" checked={inputs.productionFiles} disabled={readOnly} onChange={(e) => set('productionFiles', e.target.checked)} />
                      <span>Production-ready exports and file organization included (+1 h)</span>
                    </label>
                    <div className="field-wide">
                      <label className="lbl" htmlFor="design-note">Internal explanation <small>never shown to the customer</small></label>
                      <textarea id="design-note" className="input" value={inputs.internalNote ?? ''} disabled={readOnly} onChange={(e) => set('internalNote', e.target.value || null)} />
                    </div>
                  </div>
                </div>
                <div className="calc-result">
                  <span>Design price</span>
                  <strong>{money(total)}</strong>
                  <small>{hours} hours × {money(rate)}/hour{inputs.approvedHours !== null && inputs.approvedHours !== rec.recommendedHours ? ` (recommended ${rec.recommendedHours} h)` : ''}</small>
                </div>
              </div>

              <div className="assumptions">
                {rec.assumptions.map((a, i) => (
                  <div className="assumption" key={i}><span className="check">✓</span><span>{a}</span></div>
                ))}
              </div>

              <details className="explain" style={{ marginTop: 16, borderRadius: 10, border: '1px solid var(--line)' }}>
                <summary>How the recommendation was calculated</summary>
                <div className="details-grid" style={{ paddingTop: 12 }}>
                  {rec.breakdown.map((s, i) => (
                    <div className="detail-block" key={i}><span>{s.label}</span><strong>{s.value}</strong>{s.note ? <small>{s.note}</small> : null}</div>
                  ))}
                </div>
              </details>

              {!readOnly ? (
                <div className="footer-actions">
                  <span className="save-note">Including design creates a real <strong>Design</strong> line on the customer estimate and in the QBME.</span>
                  <div className="bidw-actions">
                    <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void save(false)}>Exclude design</button>
                    <button type="button" className="btn btn-primary" disabled={busy || hours <= 0} onClick={() => void save(true)}>{busy ? 'Saving…' : included ? 'Update design line' : 'Include design'}</button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <GuideCard
          kicker="How to think about design"
          title="Count unique setups, then consider variable data"
          intro="One layout used for 100 apartment numbers is less work than 100 completely different designs."
          items={[
            { mark: '1', text: 'Count different sign templates.' },
            { mark: '2', text: 'Consider how clean the room and unit data is.' },
            { mark: '3', text: 'Add time for proofing, corrections, and final exports.' },
          ]}
          tip={<><strong>Company rate:</strong> Design and file preparation are billed at {money(rate)} per hour (Pricing backend → Operating rates).</>}
        />
      </div>

      <StepNav back={4} next={6} nextLabel="Continue to installation →" nextDisabled={!decided} />
    </>
  );
}
