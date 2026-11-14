// A video clip's time: which moment of the source file shows at a moment of the clip (trim, speed, loop), which
// decoded frame that is (held or blended with the next), and the sound the mix lays under it. Pure functions, so the mapping is tested without a browser.
import type { SoundClip } from '../config';

export interface VideoTiming {
  /** The component's window in clip seconds, [start, end]. */
  at: [number, number];
  /** The part of the source played, in source seconds [from, to]. */
  trim: [number, number];
  /** Source seconds per clip second. */
  speed: number;
  /** Start the trim again at its end (else hold its last frame). */
  loop: boolean;
}

/** A decoded frame's place in the source: presentation time and duration (s), in presentation order. */
export interface FrameSpan { pts: number; dur: number }

/** The source time shown at clip time lt. */
export function sourceTime(lt: number, o: VideoTiming): number {
  const len = Math.max(0, o.trim[1] - o.trim[0]);
  let x = Math.max(0, lt - o.at[0]) * o.speed;
  if (o.loop && len > 0) x = x - Math.floor(x / len) * len;
  else x = Math.min(x, len);
  return o.trim[0] + x;
}

/** The index of the frame on display at source time u: the last whose pts is at or before u (the first before any). */
export function frameAt(frames: FrameSpan[], u: number): number {
  let lo = 0, hi = frames.length - 1;
  if (hi < 0) return -1;
  // (a hair of tolerance: a time computed as k / fps lands on frame k, not just before it)
  const v = u + 1e-7;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (frames[m]!.pts <= v) lo = m; else hi = m - 1; }
  return lo;
}

/** The last frame that starts inside the trim (a trim's end is exclusive), and the first. */
export function trimFrames(frames: FrameSpan[], o: VideoTiming): [number, number] {
  const first = frameAt(frames, o.trim[0]);
  let last = frameAt(frames, o.trim[1]);
  if (last > first && frames[last]!.pts >= o.trim[1] - 1e-7) last--;
  return [first, last];
}

/**
 * What shows at clip time lt: frame `a`, and with blending frame `b` mixed in by `w` (0..1, how far u is through
 * frame a towards b). Held frames have w 0 and b equal to a. The trim's last frame blends into its first when the
 * clip loops, and holds otherwise.
 */
export function framesAt(frames: FrameSpan[], lt: number, o: VideoTiming, blend: boolean): { a: number; b: number; w: number } {
  const [first, last] = trimFrames(frames, o);
  const u = sourceTime(lt, o);
  const a = Math.min(Math.max(frameAt(frames, u), first), last);
  if (!blend) return { a, b: a, w: 0 };
  const b = a < last ? a + 1 : o.loop ? first : a;
  const f = frames[a]!, w = b === a ? 0 : Math.min(1, Math.max(0, (u - f.pts) / f.dur));
  return { a, b, w };
}

/**
 * The clip's sound for the mix, in video time: one piece per pass through the trim (so a looped trim repeats its
 * own part of the file, not the whole file), from the window's start to its end. `clipStart` is the clip's start
 * in the video.
 */
export function videoSounds(file: string, clipStart: number, o: VideoTiming, db = 0): SoundClip[] {
  const len = o.trim[1] - o.trim[0], span = o.at[1] - o.at[0];
  if (len <= 0 || span <= 0) return [];
  const pass = len / o.speed, out: SoundClip[] = [];
  const n = o.loop ? Math.ceil(span / pass - 1e-9) : 1;
  for (let k = 0; k < n; k++) {
    const at = o.at[0] + k * pass, duration = Math.min(pass, o.at[1] - at);
    if (duration <= 1e-6) break;
    out.push({ file, at: clipStart + at, from: o.trim[0], duration, speed: o.speed, db, fadeIn: 0.01, fadeOut: 0.01 });
  }
  return out;
}
