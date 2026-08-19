'use client';

// Step 2 — Upload the takeoff and supporting plans. Multiple files, drag &
// drop, revisions (previous version kept), processing status, import
// summary, choose-a-different-tab, and download links (tenant-gated route).

import { useRef, useState, type DragEvent } from 'react';
import { BID_ACCEPT_ATTRIBUTE } from '@/lib/bid/upload-constants';
import type { BidWorkspaceSource } from '@/lib/bid/workflow';
import { reprocessBidSourceAction, setCurrentTakeoffAction, uploadBidSourceAction } from '../actions';
import { useBid, StepNav } from '../bid-workspace';
import { Banner, GuideCard, Pill, StepHeading, fileTypeClass, formatBytes, formatWhen } from '../bid-ui';

const ROLE_LABEL: Record<string, string> = {
  TAKEOFF: 'Takeoff',
  PLAN: 'Plans',
  SPECIFICATION: 'Specification',
  DRAWING: 'Drawing',
  PHOTO: 'Photo',
  DOCUMENT: 'Document',
  OTHER: 'Supporting file',
};

function statusPill(s: BidWorkspaceSource) {
  switch (s.status) {
    case 'READY':
      return <Pill tone="green">{s.isCurrentTakeoff ? 'Imported' : s.role === 'TAKEOFF' ? 'Ready' : 'Attached'}</Pill>;
    case 'PROCESSING':
      return <Pill tone="yellow">Processing</Pill>;
    case 'UPLOADED':
      return <Pill tone="gray">Uploaded</Pill>;
    case 'NEEDS_REVIEW':
      return <Pill tone="yellow">Needs review</Pill>;
    case 'UNSUPPORTED':
      return <Pill tone="red">Unsupported</Pill>;
    case 'FAILED':
    default:
      return <Pill tone="red">Failed</Pill>;
  }
}

function fileSummary(s: BidWorkspaceSource): string {
  const r = s.result ?? {};
  if (r.family === 'SPREADSHEET') {
    const counts = (r.counts ?? {}) as Record<string, number>;
    const tab = typeof r.primaryTab === 'string' ? r.primaryTab : null;
    if (tab && counts.productLines !== undefined) return `${tab} · ${counts.productLines} sign types · ${counts.takeoffQty ?? 0} takeoff items`;
    return 'Spreadsheet';
  }
  if (r.family === 'PDF') return `Plan evidence${typeof r.pages === 'number' ? ` · ${r.pages} page${r.pages === 1 ? '' : 's'}` : ''}`;
  if (r.family === 'IMAGE') return 'Photo / marked plan evidence';
  if (r.family === 'DOCUMENT') return 'Supporting document';
  return s.processingError ?? '';
}

