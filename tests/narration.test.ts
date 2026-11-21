import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { snapToPauses, timeScript } from '../tools/align-words';
import { joinFigures } from '../tools/align';
import { assemble } from '../tools/narration-files';
import { narrationAudioJSON, parseScript, plateText, plateWords, timing } from '../tools/script';
import { plateKey, resolveSettings } from '../tools/settings';
import { charsToWords, elevenlabs, request as elRequest } from '../tools/voices/elevenlabs';
import { fish, request as fishRequest } from '../tools/voices/fish';
import { voiceOf, type Speech } from '../tools/voices';
import { fetchRetry, retryAfter } from '../tools/http';
import { narrate } from '../tools/narrate';
import { fixture, removeTempDirs, tempDir } from './helpers';

afterAll(removeTempDirs);

describe('script', () => {
  test('plates, comments and spacing', () => {
    const p = parseScript('# intro\nOne  two.\n// a note\n\nThree.\n# end-2\nFour.\n');
    expect(p).toEqual([{ name: 'intro', lines: ['One two.', 'Three.'] }, { name: 'end-2', lines: ['Four.'] }]);
    expect(plateText(p[0]!)).toBe('One two. Three.');
    expect(plateWords(p[0]!)).toEqual([{ w: 'One', line: 0 }, { w: 'two.', line: 0 }, { w: 'Three.', line: 1 }]);
  });

  test('mistakes name their line', () => {
    expect(() => parseScript('hello\n# a\nx')).toThrow('narration.txt:1: text before the first');
    expect(() => parseScript('# a\nx\n# a\ny')).toThrow("narration.txt:3: plate 'a' appears twice");
    expect(() => parseScript('# a b\nx')).toThrow("plate name 'a b'");
    expect(() => parseScript('# a\n# b\ny')).toThrow("plate 'a' has no lines");
    expect(() => parseScript('')).toThrow('no plates');
  });

  test('timing: lines from their words, sections cut just before each plate', () => {
    const plates = parseScript('# a\nOne two.\nThree.\n# b\nFour.');
    const t = timing(plates, [[{ w: 'One', start: 0.6, end: 0.9 }, { w: 'two.', start: 1, end: 1.3 }, { w: 'Three.', start: 1.6, end: 2 }], [{ w: 'Four.', start: 3, end: 3.5 }]], 5.1);
    expect(t.lines.map((l) => [l.plate, l.text, l.start, l.end])).toEqual([['a', 'One two.', 0.6, 1.3], ['a', 'Three.', 1.6, 2], ['b', 'Four.', 3, 3.5]]);
    expect(t.sections).toEqual([{ name: 'a', start: 0, end: 2.75 }, { name: 'b', start: 2.75, end: 5.1 }]);
    expect(() => timing(plates, [[], []], 5)).toThrow("plate 'a': 0 timed words for 3 script words");
    const a = narrationAudioJSON(1.25, t.sections, 'audio/narration.flac', 'n');
    expect(a.beats).toEqual([0, 0.6, 1.2]);
    expect(a.track).toBe('audio/narration.flac');
  });
});

describe('settings', () => {
  test('defaults, then the config, then flags', () => {
    expect(resolveSettings(undefined, {})).toMatchObject({ voice: 'kokoro:af_heart', speed: 1, lead: 0.6, hold: 0.85, tail: 1.6 });
    expect(resolveSettings({ voice: 'say', hold: 2 }, { hold: '0.5', speed: '1.1' })).toMatchObject({ voice: 'say', hold: 0.5, speed: 1.1 });
    expect(() => resolveSettings({ voise: 'x' } as never, {})).toThrow('narration.voise is not a setting');
    expect(() => resolveSettings(undefined, { speed: 'fast' })).toThrow('speed fast');
    expect(() => resolveSettings(undefined, { tail: '-1' })).toThrow('tail -1');
  });

  test('a plate is voiced again only when its text, voice, speed or model change', () => {
    const s = resolveSettings(undefined, {});
    const k = plateKey('kokoro:af_heart', s, 'Hello.');
    expect(plateKey('kokoro:af_heart', { ...s, hold: 3, lead: 0 }, 'Hello.')).toBe(k);
    expect(plateKey('kokoro:af_heart', s, 'Hello!')).not.toBe(k);
    expect(plateKey('kokoro:bm_george', s, 'Hello.')).not.toBe(k);
    expect(plateKey('kokoro:af_heart', { ...s, speed: 1.1 }, 'Hello.')).not.toBe(k);
    expect(plateKey('kokoro:af_heart', { ...s, model: 'm' }, 'Hello.')).not.toBe(k);
    expect(plateKey('kokoro:af_heart', { ...s, language: 'French' }, 'Hello.')).not.toBe(k);
  });
});

