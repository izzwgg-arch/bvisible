// Yiddish Labs API client — transcription (speech → text) and text
// processing (translate / grammar). Both endpoints authenticate with the
// SAME X-API-KEY key, so one stored key covers everything.
//
// Speed: we always use the synchronous transcription endpoint with
// rapid=true (their fast mode). Voice notes here are short (the client
// caps recordings well under 5 minutes), so the sync endpoint returns the
// finished text in one round trip; if Yiddish Labs ever queues a job
// anyway we fall back to a tight poll.

import { prisma } from '@bvisible/db';
import { openSecret } from '@/lib/email-ingest/crypto';

const YL_BASE = 'https://app.yiddishlabs.com/api/v1';
const YL_CALL_TIMEOUT_MS = 90_000;
const YL_POLL_INTERVAL_MS = 1_200;
const YL_POLL_BUDGET_MS = 90_000;

/// DB-stored key (Assistant settings, encrypted) wins; env is fallback.
export async function loadYiddishLabsKey(tenantId: string): Promise<string | null> {
  const row = await prisma.assistantSetting.findUnique({
    where: { tenantId },
    select: { ylApiKeyCipher: true },
  });
  if (row?.ylApiKeyCipher) {
    try {
      return openSecret(row.ylApiKeyCipher);
    } catch {
      /* corrupt cipher — fall through to env */
    }
  }
  return process.env.YIDDISHLABS_API_KEY?.trim() || null;
}

export async function yiddishLabsConfigured(tenantId: string): Promise<boolean> {
  return Boolean(await loadYiddishLabsKey(tenantId));
}

/// Yiddish is written in Hebrew script — a reliable, free language check.
export function hasHebrewScript(text: string): boolean {
  return /[֐-׿]/.test(text);
}

function friendlyYlError(status: number, body: string): string {
  if (status === 401) return 'The Yiddish Labs API key is invalid or revoked — check it in Assistant settings.';
  if (status === 402) return 'Your Yiddish Labs account is out of credits — top up and try again.';
  if (status === 429) return 'Yiddish Labs is busy (concurrent job limit) — try again in a moment.';
  return `Yiddish Labs error (${status}): ${body.slice(0, 200)}`;
}

interface YlTranscriptionJob {
  id?: string;
  status?: string;
  text?: string;
}

