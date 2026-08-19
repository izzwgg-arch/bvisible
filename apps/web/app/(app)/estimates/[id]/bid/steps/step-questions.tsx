'use client';

// Step 4 — Ask the office. One card per question with the source evidence,
// what the system found, why it could not decide, the choices (with rate /
// total effect), a custom path, note, and project-only vs permanent scope.
// Answers recalculate the line immediately and are recorded in history.

import { useMemo, useState } from 'react';
import type { QbItem } from '@bvisible/db';
import type { BidWorkspaceQuestion } from '@/lib/bid/workflow';
import { QBME_ALLOWED_ITEMS, qbItemFromLabel } from '@/lib/estimate/qbme';
import { answerBidQuestionAction } from '../actions';
import { useBid, StepNav } from '../bid-workspace';
import { Banner, GuideCard, Pill, StepHeading, formatWhen, money } from '../bid-ui';

const KIND_LABEL: Record<string, string> = {
  STANDARD_SIGN: 'Which sign?',
  MATERIAL: 'Material',
  SIZE: 'Size needed',
  PRICING_UNIT: 'Pricing unit',
  RATE: 'Rate needed',
  ILLUMINATION: 'Illumination',
  INSTALLATION_INCLUDED: 'Installation',
  ELECTRICAL: 'Electrical',
  PROJECT_PRICE: 'Pricing conflict',
  MISSING_SPEC: 'Missing specification',
  OTHER: 'Question',
};

type Choice = { key: string; label: string; detail?: string; rateCents?: number; totalCents?: number; standardSignKey?: string; custom?: boolean; qbItem?: string };

