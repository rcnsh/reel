import { describe, expect, test } from 'bun:test';
import { checkTimes, contrastRatio, findingsOf, frameStats, measureText, relLum, sameFrame, type CheckOpts, type Pixels, type Sample } from '../src/check';
import type { ReportedBox } from '../src/engine/report';

/** A W x H frame (scale 1) filled with `bg`, with `draw` painting rectangles; rows bottom-up like the readback. */
function frame(W: number, H: number, bg: number[], draw: [number, number, number, number, number[]][] = []): Pixels {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let c = bg;
    for (const [rx, ry, rw, rh, col] of draw) if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) c = col;
    data.set([c[0]!, c[1]!, c[2]!, 255], ((H - 1 - y) * W + x) * 4);
  }
  return { data, pw: W, ph: H, scale: 1 };
}

describe('colour', () => {
  test('WCAG luminance and ratio', () => {
    expect(relLum(255, 255, 255)).toBeCloseTo(1, 9);
    expect(relLum(0, 0, 0)).toBe(0);
    expect(contrastRatio(1, 0)).toBeCloseTo(21, 9);
    expect(contrastRatio(relLum(118, 118, 118), 1)).toBeCloseTo(4.54, 1);
  });
});

describe('frames', () => {
  test('a flat frame has no spread; a frame with content does', () => {
    expect(frameStats(frame(64, 36, [40, 40, 40])).spread).toBe(0);
    expect(frameStats(frame(64, 36, [40, 40, 40], [[10, 10, 20, 10, [240, 240, 240]]])).spread).toBeGreaterThan(50);
  });
  test('sameFrame compares the brightness grid', () => {
    const a = frameStats(frame(64, 36, [40, 40, 40])), b = frameStats(frame(64, 36, [40, 40, 41])), c = frameStats(frame(64, 36, [60, 60, 60]));
    expect(sameFrame(a, b)).toBe(true);
    expect(sameFrame(a, c)).toBe(false);
  });
});

describe('measureText', () => {
  // dark "text" strokes inside a box on a light background
  const strokes: [number, number, number, number, number[]][] = [[22, 22, 4, 16, [20, 20, 20]], [30, 22, 4, 16, [20, 20, 20]], [38, 22, 4, 16, [20, 20, 20]]];
  test('reads text and background from the pixels', () => {
    const m = measureText(frame(100, 60, [235, 235, 235], strokes), { x: 20, y: 20, w: 24, h: 20, size: 20 }, [20, 20, 20])!;
    expect(m.ratio).toBeGreaterThan(14);
    expect(m.coverage).toBeGreaterThan(0.2);
    expect(m.bgHex).toBe('#EBEBEB');
  });
  test('low contrast text on a similar background', () => {
    const lowStrokes = strokes.map(([x, y, w, h]) => [x, y, w, h, [150, 150, 150]] as [number, number, number, number, number[]]);
    const m = measureText(frame(100, 60, [170, 170, 170], lowStrokes), { x: 20, y: 20, w: 24, h: 20, size: 20 }, [150, 150, 150])!;
    expect(m.ratio).toBeLessThan(1.5);
  });
  test('invisible text has no coverage; a box off the frame is not measured', () => {
    const m = measureText(frame(100, 60, [235, 235, 235]), { x: 20, y: 20, w: 24, h: 20, size: 20 }, [20, 20, 20])!;
    expect(m.coverage).toBe(0);
    expect(measureText(frame(100, 60, [0, 0, 0]), { x: 200, y: 20, w: 24, h: 20 }, [255, 255, 255])).toBeNull();
  });
});

describe('checkTimes', () => {
  const clips = [{ id: 'a', start: 0, end: 2, track: 0 }, { id: 'b', start: 2, end: 4.5, track: 0 }];
  const ts = checkTimes(clips, 4.5, 30);
  test('every clip’s first and last frame, frame times only, inside the video', () => {
    for (const t of [0, 59 / 30, 2, 134 / 30]) expect(ts.some((x) => Math.abs(x - t) < 1e-9)).toBe(true);
    for (const t of ts) { expect(Math.abs(t * 30 - Math.round(t * 30))).toBeLessThan(1e-9); expect(t).toBeLessThan(4.5); expect(t).toBeGreaterThanOrEqual(0); }
    expect([...ts].sort((x, y) => x - y)).toEqual(ts);
    expect(new Set(ts).size).toBe(ts.length);
  });
  test('denser around cuts than in the middle', () => {
    const near = ts.filter((t) => Math.abs(t - 2) < 0.3).length, mid = ts.filter((t) => Math.abs(t - 1) < 0.3).length;
    expect(near).toBeGreaterThan(mid);
  });
  test('a range', () => {
    const r = checkTimes(clips, 4.5, 30, 1, 3);
    expect(Math.min(...r)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...r)).toBeLessThan(3);
  });
  test('only the loaded clips’ frames with --only', () => {
    const r = checkTimes(clips, 4.5, 30, 0, 4.5, 0.5, ['b']);
    expect(r.length).toBeGreaterThan(0);
    expect(Math.min(...r)).toBe(2);
    expect(Math.max(...r)).toBeCloseTo(134 / 30, 9);
    expect(checkTimes(clips, 4.5, 30, 0, 1.5, 0.5, ['b'])).toEqual([]);
  });
});

