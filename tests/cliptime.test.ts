import { expect, test } from 'bun:test';
import { clipTime, sceneRate, sceneTime, statefulBlocker, videoSound, videoTime } from '../src/engine/cliptime';

const clip = (o: Record<string, unknown> = {}) => ({ id: 'c', start: 2, end: 6, ...o });
const close = (a: number | null, b: number) => expect(a).toBeCloseTo(b, 9);

test('clipTime: a clip without remapping is the identity, its window its own', () => {
  const m = clipTime(clip(), 60);
  expect(m.identity).toBe(true);
  expect(m.length).toBe(4);
  expect(sceneTime(m, 3.25)).toBe(1.25);
  expect(videoTime(m, 1.25)).toBe(3.25);
  expect(sceneRate(m, 3)).toBe(1);
});

test('speed and offset: the scene runs faster from partway in, its window stretched to match', () => {
  const m = clipTime(clip({ speed: 2, offset: 1 }), 60);
  expect(m.identity).toBe(false);
  expect(m.length).toBe(9); // 1 + 4 x 2
  close(sceneTime(m, 2), 1);
  close(sceneTime(m, 4), 5);
  // (a sub-frame's shutter offset maps too: the shutter covers twice the scene time)
  close(sceneTime(m, 4 + 0.004) - sceneTime(m, 4 - 0.004), 0.016);
  close(videoTime(m, 5), 4);
  expect(videoTime(m, 0.5)).toBeNull(); // before the offset
  expect(videoTime(m, 9)).toBeNull(); // the window's end is never shown
  expect(sceneRate(m, 3)).toBe(2);
  const slow = clipTime(clip({ speed: 0.5 }), 30);
  close(sceneTime(slow, 6), 2);
});

test('reverse: the forward clip\'s frames in the opposite order', () => {
  const fps = 30, fwd = clipTime(clip({ speed: 1.5, offset: 0.5 }), fps), rev = clipTime(clip({ speed: 1.5, offset: 0.5, reverse: true }), fps);
  const n = 4 * fps;
  const frames = (m: typeof fwd) => Array.from({ length: n }, (_, k) => sceneTime(m, 2 + k / fps));
  const f = frames(fwd), r = frames(rev);
  for (let k = 0; k < n; k++) close(r[k]!, f[n - 1 - k]!);
  expect(rev.length).toBe(fwd.length);
  expect(sceneRate(rev, 3)).toBe(-1.5);
  // (later in the shutter is earlier in the scene: reversed motion blurs back along its path)
  expect(sceneTime(rev, 3.01)).toBeLessThan(sceneTime(rev, 3));
  // a cue lands where the reversed clip passes its moment
  close(videoTime(rev, f[10]!), 2 + (n - 1 - 10) / fps);
  // one at the scene's end, past the last frame shown, lands at the reversed clip's start, as forward it lands at its end
  close(videoTime(rev, rev.length - 0.01), 2);
  expect(videoTime(fwd, fwd.length - 0.01)).not.toBeNull();
  expect(videoTime(rev, rev.length + 0.1)).toBeNull();
  expect(videoTime(rev, 0.4)).toBeNull(); // before the offset
  // the late sub-frames of the last frame stop at the scene's start rather than run before it
  const r0 = clipTime(clip({ reverse: true }), fps);
  expect(sceneTime(r0, 6 - 1 / fps + 0.25 / fps)).toBe(0);
  close(sceneTime(r0, 6 - 1 / fps), 0);
});

test('reverse off the frame grid: still the forward frames, last first', () => {
  const fps = 30, o = { id: 'w', start: 2.01, end: 3, speed: 1.25, offset: 0.3 };
  const fwd = clipTime(o, fps), rev = clipTime({ ...o, reverse: true }, fps);
  // the output frames inside the clip: 61/30 .. 89/30
  const ts = Array.from({ length: 29 }, (_, k) => (61 + k) / fps);
  const f = ts.map((t) => sceneTime(fwd, t)), r = ts.map((t) => sceneTime(rev, t));
  for (let k = 0; k < ts.length; k++) close(r[k]!, f[ts.length - 1 - k]!);
  // (late sub-frames of the last frame stop at the offset, the least the clip plays)
  expect(sceneTime(clipTime({ id: 'g', start: 2, end: 3, offset: 2, reverse: true }, fps), 3 - 0.75 / fps)).toBe(2);
  // a hold off the grid holds the last frame the forward run shows
  const held = clipTime({ ...o, end: 4, hold: 1 }, fps);
  close(sceneTime(held, 3.6), f.at(-1)!);
  expect(() => clipTime({ id: 'x', start: 2.01, end: 2.03, reverse: true }, fps)).toThrow('plays no whole frame');
});

