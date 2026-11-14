// Generated assets: the manifest's checks, status and cache keys, the providers' requests, and a generation run
// against a mocked provider (no request leaves the machine).
import { describe, expect, test } from 'bun:test';
import { $ } from 'bun';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assetKey, parseManifest, statusOf, type AssetEntry } from '../tools/asset-manifest';
import { runAssets } from '../tools/assets';
import { request as elRequest } from '../tools/providers/elevenlabs-sound';
import { request as oaRequest, sizeFor } from '../tools/providers/openai-image';

const img: AssetEntry = { id: 'ridge', kind: 'image', prompt: 'A misty ridge', size: [1600, 900], out: 'assets/ridge.png' };
const sfx: AssetEntry = { id: 'whoosh', kind: 'sfx', prompt: 'A soft whoosh', duration: 1.2, out: 'audio/whoosh.mp3' };

describe('manifest', () => {
  test('entries are checked', () => {
    expect(parseManifest({ assets: [img, sfx] })).toHaveLength(2);
    expect(() => parseManifest({})).toThrow('expected { "assets"');
    expect(() => parseManifest({ assets: [img, img] })).toThrow("id 'ridge' is used twice");
    expect(() => parseManifest({ assets: [{ ...img, kind: 'video' }] })).toThrow('kind must be image, sfx or music');
    expect(() => parseManifest({ assets: [{ ...img, size: undefined }] })).toThrow('needs size');
    expect(() => parseManifest({ assets: [{ ...sfx, duration: 99 }] })).toThrow('needs duration');
    expect(() => parseManifest({ assets: [{ ...img, out: '../x.png' }] })).toThrow('inside the project');
    expect(() => parseManifest({ assets: [{ ...img, out: 'a/x.mp3' }] })).toThrow('must end in .png');
    expect(() => parseManifest({ assets: [{ ...img, seed: 1 }] })).toThrow("unknown key 'seed'");
  });

  test('a file is regenerated only when what made it changed, and a file someone provided is left alone', () => {
    const k = assetKey(img, 'm');
    expect(assetKey({ ...img, out: 'elsewhere.png' }, 'm')).toBe(k);
    expect(assetKey({ ...img, prompt: 'A sunny ridge' }, 'm')).not.toBe(k);
    expect(assetKey({ ...img, size: [800, 800] }, 'm')).not.toBe(k);
    expect(assetKey(img, 'other-model')).not.toBe(k);
    const key = () => k;
    expect(statusOf(img, false, {}, key)).toBe('missing');
    expect(statusOf(img, true, {}, key)).toBe('provided');
    expect(statusOf(img, true, { ridge: { key: k, out: img.out, model: 'm' } }, key)).toBe('generated');
    expect(statusOf(img, true, { ridge: { key: 'old', out: img.out, model: 'm' } }, key)).toBe('stale');
  });
});

describe('providers', () => {
  test('requests carry only the prompt and the size or duration', () => {
    expect(sizeFor([1600, 900])).toBe('1536x1024');
    expect(sizeFor([1080, 1920])).toBe('1024x1536');
    expect(sizeFor([1000, 1000])).toBe('1024x1024');
    expect(oaRequest('gpt-image-1', 'A misty ridge', [1600, 900])).toEqual({ model: 'gpt-image-1', prompt: 'A misty ridge', size: '1536x1024', n: 1, quality: 'high' });
    expect(elRequest(sfx)).toEqual({ url: 'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_192', body: { text: 'A soft whoosh', duration_seconds: 1.2, prompt_influence: 0.4 } });
    expect(elRequest({ ...sfx, kind: 'music', duration: 30 }).body).toEqual({ prompt: 'A soft whoosh', music_length_ms: 30000 });
  });

  test('without a key nothing is sent and the assets stay missing; with one, images are generated, fitted and recorded', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'reel-assets-'));
    writeFileSync(path.join(root, 'assets.json'), JSON.stringify({ assets: [img, sfx] }));
    const none = (async () => { throw new Error('no request may be made'); }) as unknown as typeof fetch;
    const rows = await runAssets(root, {}, { env: {}, fetch: none });
    expect(rows.map((r) => r.status)).toEqual(['missing', 'missing']);
    // a 64x32 PNG as the provider's answer
    const png = path.join(root, 'src.png');
    await $`ffmpeg -nostdin -loglevel error -f lavfi -i color=c=red:s=64x32 -frames:v 1 ${png}`;
    const b64 = readFileSync(png).toString('base64');
    let body: any = null;
    const f = (async (_: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return new Response(JSON.stringify({ data: [{ b64_json: b64 }] })); }) as unknown as typeof fetch;
    const got = await runAssets(root, {}, { env: { OPENAI_API_KEY: 'k' }, fetch: f });
    expect(body.prompt).toBe('A misty ridge');
    expect(got.map((r) => r.status)).toEqual(['generated', 'missing']);
    const dims = (await $`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 ${path.join(root, 'assets/ridge.png')}`.text()).trim();
    expect(dims).toBe('1600,900');
    const rec = JSON.parse(readFileSync(path.join(root, 'data/generated-assets.json'), 'utf8'));
    expect(rec.ridge.model).toBe('gpt-image-1');
    // unchanged: not generated again
    expect((await runAssets(root, {}, { env: { OPENAI_API_KEY: 'k' }, fetch: none }))[0]!.status).toBe('generated');
  });
});