describe('findingsOf', () => {
  const opts: CheckOpts = { W: 1000, H: 500, safe: 0.05, minText: 24, frozen: 3, clips: [{ id: 'a', start: 0, end: 10, track: 0 }], palette: { bg: '#FFFFFF', fg: '#111111', accent: '#FF0000' } };
  const stats = (v: number) => ({ sig: [v, v + 50], cols: 2, rows: 1, spread: 50 });
  const box = (b: Partial<ReportedBox> & { m?: unknown }): ReportedBox & { m?: any } => ({ kind: 'text', x: 100, y: 100, w: 200, h: 40, size: 30, text: 'Hello', clip: 'a', index: 0, color: '#111111', alpha: 1, ...b });
  const sample = (t: number, boxes: ReturnType<typeof box>[] = [], v = t * 10, errors: string[] = []): Sample => ({ t, clips: ['a'], boxes, stats: stats(v), errors });

  test('text off the frame is an error, merged over the frames that show it', () => {
    const f = findingsOf([sample(1, [box({ x: 900 })]), sample(1.5, [box({ x: 950 })]), sample(2, [box({})])], opts);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: 'offFrame', severity: 'error', clip: 'a', t: 1, until: 1.5, frames: 2, at: 1.5, value: 150 });
    expect(f[0]!.message).toContain('past the right');
  });
  test('safe margin, small text and overlap are warnings', () => {
    const f = findingsOf([sample(1, [box({ x: 10, size: 12, text: 'tiny' }), box({ x: 400, index: 1, text: 'one' }), box({ x: 420, index: 2, text: 'two' })])], opts);
    expect(f.map((x) => x.kind).sort()).toEqual(['minSize', 'overlap', 'safeArea']);
    expect(f.every((x) => x.severity === 'warning')).toBe(true);
  });
  test('two clips of one track crossfading do not overlap; clips on different tracks do', () => {
    const one = box({ x: 400, text: 'one', clip: 'a', track: 0 });
    expect(findingsOf([sample(1, [one, box({ x: 420, text: 'two', clip: 'b', track: 0 })])], opts)).toHaveLength(0);
    expect(findingsOf([sample(1, [one, box({ x: 420, text: 'two', clip: 'b', track: 1 })])], opts).map((x) => x.kind)).toEqual(['overlap']);
  });
  test('parts of one run of text (a highlighted word in its line) do not overlap each other', () => {
    const line = box({ x: 400, w: 400, text: 'a line with a', flow: 'p1' }), word = box({ x: 560, w: 80, index: 1, text: 'word', color: '#FF0000', flow: 'p1' });
    expect(findingsOf([sample(1, [line, word])], opts)).toHaveLength(0);
    expect(findingsOf([sample(1, [line, { ...word, flow: 'p2' }])], opts).map((x) => x.kind)).toEqual(['overlap']);
  });
  test('HTML text that overflows its box is an error; clipped a warning; truncated on purpose a note', () => {
    const over = box({ overflow: { clipped: false, container: [100, 100, 150, 40], px: 50 } });
    const clip = box({ index: 1, x: 100, y: 300, overflow: { clipped: true, container: [100, 300, 200, 40], px: 30 } });
    const ell = box({ index: 2, x: 100, y: 400, overflow: { clipped: true, truncated: true, container: [100, 400, 200, 40], px: 80 } });
    const f = findingsOf([sample(1, [over, clip, ell])], opts);
    expect(f.map((x) => `${x.severity} ${x.kind}`)).toEqual(['error overflow', 'warning clipped', 'info clipped']);
    expect(f[1]!.rect).toEqual([100, 300, 200, 40]);
    expect(findingsOf([sample(1, [box({ ...over, exempt: ['overflow'] })])], opts)).toHaveLength(0);
  });
  test('contrast from the measure, with a palette colour that reads', () => {
    const m = { fg: relLum(200, 200, 200), bg: relLum(220, 220, 220), ratio: 1.2, coverage: 0.3, bgHex: '#DCDCDC' };
    const f = findingsOf([sample(1, [box({ m })])], opts);
    expect(f[0]).toMatchObject({ kind: 'contrast', severity: 'error', value: 1.2 });
    expect(f[0]!.message).toContain("rgba('fg')");
    // fading text and tiny boxes are not measured
    expect(findingsOf([sample(1, [box({ m, alpha: 0.5 })])], opts)).toHaveLength(0);
    expect(findingsOf([sample(1, [box({ m, w: 4 })])], opts)).toHaveLength(0);
  });
  test('exemptions on the box and on the clip', () => {
    expect(findingsOf([sample(1, [box({ x: 900, exempt: ['offFrame'] })])], opts)).toHaveLength(0);
    expect(findingsOf([sample(1, [box({ x: 900, exempt: true })])], opts)).toHaveLength(0);
    expect(findingsOf([sample(1, [box({ x: 900 })])], { ...opts, clips: [{ ...opts.clips[0]!, exempt: ['offFrame'] }] })).toHaveLength(0);
  });
  test('a clip that draws text with fillText and reports none is a warning; one that reports any is not', () => {
    const quiet = (t: number, n: number): Sample => ({ ...sample(t), textDraws: { a: n } });
    const f = findingsOf([quiet(1, 3), quiet(2, 2), sample(3)], opts);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: 'unreported', severity: 'warning', clip: 'a', t: 1, until: 2, frames: 2, value: 5 });
    expect(f[0]!.message).toContain('reportText(c, text, x, y)');
    expect(findingsOf([quiet(1, 3), sample(2, [box({})])], opts)).toHaveLength(0);
    expect(findingsOf([quiet(1, 3)], { ...opts, clips: [{ ...opts.clips[0]!, exempt: ['unreported'] }] })).toHaveLength(0);
  });
  test('blank and frozen frames, scene errors', () => {
    const flat = { sig: [10, 10], cols: 2, rows: 1, spread: 0 };
    const f = findingsOf([{ t: 0, clips: ['a'], boxes: [], stats: flat, errors: ['[a] render at 0.000 s: boom'] }, ...[0.5, 1, 2, 3.5].map((t) => ({ t, clips: ['a'], boxes: [], stats: flat, errors: [] }))], opts);
    expect(f.map((x) => x.kind)).toEqual(['sceneError', 'blank', 'frozen']);
    expect(f[1]).toMatchObject({ t: 0, until: 3.5, frames: 5 });
    expect(f[2]).toMatchObject({ t: 0, until: 3.5, value: 3.5 });
    expect(f[0]!.clip).toBe('a');
  });
  test('--only: a frozen run ends at a stretch no loaded clip covers, and unloaded clips are not named', () => {
    const still = { sig: [10, 60], cols: 2, rows: 1, spread: 50 };
    const o = { ...opts, clips: [{ id: 'a', start: 0, end: 2, track: 0 }, { id: 'x', start: 2, end: 8, track: 0 }, { id: 'b', start: 8, end: 10, track: 0 }], only: ['a', 'b'] };
    // a and b sampled, x (not loaded) skipped: a's last frame and b's first look alike
    const ss: Sample[] = [0, 1, 1.9, 8, 9, 9.9].map((t) => ({ t, clips: t < 2 ? ['a'] : ['b'], boxes: [], stats: still, errors: [] }));
    expect(findingsOf(ss, o)).toEqual([]);
    expect(findingsOf(ss, { ...o, only: undefined }).map((x) => x.kind)).toEqual(['frozen']);
    // a clip starting over another loaded one does not end the run
    const cap = { ...opts, clips: [{ id: 'a', start: 0, end: 8, track: 0 }, { id: 'cap', start: 2, end: 8, track: 1 }], only: ['a', 'cap'] };
    const held: Sample[] = [0, 1, 2, 3, 4, 5, 6].map((t) => ({ t, clips: t < 2 ? ['a'] : ['a', 'cap'], boxes: [], stats: still, errors: [] }));
    expect(findingsOf(held, cap).map((x) => [x.kind, x.t, x.until])).toEqual([['frozen', 0, 6]]);
    const flat = { sig: [10, 10], cols: 2, rows: 1, spread: 0 };
    const f = findingsOf([{ t: 1, clips: ['a', 'x'], boxes: [], stats: flat, errors: [] }], { ...o, only: ['a'] });
    expect(f.map((x) => [x.kind, x.clip])).toEqual([['blank', 'a']]);
  });
  test('blank frames that are not next to each other are separate findings', () => {
    const flat = { sig: [10, 10], cols: 2, rows: 1, spread: 0 };
    const at = (t: number, blank: boolean): Sample => blank ? { t, clips: ['a'], boxes: [], stats: flat, errors: [] } : sample(t);
    const f = findingsOf([at(0, true), at(0.5, true), at(1, false), at(1.5, false), at(5, true)], opts).filter((x) => x.kind === 'blank');
    expect(f.map((x) => [x.t, x.until, x.frames])).toEqual([[0, 0.5, 2], [5, 5, 1]]);
  });
});
