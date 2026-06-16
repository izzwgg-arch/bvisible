'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EstimateStatus } from '@bvisible/db';
import { updateEstimateStatusAction } from './actions';
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

  const approved = status === EstimateStatus.APPROVED || status === EstimateStatus.FINALIZED;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`/estimates/${estimateId}/preview` as never}
        className="inline-flex items-center justify-center rounded-[12px] border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
      >
        Preview
      </Link>
      <form action={sendAction} className="relative">
        <input type="hidden" name="estimateId" value={estimateId} />
        <button
          type="submit"
          disabled={sendPending || status === EstimateStatus.FINALIZED}
          title="Email this estimate to the customer email on file."
          className="inline-flex items-center justify-center rounded-[12px] border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sendPending ? 'Sending...' : sendState.ok ? 'Sent' : 'Send'}
        </button>
      </form>
      <button
        type="button"
        onClick={approve}
        disabled={approveBusy || approved}
        className="inline-flex items-center justify-center gap-2 rounded-[12px] bg-gradient-to-br from-blue-600 to-indigo-600 px-4 py-2.5 text-[13px] font-bold text-white shadow-[0_14px_30px_-16px_rgba(37,99,235,0.75)] transition hover:from-blue-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:from-emerald-500 disabled:to-emerald-600 disabled:opacity-80"
      >
        {approveBusy ? 'Approving...' : approved ? 'Approved' : 'Approve'}
      </button>
      {sendState.error ? (
        <span className="basis-full text-right text-[11.5px] font-medium text-rose-600">
          {sendState.error}
        </span>
      ) : approveError ? (
        <span className="basis-full text-right text-[11.5px] font-medium text-rose-600">
          {approveError}
        </span>
      ) : null}
    </div>
  );
}
