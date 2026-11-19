// A video project's configuration: `reel.config.ts` in the project folder default-exports defineVideo({...}).
// This module is plain data and types (no GL), so the CLI can read a config outside the browser. For the same
// reason a config's top level stays plain too: scene modules are named as lazy imports and anything that
// touches the engine lives inside `timeline()`.
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

/** A scene placed on the timeline. */
export interface Clip {
  /** Unique name: `--only` selects by it and sound mixes refer to it. */
  id: string;
  /** The scene module, loaded when the clip is: `() => import('./scenes/hello')`. Its default export is the Scene class. */
  scene: () => Promise<{ default: SceneClass }>;
  /** The clip's window in seconds, [start, end). */
  start: number;
  end: number;
  /**
   * The layer the clip is on (default 0). Tracks stack in number order, each drawn over the ones below, so a
   * scene on a track above 0 clears its target to transparent. On one track, clips that overlap in time make a
   * transition (a crossfade unless the incoming scene handles it); clips that touch make a hard cut.
   */
  track?: number;
  /**
   * How the clip comes in over the clip before it on its track while they overlap (default a crossfade): a kind
   * ('crossfade', 'wipe', 'slide', 'zoom', 'dip', 'iris', 'clock', 'whip', 'flash'), { kind, ease?, … } with
   * that kind's options (see each Transition type), or { glsl, uniforms?, ease? } for a shader of your own. It
   * lasts as long as the overlap. A scene with handlesTransition draws the transition itself instead.
   */
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
  /**
   * A grade of the clip's whole track while the clip is on it (over the track's own grade in the config's
   * `tracks`, field by field): exposure, saturation, contrast, tint, fade, flash, blur. Data, or a function of
   * the clip's time for an animated one; the scene's render() may also return `{ grade }`, which goes over both.
   * Across a transition the grade moves from the outgoing clip's to the incoming one's.
   */
  grade?: Grade | ((f: { t: number; lt: number; p: number }) => Grade);
  /**
   * Cut the clip's track by the next track above it (or below: { mode, from: 'below' }) while the clip is on top
   * of its track: 'alpha' shows it where the matte track has coverage, 'luma' where it is bright, '-inverted'
   * where it has none. The matte track is not drawn (nor its post overrides) while it is one.
   */
  matte?: MatteMode | Matte;
  /** Default post overrides while the clip is on screen (the scene's own overrides win). */
  post?: Partial<PostParams>;
  /** Free-form values handed to the scene as ctx.params (one scene module can serve several clips). */
  params?: Record<string, unknown>;
  /** Cap on adaptive motion-blur sub-frames while the clip is on screen (for noise that converges slowly). */
  maxSamples?: number;
  /** `reel check` rules this clip is meant to break (a deliberate black frame: ['blank']); true: all of them. */
  check?: { exempt?: CheckRule[] | true };
}

/** The cue sounds the engine ships in sounds/ (tools/make_sounds.ts), which a sound may name instead of a file. */
export const BUNDLED_SOUNDS = ['tick', 'click', 'pop', 'whoosh', 'swell', 'impact'];

/**
 * A sound placed on the timeline: the mix lays it under the video (no scene needs to ask for it).
 */
export interface SoundClip {
  /**
   * The sound: a file in the project (a path from its folder: `audio/door.wav`, or a video whose sound to use), or
   * one of the engine's bundled cue sounds by name (`whoosh`, `impact` …).
   */
  file: string;
  /** When it starts on the timeline (seconds). */
  at: number;
  /** Seconds into the file it starts from (default 0). */
  from?: number;
  /** Seconds it plays (default: to the end of the file, or with `loop` to the end of the video). */
  duration?: number;
  /** Repeat the file to fill `duration`. */
  loop?: boolean;
  /** Playback rate, its pitch kept (default 1; 0.1 to 10). */
  speed?: number;
  /** Gain in dB (default 0), and fades in and out in seconds (default 0.02: no click). */
  db?: number;
  fadeIn?: number;
  fadeOut?: number;
}

/** What `timeline()` is given: the project's timed words and audio analysis (both empty when it has none). */
export interface Sources {
  words: Words;
  audio: AudioData;
}

/**
 * How `reel narrate` voices narration.txt and how narrate and `reel align` space it (flags override each).
 */
