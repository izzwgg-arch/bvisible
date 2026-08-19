'use client';

// Seven-step Bid Estimator workspace (client shell). Owns: the step rail,
// the top bar with the autosave indicator, step navigation (URL ?step=
// mirrors the saved step), and hands each step screen the shared context.

import { useCallback, useEffect, useMemo, useState, useTransition, createContext, useContext, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { BidWorkspaceData } from '@/lib/bid/workflow';
import type { BidFinalOutputs } from '@/lib/bid/final-outputs';
import { BID_STEPS, type BidStep } from '@/lib/bid/types';
import { saveBidWorkflowAction } from './actions';
import { useBidAutosave, type BidAutosave } from './use-bid-autosave';
import { StepProject } from './steps/step-project';
import { StepSources } from './steps/step-sources';
import { StepPricing } from './steps/step-pricing';
import { StepQuestions } from './steps/step-questions';
import { StepDesign } from './steps/step-design';
import { StepInstallation } from './steps/step-installation';
import { StepFinal } from './steps/step-final';
import { Banner } from './bid-ui';

export type { BidFinalOutputs } from '@/lib/bid/final-outputs';

export interface BidViewer {
  id: string;
  name: string;
  email: string;
  role: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
}

export interface BidContextValue {
  data: BidWorkspaceData;
  estimateId: string;
  readOnly: boolean;
  viewer: BidViewer;
  autosave: BidAutosave;
  refresh: () => void;
  refreshing: boolean;
  goToStep: (step: BidStep, opts?: { complete?: BidStep }) => Promise<void>;
  step: BidStep;
  finalOutputs: BidFinalOutputs | null;
}

const BidContext = createContext<BidContextValue | null>(null);

export function useBid(): BidContextValue {
  const v = useContext(BidContext);
  if (!v) throw new Error('useBid outside BidWorkspace');
  return v;
}

/**
 * The app shell scrolls an inner container, not the window, so window.scrollTo
 * alone would leave a new step scrolled halfway down.
 */
export function scrollWorkspaceToTop(): void {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  let node: HTMLElement | null = document.getElementById('bid-workspace-root');
  while (node) {
    const style = window.getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
      node.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    node = node.parentElement;
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase() || (name[0] ?? '?').toUpperCase();
}

export function BidWorkspace({ data, initialStep, finalOutputs, viewer }: { data: BidWorkspaceData; initialStep: BidStep; finalOutputs: BidFinalOutputs | null; viewer: BidViewer }) {
  const router = useRouter();
  const [step, setStep] = useState<BidStep>(initialStep);
  const [pending, startTransition] = useTransition();
  const readOnly = data.estimate.readOnly;

  const autosave = useBidAutosave({
    estimateId: data.estimate.id,
    initialVersion: data.workflow.version,
    initialSavedAt: data.workflow.lastSavedAt,
    disabled: readOnly,
    save: saveBidWorkflowAction,
  });

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  const goToStep = useCallback(
    async (next: BidStep, opts?: { complete?: BidStep }) => {
      const completed = opts?.complete ? [...new Set([...data.workflow.completedSteps, opts.complete])] : undefined;
      if (!readOnly) {
        autosave.queue({ currentStep: next, ...(completed ? { completedSteps: completed as BidStep[] } : {}) });
        await autosave.flush();
      }
      setStep(next);
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('step', String(next));
        window.history.replaceState(window.history.state, '', url.toString());
        scrollWorkspaceToTop();
      }
      if (opts?.complete) refresh();
    },
    [autosave, data.workflow.completedSteps, readOnly, refresh]
  );

  // Our own server-side saves (design, installation, office answers) bump the
  // workflow version. Adopt it so the next autosave is not rejected as a
  // conflict — but only when WE wrote it; another user's save must still
  // surface as a real conflict.
  useEffect(() => {
    if (data.workflow.lastSavedById === viewer.id) {
      autosave.adoptVersion(data.workflow.version, data.workflow.lastSavedAt);
    }
  }, [data.workflow.version, data.workflow.lastSavedById, data.workflow.lastSavedAt, viewer.id, autosave]);

  // Keep the URL in sync when the page first renders with the saved step.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('step') !== String(step)) {
      url.searchParams.set('step', String(step));
      window.history.replaceState(window.history.state, '', url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ctx = useMemo<BidContextValue>(
    () => ({ data, estimateId: data.estimate.id, readOnly, viewer, autosave, refresh, refreshing: pending, goToStep, step, finalOutputs }),
    [data, readOnly, viewer, autosave, refresh, pending, goToStep, step, finalOutputs]
  );

  const completed = new Set(data.workflow.completedSteps);
  const stepMeta = BID_STEPS.find((s) => s.step === step)!;
  const attention: Record<number, boolean> = {
    3: data.counts.needsReview + data.counts.officeQuestions + data.counts.blocked > 0,
    4: data.counts.openQuestions > 0,
    5: data.workflow.designIncluded === null,
    6: data.workflow.installIncluded === null,
    7: data.checklist.blocking.length > 0,
  };

  return (
    <BidContext.Provider value={ctx}>
      <div className="bidw-shell">
        <aside className="bidw-side" aria-label="Estimate steps">
          <Link href="/estimates" className="bidw-brand">
            <div className="bidw-mark" aria-hidden="true">B•</div>
            <div>
              <span className="bidw-brand-name">B VISIBLE</span>
              <span className="bidw-brand-sub">Signs • Printing</span>
            </div>
          </Link>
          <div className="bidw-chip">
            <span>Bid estimate {data.estimate.number}</span>
            <strong title={data.workflow.projectName ?? data.estimate.title}>{data.workflow.projectName ?? data.estimate.title}</strong>
            <small>{data.estimate.client.companyName} · {data.estimate.statusLabel}</small>
          </div>
          <nav className="bidw-steps" aria-label="Steps">
            {BID_STEPS.map((s) => {
              const isActive = s.step === step;
              const done = completed.has(s.step);
              return (
                <button
                  key={s.step}
                  type="button"
                  className={`bidw-step${isActive ? ' active' : ''}`}
                  aria-current={isActive ? 'step' : undefined}
                  onClick={() => void goToStep(s.step)}
                >
                  <span className="bidw-step-num" aria-hidden="true">{s.step}</span>
                  <span className="bidw-step-name">{s.label}</span>
                  {done && !attention[s.step] ? (
                    <span className="bidw-step-check" aria-label="completed">✓</span>
                  ) : attention[s.step] ? (
                    <span className="bidw-step-dot" aria-label="needs attention" title="Needs attention" />
                  ) : (
                    <span />
                  )}
                </button>
              );
            })}
          </nav>
          <div className="bidw-side-foot">
            Signed in as<br />
            <strong>{viewer.name}</strong>
            <br />
            {viewer.role === 'USER' ? 'Bid Estimator' : viewer.role === 'ADMIN' ? 'Office admin' : 'Administrator'}
            <br />
            <br />
            <Link href={`/estimates/${data.estimate.id}`}>Open estimate record →</Link>
          </div>
        </aside>

        <section className="bidw-main">
          <header className="bidw-top">
            <div className="bidw-crumb">
              <Link href="/estimates">Bid Estimates</Link> / <strong>{data.workflow.projectName ?? data.estimate.title}</strong> / <span>{stepMeta.label}</span>
            </div>
            <div className="bidw-top-actions">
              <AutosaveIndicator autosave={autosave} readOnly={readOnly} onReload={() => window.location.reload()} />
              <div className="bidw-profile">
                <div className="bidw-avatar" aria-hidden="true">{initials(viewer.name)}</div>
                <div className="bidw-profile-copy">
                  <strong>{viewer.name}</strong>
                  <span>{viewer.role === 'USER' ? 'Bid Estimator' : 'Office'}</span>
                </div>
              </div>
            </div>
          </header>

          <main className="bidw-content">
            {readOnly ? (
              <Banner tone="info">
                <span>
                  <strong>Finalized — read-only.</strong> This estimate is locked because money is being spent against it. An administrator can unfinalize it from the estimate record if changes are genuinely needed.
                </span>
              </Banner>
            ) : null}
            {autosave.status === 'conflict' ? (
              <Banner tone="warn">
                <span>
                  <strong>Someone else changed this estimate.</strong> Your latest edits were kept in this window but not saved. <button type="button" className="link-btn" onClick={() => window.location.reload()}>Reload to see the newest version</button>.
                </span>
              </Banner>
            ) : null}
            {step === 1 ? <StepProject /> : null}
            {step === 2 ? <StepSources /> : null}
            {step === 3 ? <StepPricing /> : null}
            {step === 4 ? <StepQuestions /> : null}
            {step === 5 ? <StepDesign /> : null}
            {step === 6 ? <StepInstallation /> : null}
            {step === 7 ? <StepFinal /> : null}
          </main>
        </section>
      </div>
    </BidContext.Provider>
  );
}

function AutosaveIndicator({ autosave, readOnly, onReload }: { autosave: BidAutosave; readOnly: boolean; onReload: () => void }) {
  if (readOnly) {
    return (
      <span className="bidw-save" title="Finalized estimates are read-only">
        <span className="dot" /> Read-only
      </span>
    );
  }
  switch (autosave.status) {
    case 'saving':
      return (
        <span className="bidw-save saving" aria-live="polite">
          <span className="dot" /> Saving…
        </span>
      );
    case 'dirty':
      return (
        <span className="bidw-save dirty" aria-live="polite">
          <span className="dot" /> Unsaved changes
        </span>
      );
    case 'failed':
      return (
        <span className="bidw-save failed" aria-live="assertive" title={autosave.error ?? undefined}>
          <span className="dot" /> Save failed — <button type="button" onClick={autosave.retry}>Retry</button>
        </span>
      );
    case 'conflict':
      return (
        <span className="bidw-save failed" aria-live="assertive">
          <span className="dot" /> Changed elsewhere — <button type="button" onClick={onReload}>Reload</button>
        </span>
      );
    case 'saved':
      return (
        <span className="bidw-save saved" aria-live="polite">
          <span className="dot" /> Saved
        </span>
      );
    default:
      return (
        <span className="bidw-save saved" title={autosave.lastSavedAt ? `Last saved ${new Date(autosave.lastSavedAt).toLocaleString()}` : undefined}>
          <span className="dot" /> {autosave.lastSavedAt ? 'Saved' : 'Autosave on'}
        </span>
      );
  }
}

export function StepNav({ back, next, nextLabel, nextDisabled, nextTitle, children }: { back?: BidStep; next?: BidStep; nextLabel?: string; nextDisabled?: boolean; nextTitle?: string; children?: ReactNode }) {
  const { goToStep, step } = useBid();
  return (
    <div className="footer-actions">
      <div className="bidw-actions">
        {back ? (
          <button type="button" className="btn btn-secondary" onClick={() => void goToStep(back)}>
            ← Back
          </button>
        ) : (
          <span className="save-note">Your work saves automatically. You can leave and come back to this step.</span>
        )}
        {children}
      </div>
      {next ? (
        <button type="button" className="btn btn-primary" disabled={nextDisabled} title={nextTitle} onClick={() => void goToStep(next, { complete: step })}>
          {nextLabel ?? 'Save and continue →'}
        </button>
      ) : null}
    </div>
  );
}
