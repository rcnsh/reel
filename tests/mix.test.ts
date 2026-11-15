import { afterAll, expect, test } from 'bun:test';
import { buildMix, type Events } from '../tools/mix-graph';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { bundledSounds, soundFile } from '../tools/mix';
import { BUNDLED_SOUNDS } from '../src/config';
import { loudnessTarget, loudnormFilter, parseLoudnorm, STREAMING } from '../tools/loudness';
import { removeTempDirs, tempDir } from './helpers';

afterAll(removeTempDirs);

const ev: Events = { duration: 10, timeline: [{ id: 'a', start: 0, end: 4 }, { id: 'b', start: 4, end: 10 }], cues: [{ kind: 'tick', t: 1 }, { kind: 'tick', t: 1.05 }, { kind: 'tick', t: 5 }, { kind: 'boom', t: 2 }] };
const snd = (f: string) => `/p/audio/${f}`;
const FMT = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';

test('the track alone, read from its lossless file from the render start, padded to the video', () => {
  const g = buildMix({}, ev, 10, 0, '/p/audio/narration.flac', snd);
  expect(g.inputs).toEqual(['-ss', '0.000000', '-t', '10.000000', '-i', '/p/audio/narration.flac']);
  expect(g.filter).toBe(`[1:a]${FMT},asetnsamples=n=1024:p=0[voice];[voice]apad,atrim=0:10.000000,asetpts=PTS-STARTPTS[mixed]`);
  expect(g.warnings).toEqual(["no sound for cue kind 'tick' in mix.json: skipped", "no sound for cue kind 'boom' in mix.json: skipped"]);
  expect(g.silent).toBe(false);
});

test('a silent video with nothing to lay is silence of its length', () => {
  const g = buildMix({}, { ...ev, cues: [] }, 3, 0, null, snd);
  expect(g.silent).toBe(true);
  expect(g.filter).toBe('anullsrc=r=48000:cl=stereo,apad,atrim=0:3.000000,asetpts=PTS-STARTPTS[mixed]');
});

test('a music bed from a clip, ducked under the track, and cues merged within minGap', () => {
  const g = buildMix({ music: [{ file: 'bed.mp3', from: 'b', db: -20 }], cues: { tick: { file: 't.wav', db: -6 } } }, ev, 10, 0, '/v.flac', snd);
  expect(g.inputs).toEqual(['-ss', '0.000000', '-t', '10.000000', '-i', '/v.flac', '-stream_loop', '-1', '-i', '/p/audio/bed.mp3', '-i', '/p/audio/t.wav']);
  expect(g.counts).toEqual(['2 tick']);
  const f = g.filter.split(';');
  expect(f[0]).toBe(`[1:a]${FMT},asetnsamples=n=1024:p=0,asplit=2[voice][sc]`);
  expect(f[1]).toBe(`[2:a]${FMT},atrim=0:6.000,asetpts=PTS-STARTPTS,volume=-20dB,afade=t=in:d=0.4,afade=t=out:st=3.000:d=3,adelay=4000:all=1,asetnsamples=n=1024:p=0[m0]`);
  expect(f).toContain('[mraw][sc]sidechaincompress=threshold=0.03:ratio=4:attack=80:release=600[music]');
  expect(f).toContain(`[3:a]${FMT},volume=-6dB,asplit=2[c0_0][c0_1]`);
  expect(f).toContain('[c0_1]adelay=5000:all=1[c0d1]');
  expect(f.at(-1)).toBe('[voice][music][c0]amix=inputs=3:normalize=0:duration=longest,apad,atrim=0:10.000000,asetpts=PTS-STARTPTS[mixed]');
});

test('a partial render: the track and times shift by --from, segments fade at the cut, cues outside are dropped', () => {
  const g = buildMix({ music: [{ file: 'bed.mp3' }], cues: { tick: { file: 't.wav' } } }, ev, 3, 3, null, snd);
  const f = g.filter.split(';');
  expect(f[0]).toContain('atrim=0:3.000,asetpts=PTS-STARTPTS,volume=-17dB,afade=t=in:d=1.5,afade=t=out:st=1.500:d=1.5,adelay=0:all=1');
  expect(f[1]).toBe('[m0]anull[music]');
  expect(g.counts).toEqual(['1 tick']);
  expect(f).toContain('[c0d0]anull[c0]');
  expect(buildMix({}, ev, 3, 3, '/v.flac', snd).inputs.slice(0, 4)).toEqual(['-ss', '3.000000', '-t', '3.000000']);
});

test('an unknown clip in mix.json is an error', () => {
  expect(() => buildMix({ music: [{ file: 'x.mp3', from: 'zzz' }] }, ev, 10, 0, null, snd)).toThrow("no clip 'zzz'");
});

