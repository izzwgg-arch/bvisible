import { notFound } from 'next/navigation';
import { requireTenantId } from '@/lib/auth/current-user';
import { loadBidWorkspace } from '@/lib/bid/workflow';
import { buildBidFinalOutputs } from '@/lib/bid/final-outputs';
import { isBidStep, type BidStep } from '@/lib/bid/types';
import { BidWorkspace } from './bid-workspace';
import { bidWorkspaceCss } from './bid-styles';

export const metadata = { title: 'Bid Estimator' };
export const dynamic = 'force-dynamic';

export default async function BidEstimatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const me = await requireTenantId();
  const { id } = await params;
  const sp = await searchParams;

  const data = await loadBidWorkspace({ tenantId: me.tenantId, estimateId: id, actor: { id: me.id, role: me.role, name: me.name, email: me.email } });
  if (!data) notFound();

  // Step 7 outputs come from the SAME loader as the PDF / public quote, so
  // the on-screen estimate, the printed PDF, and the QBME block agree line by
  // line. The client refreshes them after any edit (see StepFinal).
  const finalOutputs = await buildBidFinalOutputs(me.tenantId, id);

  const requested = Number(sp.step);
  const initialStep: BidStep = isBidStep(requested) ? requested : data.workflow.currentStep;

  return (
    <div id="bid-workspace-root" className="bidw">
      <style>{`
        /* Focused workspace: the seven-step rail replaces the app sidebar and
           top bar so the workflow owns the full width (the app is one click
           away from the rail's brand mark / "Open estimate record"). */
        body:has(#bid-workspace-root) header.sticky { display: none; }
        body:has(#bid-workspace-root) main { padding: 0 !important; }
        body:has(#bid-workspace-root) { background: #f4f7fa; }
        .grid:has(#bid-workspace-root) { grid-template-columns: minmax(0, 1fr) !important; }
        .grid:has(#bid-workspace-root) > aside { display: none !important; }
        ${bidWorkspaceCss()}
      `}</style>
      <BidWorkspace
        data={data}
        initialStep={initialStep}
        finalOutputs={finalOutputs}
        viewer={{ id: me.id, name: me.name ?? me.email, email: me.email, role: me.role }}
      />
    </div>
  );
}