test('hold: the clip plays, then shows its last frame played', () => {
  const fps = 60, m = clipTime(clip({ hold: 1 }), fps);
  expect(m.length).toBe(3);
  const last = sceneTime(m, 5 - 1 / fps); // the last frame of the part played
  close(last, 3 - 1 / fps);
  close(sceneTime(m, 5.5), last);
  close(sceneTime(m, 6), last);
  expect(sceneRate(m, 5.5)).toBe(0);
  expect(sceneRate(m, 4)).toBe(1);
  // (the last frame played still moves; the one after it is held)
  expect(sceneRate(m, 5 - 1 / fps)).toBe(1);
  expect(sceneRate(m, 5)).toBe(0);
  // (a cue between the last frame played and the hold lands where it falls, as a sound would)
  close(videoTime(m, 2.999), 4.999);
  expect(videoTime(m, 3)).toBeNull();
  close(videoTime(m, 1), 3);
  // reversed and held: the reversed run, then its last frame (the scene's offset)
  const r = clipTime(clip({ hold: 1, reverse: true }), fps);
  close(sceneTime(r, 2), 3 - 1 / fps);
  close(sceneTime(r, 5.7), 0);
});

test('freeze: one moment of the window for the whole clip', () => {
  const m = clipTime(clip({ freeze: 1.5 }), 60);
  expect(sceneTime(m, 2)).toBe(1.5);
  expect(sceneTime(m, 5.9)).toBe(1.5);
  expect(sceneRate(m, 3)).toBe(0);
  expect(videoTime(m, 1.5)).toBeNull();
  expect(m.length).toBe(4);
  // speed and offset size the window a freeze sits in (a still of a longer clip's moment)
  expect(clipTime(clip({ freeze: 4.5, speed: 1.25 }), 60).length).toBe(5);
});

test('clipTime: bad fields are errors naming the clip and the field', () => {
  const bad = (o: Record<string, unknown>, msg: string) => expect(() => clipTime(clip(o), 60)).toThrow(msg);
  bad({ speed: 0 }, "clip 'c' speed 0: expected scene seconds per video second");
  bad({ speed: -1 }, 'speed -1');
  bad({ speed: '2' }, 'speed 2');
  bad({ speed: 1000 }, '0.01 to 100');
  bad({ offset: -1 }, "clip 'c' offset -1");
  bad({ reverse: 'yes' }, 'reverse "yes": expected true or false');
  bad({ hold: 4 }, "clip 'c' hold 4");
  bad({ hold: -0.5 }, 'hold -0.5');
  bad({ freeze: 4 }, "clip 'c' freeze 4: expected scene seconds inside its window");
  bad({ freeze: 1, reverse: true }, 'freeze holds one moment, so it takes no reverse');
  bad({ freeze: 1, hold: 1 }, 'so it takes no hold');
  expect(() => clipTime(clip({ hold: 4 - 1 / 60 }), 60)).not.toThrow();
});

test('videoSound: a scene\'s sound trimmed to the part played and sped up with it', () => {
  const m = clipTime(clip({ speed: 2, offset: 1 }), 60); // plays scene 1..9 over video 2..6
  // starts before the offset: cut at it, the file skipped ahead
  expect(videoSound(m, { file: 'a.wav', at: 2.5, duration: 3, from: 0.5 })).toEqual({ file: 'a.wav', at: 2, duration: 1.25, from: 1, speed: 2 });
  // runs past the window: cut there
  expect(videoSound(m, { file: 'a.wav', at: 10, duration: 4, speed: 0.5 })).toEqual({ file: 'a.wav', at: 5.5, duration: 0.5, speed: 1 });
  // no length: plays on, as it would on a clip without remapping
  expect(videoSound(m, { file: 'a.wav', at: 5 })).toEqual({ file: 'a.wav', at: 3, speed: 2 });
  expect(videoSound(m, { file: 'a.wav', at: 11 })).toBeNull();
  expect(videoSound(m, { file: 'a.wav', at: 2, duration: 0.5 })).toBeNull();
  expect(videoSound(clipTime(clip({ reverse: true }), 60), { file: 'a.wav', at: 3 })).toBeNull();
  expect(videoSound(clipTime(clip({ freeze: 1 }), 60), { file: 'a.wav', at: 3 })).toBeNull();
  // fades are in the scene's seconds: they shorten with the sound
  expect(videoSound(m, { file: 'a.wav', at: 4, duration: 2, fadeIn: 0.5, fadeOut: 0.2 })).toEqual({ file: 'a.wav', at: 2.5, duration: 1, speed: 2, fadeIn: 0.25, fadeOut: 0.1 });
  const id = { file: 'a.wav', at: 3 };
  expect(videoSound(clipTime(clip(), 60), id)).toBe(id);
});

test('statefulBlocker: a stateful scene plays only forward runs, at any speed', () => {
  const b = (o: Record<string, unknown>) => statefulBlocker(clipTime(clip(o), 60));
  expect(b({})).toBe('');
  expect(b({ speed: 0.5 })).toBe('');
  expect(b({ reverse: true })).toBe('reverse');
  expect(b({ freeze: 1 })).toBe('freeze');
  expect(b({ offset: 1 })).toBe('start at an offset');
  expect(b({ hold: 1 })).toBe('hold');
});
