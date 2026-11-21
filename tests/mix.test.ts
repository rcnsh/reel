import { afterAll, expect, test } from 'bun:test';
import { buildMix, CUE_TRACK_INPUT as CUE_IN, cueBlock, duckFilter, FMT, type Events } from '../tools/mix-graph';
import { $ } from 'bun';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { bundledSounds, mixVideo, soundFile } from '../tools/mix';
import { BUNDLED_SOUNDS } from '../src/config';
import { linearGain, loudnessTarget, loudnormFilter, parseEbur128, parseLoudnorm, STREAMING } from '../tools/loudness';
import { removeTempDirs, tempDir } from './helpers';

afterAll(removeTempDirs);

const ev: Events = { duration: 10, timeline: [{ id: 'a', start: 0, end: 4 }, { id: 'b', start: 4, end: 10 }], cues: [{ kind: 'tick', t: 1 }, { kind: 'tick', t: 1.05 }, { kind: 'tick', t: 5 }, { kind: 'boom', t: 2 }] };
const snd = (f: string) => `/p/audio/${f}`;

test('the track alone, read from its lossless file from the render start, over silence of the video\'s length', () => {
  const g = buildMix({}, ev, 10, 0, '/p/audio/narration.flac', snd);
  expect(g.inputs).toEqual(['-ss', '0.000000', '-t', '10.000000', '-i', '/p/audio/narration.flac']);
  expect(g.filter).toBe(`[1:a]${FMT},asetnsamples=n=1024:p=0[voice];anullsrc=r=48000:cl=stereo,atrim=0:10.000000[silence];[silence][voice]amix=inputs=2:normalize=0:duration=first,atrim=0:10.000000,asetpts=PTS-STARTPTS[mixed]`);
  expect(g.warnings).toEqual(["no sound for cue kind 'tick' in mix.json: skipped", "no sound for cue kind 'boom' in mix.json: skipped"]);
  expect(g.silent).toBe(false);
});

test('a silent video with nothing to lay is silence of its length', () => {
  const g = buildMix({}, { ...ev, cues: [] }, 3, 0, null, snd);
  expect(g.silent).toBe(true);
  expect(g.filter).toBe('anullsrc=r=48000:cl=stereo,atrim=0:3.000000[mixed]');
});

test('a music bed from a clip, ducked under the track, and cues merged within minGap', () => {
  const g = buildMix({ music: [{ file: 'bed.mp3', from: 'b', db: -20 }], cues: { tick: { file: 't.wav', db: -6 } } }, ev, 10, 0, '/v.flac', snd);
  expect(g.inputs).toEqual(['-ss', '0.000000', '-t', '10.000000', '-i', '/v.flac', '-stream_loop', '-1', '-i', '/p/audio/bed.mp3', ...CUE_IN, '-i', 'cues-tick.f32']);
  expect(g.counts).toEqual(['2 tick']);
  const f = g.filter.split(';');
  expect(f[0]).toBe(`[1:a]${FMT},asetnsamples=n=1024:p=0,asplit=2[voice][sc]`);
  expect(f[1]).toBe(`[2:a]${FMT},atrim=0.000:6.000,asetpts=PTS-STARTPTS,volume=-20dB,afade=t=in:d=0.4,afade=t=out:st=3.000:d=3,adelay=4000:all=1,asetnsamples=n=1024:p=0[m0]`);
  expect(f).toContain('[mraw][sc]sidechaincompress=threshold=0.03:ratio=4:attack=80:release=600[music]');
  expect(f).toContain(`[3:a]${FMT}[c0]`);
  expect(g.cues).toEqual([{ kind: 'tick', file: '/p/audio/t.wav', gain: 10 ** (-6 / 20), offsets: [48000, 240000], track: 'cues-tick.f32' }]);
  expect(f.at(-1)).toBe('[silence][voice][music][c0]amix=inputs=4:normalize=0:duration=first,atrim=0:10.000000,asetpts=PTS-STARTPTS[mixed]');
});

test('a partial render: the track and times shift by --from, the bed plays from where it has got to, segments fade at the cut, cues outside are dropped', () => {
  const g = buildMix({ music: [{ file: 'bed.mp3' }], cues: { tick: { file: 't.wav' } } }, ev, 3, 3, null, snd);
  const f = g.filter.split(';');
  expect(f[0]).toContain('atrim=3.000:6.000,asetpts=PTS-STARTPTS,volume=-17dB,afade=t=in:d=1.5,afade=t=out:st=1.500:d=1.5,adelay=0:all=1');
  expect(f[1]).toBe('[m0]anull[music]');
  expect(g.counts).toEqual(['1 tick']);
  expect(g.cues[0]!.offsets).toEqual([2 * 48000]);
  expect(buildMix({}, ev, 3, 3, '/v.flac', snd).inputs.slice(0, 4)).toEqual(['-ss', '3.000000', '-t', '3.000000']);
});

