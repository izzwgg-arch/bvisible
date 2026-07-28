import { NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/auth/current-user';
import { transcribeVoiceNote } from '@/lib/assistant/agent';
import { loadYiddishLabsKey, ylTranscribe } from '@/lib/assistant/yiddishlabs';

// Voice-note transcription for the assistant dock. The recording is
// forwarded straight to the transcription service with the tenant's
// stored key and then discarded — nothing is stored on the server.
//
// Two engines, picked by the dock's Y/E toggle (form field "lang"):
//   - "yi" → Yiddish Labs (language=auto so English spoken in Y mode
//     still comes out right; rapid mode for speed)
//   - anything else → OpenAI Whisper (the original English path)

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_BYTES = 15 * 1024 * 1024; // ~15 MB ≈ several minutes of audio

export async function POST(req: Request) {
  const me = await requireTenantId();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data.' }, { status: 400 });
  }
  const file = form.get('audio');
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: 'No audio received.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Voice note too long — keep it under a few minutes.' }, { status: 413 });
  }

  const type = file.type || 'audio/webm';
  const ext =
    type.includes('wav') ? 'wav'
    : type.includes('mp4') || type.includes('m4a') ? 'm4a'
    : type.includes('ogg') ? 'ogg'
    : 'webm';

  if (String(form.get('lang') ?? '') === 'yi') {
    const ylKey = await loadYiddishLabsKey(me.tenantId);
    if (!ylKey) {
      return NextResponse.json(
        { error: 'Yiddish mode needs a Yiddish Labs API key — add it in Assistant settings.' },
        { status: 200 }
      );
    }
    const result = await ylTranscribe(ylKey, file, `voice-note.${ext}`, 'auto');
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 200 });
    return NextResponse.json({ text: result.text });
  }

  const result = await transcribeVoiceNote(me.tenantId, file, `voice-note.${ext}`);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 200 });
  }
  return NextResponse.json({ text: result.text });
}
