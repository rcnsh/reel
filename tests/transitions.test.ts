import { expect, test } from 'bun:test';
import { customSource, declaredUniforms, idleTransitions, transitionDisplaces, transitionEase, transitionOf, transitionWeights } from '../src/engine/transitions';
import { ease } from '../src/engine/util';

test('transitionOf takes a name or an object and rejects anything else', () => {
  expect(transitionOf(undefined, 'x')).toEqual({ kind: 'crossfade' });
  expect(transitionOf('wipe', 'x')).toEqual({ kind: 'wipe' });
  expect(transitionOf({ kind: 'dip', color: 'accent' }, 'x')).toEqual({ kind: 'dip', color: 'accent' });
  expect(() => transitionOf('fade', "clip 'a'")).toThrow("clip 'a': transition \"fade\": kind must be one of crossfade, wipe, slide, zoom, dip, iris, clock, whip, flash");
  expect(() => transitionOf({ kind: 'wipe', dir: 'left' }, 'x')).toThrow("unknown key 'dir' for a wipe (expected kind, direction, softness, ease)");
  expect(() => transitionOf({ kind: 'slide', direction: 'sideways' }, 'x')).toThrow('direction must be');
  expect(() => transitionOf({ kind: 'dip', color: 'nokey' }, 'x')).toThrow('palette key');
  expect(() => transitionOf({ kind: 'wipe', softness: 2 }, 'x')).toThrow('softness');
});

test('each kind takes only its own keys', () => {
  for (const kind of ['iris', 'clock', 'whip', 'flash']) expect(transitionOf(kind, 'x')).toEqual({ kind } as never);
  expect(transitionOf({ kind: 'iris', center: [0.3, 0.6], softness: 0.1, close: true, ease: 'outQuad' }, 'x')).toMatchObject({ kind: 'iris', close: true });
  expect(transitionOf({ kind: 'clock', clockwise: false }, 'x')).toMatchObject({ clockwise: false });
  expect(transitionOf({ kind: 'whip', direction: 'up' }, 'x')).toMatchObject({ direction: 'up' });
  expect(() => transitionOf({ kind: 'flash', color: 'accent' }, 'x')).toThrow("unknown key 'color' for a flash (expected kind, ease)");
  expect(() => transitionOf({ kind: 'slide', softness: 0.1 }, 'x')).toThrow("unknown key 'softness' for a slide");
  expect(() => transitionOf({ kind: 'zoom', direction: 'left' }, 'x')).toThrow("unknown key 'direction' for a zoom");
  expect(() => transitionOf({ kind: 'iris', center: [0.5] }, 'x')).toThrow('center must be [x, y]');
  expect(() => transitionOf({ kind: 'iris', close: 'yes' }, 'x')).toThrow('close must be true or false');
  expect(() => transitionOf({ kind: 'wipe', dur: 0.5 }, 'x')).toThrow('lasts as long as its clip overlaps');
});

test('ease: a name from the easing set, defaulting to the curve each kind always had', () => {
  expect(() => transitionOf({ kind: 'wipe', ease: 'bouncy' }, 'x')).toThrow('ease must be one of linear, inSine');
  expect(transitionEase({ kind: 'crossfade' })).toBe(ease.linear);
  expect(transitionEase({ kind: 'dip' })).toBe(ease.linear);
  for (const kind of ['wipe', 'slide', 'zoom', 'iris', 'clock'] as const) expect(transitionEase({ kind })).toBe(ease.inOutCubic);
  expect(transitionEase({ kind: 'whip' })).toBe(ease.inOutExpo);
  expect(transitionEase({ kind: 'wipe', ease: 'outBack' })).toBe(ease.outBack);
  expect(transitionEase({ glsl: 'mix(getFromColor(uv), getToColor(uv), p)' })).toBe(ease.linear);
});

test('transitionWeights: a crossfade is linear, a dip shows neither clip at its middle, a flash cuts through white', () => {
  expect(transitionWeights({ kind: 'crossfade' }, 0.25)).toEqual([0.75, 0.25]);
  expect(transitionWeights({ kind: 'crossfade', ease: 'inQuad' }, 0.5)).toEqual([0.75, 0.25]);
  expect(transitionWeights({ kind: 'dip' }, 0.5)).toEqual([0, 0]);
  expect(transitionWeights({ kind: 'dip' }, 0.75)).toEqual([0, 0.5]);
  const [o, i] = transitionWeights({ kind: 'wipe' }, 0.5);
  expect(o + i).toBeCloseTo(1);
  expect(transitionWeights({ kind: 'flash' }, 0.5)).toEqual([0, 0]);
  expect(transitionWeights({ kind: 'flash' }, 0.25)).toEqual([0.75, 0]);
  expect(transitionWeights({ kind: 'flash' }, 1)).toEqual([0, 1]);
  expect(Math.max(...transitionWeights({ kind: 'slide', ease: 'outBack' }, 0.8))).toBeLessThanOrEqual(1);
});

test('transitions that read their clips off the pixel are the ones the sampler leaves unmasked', () => {
  expect(['slide', 'whip', 'zoom'].map((kind) => transitionDisplaces({ kind } as never))).toEqual([true, true, true]);
  expect(['crossfade', 'wipe', 'dip', 'iris', 'clock', 'flash'].some((kind) => transitionDisplaces({ kind } as never))).toBe(false);
  expect(transitionDisplaces({ glsl: 'getToColor(uv)' })).toBe(true);
});

