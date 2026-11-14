// Narration: the script parser, the timing files, settings and cache keys, word refinement, the assembly of the
// track, and the hosted voices' requests and responses (against fixtures: no request leaves the machine).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { snapToPauses, timeScript } from '../tools/align-words';
import { joinFigures } from '../tools/align';
import { assemble } from '../tools/narration-files';
import { narrationAudioJSON, parseScript, plateText, plateWords, timing } from '../tools/script';
import { plateKey, resolveSettings } from '../tools/settings';
import { charsToWords, elevenlabs, request as elRequest } from '../tools/voices/elevenlabs';
import { fish, request as fishRequest } from '../tools/voices/fish';
import { voiceOf } from '../tools/voices';

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
    // 1 s of 10 ms frames: sound 0-0.3, pause 0.3-0.5, sound 0.5-0.9, a short dip at 0.7 (a stop consonant), quiet after
    const db = new Float32Array(100).map((_, i) => (i < 30 || (i >= 50 && i < 90 && i !== 70) ? -10 : -80));
    const out = snapToPauses([{ w: 'a', start: 0, end: 0.24 }, { w: 'b', start: 0.42, end: 0.7 }, { w: 'c', start: 0.7, end: 0.95 }], db);
    expect(out[0]!.end).toBe(0.3); // moved to where the pause begins
    expect(out[1]!.start).toBe(0.5); // a start in the pause moves to where sound begins
    expect(out[1]!.end).toBe(0.7); // the 10 ms dip is not a pause
    expect(out[2]!.end).toBe(0.9); // the end of a word before the trailing silence
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
    expect(a.pcm[0]).toBe(0); // faded in where the part starts
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
    const work = mkdtempSync(path.join(tmpdir(), 'reel-el-'));
    const [sp] = await v.synth([{ text: 'Hi, there. 3.5', speed: 1 }], work);
    expect((seen[0]!.init.headers as Record<string, string>)['xi-api-key']).toBe('secret');
    expect(readFileSync(sp!.file).subarray(0, 4).toString()).toBe('RIFF');
    expect(sp!.words!.map((w) => w.w)).toEqual(['Hi,', 'there.', '3.5']);
  });

  test('ElevenLabs and Fish: an HTTP error is one line with the service and its message', async () => {
    const f = (async () => new Response('{"detail":"quota exceeded"}', { status: 401 })) as unknown as typeof fetch;
    const work = mkdtempSync(path.join(tmpdir(), 'reel-err-'));
    await expect(elevenlabs.create('abc', { env: { ELEVENLABS_API_KEY: 'k' }, fetch: f }).synth([{ text: 'x', speed: 1 }], work)).rejects.toThrow('elevenlabs: HTTP 401: {"detail":"quota exceeded"}');
    await expect(fish.create('abc', { env: { FISH_API_KEY: 'k' }, fetch: f }).synth([{ text: 'x', speed: 1 }], work)).rejects.toThrow('fish: HTTP 401');
  });

  test('Fish: the request names the voice model and asks for WAV', async () => {
    const q = fishRequest('ref1', { text: 'Hello.', speed: 0.9, model: 's1' });
    expect(q.headers.model).toBe('s1');
    expect(q.body).toMatchObject({ text: 'Hello.', reference_id: 'ref1', format: 'wav', prosody: { speed: 0.9, volume: 0 } });
    const wav = Buffer.from('UklGRiQAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQAAAAA=', 'base64');
    let auth = '';
    const f = (async (_: string, init: RequestInit) => { auth = (init.headers as Record<string, string>).authorization!; return new Response(wav); }) as unknown as typeof fetch;
    const [sp] = await fish.create('ref1', { env: { FISH_API_KEY: 'fk' }, fetch: f }).synth([{ text: 'Hello.', speed: 1 }], mkdtempSync(path.join(tmpdir(), 'reel-fish-')));
    expect(auth).toBe('Bearer fk');
    expect(sp!.words).toBeUndefined(); // timed by the forced aligner
  });
});
