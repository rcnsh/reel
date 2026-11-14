// Sound effects and music from ElevenLabs (ELEVENLABS_API_KEY): the sound-generation and music endpoints. Only the
// prompt and the duration are sent.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { httpError } from '../voices/voice';
import type { AssetEntry } from '../asset-manifest';
import type { AssetProvider } from './provider';

export const API = 'https://api.elevenlabs.io/v1';

export function request(a: AssetEntry): { url: string; body: Record<string, unknown> } {
  return a.kind === 'sfx'
    ? { url: `${API}/sound-generation?output_format=mp3_44100_192`, body: { text: a.prompt, duration_seconds: a.duration, prompt_influence: 0.4 } }
    : { url: `${API}/music?output_format=mp3_44100_192`, body: { prompt: a.prompt, music_length_ms: Math.round(a.duration! * 1000) } };
}

export const elevenlabsSound: AssetProvider = {
  id: 'elevenlabs-sound',
  kinds: ['sfx', 'music'],
  keyVar: 'ELEVENLABS_API_KEY',
  model: () => 'elevenlabs',
  async generate(a, work, { env, fetch }) {
    const q = request(a);
    const r = await fetch(q.url, { method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY!, 'content-type': 'application/json' }, body: JSON.stringify(q.body) });
    if (!r.ok) throw await httpError('elevenlabs', r);
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length < 100) throw new Error('elevenlabs: the response had no audio');
    const f = path.join(work, `${a.id}.mp3`);
    writeFileSync(f, buf);
    return f;
  },
};