test('a bed in a partial render: from where it entered, wrapped by its length when it loops, ended with its file when not', () => {
  const long: Events = { duration: 120, timeline: [{ id: 'a', start: 0, end: 50 }, { id: 'b', start: 50, end: 120 }], cues: [] };
  const at60 = (m: object, len = Infinity) => buildMix({ music: [{ file: 'bed.flac', ...m }] }, long, 30, 60, null, snd, () => len).filter.split(';')[0]!;
  expect(at60({})).toContain('atrim=60.000:90.000');
  expect(at60({}, 25)).toContain('atrim=10.000:40.000');
  expect(at60({ from: 'b' }, 25)).toContain('atrim=10.000:40.000');
  expect(at60({ at: 12 }, 1000)).toContain('atrim=48.000:78.000');
  const once = buildMix({ music: [{ file: 'bed.flac', from: 'b', loop: false }] }, long, 30, 60, null, snd, () => 35);
  expect(once.inputs).toEqual(['-i', '/p/audio/bed.flac']);
  expect(once.filter).toContain('atrim=10.000:35.000,asetpts=PTS-STARTPTS,volume=-17dB,afade=t=in:d=1.5,afade=t=out:st=24.600:d=0.4');
  expect(buildMix({ music: [{ file: 'bed.flac', loop: false }] }, long, 30, 60, null, snd, () => 35).segments).toBe(0);
});

test('a bed that starts at a time, not a clip', () => {
  const g = buildMix({ music: [{ file: 'bed.flac', at: 2.5 }] }, ev, 10, 0, null, snd);
  expect(g.filter.split(';')[0]).toContain('atrim=0.000:7.500,asetpts=PTS-STARTPTS,volume=-17dB,afade=t=in:d=0.4,afade=t=out:st=4.500:d=3,adelay=2500:all=1');
  expect(() => buildMix({ music: [{ file: 'bed.flac', at: 2, from: 'a' }] }, ev, 10, 0, null, snd)).toThrow('not both');
  expect(() => buildMix({ music: [{ file: 'bed.flac', at: -1 }] }, ev, 10, 0, null, snd)).toThrow('expected seconds');
  expect(() => buildMix({ music: [{ file: 'bed.flac', loop: 'false' as unknown as boolean }] }, ev, 10, 0, null, snd)).toThrow('expected true or false');
});

test('ducking: the defaults as before, settable in mix.json, or off', () => {
  expect(duckFilter(undefined)).toBe('sidechaincompress=threshold=0.03:ratio=4:attack=80:release=600');
  expect(duckFilter({ threshold: -20, ratio: 8, release: 300 })).toBe('sidechaincompress=threshold=0.1:ratio=8:attack=80:release=300');
  expect(duckFilter(false)).toBeNull();
  expect(() => duckFilter({ amount: 3 })).toThrow("unknown key 'amount'");
  expect(() => duckFilter({ ratio: 50 })).toThrow('duck.ratio 50');
  const g = buildMix({ music: [{ file: 'bed.flac' }], duck: { attack: 20 } }, ev, 10, 0, '/v.flac', snd).filter;
  expect(g).toContain('[mraw][sc]sidechaincompress=threshold=0.03:ratio=4:attack=20:release=600[music]');
  const off = buildMix({ music: [{ file: 'bed.flac' }], duck: false }, ev, 10, 0, '/v.flac', snd).filter;
  expect(off).not.toContain('sidechaincompress');
  expect(off).not.toContain('[sc]');
  expect(off).toContain('[m0]anull[music]');
});

test('a cue track: the sound at each offset, times its gain, overlaps summed, written a block at a time', () => {
  const src = new Float32Array([1, -1, 2, -2, 3, -3]);
  const whole = cueBlock(src, 0.5, [0, 2, 10], 0, 13);
  expect([...whole.slice(0, 10)]).toEqual([0.5, -0.5, 1, -1, 2, -2, 1, -1, 1.5, -1.5]);
  expect([...whole.slice(20)]).toEqual([0.5, -0.5, 1, -1, 1.5, -1.5]);
  const parts = [cueBlock(src, 0.5, [0, 2, 10], 0, 3), cueBlock(src, 0.5, [0, 2, 10], 3, 8), cueBlock(src, 0.5, [0, 2, 10], 11, 2)];
  expect([...parts.flatMap((p) => [...p])]).toEqual([...whole]);
});

