// Images from OpenAI's image API (OPENAI_API_KEY; model gpt-image-1 unless REEL_IMAGE_MODEL names another):
// one synchronous request per image, the size nearest the asset's aspect, then fitted to the asset by reel assets.
// Only the prompt is sent.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { httpError } from '../voices/voice';
import type { AssetProvider } from './provider';

export const API = 'https://api.openai.com/v1/images/generations';

/** The API size nearest an aspect ratio. */
export function sizeFor([w, h]: [number, number]) {
  const r = w / h;
  return r > 1.2 ? '1536x1024' : r < 1 / 1.2 ? '1024x1536' : '1024x1024';
}

export function request(model: string, prompt: string, size: [number, number]) {
  return { model, prompt, size: sizeFor(size), n: 1, quality: 'high' };
}

export const openaiImage: AssetProvider = {
  id: 'openai-image',
  kinds: ['image'],
  keyVar: 'OPENAI_API_KEY',
  model: (env) => env.REEL_IMAGE_MODEL || 'gpt-image-1',
  async generate(a, work, { env, fetch }) {
    const r = await fetch(API, { method: 'POST', headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(request(this.model(env), a.prompt, a.size!)) });
    if (!r.ok) throw await httpError('openai', r);
    const j = await r.json() as { data?: { b64_json?: string }[] };
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) throw new Error('openai: the response had no image');
    const f = path.join(work, `${a.id}.png`);
    writeFileSync(f, Buffer.from(b64, 'base64'));
    return f;
  },
};
