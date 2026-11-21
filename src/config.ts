import type { SceneClass } from './engine/scene';
import type { PostParams } from './engine/post';
import type { Words } from './engine/words';
import type { AudioData } from './engine/audio';
import type { Grade, Matte, MatteMode, TrackBlend, TrackSettings } from './engine/tracks';
export type { Grade, Matte, MatteMode, TrackBlend, TrackSettings } from './engine/tracks';
import type { Theme, ThemeName } from './themes';
import type { CheckRule } from './engine/report';
import type { Transition, TransitionKind } from './engine/transitions';
export type { Transition, TransitionKind, TransitionDirection, TransitionUniform, CustomTransition, EaseName } from './engine/transitions';

export { themes, extendTheme, resolveTheme } from './themes';
export type { Theme, ThemeName, HudParams, ResolvedTheme } from './themes';

export interface Clip {
  id: string;
  scene: () => Promise<{ default: SceneClass }>;
  start: number;
  end: number;
  track?: number;
  transition?: TransitionKind | Transition;
  /**
   * How the clip's track is drawn over the tracks below (default the track's, else 'normal'), and how strongly
   * (default the track's, else 1; under the lowest track is black). Across a transition the opacity fades from
   * the outgoing clip's to the incoming one's; the blend is the incoming clip's. 'normal', 'add', 'screen',
   * 'multiply', 'max', and the modes that read the tracks below: 'overlay', 'soft-light', 'hard-light'
   * (on display values: light above 1 is cut to 1), 'difference', 'color-dodge'.
   */
  blend?: TrackBlend;
  opacity?: number;
  grade?: Grade | ((f: { t: number; lt: number; p: number }) => Grade);
  matte?: MatteMode | Matte;
  post?: Partial<PostParams>;
  params?: Record<string, unknown>;
  speed?: number;
  offset?: number;
  reverse?: boolean;
  hold?: number;
  freeze?: number;
  maxSamples?: number;
  /** `reel check` rules this clip is meant to break (a deliberate black frame: ['blank']); true: all of them. */
  check?: { exempt?: CheckRule[] | true };
}

export const BUNDLED_SOUNDS = ['tick', 'click', 'pop', 'whoosh', 'swell', 'impact'];

export interface SoundClip {
  file: string;
  at: number;
  from?: number;
  /** Seconds it plays (default: to the end of the file, or with `loop` to the end of the video). */
  duration?: number;
  loop?: boolean;
  speed?: number;
  /** Gain in dB (default 0), and fades in and out in seconds (default 0.02: no click). */
  db?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export type Props = Record<string, any>;

export interface Sources<P extends object = Props> {
  words: Words;
  audio: AudioData;
  props: P;
}

export interface NarrationSettings {
  voice?: string;
  speed?: number;
  model?: string;
  lead?: number;
  hold?: number;
  tail?: number;
  language?: string;
}

export interface VideoConfig<P extends object = Props> {
  size?: [number, number];
  fps?: number;
  theme?: ThemeName | Theme;
  duration?: number;
  /**
   * Timed words (JSON, relative to the project folder; default 'data/words.json' when that file exists) and
   * audio analysis (default 'data/audio.json' when it exists). `false`: the video has none.
   */
  words?: string | false;
  audio?: string | false;
  narration?: NarrationSettings;
  props?: P;
  tracks?: Record<number, TrackSettings>;
  timeline(src: Sources<P>): Clip[];
  sounds?: SoundClip[] | { fn(src: Sources<P>): SoundClip[] }['fn'];
  export?: ExportDefaults;
}

export interface ExportDefaults {
  /** x264/x265 quality for h264 (default 16) and hevc (default 18), 0 to 51; higher is smaller. Not applied to webm. */
  crf?: number;
  preset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow' | 'placebo';
  /** Leave the sound out (not with --mix or --subtitles, which make the finished sound; `--audio` keeps it). */
  noaudio?: boolean;
  /** Sub-frames per frame: a count, or 'auto' (not for drafts, which take one). */
  samples?: number | 'auto';
}

export function defineVideo<P extends object = Props>(c: VideoConfig<P>): VideoConfig<P> {
  return c;
}

export const kindOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
export const an = (kind: string) => (kind === 'null' ? 'null' : `${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}`);

export const isProps = (v: unknown): v is Props => kindOf(v) === 'object';

export function parseProps(text: string, what: string): Props {
  let v: unknown;
  try { v = JSON.parse(text); } catch (e) { throw new Error(`${what}: not JSON (${(e as Error).message})`); }
  if (!isProps(v)) throw new Error(`${what}: expected a JSON object, got ${an(kindOf(v))}`);
  return v;
}

export function resolveProps(defaults: unknown, given: Props | null | undefined): Props {
  if (defaults !== undefined && !isProps(defaults)) throw new Error(`the config's props: expected an object, got ${an(kindOf(defaults))}`);
  if (!defaults) return { ...given };
  const out: Props = { ...defaults };
  for (const [k, v] of Object.entries(given ?? {})) {
    if (!Object.hasOwn(defaults, k)) throw new Error(`props: '${k}' is not one of the config's props (${Object.keys(defaults).join(', ') || 'it has none'})`);
    const want = kindOf(defaults[k]), got = kindOf(v);
    if (want !== 'null' && want !== 'undefined' && got !== want) throw new Error(`props: '${k}' expected ${an(want)}, as in the config's props, got ${an(got)}`);
    out[k] = v;
  }
  return out;
}

export function formatOf(c: VideoConfig): { w: number; h: number; fps: number } {
  const [w, h] = c.size ?? [1920, 1080], fps = c.fps ?? 60;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 16 || h < 16 || w > 8192 || h > 8192) throw new Error(`size [${w}, ${h}]: expected integers from 16 to 8192`);
  if (w % 4 || h % 2) throw new Error(`size [${w}, ${h}]: the width must be a multiple of 4 and the height even`);
  if (!(fps > 0 && fps <= 240)) throw new Error(`fps ${fps}: expected a frame rate up to 240`);
  return { w, h, fps };
}