export function StepSources() {
  const { data, estimateId, readOnly, refresh } = useBid();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const [reviseId, setReviseId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const summary = data.workflow.importSummary;

  async function uploadFiles(files: FileList | File[]) {
    if (readOnly) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    setBusy(true);
    setErrors([]);
    const errs: string[] = [];
    let i = 0;
    for (const file of list) {
      i += 1;
      setProgress(`Uploading ${file.name} (${i} of ${list.length})…`);
      const fd = new FormData();
      fd.set('estimateId', estimateId);
      fd.set('file', file);
      if (reviseId) fd.set('supersedesId', reviseId);
      try {
        const r = await uploadBidSourceAction(fd);
        if (!r.ok && r.error) errs.push(r.error);
        else if (r.error) errs.push(`${file.name}: ${r.error}`);
      } catch (e) {
        errs.push(`${file.name}: ${e instanceof Error ? e.message : 'upload failed'} — the file was not saved; try again.`);
      }
    }
    setErrors(errs);
    setProgress(null);
    setBusy(false);
    setReviseId(null);
    refresh();
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer?.files?.length) void uploadFiles(e.dataTransfer.files);
  }

  async function reprocess(fileId: string, tab: string | null) {
    setBusy(true);
    setErrors([]);
    const r = await reprocessBidSourceAction({ estimateId, fileId, preferredTab: tab });
    if (!r.ok && r.error) setErrors([r.error]);
    setBusy(false);
    refresh();
  }

  async function makeCurrent(fileId: string) {
    setBusy(true);
    setErrors([]);
    const r = await setCurrentTakeoffAction({ estimateId, fileId });
    if (!r.ok && r.error) setErrors([r.error]);
    setBusy(false);
    refresh();
  }

  const current = data.sources.find((s) => s.isCurrentTakeoff) ?? null;
  const currentTabs = ((current?.result?.tabs as Array<{ sheetName: string; productLines: number; rowsRead: number; usable: boolean }> | undefined) ?? []);
  const active = data.sources.filter((s) => !s.supersededAt);
  const superseded = data.sources.filter((s) => s.supersededAt);
  const readyToReview = !!summary && summary.signLines > 0;

  return (
    <>
      <StepHeading
        step={2}
        title="Upload the takeoff and supporting plans"
        description="The Excel file drives pricing. Marked plans and specifications remain attached as evidence for quantities and scope."
        actions={<StepNav back={1} next={3} nextLabel="Import and review →" nextDisabled={!readyToReview && data.lines.length === 0} nextTitle={!readyToReview && data.lines.length === 0 ? 'Upload a takeoff (or add lines manually on Step 3) first' : undefined} />}
      />

      <div className="bidw-layout">
        <div className="bidw-stack">
          <div className="card">
            <div className="card-body">
              {!readOnly ? (
                <div
                  className={`dropzone${over ? ' over' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(true);
                  }}
                  onDragLeave={() => setOver(false)}
                  onDrop={onDrop}
                >
                  <div>
                    <div className="upload-icon" aria-hidden="true">↑</div>
                    <h3>{reviseId ? 'Drop the revised file here' : 'Drop the Excel takeoff here'}</h3>
                    <p>Or select files from the computer. Excel / CSV drives pricing; PDFs, images, and Word files attach as evidence. Up to 25 MB each.</p>
                    <input ref={inputRef} type="file" multiple accept={BID_ACCEPT_ATTRIBUTE} className="sr-only" aria-label="Choose files" onChange={(e) => e.target.files && void uploadFiles(e.target.files)} />
                    <div className="bidw-actions" style={{ justifyContent: 'center', marginTop: 14 }}>
                      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
                        {busy ? progress ?? 'Working…' : reviseId ? 'Choose revised file' : 'Choose files'}
                      </button>
                      {reviseId ? (
                        <button type="button" className="btn btn-quiet" onClick={() => setReviseId(null)}>Cancel revision</button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
              {errors.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                  {errors.map((e, i) => (
                    <Banner key={i} tone="err">
                      <span>{e}</span>
                    </Banner>
                  ))}
                </div>
              ) : null}

              <div className="file-list">
                {active.length === 0 ? <div className="empty">No files yet. Upload the takeoff spreadsheet to start pricing.</div> : null}
                {active.map((s) => (
                  <FileRow key={s.id} s={s} estimateId={estimateId} busy={busy} readOnly={readOnly} onRevise={() => { setReviseId(s.id); inputRef.current?.click(); }} onReprocess={() => void reprocess(s.id, null)} onMakeCurrent={() => void makeCurrent(s.id)} />
                ))}
                {superseded.length > 0 ? (
                  <details className="explain" style={{ borderTop: 0 }}>
                    <summary>Revision history — {superseded.length} earlier version{superseded.length === 1 ? '' : 's'} kept</summary>
                    <div style={{ padding: '0 12px 12px', display: 'grid', gap: 8 }}>
                      {superseded.map((s) => (
                        <FileRow key={s.id} s={s} estimateId={estimateId} busy={busy} readOnly onRevise={() => undefined} onReprocess={() => undefined} onMakeCurrent={() => undefined} />
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2>Import summary</h2>
                <p>The system separates sign items from headings and totals.</p>
              </div>
              {summary ? <Pill tone={summary.officeQuestions > 0 || summary.blocked > 0 ? 'blue' : summary.needsReview > 0 ? 'yellow' : 'green'}>{summary.officeQuestions > 0 ? `${summary.officeQuestions} office question${summary.officeQuestions === 1 ? '' : 's'}` : summary.needsReview > 0 ? `${summary.needsReview} to check` : 'Ready to review'}</Pill> : <Pill tone="gray">Waiting for a takeoff</Pill>}
            </div>
            <div className="card-body">
              {summary ? (
                <>
                  <div className="summary-strip">
                    <div><span>Rows read</span><strong>{summary.rowsRead}</strong></div>
                    <div><span>Sign lines</span><strong>{summary.signLines}</strong></div>
                    <div><span>Headings ignored</span><strong>{summary.headingsIgnored}</strong></div>
                    <div><span>Takeoff quantity</span><strong>{summary.takeoffQty}</strong></div>
                  </div>
                  <div className="summary-strip" style={{ marginTop: 10 }}>
                    <div><span>Auto-matched</span><strong>{summary.autoPriced}</strong></div>
                    <div><span>Need a check</span><strong>{summary.needsReview}</strong></div>
                    <div><span>Office questions</span><strong>{summary.officeQuestions}</strong></div>
                    <div><span>Totals / tax rows skipped</span><strong>{summary.totalsIgnored + summary.taxRowsIgnored}</strong></div>
                  </div>
                  <p className="field-note" style={{ marginTop: 10 }}>
                    Tab used: <strong>{summary.primaryTab}</strong>
                    {summary.serviceRowsDeferred > 0 ? ` · ${summary.serviceRowsDeferred} design / installation row${summary.serviceRowsDeferred === 1 ? '' : 's'} deferred to Steps 5–6` : ''}
                    {summary.updated > 0 || summary.removed > 0 ? ` · revision: ${summary.added} added, ${summary.updated} updated, ${summary.removed} no longer in the takeoff` : ''}
                  </p>
                  {current && currentTabs.length > 1 && !readOnly ? (
                    <div style={{ marginTop: 12 }} className="bidw-actions">
                      <label className="lbl" htmlFor="tab-picker" style={{ margin: 0 }}>Use a different tab</label>
                      <select id="tab-picker" className="input" style={{ maxWidth: 320 }} defaultValue={summary.primaryTab ?? ''} disabled={busy} onChange={(e) => e.target.value && void reprocess(current.id, e.target.value)}>
                        {currentTabs.map((t) => (
                          <option key={t.sheetName} value={t.sheetName} disabled={!t.usable}>
                            {t.sheetName} — {t.usable ? `${t.productLines} sign types` : 'no takeoff rows'}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="empty">Upload an Excel or CSV takeoff and the summary appears here: rows read, sign lines found, headings and totals ignored, and how many lines were priced automatically.</div>
              )}
            </div>
          </div>
        </div>

        <GuideCard
          kicker="What the system found"
          title={summary ? `${summary.signLines} real sign type${summary.signLines === 1 ? '' : 's'} ready for pricing` : 'The takeoff drives everything'}
          intro={summary ? 'Rows such as "Interior Signage," "Pod B," and "Second Floor" were recognized as organization headings, not products.' : 'Excel or CSV gives the quantities and line descriptions. Plans and specifications stay attached as evidence — they never silently override an explicit quantity.'}
          items={[
            { mark: '✓', text: 'Quantities are combined across floors and pods for the same sign type.' },
            { mark: '✓', text: 'The original spreadsheet row stays attached to every item.' },
            { mark: '!', text: 'Re-uploading a revision shows exactly what changed; the earlier file is kept.' },
          ]}
          tip={summary ? <><strong>Check:</strong> Is {summary.takeoffQty} a reasonable total based on the takeoff before continuing?</> : <><strong>Tip:</strong> One workbook can hold a summary and a detailed sheet — the most detailed tab is used, and you can switch tabs after import.</>}
        />
      </div>

      <StepNav back={1} next={3} nextLabel="Import and review →" nextDisabled={!readyToReview && data.lines.length === 0} />
    </>
  );
}

function FileRow({ s, estimateId, busy, readOnly, onRevise, onReprocess, onMakeCurrent }: { s: BidWorkspaceSource; estimateId: string; busy: boolean; readOnly: boolean; onRevise: () => void; onReprocess: () => void; onMakeCurrent: () => void }) {
  const t = fileTypeClass(s.mimeType);
  const isSheet = t.label === 'XLSX' || t.label === 'XLS' || t.label === 'CSV';
  return (
    <div className={`file-row${s.supersededAt ? ' superseded' : ''}`}>
      <span className={t.cls} aria-hidden="true">{t.label}</span>
      <div className="file-copy">
        <strong title={s.originalFilename}>
          <a href={`/api/estimates/${estimateId}/bid-sources/${s.id}`} download>{s.originalFilename}</a>
          {s.version > 1 ? ` (v${s.version})` : ''}
        </strong>
        <span>
          {ROLE_LABEL[s.role] ?? s.role} · {formatBytes(s.sizeBytes)} · {s.uploadedByName ?? 'unknown'} · {formatWhen(s.createdAt)}
          {fileSummary(s) ? ` · ${fileSummary(s)}` : ''}
          {s.processingError ? ` · ${s.processingError}` : ''}
          {s.isCurrentTakeoff ? ' · current takeoff' : ''}
        </span>
      </div>
      <div className="file-actions">
        {statusPill(s)}
        {!readOnly && !s.supersededAt ? (
          <>
            {isSheet && !s.isCurrentTakeoff && s.status !== 'FAILED' && s.status !== 'UNSUPPORTED' ? (
              <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={onMakeCurrent} title="Use this spreadsheet as the takeoff that drives pricing">Use as takeoff</button>
            ) : null}
            {isSheet && (s.status === 'FAILED' || s.status === 'NEEDS_REVIEW' || s.status === 'READY') ? (
              <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={onReprocess} title="Read the file again">Retry</button>
            ) : null}
            <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={onRevise} title="Upload a newer version of this file">Upload revision</button>
          </>
        ) : null}
      </div>
    </div>
  );
}
