import { expect, test } from 'bun:test';
import { buildMix, type Events } from '../tools/mix-graph';

const ev: Events = { duration: 10, timeline: [{ id: 'a', start: 0, end: 4 }, { id: 'b', start: 4, end: 10 }], cues: [{ kind: 'tick', t: 1 }, { kind: 'tick', t: 1.05 }, { kind: 'tick', t: 5 }, { kind: 'boom', t: 2 }] };

test('voice only', () => {
  const g = buildMix({}, ev, 10, 0, '/p');
  expect(g.inputs).toEqual([]);
  expect(g.filter).toBe('[0:a]anull[voice];[voice]amix=inputs=1:normalize=0:duration=first,alimiter=limit=0.95[a]');
  expect(g.warnings).toEqual(["no sound for cue kind 'tick' in mix.json: skipped", "no sound for cue kind 'boom' in mix.json: skipped"]);
});

test('a music bed from a clip, ducked under the voice, and cues merged within minGap', () => {
  const g = buildMix({ music: [{ file: 'bed.mp3', from: 'b', db: -20 }], cues: { tick: { file: 't.wav', db: -6 } } }, ev, 10, 0, '/p');
  expect(g.inputs).toEqual(['-stream_loop', '-1', '-i', '/p/audio/bed.mp3', '-i', '/p/audio/t.wav']);
  expect(g.segments).toBe(1);
  expect(g.counts).toEqual(['2 tick']);
  const f = g.filter.split(';');
  expect(f[0]).toBe('[1:a]atrim=0:6.000,asetpts=PTS-STARTPTS,volume=-20dB,afade=t=in:d=0.4,afade=t=out:st=3.000:d=3,adelay=4000:all=1[m0]');
  expect(f).toContain('[0:a]asplit=2[voice][sc]');
  expect(f).toContain('[mraw][sc]sidechaincompress=threshold=0.03:ratio=4:attack=80:release=600[music]');
  expect(f).toContain('[2:a]volume=-6dB,asplit=2[c0_0][c0_1]');
  expect(f).toContain('[c0_0]adelay=1000:all=1[c0d0]');
  expect(f).toContain('[c0_1]adelay=5000:all=1[c0d1]');
  expect(f.at(-1)).toBe('[voice][music][c0]amix=inputs=3:normalize=0:duration=first,alimiter=limit=0.95[a]');
});

test('a partial render: times shift by --from, segments fade at the cut, cues outside are dropped', () => {
  const g = buildMix({ music: [{ file: 'bed.mp3' }], cues: { tick: { file: 't.wav' } } }, ev, 3, 3, '/p');
  const f = g.filter.split(';');
  expect(f[0]).toBe('[1:a]atrim=0:3.000,asetpts=PTS-STARTPTS,volume=-17dB,afade=t=in:d=1.5,afade=t=out:st=1.500:d=1.5,adelay=0:all=1[m0]');
  expect(g.counts).toEqual(['1 tick']);
  expect(f).toContain('[c0_0]adelay=2000:all=1[c0d0]');
});

test('an unknown clip in mix.json is an error', () => {
  expect(() => buildMix({ music: [{ file: 'x.mp3', from: 'zzz' }] }, ev, 10, 0, '/p')).toThrow("no timeline entry 'zzz'");
});
