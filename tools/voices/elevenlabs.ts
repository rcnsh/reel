import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fetchRetry } from '../http';
import type { SynthRequest, VoiceSource } from './voice';

export const API = 'https://api.elevenlabs.io/v1';
export const DEFAULT_MODEL = 'eleven_multilingual_v2';

export interface CharAlignment { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }

export function charsToWords(a: CharAlignment): { w: string; start: number; end: number }[] {
  const out: { w: string; start: number; end: number }[] = [];
  let cur: { w: string; start: number; end: number } | null = null;
  a.characters.forEach((c, i) => {
    if (/\s/.test(c)) { if (cur) out.push(cur); cur = null; return; }
    const s = a.character_start_times_seconds[i]!, e = a.character_end_times_seconds[i]!;
    if (cur) { cur.w += c; cur.end = e; } else cur = { w: c, start: s, end: e };
  });
  if (cur) out.push(cur);
  return out;
}

export function request(voiceId: string, r: SynthRequest): { url: string; body: Record<string, unknown> } {
  const body: Record<string, unknown> = { text: r.text, model_id: r.model ?? DEFAULT_MODEL };
  if (r.speed !== 1) body.voice_settings = { speed: Math.min(1.2, Math.max(0.7, r.speed)) };
  if (r.previous) body.previous_text = r.previous;
  if (r.next) body.next_text = r.next;
  return { url: `${API}/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=wav_24000`, body };
}

export const elevenlabs: VoiceSource = {
  about: 'elevenlabs:<voice-id> hosted (ELEVENLABS_API_KEY); word times from its character timestamps',
  hosted: true,
  create(arg, ctx) {
    const { env } = ctx;
    if (!arg) throw new Error('elevenlabs needs a voice id: --voice elevenlabs:<voice-id> (the id from the ElevenLabs voice library)');
    const key = env.ELEVENLABS_API_KEY;
    if (!key) throw new Error('ELEVENLABS_API_KEY is not set: hosted voices are opt-in, so nothing is sent until it is (or use --voice kokoro)');
    return {
      id: `elevenlabs:${arg}`,
      async synth(reqs, work, each) {
        for (const [i, r] of reqs.entries()) {
          const q = request(arg, r);
          const j = await fetchRetry('elevenlabs', ctx, q.url, { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify(q.body) }, (r) => r.json() as Promise<{ audio_base64: string; alignment: CharAlignment | null }>);
          if (!j.audio_base64) throw new Error('elevenlabs: the response had no audio');
          const file = path.join(work, `elevenlabs${i}.wav`);
          writeFileSync(file, Buffer.from(j.audio_base64, 'base64'));
          await each(i, { file, words: j.alignment ? charsToWords(j.alignment) : undefined });
        }
      },
    };
  },
};