test('the sum ends with silence of the video length, not with its parts', () => {
  const g = buildMix({ cues: { tick: { file: 't.wav' } } }, { ...ev, cues: [1, 2, 3].map((t) => ({ kind: 'tick', t })) }, 4, 0, null, snd);
  expect(g.filter).toEndWith('anullsrc=r=48000:cl=stereo,atrim=0:4.000000[silence];[silence][c0]amix=inputs=2:normalize=0:duration=first,atrim=0:4.000000,asetpts=PTS-STARTPTS[mixed]');
  expect(g.filter).not.toContain('apad');
});

test.skipIf(!Bun.which('ffmpeg'))('a silent video with several cues of a kind mixes to the video length, under the true-peak ceiling', async () => {
  const root = tempDir('reel-mix-cues-');
  const raw = path.join(root, 'raw.mp4'), out = path.join(root, 'mixed.mp4');
  await $`ffmpeg -nostdin -loglevel error -f lavfi -i color=s=64x64:r=30:d=4 -c:v libx264 -preset ultrafast ${raw}`.quiet();
  const events: Events = { duration: 4, timeline: [{ id: 'a', start: 0, end: 4 }], cues: [1, 2, 3].map((t) => ({ kind: 'tick', t })) };
  const r = await mixVideo({ root, input: raw, output: out, events });
  expect(r.summary).toContain('3 tick');
  expect(r.loudness!.truePeak).toBeLessThanOrEqual(-0.9);
  const audioDur = Number((await $`ffprobe -v error -select_streams a -show_entries stream=duration -of csv=p=0 ${out}`.text()).trim());
  expect(Math.abs(audioDur - 4)).toBeLessThan(0.022);
}, 30_000);

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

test('ebur128: the last running values are the whole file, and a linear gain where the peak and range allow', () => {
  const frame = (I: number, tp: number) => `frame:9 pts:1 pts_time:0.1\nlavfi.r128.M=-20.1\nlavfi.r128.I=${I}\nlavfi.r128.LRA=3.250\nlavfi.r128.true_peaks_ch0=${tp}\nlavfi.r128.true_peak=${tp}\n`;
  const m = parseEbur128(frame(-30, 0.1) + frame(-23.456, 0.5));
  expect(m.integrated).toBe(-23.456);
  expect(m.lra).toBe(3.25);
  expect(m.truePeak).toBeCloseTo(-6.0206, 3);
  expect(parseEbur128(frame(-70, 0)).integrated).toBe(-Infinity);
  expect(() => parseEbur128('nothing')).toThrow('no loudness measurement');
  expect(linearGain(STREAMING, { integrated: -20, truePeak: -8, lra: 5 })).toBe(6);
  expect(linearGain(STREAMING, { integrated: -20, truePeak: -6, lra: 5 })).toBeNull();
  expect(linearGain(STREAMING, { integrated: -20, truePeak: -20, lra: 15 })).toBeNull();
  expect(linearGain(STREAMING, { integrated: -Infinity, truePeak: -Infinity, lra: 0 })).toBe(0);
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
    { file: 'door.wav', at: 2, db: -3, fadeOut: 0.5 },
    { file: 'rain.flac', at: 3, duration: 20, loop: true, fadeIn: 1 },
    { file: 'clip.mp4', at: 1, from: 4, speed: 2, duration: 2 },
    { file: 'late.wav', at: 30 },
  ];
  const len = (f: string) => (f.endsWith('door.wav') ? 1.5 : 60);
  const g = buildMix({}, { ...ev, cues: [], sounds }, 6, 1.5, null, snd, len);
  expect(g.inputs).toEqual(['-i', '/p/audio/door.wav', '-stream_loop', '-1', '-i', '/p/audio/rain.flac', '-i', '/p/audio/clip.mp4']);
  const parts = g.filter.split(';');
  expect(parts[0]).toBe(`[1:a]${FMT},atrim=start=0.000000,asetpts=PTS-STARTPTS,atrim=0:1.500000,asetpts=PTS-STARTPTS,volume=-3dB,afade=t=in:d=0.020,afade=t=out:st=1.000:d=0.500,adelay=500:all=1,asetnsamples=n=1024:p=0[s0]`);
  expect(parts[1]).toContain('atrim=0:4.500000');
  expect(parts[1]).toContain('afade=t=in:d=1.000');
  expect(parts[1]).not.toContain('afade=t=out');
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
