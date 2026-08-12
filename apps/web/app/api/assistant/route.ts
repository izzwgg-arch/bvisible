import { NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/auth/current-user';
import {
  assistantConfigured,
  runAssistant,
  type AssistantActor,
  type AssistantProgressEvent,
  type AssistantTurn,
} from '@/lib/assistant/agent';
import {
  hasHebrewScript,
  loadYiddishLabsKey,
  ylProcessText,
  ylTranslateFast,
} from '@/lib/assistant/yiddishlabs';
import { runTakeoffTurn } from '@/lib/assistant/takeoff-turn';
import { sanitizeAttachedTakeoff } from '@/lib/estimate-import/attached-takeoff';

// The assistant can work for minutes (multi-round Sheet + DB research).
// A buffered response dies in the proxy's 300s read timeout (this caused
// real 504s), so when the client asks for it we stream NDJSON instead:
// heartbeat + live progress lines keep the connection alive, and the
// final line carries the complete turn. Old/stale tabs that don't send
// the accept header still get the legacy buffered JSON response.

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

/// Yiddish mode (dock Y/E toggle): the operator's Yiddish message is
/// translated to English by Yiddish Labs before it reaches OpenAI
/// (~2s), and the final answer is translated back to Yiddish by Yiddish
/// Labs — long replies are chunked and translated in parallel so YL's
/// fixed per-call cost is paid once, not per paragraph. Messages typed
/// in English while the toggle is on Y skip the inbound translation
/// (Yiddish is written in Hebrew script, so detection is exact).
async function runAssistantInLanguage(
  lang: string | null,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  me: AssistantActor,
  context: string | null,
  onEvent?: (e: AssistantProgressEvent) => void
): Promise<AssistantTurn> {
  if (lang !== 'yi') return runAssistant(history, me, context, onEvent);

  const ylKey = await loadYiddishLabsKey(me.tenantId);
  if (!ylKey) {
    return {
      reply: 'Yiddish mode needs a Yiddish Labs API key — add it in Assistant settings (or switch the toggle back to E).',
      toolEvents: [],
    };
  }

  const translated = [...history];
  const last = translated[translated.length - 1];
  if (last && hasHebrewScript(last.content)) {
    onEvent?.({ type: 'tool', tool: 'translate_to_english', summary: '' });
    const en = await ylProcessText(ylKey, last.content, 'translate-english');
    if ('text' in en) {
      translated[translated.length - 1] = { ...last, content: en.text };
    }
    // On translation failure the original Yiddish goes through — the
    // model handles it well enough that failing the whole turn is worse.
  }

  const turn = await runAssistant(translated, me, context, onEvent);

  if (turn.reply && turn.reply.trim() && !hasHebrewScript(turn.reply)) {
    onEvent?.({ type: 'tool', tool: 'translate_to_yiddish', summary: '' });
    const yi = await ylTranslateFast(ylKey, turn.reply, 'translate-yiddish');
    if ('text' in yi) turn.reply = yi.text;
  }
  return turn;
}

export async function POST(req: Request) {
  const me = await requireTenantId();
  if (!(await assistantConfigured(me.tenantId))) {
    return NextResponse.json(
      { reply: 'Assistant not configured — add your OpenAI API key in Assistant settings.', toolEvents: [] },
      { status: 200 }
    );
  }
  let body: {
    messages?: Array<{ role: string; content: string }>;
    context?: string;
    lang?: string;
    takeoff?: unknown;
  };
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
  const lang = typeof body.lang === 'string' ? body.lang : null;

  // Role comes from the session-backed user, never from the request body:
  // it decides whether this turn may train the assistant's memory.
  const actor: AssistantActor = { id: me.id, tenantId: me.tenantId, role: me.role };

  // A message carrying a parsed Excel takeoff takes the dedicated path:
  // one planning call, then a deterministic verbatim import — the agent
  // loop (and Yiddish translation) never see the line data.
  const takeoff = sanitizeAttachedTakeoff(body.takeoff);
  const runTurn = (onEvent?: (e: AssistantProgressEvent) => void) =>
    takeoff
      ? runTakeoffTurn(history, actor, takeoff, onEvent)
      : runAssistantInLanguage(lang, history, actor, context, onEvent);

  const wantsStream = (req.headers.get('accept') ?? '').includes('application/x-ndjson');
  if (!wantsStream) {
    // Legacy buffered path (kept for tabs opened before this deploy).
    try {
      const turn = await runTurn();
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
          const turn = await runTurn((e: AssistantProgressEvent) => write(e));
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
