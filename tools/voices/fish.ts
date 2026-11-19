// Fish Audio, a hosted voice: opt-in through FISH_API_KEY. It returns audio only, so the forced aligner times the
// words. Only the passage's text is sent.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fetchRetry } from '../http';
import type { SynthRequest, VoiceSource } from './voice';

export const API = 'https://api.fish.audio/v1/tts';
export const DEFAULT_MODEL = 's2.1-pro';

/** The request for a passage (headers beyond auth, and body), separate so tests can check it. */
export function request(referenceId: string, r: SynthRequest): { headers: Record<string, string>; body: Record<string, unknown> } {
  return {
    headers: { model: r.model ?? DEFAULT_MODEL, 'content-type': 'application/json' },
    body: { text: r.text, reference_id: referenceId, format: 'wav', sample_rate: 44100, normalize: true, latency: 'normal', prosody: { speed: r.speed, volume: 0 } },
  };
}

export const fish: VoiceSource = {
  about: 'fish:<voice-id>       hosted (FISH_API_KEY), a Fish Audio voice model id; words timed by the forced aligner',
  hosted: true,
  create(arg, ctx) {
    const { env } = ctx;
    if (!arg) throw new Error('fish needs a voice model id: --voice fish:<id> (from the voice\'s page on fish.audio)');
    const key = env.FISH_API_KEY;
    if (!key) throw new Error('FISH_API_KEY is not set: hosted voices are opt-in, so nothing is sent until it is (or use --voice kokoro)');
    return {
      id: `fish:${arg}`,
      async synth(reqs, work, each) {
        for (const [i, r] of reqs.entries()) {
          const q = request(arg, r);
          const buf = new Uint8Array(await fetchRetry('fish', ctx, API, { method: 'POST', headers: { authorization: `Bearer ${key}`, ...q.headers }, body: JSON.stringify(q.body) }, (r) => r.arrayBuffer()));
          if (buf.length < 44) throw new Error('fish: the response had no audio');
          const file = path.join(work, `fish${i}.wav`);
          writeFileSync(file, buf);
          await each(i, { file });
        }
      },
    };
  },
};
