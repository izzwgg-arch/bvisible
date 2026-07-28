'use client';

// Chrome's MediaRecorder produces WebM/Opus, which Yiddish Labs does not
// accept (it takes MP3, WAV, M4A, OGG, FLAC). This converts a recorded
// blob to 16 kHz mono PCM WAV in the browser — decode with WebAudio,
// resample through an OfflineAudioContext, write a WAV header. 16 kHz
// mono is what speech models use anyway, and it keeps the upload small
// (~32 KB per second) so transcription starts as fast as possible.

export async function blobToWav16k(blob: Blob): Promise<Blob> {
  const bytes = await blob.arrayBuffer();
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const probe = new Ctx();
  let decoded: AudioBuffer;
  try {
    decoded = await probe.decodeAudioData(bytes);
  } finally {
    void probe.close();
  }

  const rate = 16000;
  const frames = Math.max(1, Math.ceil(decoded.duration * rate));
  const off = new OfflineAudioContext(1, frames, rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  const pcm = rendered.getChannelData(0);

  const out = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(out);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i += 1) {
    const s = Math.max(-1, Math.min(1, pcm[i] ?? 0));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([out], { type: 'audio/wav' });
}