describe('words', () => {
  test('script words take the times of the tokens they match, whatever their spelling', () => {
    const t = timeScript([{ w: 'It' }, { w: 'costs' }, { w: '3.5' }, { w: 'million.' }], [{ w: 'It', start: 0, end: 0.2 }, { w: 'costs', start: 0.2, end: 0.6 }, { w: '35', start: 0.7, end: 1.2 }, { w: 'million', start: 1.3, end: 1.7 }], 0, 2);
    expect(t.map((x) => x.start)).toEqual([0, 0.2, 0.7, 1.3]);
  });

  test('edges move onto pauses; continuous speech is left alone; words never overlap', () => {
    const db = new Float32Array(100).map((_, i) => (i < 30 || (i >= 50 && i < 90 && i !== 70) ? -10 : -80));
    const out = snapToPauses([{ w: 'a', start: 0, end: 0.24 }, { w: 'b', start: 0.42, end: 0.7 }, { w: 'c', start: 0.7, end: 0.95 }], db);
    expect(out[0]!.end).toBe(0.3);
    expect(out[1]!.start).toBe(0.5);
    expect(out[1]!.end).toBe(0.7);
    expect(out[2]!.end).toBe(0.9);
    const o2 = snapToPauses([{ w: 'x', start: 0.1, end: 0.6 }, { w: 'y', start: 0.5, end: 0.8 }], db);
    expect(o2[0]!.end).toBeLessThanOrEqual(o2[1]!.start);
  });

  test('Whisper figures are joined', () => {
    expect(joinFigures([{ w: '152', s: 1, e: 1.2 }, { w: ',000', s: 1.2, e: 1.5 }, { w: 'people', s: 1.6, e: 2 }])).toEqual([{ w: '152,000', start: 1, end: 1.5 }, { w: 'people', start: 1.6, end: 2 }]);
  });
});

describe('assembly', () => {
  const SR = 48000, part = (sec: number, w0: number, w1: number) => ({ pcm: new Float32Array(Math.round(sec * SR)).fill(0.5), words: [{ w: 'x', start: w0, end: w1 }] });
  test('lead before the first word, hold between plates counting the silence parts already have, tail after the last', () => {
    const a = assemble([part(1, 0.1, 0.9), part(2, 0.2, 1.5)], { lead: 0.6, hold: 1, tail: 2 });
    expect(a.words[0]![0]!.start).toBeCloseTo(0.6, 4);
    expect(a.words[1]![0]!.start - a.words[0]![0]!.end).toBeCloseTo(1, 3);
    expect(a.duration - a.words[1]![0]!.end).toBeCloseTo(2, 3);
  });
  test('a part that already has more silence than asked gets none added', () => {
    const a = assemble([part(1, 0.8, 0.9)], { lead: 0.2, hold: 1, tail: 0 });
    expect(a.words[0]![0]!.start).toBeCloseTo(0.8, 4);
    expect(a.pcm[0]).toBe(0);
  });
});