test('custom transitions: checked, and wrapped from a function, a body or an expression', () => {
  expect(transitionOf({ glsl: 'getToColor(uv)', uniforms: { n: 4, c: [1, 0, 0] } }, 'x')).toMatchObject({ uniforms: { n: 4 } });
  expect(() => transitionOf({ glsl: '' }, 'x')).toThrow('glsl must be GLSL source');
  expect(() => transitionOf({ glsl: 'x', kind: 'wipe' }, 'x')).toThrow("unknown key 'glsl' for a wipe");
  expect(() => transitionOf({ glsl: 'x', direction: 'left' }, 'x')).toThrow("unknown key 'direction' for a custom transition (expected glsl, uniforms, ease)");
  expect(() => transitionOf({ glsl: 'x', uniforms: { progress: 1 } }, 'x')).toThrow("uniform 'progress' is not a free GLSL name");
  expect(() => transitionOf({ glsl: 'x', uniforms: { 'a b': 1 } }, 'x')).toThrow('is not a free GLSL name');
  expect(() => transitionOf({ glsl: 'x', uniforms: { v: [1, 2, 3, 4, 5] } }, 'x')).toThrow("uniform 'v' must be a number or an array of 2 to 4 numbers");

  const expr = customSource({ glsl: 'mix(getFromColor(uv), getToColor(uv), p);', uniforms: { n: 4, c: [1, 0, 0] } });
  expect(expr).toContain('uniform float n;');
  expect(expr).toContain('uniform vec3 c;');
  expect(expr).toContain('vec4 transition(vec2 uv) {\n  float p = progress;\n  return (mix(getFromColor(uv), getToColor(uv), p));\n}');
  const body = customSource({ glsl: 'float m = step(uv.x, p);\nreturn mix(getFromColor(uv), getToColor(uv), m);' });
  expect(body).toContain('float p = progress;\nfloat m = step(uv.x, p);');
  const fn = 'uniform float strength; // = 0.5\nvec4 transition(vec2 uv) { return mix(getFromColor(uv), getToColor(uv), progress * strength); }';
  const whole = customSource({ glsl: fn, uniforms: { strength: 0.5 } });
  expect(whole).not.toContain('uniform float strength;\n');
  expect(whole).toContain(fn);
  expect(whole.match(/vec4 transition\(/g)).toHaveLength(1);
});

test('uniforms a source declares itself: found through precision qualifiers, lists and comments, and checked against their values', () => {
  expect([...declaredUniforms('uniform highp float a, b; // uniform vec2 c;\n/* uniform vec3 d; */ uniform vec2 e[2];')]).toEqual([['a', 'float'], ['b', 'float'], ['e', 'vec2']]);
  const src = 'uniform highp float amount, strength;\nvec4 transition(vec2 uv) { return getToColor(uv) * strength; }';
  expect(customSource({ glsl: src, uniforms: { strength: 0.5 } })).not.toContain('uniform float strength;');
  expect(() => transitionOf({ glsl: 'uniform vec2 dir;\nvec4 transition(vec2 uv) { return getToColor(uv + dir); }', uniforms: { dir: 1 } }, 'x'))
    .toThrow("uniform 'dir' is declared vec2 in the glsl, which takes an array of 2");
  const pixelize = 'uniform ivec2 squaresMin; uniform int steps;\nvec4 transition(vec2 uv) { return getToColor(uv); }';
  expect(transitionOf({ glsl: pixelize, uniforms: { squaresMin: [20, 20], steps: 50 } }, 'x')).toMatchObject({ uniforms: { steps: 50 } });
  expect(() => transitionOf({ glsl: pixelize, uniforms: { steps: [1, 2] } }, 'x')).toThrow("declared int in the glsl, which takes a number");
  for (const name of ['progress', 'getToColor', 'C_BG']) expect(() => transitionOf({ glsl: 'x', uniforms: { [name]: 1 } }, 'x')).toThrow('the custom pass declares');
  expect(transitionOf({ glsl: '#define PI 3.141592653589\nvec4 transition(vec2 uv) { return getToColor(uv); }', uniforms: { luma: 1, C: 2 } }, 'x')).toBeTruthy();
});

test('idleTransitions: a transition on a clip that does not overlap the one before it on its track never plays', () => {
  const clips = [
    { id: 'a', start: 0, end: 2 },
    { id: 'b', start: 1.5, end: 4, transition: 'wipe' },
    { id: 'c', start: 4, end: 6, transition: 'slide' },
    { id: 'd', start: 6, end: 8 },
    { id: 'e', start: 1, end: 3, track: 1, transition: { kind: 'dip' } },
    { id: 'f', start: 3.5, end: 5, track: 1, transition: 'crossfade' },
  ];
  const w = idleTransitions(clips);
  expect(w.map((x) => x.clip)).toEqual(['c', 'e', 'f']);
  expect(w[0]!.message).toContain("does not overlap 'b'");
  expect(w[0]!.message).toContain("overlap it by the transition's length");
  expect(w[1]!.message).toContain('no clip before it on track 1');
  expect(idleTransitions([{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 0, end: 5, transition: 'wipe' }])).toEqual([]);
  expect(idleTransitions([{ id: 'b', start: 0, end: 5, transition: 'wipe' }, { id: 'a', start: 0, end: 3 }]).map((x) => x.clip)).toEqual(['b']);
  const near = [{ id: 'a', start: 0, end: 4.3 + 1e-9 }, { id: 'b', start: 4.3, end: 6, transition: 'wipe' }];
  expect(idleTransitions(near)).toEqual([]);
  expect(idleTransitions(near, 1 / 30).map((x) => x.clip)).toEqual(['b']);
  expect(idleTransitions(near, 1 / 30)[0]!.message).toContain('by less than a frame');
  expect(idleTransitions([{ id: 'a', start: 0, end: 9 }, { id: 'b', start: 9 - 1 / 30, end: 12, transition: 'crossfade' }], 1 / 30)).toEqual([]);
});