export function StepQuestions() {
  const { data } = useBid();
  const open = data.questions.filter((q) => q.status === 'OPEN');
  const answered = data.questions.filter((q) => q.status !== 'OPEN');
  const unpricedManual = data.lines.filter((l) => !l.isService && l.detail?.reviewStatus === 'BLOCKED');

  return (
    <>
      <StepHeading
        step={4}
        title="Resolve only the items that affect price"
        description="Questions arrive with the source information, the reason for asking, and clear choices. Office answers update the estimate immediately."
        actions={<StepNav back={3} next={5} nextLabel="Continue to design →" />}
      />

      <div className="bidw-layout-wide">
        <div className="bidw-stack">
          {open.length === 0 ? (
            <Banner tone="ok">
              <span>
                <strong>No open office questions.</strong> {answered.length > 0 ? 'Every question has been answered — the history is below.' : 'Nothing on this estimate needed an office decision.'}
              </span>
            </Banner>
          ) : null}
          {unpricedManual.length > 0 ? (
            <Banner tone="warn">
              <span>
                <strong>{unpricedManual.length} hand-added line{unpricedManual.length === 1 ? ' has' : 's have'} no rate yet</strong> — an office administrator sets the rate with <em>Edit</em> on Step 3.
              </span>
            </Banner>
          ) : null}
          {open.map((q) => (
            <QuestionCard key={q.id} q={q} />
          ))}

          <div className="card">
            <div className="card-head">
              <div>
                <h2>Resolved decision history</h2>
                <p>Project-specific answers are recorded without silently changing company standards.</p>
              </div>
              <Pill tone="gray">{answered.length} answered</Pill>
            </div>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Question</th>
                    <th>Answer</th>
                    <th>Scope</th>
                    <th>Answered by</th>
                  </tr>
                </thead>
                <tbody>
                  {answered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty">No decisions yet.</td>
                    </tr>
                  ) : null}
                  {answered.map((q) => {
                    const choice = (q.choices as Choice[]).find((c) => c.key === q.answerKey);
                    const custom = (q.answerValue ?? {}) as { rateCents?: number; description?: string; widthIn?: number; heightIn?: number; wording?: string };
                    let answer = choice?.label ?? q.answerKey ?? '—';
                    if (q.answerKey === 'custom' && custom.rateCents) answer = `${money(custom.rateCents)} custom`;
                    if (custom.widthIn && custom.heightIn) answer = `${custom.widthIn}" × ${custom.heightIn}"`;
                    if (custom.wording) answer = `“${custom.wording}”`;
                    return (
                      <tr key={q.id}>
                        <td><strong>{q.lineDescription ?? '—'}</strong></td>
                        <td className="item-meta">{q.title}</td>
                        <td>
                          <Pill tone={q.status === 'DISMISSED' ? 'gray' : 'green'}>{q.status === 'DISMISSED' ? 'Superseded' : answer}</Pill>
                          {q.answerNote ? <span className="item-meta">{q.answerNote}</span> : null}
                        </td>
                        <td className="item-meta">{q.answerScope === 'PERMANENT' ? 'Company standard' : q.status === 'DISMISSED' ? '—' : 'This project'}</td>
                        <td className="item-meta">{q.answeredByName ?? '—'}{q.answeredAt ? ` • ${formatWhen(q.answeredAt)}` : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <GuideCard
          kicker="What to expect"
          title="A question should explain the pricing risk"
          intro="You should understand why the software could not safely choose a rate — not merely see “error.”"
          items={[
            { mark: '1', text: 'Review what the plan and Excel actually say.' },
            { mark: '2', text: 'See the conflicting pricing rule or missing specification.' },
            { mark: '3', text: 'Use the office answer and continue without retyping the line.' },
          ]}
          tip={<><strong>Important:</strong> An answer applies only to this project unless an authorized office administrator saves it as a new company standard.</>}
        />
      </div>

      <StepNav back={3} next={5} nextLabel="Continue to design →" />
    </>
  );
}

function QuestionCard({ q }: { q: BidWorkspaceQuestion }) {
  const { data, estimateId, readOnly, refresh } = useBid();
  const choices = q.choices as Choice[];
  const [selected, setSelected] = useState<string | null>(null);
  const [rate, setRate] = useState('');
  const [desc, setDesc] = useState('');
  const [item, setItem] = useState<string>('');
  const [w, setW] = useState('');
  const [h, setH] = useState('');
  const [wording, setWording] = useState('');
  const [note, setNote] = useState('');
  const [permanent, setPermanent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const chosen = choices.find((c) => c.key === selected);
  const isCustom = selected === 'custom' || chosen?.custom;
  const needsSize = q.kind === 'SIZE';
  const needsWording = q.kind === 'MISSING_SPEC';
  const needsRate = isCustom && !needsSize && !needsWording;
  const introducesRate = selected === 'source' || needsRate;
  const canApprove = data.permissions.canApproveCustomRate;
  const canPromote = data.permissions.canPromote;

  const affects = useMemo(() => {
    if (!chosen?.totalCents && !chosen?.rateCents) return null;
    return `${chosen.rateCents !== undefined ? money(chosen.rateCents) : ''}${chosen.totalCents !== undefined ? ` → line total ${money(chosen.totalCents)}` : ''}`;
  }, [chosen]);

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setErr(null);
    const custom = isCustom || needsSize || needsWording
      ? {
          rateCents: needsRate && rate ? Math.round(Number(rate) * 100) : null,
          description: desc.trim() || null,
          qbItem: item ? (qbItemFromLabel(item) as QbItem | null) : null,
          widthIn: needsSize && w ? Number(w) : null,
          heightIn: needsSize && h ? Number(h) : null,
          wording: needsWording && wording.trim() ? wording.trim() : null,
          characterCount: needsWording && wording.trim() ? (wording.match(/[A-Za-z0-9]/g) ?? []).length : null,
          standardSignKey: chosen?.standardSignKey ?? null,
        }
      : null;
    let r: Awaited<ReturnType<typeof answerBidQuestionAction>>;
    try {
      r = await answerBidQuestionAction({ estimateId, questionId: q.id, choiceKey: selected, custom, note: note.trim() || null, scope: permanent ? 'PERMANENT' : 'PROJECT' });
    } catch (e) {
      setBusy(false);
      setErr(e instanceof Error ? e.message : 'The answer could not be saved. Try again.');
      return;
    }
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setDone(r.newRateCents !== null && r.newRateCents !== undefined && r.totalCents !== null && r.totalCents !== undefined ? `Office decision saved. The line was recalculated to ${money(r.totalCents)}${r.newRateCents ? ` (${money(r.newRateCents)} per unit)` : ''}.` : 'Decision saved.');
    refresh();
  }

  return (
    <div className={`qcard${done ? ' answered' : ''}`}>
      <div className="qtop">
        <div>
          <h3>{q.title}</h3>
          <p>
            {KIND_LABEL[q.kind] ?? q.kind}
            {q.sourceRef ? ` • Source: ${q.sourceRef}` : ''}
            {q.sourceText ? ` • ${q.sourceText.slice(0, 120)}` : ''}
          </p>
        </div>
        <Pill tone={done ? 'green' : 'blue'}>{done ? 'Answered' : 'Needs an answer'}</Pill>
      </div>
      <div className="qbody">
        <div className="found">
          <div>
            <span>What the system found</span>
            <strong>{q.systemFound ?? '—'}</strong>
          </div>
          <div>
            <span>Why it matters</span>
            <strong>{q.whyMatters ?? '—'}</strong>
          </div>
        </div>
        <p className="qtext">{q.whyUnsafe ?? 'Which choice applies?'}</p>
        {done ? (
          <div className="decision"><b>✓</b><span><strong>Office decision saved:</strong> {done}</span></div>
        ) : (
          <>
            <div className="choices" role="group" aria-label={q.title}>
              {choices.map((c) => (
                <button key={c.key} type="button" className={`choice${selected === c.key ? ' selected' : ''}`} disabled={readOnly} onClick={() => setSelected(c.key)} aria-pressed={selected === c.key}>
                  <strong>{c.label}</strong>
                  {c.detail ?? ''}
                  {c.totalCents !== undefined ? <small>Line total {money(c.totalCents)}</small> : null}
                </button>
              ))}
            </div>
            {selected ? (
              <div style={{ marginTop: 14 }}>
                {affects ? <p className="field-note">Effect: {affects}</p> : null}
                <div className="form-grid">
                  {needsRate ? (
                    <div>
                      <label className="lbl" htmlFor={`rate-${q.id}`}>Approved rate ($ per unit) <span className="req">*</span></label>
                      <input id={`rate-${q.id}`} className="input" type="number" min={0} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} disabled={!canApprove} />
                    </div>
                  ) : null}
                  {needsSize ? (
                    <>
                      <div>
                        <label className="lbl" htmlFor={`w-${q.id}`}>Width (inches) <span className="req">*</span></label>
                        <input id={`w-${q.id}`} className="input" type="number" min={0} step="0.125" value={w} onChange={(e) => setW(e.target.value)} />
                      </div>
                      <div>
                        <label className="lbl" htmlFor={`h-${q.id}`}>Height (inches) <span className="req">*</span></label>
                        <input id={`h-${q.id}`} className="input" type="number" min={0} step="0.125" value={h} onChange={(e) => setH(e.target.value)} />
                      </div>
                    </>
                  ) : null}
                  {needsWording ? (
                    <div className="field-wide">
                      <label className="lbl" htmlFor={`wording-${q.id}`}>Sign wording <span className="req">*</span> <small>letters and digits are counted; spaces and punctuation are not billed</small></label>
                      <input id={`wording-${q.id}`} className="input" value={wording} onChange={(e) => setWording(e.target.value)} placeholder="e.g. AZURA PHASE 1" />
                    </div>
                  ) : null}
                  {isCustom && !needsSize && !needsWording ? (
                    <>
                      <div className="field-wide">
                        <label className="lbl" htmlFor={`desc-${q.id}`}>Customer-facing description <small>optional</small></label>
                        <input id={`desc-${q.id}`} className="input" value={desc} onChange={(e) => setDesc(e.target.value)} />
                      </div>
                      <div>
                        <label className="lbl" htmlFor={`item-${q.id}`}>QuickBooks item <small>optional</small></label>
                        <select id={`item-${q.id}`} className="input" value={item} onChange={(e) => setItem(e.target.value)}>
                          <option value="">Keep current</option>
                          {QBME_ALLOWED_ITEMS.map((i) => (
                            <option key={i} value={i}>{i}</option>
                          ))}
                        </select>
                      </div>
                    </>
                  ) : null}
                  <div className="field-wide">
                    <label className="lbl" htmlFor={`note-${q.id}`}>Reason / note {introducesRate ? <span className="req">*</span> : <small>optional</small>}</label>
                    <input id={`note-${q.id}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this decision applies" />
                  </div>
                  {canPromote && (chosen?.standardSignKey || needsRate || selected === 'source') ? (
                    <label className="toggle-row field-wide">
                      <input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} />
                      <span>
                        <strong>Also save as a company standard</strong> — future takeoffs will match this wording automatically. Leave off for a project-specific decision.
                      </span>
                    </label>
                  ) : null}
                </div>
                {introducesRate && !canApprove ? (
                  <div className="decision warn"><b>!</b><span>Approving a project-specific or custom rate needs an office administrator. You can still choose a standard sign, use the current rule, supply the missing size or wording, or exclude the line.</span></div>
                ) : null}
                {err ? <div className="decision err"><b>×</b><span>{err}</span></div> : null}
                <div className="bidw-actions" style={{ marginTop: 12 }}>
                  <button type="button" className="btn btn-primary" disabled={busy || readOnly || (introducesRate && !canApprove) || (needsRate && !rate) || (needsSize && !(w && h)) || (needsWording && !wording.trim()) || (introducesRate && !note.trim())} onClick={() => void submit()}>
                    {busy ? 'Saving…' : 'Save answer'}
                  </button>
                  <button type="button" className="btn btn-quiet" onClick={() => setSelected(null)}>Clear</button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
