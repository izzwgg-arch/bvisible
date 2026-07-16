import { NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/auth/current-user';
import { assistantConfigured, runAssistant } from '@/lib/assistant/agent';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  const me = await requireTenantId();
  if (!(await assistantConfigured(me.tenantId))) {
    return NextResponse.json(
      { reply: 'Assistant not configured — add your OpenAI API key in Assistant settings.', toolEvents: [] },
      { status: 200 }
    );
  }
  let body: { messages?: Array<{ role: string; content: string }> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const history = (body.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-16)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 8000) }));
  if (history.length === 0 || history[history.length - 1]?.role !== 'user') {
    return NextResponse.json({ error: 'Last message must be from the user.' }, { status: 400 });
  }
  const turn = await runAssistant(history, { id: me.id, tenantId: me.tenantId });
  return NextResponse.json(turn);
}