export interface SequenceItem extends Omit<Clip, 'start' | 'end' | 'track'> {
  dur: number;
  overlap?: number;
}

export interface SequenceOptions {
  start?: number;
  track?: number;
  transition?: TransitionKind | Transition;
  overlap?: number;
}

const us = (x: number) => Math.round(x * 1e6) / 1e6;

export function sequence(items: SequenceItem[], o: SequenceOptions = {}): Clip[] {
  const out: Clip[] = [];
  let t = o.start ?? 0, overlapIn = 0;
  if (!Number.isFinite(t) || t < 0) throw new Error(`sequence: start ${t} must be 0 or more seconds`);
  items.forEach((it, k) => {
    const where = `sequence: clip '${it.id}'`;
    if (!(Number.isFinite(it.dur) && it.dur > 0)) throw new Error(`${where}: dur ${it.dur} must be above 0 seconds`);
    const { dur, overlap: _, ...clip } = it;
    const transition = it.transition ?? (k > 0 ? o.transition : undefined);
    const overlap = k === 0 ? 0 : it.overlap ?? (transition !== undefined ? o.overlap ?? 0.5 : 0);
    if (k === 0 && it.overlap !== undefined && it.overlap !== 0) throw new Error(`${where}: the first clip has no clip before it to overlap (start the sequence earlier instead)`);
    if (k > 0 && !(Number.isFinite(overlap) && overlap >= 0 && overlap < dur)) throw new Error(`${where}: overlap ${overlap} must be 0 or more and shorter than the clip`);
    if (k > 0 && (overlapIn + overlap > items[k - 1]!.dur + 1e-9 || overlap >= items[k - 1]!.dur)) throw new Error(`${where}: overlap ${overlap} reaches back past the start of the clip before, '${items[k - 1]!.id}' (${items[k - 1]!.dur} s, ${overlapIn} s of it overlapping the clip before it)`);
    const start = us(t - overlap), end = us(start + dur);
    out.push({ ...clip, ...(transition !== undefined ? { transition } : {}), start, end, ...(o.track !== undefined ? { track: o.track } : {}) });
    t = end;
    overlapIn = overlap;
  });
  return out;
}

export interface SectionOptions {
  transition?: TransitionKind | Transition | ((name: string) => TransitionKind | Transition | undefined);
  overlap?: number;
  params?: Record<string, unknown> | ((name: string) => Record<string, unknown> | undefined);
}

export function clipsFromSections(src: Sources<object>, modules: Record<string, () => Promise<unknown>>, o: SectionOptions = {}): Clip[] {
  const mod = (name: string) => modules[`./scenes/${name}.ts`] as Clip['scene'] | undefined;
  const have = src.audio.sections.filter((s) => mod(s.name));
  const bounds = have.map((s, k) => (k === 0 ? 0 : s.start)).concat(src.audio.duration);
  const transitionOf = (name: string) => (typeof o.transition === 'function' ? o.transition(name) : o.transition);
  if (o.overlap !== undefined && !(Number.isFinite(o.overlap) && o.overlap >= 0)) throw new Error(`clipsFromSections: overlap ${o.overlap} must be 0 or more seconds`);
  const transitions = have.map((s, k) => (k > 0 ? transitionOf(s.name) : undefined));
  const half = have.map((_, k) => (k === 0 ? 0 : o.transition === undefined ? o.overlap ?? 0 : transitions[k] !== undefined ? o.overlap ?? 0.5 : 0) / 2).concat(0);
  return have.map((s, k) => {
    const start = us(bounds[k]! - half[k]!), end = us(bounds[k + 1]! + half[k + 1]!);
    const len = bounds[k + 1]! - bounds[k]!;
    if (half[k]! + half[k + 1]! > len + 1e-9 || half[k]! >= len || half[k + 1]! >= len) throw new Error(`clipsFromSections: section '${s.name}' (${(bounds[k + 1]! - bounds[k]!).toFixed(2)} s) is too short for its overlaps`);
    const transition = transitions[k];
    const params = typeof o.params === 'function' ? o.params(s.name) : o.params;
    return { id: s.name, scene: mod(s.name)!, start, end, ...(transition !== undefined ? { transition } : {}), ...(params ? { params } : {}) };
  });
}