test('loudness: targets from mix.json, the measurement and the second pass', () => {
  expect(loudnessTarget(undefined)).toEqual(STREAMING);
  expect(loudnessTarget(false)).toBeNull();
  expect(loudnessTarget({ integrated: -16 })).toEqual({ integrated: -16, truePeak: -1, lra: 11 });
  expect(() => loudnessTarget({ integrated: 3 })).toThrow('loudness.integrated 3');
  expect(() => loudnessTarget({ peak: -1 })).toThrow("unknown key 'peak'");
  const m = parseLoudnorm('[Parsed_loudnorm_0 @ 0x1] \n{\n\t"input_i" : "-23.40",\n\t"input_tp" : "-5.10",\n\t"input_lra" : "6.20",\n\t"input_thresh" : "-33.90",\n\t"target_offset" : "0.30"\n}\n');
  expect(m).toEqual({ integrated: -23.4, truePeak: -5.1, lra: 6.2, threshold: -33.9, offset: 0.3 });
  expect(loudnormFilter(STREAMING, m)).toBe('loudnorm=I=-14:TP=-1:LRA=11:measured_I=-23.40:measured_TP=-5.10:measured_LRA=6.20:measured_thresh=-33.90:offset=0.30:linear=true,aresample=48000');
  expect(parseLoudnorm('{"input_i":"-inf","input_tp":"-inf","input_lra":"0.00","input_thresh":"-70.00","target_offset":"0.00"}').integrated).toBe(-Infinity);
});

test('mix.json can name a bundled cue sound; a project file of that name wins', () => {
  expect(bundledSounds().sort()).toEqual(['click', 'impact', 'pop', 'swell', 'tick', 'whoosh']);
  const root = tempDir('reel-snd-');
  expect(soundFile(root, 'whoosh')).toEndWith('sounds/whoosh.wav');
  expect(soundFile(root, 'reel:pop')).toEndWith('sounds/pop.wav');
  expect(() => soundFile(root, 'nope.wav')).toThrow('nor one of the bundled sounds');
  expect(existsSync(soundFile(root, 'tick.wav'))).toBe(true);
});

test('sounds on the timeline: trimmed to the render, faded at their own ends, at their rate, delayed to their start', () => {
  const sounds = [
    { file: 'door.wav', at: 2, db: -3, fadeOut: 0.5 },                       // to the end of its 1.5 s file
    { file: 'rain.flac', at: 3, duration: 20, loop: true, fadeIn: 1 },       // runs past the render's end
    { file: 'clip.mp4', at: 1, from: 4, speed: 2, duration: 2 },             // from 4 s into a video's sound, twice as fast
    { file: 'late.wav', at: 30 },                                            // after the render: not laid
  ];
  const len = (f: string) => (f.endsWith('door.wav') ? 1.5 : 60);
  const g = buildMix({}, { ...ev, cues: [], sounds }, 6, 1.5, null, snd, len);
  expect(g.inputs).toEqual(['-i', '/p/audio/door.wav', '-stream_loop', '-1', '-i', '/p/audio/rain.flac', '-i', '/p/audio/clip.mp4']);
  const parts = g.filter.split(';');
  // the door: 2 s on the timeline is 0.5 s into the render; its own fade out at its end
  expect(parts[0]).toBe(`[1:a]${FMT},atrim=start=0.000000,asetpts=PTS-STARTPTS,atrim=0:1.500000,asetpts=PTS-STARTPTS,volume=-3dB,afade=t=in:d=0.020,afade=t=out:st=1.000:d=0.500,adelay=500:all=1,asetnsamples=n=1024:p=0[s0]`);
  // rain is cut by the render's end (no fade out there), 4.5 s long from 1.5 s in
  expect(parts[1]).toContain('atrim=0:4.500000');
  expect(parts[1]).toContain('afade=t=in:d=1.000');
  expect(parts[1]).not.toContain('afade=t=out');
  // the clip started before the render: 0.5 s of it are gone, which is 1 s of its file at speed 2
  expect(parts[2]).toContain('atrim=start=5.000000,asetpts=PTS-STARTPTS,atempo=2,atrim=0:1.500000');
  expect(parts[2]).toContain('adelay=0:all=1');
  expect(g.counts).toEqual(['3 sounds on the timeline']);
});

test('a sound slower or faster than atempo takes in one step is a chain of atempo filters', () => {
  const sounds = [{ file: 'slow.mp4', at: 0, speed: 0.25, duration: 4 }, { file: 'fast.mp4', at: 0, speed: 6, duration: 1 }];
  const g = buildMix({}, { ...ev, cues: [], sounds }, 6, 0, null, snd, () => 60);
  const [slow, fast] = g.filter.split(';');
  expect(slow).toContain('atempo=0.5,atempo=0.5,atrim');
  expect(fast).toContain('atempo=2,atempo=2,atempo=1.5,atrim');
});

test('a sound names a file of the project, of its audio folder, or a bundled sound', () => {
  const root = tempDir('reel-snd-');
  expect([...bundledSounds()].sort()).toEqual([...BUNDLED_SOUNDS].sort());
  return Bun.write(path.join(root, 'clips/a.mp4'), 'x').then(() => {
    expect(soundFile(root, 'clips/a.mp4')).toBe(path.join(root, 'clips/a.mp4'));
    expect(soundFile(root, 'whoosh')).toMatch(/sounds\/whoosh\.wav$/);
    expect(() => soundFile(root, '../../etc/passwd')).toThrow();
  });
});
