'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EstimateStatus } from '@bvisible/db';
import { finalizeEstimateAction, updateEstimateStatusAction } from './actions';
import {
  sendEstimateEmailAction,
  type SendEstimateEmailState,
} from './preview/actions';

const INITIAL_SEND_STATE: SendEstimateEmailState = { ok: false, error: null, messageId: null };

export function EstimateHeaderActions({
  estimateId,
  status,
}: {
  estimateId: string;
  status: EstimateStatus;
}) {
  const router = useRouter();
  const [sendState, sendAction, sendPending] = useActionState(
    sendEstimateEmailAction,
    INITIAL_SEND_STATE,
  );
  const [approveBusy, setApproveBusy] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [finalizeBusy, setFinalizeBusy] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  useEffect(() => {
    if (sendState.ok) router.refresh();
  }, [router, sendState.ok]);

  async function approve() {
    setApproveBusy(true);
    setApproveError(null);
    const result = await updateEstimateStatusAction({
      estimateId,
      status: EstimateStatus.APPROVED,
    });
    setApproveBusy(false);
    if (result.error) {
      setApproveError(result.error);
      return;
    }
    router.refresh();
  }

  async function finalize() {
    setFinalizeBusy(true);
    setFinalizeError(null);
    const result = await finalizeEstimateAction({ estimateId });
    setFinalizeBusy(false);
    if (!result.ok) {
      setFinalizeError(result.message ?? 'Could not finalize estimate.');
      return;
    }
    if (result.purchaseOrderId) {
      router.push(`/purchase-orders/${result.purchaseOrderId}` as never);
    } else {
      router.refresh();
    }
  }

  const approved = status === EstimateStatus.APPROVED || status === EstimateStatus.FINALIZED;
  const finalized = status === EstimateStatus.FINALIZED;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`/estimates/${estimateId}/preview` as never}
        className="inline-flex h-9 items-center justify-center rounded-[7px] border border-slate-200 bg-white px-5 text-[12px] font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
      >
        Preview
      </Link>
      <Link
        href={`/estimates/${estimateId}/qbme` as never}
        title="QuickBooks manual-estimate export block"
        className="inline-flex h-9 items-center justify-center rounded-[7px] border border-slate-200 bg-white px-5 text-[12px] font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
      >
        QBME
      </Link>
      <form action={sendAction} className="relative">
        <input type="hidden" name="estimateId" value={estimateId} />
        <button
          type="submit"
          disabled={sendPending || status === EstimateStatus.FINALIZED}
          title="Email this estimate to the customer email on file."
          className="inline-flex h-9 items-center justify-center rounded-[7px] border border-slate-200 bg-white px-6 text-[12px] font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sendPending ? 'Sending...' : sendState.ok ? 'Sent' : 'Send'}
        </button>
      </form>
      <button
        type="button"
        onClick={approve}
        disabled={approveBusy || approved}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-[7px] bg-[#4f46e5] px-5 text-[12px] font-bold text-white shadow-[0_12px_24px_-14px_rgba(79,70,229,0.85)] transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-emerald-600 disabled:opacity-80"
      >
        {approveBusy ? 'Approving...' : approved ? 'Approved' : 'Approve'}
        <span aria-hidden className="text-white/75">⌄</span>
      </button>
      <button
        type="button"
        onClick={finalize}
        disabled={finalizeBusy || finalized}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-[7px] border border-violet-200 bg-white px-5 text-[12px] font-bold text-violet-700 shadow-sm transition hover:border-violet-300 hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
      >
        <span aria-hidden>⚑</span>
        {finalizeBusy ? 'Finalizing...' : finalized ? 'Finalized' : 'Finalize estimate'}
      </button>
      {sendState.error ? (
        <span className="basis-full text-right text-[11.5px] font-medium text-rose-600">
          {sendState.error}
        </span>
      ) : approveError ? (
        <span className="basis-full text-right text-[11.5px] font-medium text-rose-600">
          {approveError}
        </span>
      ) : finalizeError ? (
        <span className="basis-full text-right text-[11.5px] font-medium text-rose-600">
          {finalizeError}
        </span>
      ) : null}
    </div>
  );
}