/// Transcribe a short voice note. language: 'auto' detects Yiddish vs
/// English (vs Hebrew) server-side; pass 'yi' / 'en' to force. Forcing
/// the language measures ~3s faster than 'auto' on short clips, so the
/// Y/E toggle's explicit choice should be forwarded, not re-detected.
export async function ylTranscribe(
  apiKey: string,
  audio: Blob,
  fileName: string,
  language: 'auto' | 'yi' | 'en' | 'he' = 'auto'
): Promise<{ text: string } | { error: string }> {
  const startedAtMs = Date.now();
  const done = (result: { text: string } | { error: string }, note: string) => {
    console.log(
      `[assistant] YL transcribe (${language}, ${Math.round(audio.size / 1024)}KB): ${note} in ${Date.now() - startedAtMs}ms`
    );
    return result;
  };
  const form = new FormData();
  form.append('file', audio, fileName);
  form.append('name', 'B Visible voice note');
  form.append('language', language);
  form.append('rapid', 'true');

  let res: Response;
  try {
    res = await fetch(`${YL_BASE}/transcriptions/sync`, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey },
      body: form,
      signal: AbortSignal.timeout(YL_CALL_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === 'TimeoutError';
    return done(
      { error: timedOut ? 'Yiddish Labs took too long — try a shorter note.' : 'Could not reach Yiddish Labs — check the connection.' },
      'network failure'
    );
  }
  if (!res.ok) return done({ error: friendlyYlError(res.status, await res.text()) }, `HTTP ${res.status}`);

  let job = (await res.json()) as YlTranscriptionJob;
  if (job.status === 'completed' && typeof job.text === 'string') {
    return done({ text: job.text.trim() }, 'sync completed');
  }
  if (!job.id) return done({ error: 'Yiddish Labs returned no transcription — try again.' }, 'no job id');

  // Rare: the sync endpoint queued the job anyway — poll until done.
  let polls = 0;
  const startedAt = Date.now();
  while (Date.now() - startedAt < YL_POLL_BUDGET_MS) {
    await new Promise((r) => setTimeout(r, YL_POLL_INTERVAL_MS));
    polls += 1;
    try {
      const poll = await fetch(`${YL_BASE}/transcriptions/${job.id}`, {
        headers: { 'X-API-KEY': apiKey },
        signal: AbortSignal.timeout(15_000),
      });
      if (!poll.ok) return done({ error: friendlyYlError(poll.status, await poll.text()) }, `poll HTTP ${poll.status}`);
      job = (await poll.json()) as YlTranscriptionJob;
      if (job.status === 'completed' && typeof job.text === 'string') {
        return done({ text: job.text.trim() }, `queued, completed after ${polls} polls`);
      }
      if (job.status === 'failed' || job.status === 'error') {
        return done({ error: 'Yiddish Labs could not transcribe that recording — try again.' }, `job ${job.status}`);
      }
    } catch {
      /* transient poll failure — keep polling within the budget */
    }
  }
  return done({ error: 'Yiddish Labs is still processing — try a shorter note.' }, `poll budget spent (${polls} polls)`);
}

type YlTextAction =
  | 'fix_grammar'
  | 'rewrite'
  | 'translate-yiddish'
  | 'translate-english'
  | 'translate-hebrew'
  | 'translate-lk';

/// Text Processing API — grammar fixing, rephrasing, translation.
export async function ylProcessText(
  apiKey: string,
  text: string,
  action: YlTextAction
): Promise<{ text: string } | { error: string }> {
  const startedAtMs = Date.now();
  let res: Response;
  try {
    res = await fetch(`${YL_BASE}/process/text`, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ text_content: text, action }),
      signal: AbortSignal.timeout(YL_CALL_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === 'TimeoutError';
    return { error: timedOut ? 'Yiddish Labs translation took too long — try again.' : 'Could not reach Yiddish Labs — check the connection.' };
  }
  if (!res.ok) return { error: friendlyYlError(res.status, await res.text()) };
  const json = (await res.json()) as { text?: string };
  const out = (json.text ?? '').trim();
  console.log(`[assistant] YL ${action}: ${text.length} chars in ${Date.now() - startedAtMs}ms`);
  if (!out) return { error: 'Yiddish Labs returned empty text — try again.' };
  return { text: out };
}

// YL's text processing has a large fixed per-call cost (~7-8s measured)
// plus a length component. For long texts, translating a few chunks IN
// PARALLEL pays the fixed cost once instead of letting it stack — an
// estimate-style reply drops from ~14-20s to ~8-9s. Chunks split on line
// boundaries (agent replies are line lists), falling back to sentence
// boundaries for one long paragraph, so each chunk translates cleanly.
const CHUNK_MIN_CHARS = 260;
const MAX_PARALLEL_CHUNKS = 4; // stay under YL concurrency limits

function splitForTranslation(text: string): string[] {
  if (text.length <= CHUNK_MIN_CHARS * 1.5) return [text];
  const target = Math.max(CHUNK_MIN_CHARS, Math.ceil(text.length / MAX_PARALLEL_CHUNKS));
  // Prefer line boundaries; a single long paragraph splits on sentences.
  let parts = text.split('\n');
  if (parts.length === 1) parts = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';
  for (const part of parts) {
    if (current && current.length + part.length + 1 > target) {
      chunks.push(current);
      current = part;
    } else {
      current = current ? `${current}\n${part}` : part;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/// Translate with parallel chunking for long texts. Short texts go
/// through as a single call; anything else is split, translated
/// concurrently, and re-joined in order.
export async function ylTranslateFast(
  apiKey: string,
  text: string,
  action: YlTextAction
): Promise<{ text: string } | { error: string }> {
  const trimmed = text.trim();
  const chunks = splitForTranslation(trimmed);
  if (chunks.length <= 1) return ylProcessText(apiKey, trimmed, action);

  const startedAtMs = Date.now();
  const results = await Promise.all(chunks.map((c) => ylProcessText(apiKey, c, action)));
  console.log(
    `[assistant] YL ${action} chunked: ${trimmed.length} chars in ${chunks.length} parallel chunks, ${Date.now() - startedAtMs}ms total`
  );
  const failed = results.find((r) => 'error' in r);
  if (failed && 'error' in failed) return failed;
  return { text: results.map((r) => ('text' in r ? r.text : '')).join('\n') };
}
