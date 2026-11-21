import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fetchRetry } from '../http';
import type { AssetProvider } from './provider';

export const API = 'https://api.openai.com/v1/images/generations';

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
  async generate(a, work, ctx) {
    const { env } = ctx;
    const j = await fetchRetry('openai', ctx, API, { method: 'POST', headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(request(this.model(env), a.prompt, a.size!)) }, (r) => r.json() as Promise<{ data?: { b64_json?: string }[] }>);
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) throw new Error('openai: the response had no image');
    const f = path.join(work, `${a.id}.png`);
    writeFileSync(f, Buffer.from(b64, 'base64'));
    return f;
  },
};
