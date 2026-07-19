import { NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/auth/current-user';
import { executeConfirmedAction, type PendingAction } from '@/lib/assistant/operator-actions';

// Executes an assistant action the operator approved (currently: soft
// deletes). The pending action was produced server-side and echoed back
// here; executeConfirmedAction re-checks tenant ownership before doing
// anything, so a tampered id can never reach another tenant's data.

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const me = await requireTenantId();
  let body: { action?: PendingAction };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const action = body.action;
  const validDelete = action?.kind === 'delete' && !!action.entity && !!action.recordId;
  const validStatus = action?.kind === 'set_estimate_status' && !!action.recordId && !!action.targetStatus;
  if (!action || (!validDelete && !validStatus)) {
    return NextResponse.json({ error: 'No valid action to confirm.' }, { status: 400 });
  }
  const result = await executeConfirmedAction({ id: me.id, tenantId: me.tenantId }, action);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 200 });
  }
  return NextResponse.json({ ok: true, label: result.label });
}
