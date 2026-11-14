// A video project's configuration: `reel.config.ts` in the project folder default-exports defineVideo({...}).
// This module is plain data and types (no GL), so the CLI can read a config outside the browser. For the same
// reason a config's top level stays plain too: scene modules are named as lazy imports and anything that
// touches the engine lives inside `timeline()`.
import type { SceneClass } from './engine/scene';
import type { PostParams } from './engine/post';
import type { Words } from './engine/words';
import type { AudioData } from './engine/audio';
import type { BlendMode } from './engine/gl';
import type { Theme, ThemeName } from './themes';
import type { CheckRule } from './engine/report';

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
   * How the clip's track is drawn over the tracks below (default 'normal'), and how strongly (default 1; under
   * the lowest track is black). Across a transition the opacity fades from the outgoing clip's to the incoming
   * one's; the blend is the incoming clip's.
   */
  blend?: BlendMode;
  opacity?: number;
  /** Default post overrides while the clip is on screen (the scene's own overrides win). */
  post?: Partial<PostParams>;
  /** Free-form values handed to the scene as ctx.params (one scene module can serve several clips). */
  params?: Record<string, unknown>;
  /** Cap on adaptive motion-blur sub-frames while the clip is on screen (for noise that converges slowly). */
  maxSamples?: number;
  /** `reel check` rules this clip is meant to break (a deliberate black frame: ['blank']); true: all of them. */
  check?: { exempt?: CheckRule[] | true };
}

/** What `timeline()` is given: the project's timed words and audio analysis (both empty when it has none). */
export interface Sources {
  words: Words;
  audio: AudioData;
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
  /** The edit: every clip of the video. Called once the sources are loaded. */
  timeline(src: Sources): Clip[];
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

/**
 * One clip per named section that has a scene module of the same name, each running until the next begins
 * (the first from 0): the edit of a narrated video, whose sections are the plates of its script.
 * `modules` is `import.meta.glob('./scenes/*.ts')`.
 */
export function clipsFromSections(src: Sources, modules: Record<string, () => Promise<unknown>>): Clip[] {
  const mod = (name: string) => modules[`./scenes/${name}.ts`] as Clip['scene'] | undefined;
  const have = src.audio.sections.filter((s) => mod(s.name));
  return have.map((s, k) => ({ id: s.name, scene: mod(s.name)!, start: k === 0 ? 0 : s.start, end: have[k + 1]?.start ?? src.audio.duration }));
}
