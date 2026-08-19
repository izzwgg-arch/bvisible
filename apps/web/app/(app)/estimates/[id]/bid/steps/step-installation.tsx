'use client';

// Step 6 — Installation. Hourly or daily crew pricing with the live crew
// rates; the recommendation considers mounting, buildings, floors, travel,
// mobilizations, lift, posts, surfaces and electrical scope; the customer-
// facing assumptions (incl. electrical exclusion) flow into the line and
// the estimate terms.

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildInstallCustomerAssumptions, computeInstallLine, convertInstallAmount, recommendInstallHours } from '@/lib/bid/install-calc';
import type { InstallInputs } from '@/lib/bid/types';
import { saveInstallAction } from '../actions';
import { useBid, StepNav } from '../bid-workspace';
import { Banner, GuideCard, Pill, StepHeading, money } from '../bid-ui';

export function StepInstallation() {
  const { data, estimateId, readOnly, refresh, autosave } = useBid();
  const wf = data.workflow;
  const rates = data.rates;
  const [inputs, setInputs] = useState<InstallInputs>(wf.installInputs);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [justDecided, setJustDecided] = useState<boolean | null>(null);

  // Same guard as Step 5: never overwrite in-progress edits with a
  // background refresh; re-seed only on a newer saved version.
  const seededVersion = useRef(wf.version);
  useEffect(() => {
    if (wf.version > seededVersion.current && !autosave.isDirty) {
      seededVersion.current = wf.version;
      setInputs(wf.installInputs);
    }
  }, [wf.version, wf.installInputs, autosave.isDirty]);

  const rec = useMemo(() => recommendInstallHours(inputs, data.installScope, rates.installDayHours), [inputs, data.installScope, rates.installDayHours]);
  const calc = useMemo(() => computeInstallLine(inputs, rates, rec), [inputs, rates, rec]);
  const assumptions = useMemo(() => buildInstallCustomerAssumptions(inputs), [inputs]);
  const included = justDecided ?? wf.installIncluded;
  const decided = included !== null;

  function set<K extends keyof InstallInputs>(k: K, v: InstallInputs[K]) {
    const next = { ...inputs, [k]: v };
    setInputs(next);
    autosave.queue({ installInputs: next });
  }

  function switchMode(mode: 'HOURS' | 'DAYS') {
    if (mode === inputs.mode) return;
    const current = inputs.amount ?? (inputs.mode === 'DAYS' ? rec.crewDays : rec.crewHours);
    const next = { ...inputs, mode, amount: convertInstallAmount(current, inputs.mode, mode, rates.installDayHours) };
    setInputs(next);
    autosave.queue({ installInputs: next });
  }

  async function save(included: boolean) {
    if (!included && !window.confirm('Exclude installation from this estimate? The customer estimate will not carry an Installation line. You can include it again later.')) return;
    setBusy(true);
    setErr(null);
    await autosave.flush();
    const r = await saveInstallAction({ estimateId, included, inputs });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setJustDecided(included);
    setSavedNote(included ? `Installation line saved: ${money(r.totalCents ?? 0)}.` : 'Installation intentionally excluded from this estimate.');
    refresh();
  }

  const num = (v: string, int = false) => (int ? Math.max(0, Math.floor(Number(v) || 0)) : Math.max(0, Number(v) || 0));
  const amountLabel = inputs.mode === 'DAYS' ? 'Crew days' : 'Crew hours';
  const dailyEq = `${money(rates.installCrewHourlyCents)}/hour or ${money(rates.installCrewDailyCents)}/${rates.installDayHours}-hour day`;

  return (
    <>
      <StepHeading
        step={6}
        title="Estimate installation from the actual site work"
        description="Choose hourly or daily pricing. The system explains which site conditions were assumed so the number can be reviewed intelligently."
        actions={<StepNav back={5} next={7} nextLabel="Final review →" nextDisabled={!decided} nextTitle={!decided ? 'Include installation or confirm it is excluded first' : undefined} />}
      />

      <div className="bidw-layout">
        <div className="bidw-stack">
          {savedNote ? <Banner tone="ok"><span>{savedNote}</span></Banner> : null}
          {err ? <Banner tone="err"><span>{err}</span></Banner> : null}
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Installation calculation</h2>
                <p>Two equivalent rate options: {dailyEq}. Recommendation: {rec.crewHours} crew-hours ≈ {rec.crewDays} crew-days for {data.installScope.interiorSigns} interior, {data.installScope.exteriorSigns} exterior sign{data.installScope.exteriorSigns === 1 ? '' : 's'}{data.installScope.letterCharacters > 0 ? `, ${data.installScope.letterCharacters} dimensional characters` : ''}.</p>
              </div>
              <Pill tone={included === true ? 'green' : included === false ? 'gray' : 'yellow'}>{included === true ? 'Included' : included === false ? 'Excluded' : 'Decide'}</Pill>
            </div>
            <div className="card-body">
              <div className="radio-row" role="group" aria-label="Pricing mode">
                <button type="button" className={`mode-btn${inputs.mode === 'HOURS' ? ' active' : ''}`} disabled={readOnly} onClick={() => switchMode('HOURS')} aria-pressed={inputs.mode === 'HOURS'}>Price by hour</button>
                <button type="button" className={`mode-btn${inputs.mode === 'DAYS' ? ' active' : ''}`} disabled={readOnly} onClick={() => switchMode('DAYS')} aria-pressed={inputs.mode === 'DAYS'}>Price by day</button>
              </div>
              <div className="calc">
                <div>
                  <div className="form-grid">
                    <div>
                      <label className="lbl" htmlFor="install-amount">{amountLabel}</label>
                      <input id="install-amount" className="input" type="number" min={0} step={inputs.mode === 'DAYS' ? 0.5 : 0.25} value={inputs.amount ?? ''} placeholder={String(inputs.mode === 'DAYS' ? rec.crewDays : rec.crewHours)} disabled={readOnly} onChange={(e) => set('amount', e.target.value === '' ? null : num(e.target.value))} />
                      <p className="field-note">{calc.formula} · {calc.equivalentHours} crew-hours total. Leave blank to use the recommendation.</p>
                    </div>
                    <div>
                      <label className="lbl" htmlFor="crew-size">Crew size</label>
                      <select id="crew-size" className="input" value={inputs.crewSize} disabled={readOnly} onChange={(e) => set('crewSize', num(e.target.value, true) || 1)}>
                        <option value={1}>One installer</option>
                        <option value={2}>Two efficient installers</option>
                        <option value={3}>Three installers</option>
                        <option value={4}>Four installers</option>
                      </select>
                    </div>
                    <div>
                      <label className="lbl" htmlFor="travel">Travel time per trip (hours)</label>
                      <input id="travel" className="input" type="number" min={0} step={0.25} value={inputs.travelHours} disabled={readOnly} onChange={(e) => set('travelHours', num(e.target.value))} />
                    </div>
                    <div>
                      <label className="lbl" htmlFor="mobilizations">Mobilizations (trips)</label>
                      <input id="mobilizations" className="input" type="number" min={1} step={1} value={inputs.mobilizations} disabled={readOnly} onChange={(e) => set('mobilizations', Math.max(1, num(e.target.value, true)))} />
                    </div>
                    <div>
                      <label className="lbl" htmlFor="buildings">Buildings</label>
                      <input id="buildings" className="input" type="number" min={1} step={1} value={inputs.buildings} disabled={readOnly} onChange={(e) => set('buildings', Math.max(1, num(e.target.value, true)))} />
                    </div>
                    <div>
                      <label className="lbl" htmlFor="floors">Floors</label>
                      <input id="floors" className="input" type="number" min={1} step={1} value={inputs.floors} disabled={readOnly} onChange={(e) => set('floors', Math.max(1, num(e.target.value, true)))} />
                    </div>
                    <div>
                      <label className="lbl" htmlFor="movement">Site movement</label>
                      <select id="movement" className="input" value={inputs.siteMovement} disabled={readOnly} onChange={(e) => set('siteMovement', e.target.value as InstallInputs['siteMovement'])}>
                        <option value="LOW">Low — compact site</option>
                        <option value="NORMAL">Normal</option>
                        <option value="HIGH">High — spread out, long walks</option>
                      </select>
                    </div>
                    <div>
                      <label className="lbl" htmlFor="new-posts">New posts to set</label>
                      <input id="new-posts" className="input" type="number" min={0} step={1} value={inputs.newPosts} disabled={readOnly} onChange={(e) => set('newPosts', num(e.target.value, true))} />
                    </div>
                    <div>
                      <label className="lbl" htmlFor="electrical">Electrical scope</label>
                      <select id="electrical" className="input" value={inputs.electricalScope} disabled={readOnly} onChange={(e) => set('electricalScope', e.target.value as InstallInputs['electricalScope'])}>
                        <option value="NONE">None — no illuminated signs</option>
                        <option value="LOW_VOLTAGE_ONLY">Low-voltage wiring to point of connection</option>
                        <option value="ELECTRICIAN_REQUIRED">Electrician required for hookup</option>
                      </select>
                    </div>
                    <div>
                      <label className="lbl" htmlFor="permits">Permits</label>
                      <select id="permits" className="input" value={inputs.permitsAssumed} disabled={readOnly} onChange={(e) => set('permitsAssumed', e.target.value as InstallInputs['permitsAssumed'])}>
                        <option value="BY_CUSTOMER">By customer</option>
                        <option value="INCLUDED">Handled by B Visible</option>
                        <option value="NOT_APPLICABLE">Not applicable</option>
                      </select>
                    </div>
                    <div>
                      <label className="lbl" htmlFor="equipment">Lift / equipment <small>optional</small></label>
                      <input id="equipment" className="input" value={inputs.equipment ?? ''} disabled={readOnly} onChange={(e) => set('equipment', e.target.value || null)} placeholder="e.g. 26' scissor lift" />
                    </div>
                    <div className="field-wide" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                      <label className="toggle-row"><input type="checkbox" checked={inputs.existingPosts} disabled={readOnly} onChange={(e) => set('existingPosts', e.target.checked)} /><span>Exterior signs use existing posts</span></label>
                      <label className="toggle-row"><input type="checkbox" checked={inputs.wallMounted} disabled={readOnly} onChange={(e) => set('wallMounted', e.target.checked)} /><span>Interior signs are wall-mounted</span></label>
                      <label className="toggle-row"><input type="checkbox" checked={inputs.surfacesReady} disabled={readOnly} onChange={(e) => set('surfacesReady', e.target.checked)} /><span>Mounting surfaces are ready</span></label>
                      <label className="toggle-row"><input type="checkbox" checked={inputs.liftRequired} disabled={readOnly} onChange={(e) => set('liftRequired', e.target.checked)} /><span>Lift required</span></label>
                      <label className="toggle-row"><input type="checkbox" checked={inputs.finalElectricalExcluded} disabled={readOnly} onChange={(e) => set('finalElectricalExcluded', e.target.checked)} /><span>Final electrical connection excluded</span></label>
                    </div>
                    <div className="field-wide">
                      <label className="lbl" htmlFor="install-note">Internal note <small>never shown to the customer</small></label>
                      <textarea id="install-note" className="input" value={inputs.internalNote ?? ''} disabled={readOnly} onChange={(e) => set('internalNote', e.target.value || null)} />
                    </div>
                  </div>
                </div>
                <div className="calc-result">
                  <span>Installation price</span>
                  <strong>{money(calc.totalCents)}</strong>
                  <small>{calc.equivalentHours} crew-hours total · {inputs.crewSize}-person crew</small>
                </div>
              </div>

              <h3 style={{ marginTop: 16 }}>Customer-facing assumptions</h3>
              <div className="assumptions">
                {assumptions.map((a, i) => (
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
                  <span className="save-note">Including installation creates a real <strong>Installation</strong> line with the complete customer-facing scope.</span>
                  <div className="bidw-actions">
                    <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void save(false)}>Exclude installation</button>
                    <button type="button" className="btn btn-primary" disabled={busy || calc.qtyMilli <= 0} onClick={() => void save(true)}>{busy ? 'Saving…' : included ? 'Update installation line' : 'Include installation'}</button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <GuideCard
          kicker="How to think about installation"
          title="Sign quantity is only the starting point"
          intro="Installation time changes with mounting, floors, buildings, equipment, access, and travel around the site."
          items={[
            { mark: '1', text: 'Confirm whether posts and mounting surfaces already exist.' },
            { mark: '2', text: 'Include movement, layout, cleanup, and mobilization.' },
            { mark: '3', text: 'State lift and electrical assumptions clearly.' },
          ]}
          tip={<><strong>Company rate:</strong> {money(rates.installCrewHourlyCents)} per crew-hour, equal to {money(rates.installCrewDailyCents)} per {rates.installDayHours}-hour day (Pricing backend → Operating rates).</>}
        />
      </div>

      <StepNav back={5} next={7} nextLabel="Final review →" nextDisabled={!decided} />
    </>
  );
}
