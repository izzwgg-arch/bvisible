import { NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/auth/current-user';
import {
  assistantConfigured,
  runAssistant,
  type AssistantProgressEvent,
} from '@/lib/assistant/agent';

// The assistant can work for minutes (multi-round Sheet + DB research).
// A buffered response dies in the proxy's 300s read timeout (this caused
// real 504s), so when the client asks for it we stream NDJSON instead:
// heartbeat + live progress lines keep the connection alive, and the
// final line carries the complete turn. Old/stale tabs that don't send
// the accept header still get the legacy buffered JSON response.

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function POST(req: Request) {
  const me = await requireTenantId();
  if (!(await assistantConfigured(me.tenantId))) {
    return NextResponse.json(
      { reply: 'Assistant not configured — add your OpenAI API key in Assistant settings.', toolEvents: [] },
      { status: 200 }
    );
  }
  let body: { messages?: Array<{ role: string; content: string }>; context?: string };
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
  const context = typeof body.context === 'string' ? body.context.slice(0, 4000) : null;

  const wantsStream = (req.headers.get('accept') ?? '').includes('application/x-ndjson');
  if (!wantsStream) {
    // Legacy buffered path (kept for tabs opened before this deploy).
    try {
      const turn = await runAssistant(history, { id: me.id, tenantId: me.tenantId }, context);
      return NextResponse.json(turn);
    } catch (e) {
      console.error('[assistant] request failed:', e);
      return NextResponse.json(
        { reply: 'The assistant hit an unexpected error — please try again.', toolEvents: [] },
        { status: 200 }
      );
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          closed = true; // client went away — let the agent finish quietly
        }
      };
      // First byte immediately + heartbeat every 10s: the proxy never
      // waits long enough to time out, no matter how long the agent works.
      write({ type: 'hb' });
      const heartbeat = setInterval(() => write({ type: 'hb' }), 10_000);
      void (async () => {
        try {
          const turn = await runAssistant(
            history,
            { id: me.id, tenantId: me.tenantId },
            context,
            (e: AssistantProgressEvent) => write(e)
          );
          write({ type: 'done', ...turn });
        } catch (e) {
          console.error('[assistant] request failed:', e);
          write({ type: 'done', reply: 'The assistant hit an unexpected error — please try again.', toolEvents: [] });
        } finally {
          clearInterval(heartbeat);
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      })();
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