export interface NarrationSettings {
  /**
   * The voice (default 'kokoro:af_heart'): 'kokoro[:<voice>]' (a local model), 'say[:<name>]' (macOS scratch voice),
   * 'elevenlabs:<voice-id>' or 'fish:<voice-id>' (hosted: used only when ELEVENLABS_API_KEY or FISH_API_KEY is set).
   */
  voice?: string;
  /** Speaking rate (default 1). */
  speed?: number;
  /** A hosted voice's model (ElevenLabs model_id, Fish Audio model). */
  model?: string;
  /** Seconds of silence before the first word (default 0.6), at least between plates (default 0.85), after the last word (default 1.6). */
  lead?: number;
  hold?: number;
  tail?: number;
  /** The script's language for the forced aligner (default 'English'). */
  language?: string;
}

export interface VideoConfig {
  /** Logical frame size in px, [width, height] (default [1920, 1080]). The width is a multiple of 4, the height even. */
  size?: [number, number];
  /** Output frames per second (default 60). */
  fps?: number;
  /**
   * The look: 'print', 'film', 'neutral' (the default) or a theme object (`extendTheme('print', { palette: { accent: '#0a7' } })`).
   * It sets the palette scenes colour with, the default post-processing and an overlay over every clip.
   */
  theme?: ThemeName | Theme;
  /** Length in seconds. Default: the audio analysis's duration, else the end of the last clip. */
  duration?: number;
  /**
   * Timed words (JSON, relative to the project folder; default 'data/words.json' when that file exists) and
   * audio analysis (default 'data/audio.json' when it exists). `false`: the video has none.
   */
  words?: string | false;
  audio?: string | false;
  /** How narration.txt is voiced and spaced (reel narrate, reel align). Plain data. */
  narration?: NarrationSettings;
  /**
   * Settings per track, by track number: `{ 1: { grade: { saturation: 0 }, blend: 'overlay' }, 2: { matte: 'alpha' } }`.
   * `blend`, `opacity`, `grade` and `matte` as on a clip; a clip's own value goes over its track's. Plain data.
   */
  tracks?: Record<number, TrackSettings>;
  /** The edit: every clip of the video. Called once the sources are loaded. */
  timeline(src: Sources): Clip[];
  /**
   * Sounds on the timeline that the mix lays in (`reel mix`, `reel video --mix`), as data or a function of the
   * sources (times from words or beats): `[{ file: 'audio/rain.flac', at: 2, duration: 8, loop: true, db: -12, fadeIn: 1 }]`.
   */
  sounds?: SoundClip[] | ((src: Sources) => SoundClip[]);
  /** This project's defaults for `reel video` (and the MCP video_start); a flag given overrides each. Plain data. */
  export?: ExportDefaults;
}

/** Defaults for a project's video exports. */
export interface ExportDefaults {
  /** x264/x265 quality for h264 (default 16) and hevc (default 18), 0 to 51; higher is smaller. Not applied to webm. */
  crf?: number;
  /** x264/x265 preset for h264 and hevc. */
  preset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow' | 'placebo';
  /** Leave the sound out (not with --mix or --subtitles, which make the finished sound; `--audio` keeps it). */
  noaudio?: boolean;
  /** Sub-frames per frame: a count, or 'auto' (not for drafts, which take one). */
  samples?: number | 'auto';
}

export function defineVideo(c: VideoConfig): VideoConfig {
  return c;
}

/** The format a config asks for, with defaults, checked. */
export function formatOf(c: VideoConfig): { w: number; h: number; fps: number } {
  const [w, h] = c.size ?? [1920, 1080], fps = c.fps ?? 60;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 16 || h < 16 || w > 8192 || h > 8192) throw new Error(`size [${w}, ${h}]: expected integers from 16 to 8192`);
  if (w % 4 || h % 2) throw new Error(`size [${w}, ${h}]: the width must be a multiple of 4 and the height even`);
  if (!(fps > 0 && fps <= 240)) throw new Error(`fps ${fps}: expected a frame rate up to 240`);
  return { w, h, fps };
}

/** A clip of a sequence: a Clip without its window, which the sequence works out from the lengths. */
export interface SequenceItem extends Omit<Clip, 'start' | 'end' | 'track'> {
  /** Seconds the clip is on screen, its transitions in and out included. */
  dur: number;
  /**
   * Seconds it overlaps the clip before, over which its transition plays (default: the sequence's `overlap` when it
   * has a transition, else 0, a cut). An overlap without a transition is a crossfade.
   */
  overlap?: number;
}

/** Where a sequence starts and what its clips take by default. */
export interface SequenceOptions {
  /** When the first clip starts, in video seconds (default 0). */
  start?: number;
  /** The track its clips are on (default 0). */
  track?: number;
  /** The transition of every clip after the first that names none (default none: cuts). */
  transition?: TransitionKind | Transition;
  /** The overlap of a clip after the first that has a transition and gives no overlap (default 0.5). */
  overlap?: number;
}