describe('voices', () => {
  const env = { env: {} as Record<string, string | undefined>, fetch: (() => { throw new Error('no network in tests'); }) as unknown as typeof fetch };

  test('--voice names a source and its argument; hosted ones need their key', () => {
    expect(voiceOf('kokoro', env).id).toBe('kokoro:af_heart');
    expect(voiceOf('kokoro:bm_george', env).id).toBe('kokoro:bm_george');
    expect(() => voiceOf('kokoro:zz', env)).toThrow('English Kokoro voice');
    expect(() => voiceOf('piper:x', env)).toThrow("voice 'piper:x': expected kokoro");
    expect(() => voiceOf('elevenlabs:abc', env)).toThrow('ELEVENLABS_API_KEY is not set');
    expect(() => voiceOf('fish:abc', env)).toThrow('FISH_API_KEY is not set');
    expect(() => voiceOf('elevenlabs', { ...env, env: { ELEVENLABS_API_KEY: 'k' } })).toThrow('needs a voice id');
  });

  test('ElevenLabs: character times become word times', () => {
    const fx = JSON.parse(readFileSync(path.join(import.meta.dir, 'fixtures/elevenlabs-with-timestamps.json'), 'utf8'));
    expect(charsToWords(fx.alignment)).toEqual([{ w: 'Hi,', start: 0, end: 0.18 }, { w: 'there.', start: 0.21, end: 0.5 }, { w: '3.5', start: 0.7, end: 1.2 }]);
  });

  test('ElevenLabs: the request carries only the text, its context and the voice settings', () => {
    const q = elRequest('voice/1', { text: 'Hello.', previous: 'Before.', speed: 1.5 });
    expect(q.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice%2F1/with-timestamps?output_format=wav_24000');
    expect(q.body).toEqual({ text: 'Hello.', model_id: 'eleven_multilingual_v2', voice_settings: { speed: 1.2 }, previous_text: 'Before.' });
  });

  test('ElevenLabs: a response is written as audio with its words', async () => {
    const fx = readFileSync(path.join(import.meta.dir, 'fixtures/elevenlabs-with-timestamps.json'), 'utf8');
    const seen: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(fx, { headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch;
    const v = elevenlabs.create('abc', { env: { ELEVENLABS_API_KEY: 'secret' }, fetch: f });
    const work = tempDir('reel-el-');
    const got: Speech[] = [];
    await v.synth([{ text: 'Hi, there. 3.5', speed: 1 }], work, async (_, sp) => { got.push(sp); });
    const sp = got[0];
    expect((seen[0]!.init.headers as Record<string, string>)['xi-api-key']).toBe('secret');
    expect(readFileSync(sp!.file).subarray(0, 4).toString()).toBe('RIFF');
    expect(sp!.words!.map((w) => w.w)).toEqual(['Hi,', 'there.', '3.5']);
  });

  test('ElevenLabs and Fish: an HTTP error is one line with the service and its message', async () => {
    const f = (async () => new Response('{"detail":"quota exceeded"}', { status: 401 })) as unknown as typeof fetch;
    const work = tempDir('reel-err-');
    const none = async () => {};
    await expect(elevenlabs.create('abc', { env: { ELEVENLABS_API_KEY: 'k' }, fetch: f }).synth([{ text: 'x', speed: 1 }], work, none)).rejects.toThrow('elevenlabs: HTTP 401: {"detail":"quota exceeded"}');
    await expect(fish.create('abc', { env: { FISH_API_KEY: 'k' }, fetch: f }).synth([{ text: 'x', speed: 1 }], work, none)).rejects.toThrow('fish: HTTP 401');
  });

  test('Fish: the request names the voice model and asks for WAV', async () => {
    const q = fishRequest('ref1', { text: 'Hello.', speed: 0.9, model: 's1' });
    expect(q.headers.model).toBe('s1');
    expect(q.body).toMatchObject({ text: 'Hello.', reference_id: 'ref1', format: 'wav', prosody: { speed: 0.9, volume: 0 } });
    const wav = Buffer.from('UklGRiQAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQAAAAA=', 'base64');
    let auth = '';
    const f = (async (_: string, init: RequestInit) => { auth = (init.headers as Record<string, string>).authorization!; return new Response(wav); }) as unknown as typeof fetch;
    let sp: Speech | undefined;
    await fish.create('ref1', { env: { FISH_API_KEY: 'fk' }, fetch: f }).synth([{ text: 'Hello.', speed: 1 }], tempDir('reel-fish-'), async (_, x) => { sp = x; });
    expect(auth).toBe('Bearer fk');
    expect(sp!.words).toBeUndefined();
  });
});

describe('hosted requests retry', () => {
  const scripted = (answers: (() => Response)[]) => {
    let n = 0;
    const f = (async () => answers[Math.min(n++, answers.length - 1)]!()) as unknown as typeof fetch;
    return { f, calls: () => n };
  };
  const ok = () => new Response('{"ok":true}');
  const fail = (status: number, body = '', headers: Record<string, string> = {}) => () => new Response(body, { status, headers });
  const offline = (msg: string) => () => { throw new TypeError(msg); };
  const cutOff = () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"audio')); c.error(new Error('socket closed')); } }));
  const json = (r: Response) => r.json();

  test('429, 5xx and network errors are retried, after Retry-After when sent, else backing off', async () => {
    const waits: number[] = [];
    const s = scripted([fail(429, 'slow down', { 'retry-after': '2' }), fail(503), offline('connection reset'), ok]);
    expect(await fetchRetry('svc', { fetch: s.f, sleep: async (ms: number) => { waits.push(ms); } }, 'https://x', {}, json)).toEqual({ ok: true });
    expect(s.calls()).toBe(4);
    expect(waits).toEqual([2000, 2000, 4000]);
  });

  test('a request that succeeded is not sent again, even when its body cannot be read (it was billed)', async () => {
    const s = scripted([cutOff, ok]);
    await expect(fetchRetry('svc', { fetch: s.f, sleep: async () => {} }, 'https://x', {}, json)).rejects.toThrow('svc: the response could not be read: socket closed');
    expect(s.calls()).toBe(1);
  });

  test('a client error is not retried; a lasting failure gives up with the last error; a long Retry-After fails at once', async () => {
    const sleep = async () => {};
    const a = scripted([fail(401, 'bad key')]);
    await expect(fetchRetry('svc', { fetch: a.f, sleep }, 'https://x', {}, json)).rejects.toThrow('svc: HTTP 401: bad key');
    expect(a.calls()).toBe(1);
    const b = scripted([fail(502, 'down')]);
    await expect(fetchRetry('svc', { fetch: b.f, sleep }, 'https://x', {}, json)).rejects.toThrow('svc: HTTP 502: down');
    expect(b.calls()).toBe(5);
    const c = scripted([offline('offline')]);
    await expect(fetchRetry('svc', { fetch: c.f, sleep }, 'https://x', {}, json)).rejects.toThrow('svc: offline (after 5 attempts)');
    const d = scripted([fail(429, 'quota', { 'retry-after': '3600' })]);
    await expect(fetchRetry('svc', { fetch: d.f, sleep }, 'https://x', {}, json)).rejects.toThrow('svc: HTTP 429: quota (it asks to wait 3600 s: try again later)');
    expect(d.calls()).toBe(1);
  });

  test('Retry-After: seconds or a date', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(retryAfter('3', now)).toBe(3000);
    expect(retryAfter('Thu, 01 Jan 2026 00:00:10 GMT', now)).toBe(10_000);
    expect(retryAfter('Wed, 31 Dec 2025 00:00:10 GMT', now)).toBe(0);
    expect(retryAfter('soon', now)).toBeUndefined();
    expect(retryAfter(null, now)).toBeUndefined();
  });
});

describe('narrate: the plate cache with a hosted voice', () => {
  const voiced: string[] = [];
  let failOn = -1, throttleOnce = false;
  const speech = (text: string) => {
    const SR = 24000, words = text.split(' '), chars: string[] = [], starts: number[] = [], ends: number[] = [];
    const pcm = new Int16Array(Math.round((0.1 + words.length * 0.35) * SR));
    words.forEach((w, i) => {
      const t0 = 0.1 + i * 0.35;
      for (let n = Math.round(t0 * SR); n < Math.round((t0 + 0.25) * SR); n++) pcm[n] = Math.round(8000 * Math.sin((2 * Math.PI * 220 * n) / SR));
      if (i) { chars.push(' '); starts.push(t0 - 0.1); ends.push(t0); }
      [...w].forEach((c, j) => { chars.push(c); starts.push(t0 + (0.25 * j) / w.length); ends.push(t0 + (0.25 * (j + 1)) / w.length); });
    });
    const head = Buffer.alloc(44);
    head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.byteLength, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16);
    head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
    head.write('data', 36); head.writeUInt32LE(pcm.byteLength, 40);
    const audio = Buffer.concat([head, Buffer.from(pcm.buffer)]).toString('base64');
    return JSON.stringify({ audio_base64: audio, alignment: { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends } });
  };
  const waits: number[] = [];
  const ctx = {
    env: { ELEVENLABS_API_KEY: 'k' },
    sleep: async (ms: number) => { waits.push(ms); },
    fetch: (async (_: string, init: RequestInit) => {
      const text = JSON.parse(String(init.body)).text as string;
      if (throttleOnce) { throttleOnce = false; return new Response('busy', { status: 429, headers: { 'retry-after': '1' } }); }
      if (voiced.length === failOn) return new Response('{"detail":"quota exceeded"}', { status: 401 });
      voiced.push(text);
      return new Response(speech(text));
    }) as unknown as typeof fetch,
  };
  const project = () => {
    const p = fixture('narrate', {
      'reel.config.ts': "import { defineVideo } from 'reel/config';\nexport default defineVideo({ narration: { voice: 'elevenlabs:test' }, timeline: () => [] });\n",
      'narration.txt': '# a\nOne two.\n# b\nThree four.\n# c\nFive six.\n',
    });
    afterAll(p.cleanup);
    return p.dir;
  };
  const cached = (root: string) => readdirSync(path.join(root, 'audio/.narration')).filter((f) => f !== 'work').sort();
  const reset = () => { voiced.length = 0; waits.length = 0; failOn = -1; throttleOnce = false; };

  test('voiced once; a re-run is all hits; an edited plate is voiced again and its old files removed', async () => {
    const root = project();
    reset();
    expect(await narrate(root, {}, ctx)).toContain('3 of 3 plates voiced (elevenlabs:test), 0 from the cache');
    expect(voiced).toEqual(['One two.', 'Three four.', 'Five six.']);
    const first = cached(root);
    expect(first.map((f) => f.replace(/-[^.]+/, ''))).toEqual(['a.flac', 'a.json', 'b.flac', 'b.json', 'c.flac', 'c.json']);
    expect(JSON.parse(readFileSync(path.join(root, 'data/words.json'), 'utf8')).lines.map((l: { text: string }) => l.text)).toEqual(['One two.', 'Three four.', 'Five six.']);

    reset();
    expect(await narrate(root, {}, ctx)).toContain('0 of 3 plates voiced (elevenlabs:test), 3 from the cache');
    expect(voiced).toEqual([]);

    writeFileSync(path.join(root, 'narration.txt'), '# a\nOne two.\n# b\nThree five.\n# c\nFive six.\n');
    reset();
    expect(await narrate(root, {}, ctx)).toContain('1 of 3 plates voiced');
    expect(voiced).toEqual(['Three five.']);
    const now = cached(root);
    expect(now.length).toBe(6);
    expect(now.filter((f) => f.startsWith('b-'))).not.toEqual(first.filter((f) => f.startsWith('b-')));
    for (const f of first.filter((f) => f.startsWith('b-'))) expect(existsSync(path.join(root, 'audio/.narration', f))).toBe(false);
  });

  test('a failure on plate 3 keeps plates 1 and 2; the re-run voices only plate 3', async () => {
    const root = project();
    reset(); failOn = 2;
    await expect(narrate(root, {}, ctx)).rejects.toThrow('elevenlabs: HTTP 401');
    expect(voiced).toEqual(['One two.', 'Three four.']);
    expect(cached(root).map((f) => f.replace(/-[^.]+/, ''))).toEqual(['a.flac', 'a.json', 'b.flac', 'b.json']);
    expect(existsSync(path.join(root, 'data/words.json'))).toBe(false);

    reset();
    expect(await narrate(root, {}, ctx)).toContain('1 of 3 plates voiced (elevenlabs:test), 2 from the cache');
    expect(voiced).toEqual(['Five six.']);
  });

  test('a plate whose audio is missing (a run stopped between its two files) is voiced again', async () => {
    const root = project();
    reset();
    await narrate(root, {}, ctx);
    for (const f of cached(root).filter((f) => f.startsWith('b-') && f.endsWith('.flac'))) rmSync(path.join(root, 'audio/.narration', f));
    reset();
    expect(await narrate(root, {}, ctx)).toContain('1 of 3 plates voiced');
    expect(voiced).toEqual(['Three four.']);
    expect(cached(root).length).toBe(6);
  });

  test('a 429 is waited out and retried', async () => {
    const root = project();
    reset(); throttleOnce = true;
    expect(await narrate(root, {}, ctx)).toContain('3 of 3 plates voiced');
    expect(voiced).toEqual(['One two.', 'Three four.', 'Five six.']);
    expect(waits).toEqual([1000]);
  });
});