/** Times worked out by adding lengths, to the microsecond (so 4.4 - 0.4 is 4, not 4.000000000000001). */
const us = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Clips back to back on one track, each starting where the one before ends less its overlap: the edit of a video
 * without narration, written as lengths instead of times.
 *
 *   sequence([
 *     { id: 'title', scene: () => import('./scenes/title'), dur: 4.4 },
 *     { id: 'light', scene: () => import('./scenes/light'), dur: 5, transition: 'slide' },
 *   ], { overlap: 0.4 })  // title 0 to 4.4, light 4 to 9, sliding in over 0.4 s
 */
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
    // (the clip before must still be on screen alone between its own transition in and this one: no three at once)
    if (k > 0 && (overlapIn + overlap > items[k - 1]!.dur + 1e-9 || overlap >= items[k - 1]!.dur)) throw new Error(`${where}: overlap ${overlap} reaches back past the start of the clip before, '${items[k - 1]!.id}' (${items[k - 1]!.dur} s, ${overlapIn} s of it overlapping the clip before it)`);
    const start = us(t - overlap), end = us(start + dur);
    out.push({ ...clip, ...(transition !== undefined ? { transition } : {}), start, end, ...(o.track !== undefined ? { track: o.track } : {}) });
    t = end;
    overlapIn = overlap;
  });
  return out;
}

/** How clipsFromSections joins its clips and what it hands them. */
export interface SectionOptions {
  /** How each clip after the first comes in: a transition for all, or one per section by name (undefined: a cut). */
  transition?: TransitionKind | Transition | ((name: string) => TransitionKind | Transition | undefined);
  /**
   * Seconds two clips overlap across each section boundary that has a transition, centred on it, over which the
   * transition plays (default 0.5). Without `transition`, an overlap crossfades every boundary.
   */
  overlap?: number;
  /** ctx.params of every clip, or of each by its section's name. */
  params?: Record<string, unknown> | ((name: string) => Record<string, unknown> | undefined);
}

/**
 * One clip per named section that has a scene module of the same name, each running until the next begins
 * (the first from 0): the edit of a narrated video, whose sections are the plates of its script.
 * `modules` is `import.meta.glob('./scenes/*.ts')`. With a transition or an overlap, neighbouring clips overlap
 * by `overlap` seconds centred on the boundary between them.
 */
export function clipsFromSections(src: Sources, modules: Record<string, () => Promise<unknown>>, o: SectionOptions = {}): Clip[] {
  const mod = (name: string) => modules[`./scenes/${name}.ts`] as Clip['scene'] | undefined;
  const have = src.audio.sections.filter((s) => mod(s.name));
  const bounds = have.map((s, k) => (k === 0 ? 0 : s.start)).concat(src.audio.duration);
  const transitionOf = (name: string) => (typeof o.transition === 'function' ? o.transition(name) : o.transition);
  if (o.overlap !== undefined && !(Number.isFinite(o.overlap) && o.overlap >= 0)) throw new Error(`clipsFromSections: overlap ${o.overlap} must be 0 or more seconds`);
  // each clip's transition in (none for the first), and half the overlap across the boundary it starts at
  const transitions = have.map((s, k) => (k > 0 ? transitionOf(s.name) : undefined));
  const half = have.map((_, k) => (k === 0 ? 0 : o.transition === undefined ? o.overlap ?? 0 : transitions[k] !== undefined ? o.overlap ?? 0.5 : 0) / 2).concat(0);
  return have.map((s, k) => {
    const start = us(bounds[k]! - half[k]!), end = us(bounds[k + 1]! + half[k + 1]!);
    // (as in sequence: never three clips at once, and no clip starting or ending with the one beside it)
    const len = bounds[k + 1]! - bounds[k]!;
    if (half[k]! + half[k + 1]! > len + 1e-9 || half[k]! >= len || half[k + 1]! >= len) throw new Error(`clipsFromSections: section '${s.name}' (${(bounds[k + 1]! - bounds[k]!).toFixed(2)} s) is too short for its overlaps`);
    const transition = transitions[k];
    const params = typeof o.params === 'function' ? o.params(s.name) : o.params;
    return { id: s.name, scene: mod(s.name)!, start, end, ...(transition !== undefined ? { transition } : {}), ...(params ? { params } : {}) };
  });
}
