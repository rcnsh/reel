// A clip's time remapping: which moment of its scene's own time shows at a moment of the video (speed, reverse,
// offset, freeze, hold), the way back (for cues and sounds a scene places in its own time), and the checks of a
// clip's fields. Pure functions, so the mapping is tested without a browser.
import type { Clip, SoundClip } from '../config';

/**
 * A clip's mapping from video time to its scene's local time, checked. The scene's window is [start, start +
 * length) in scene time; `lt` is local scene seconds (0 at the window's start).
 */
export interface ClipTime {
  start: number;
  end: number;
  /** Scene seconds per video second. */
  speed: number;
  /** Scene seconds the clip's first frame shows (forward), or its last (reversed). */
  offset: number;
  reverse: boolean;
  /** The local scene time held over the whole clip, or null. */
  freeze: number | null;
  /** Video seconds at the clip's end held on the last frame played. */
  hold: number;
  /** Video seconds the clip plays before its hold. */
  play: number;
  /** The scene's window in its own seconds: offset + play x speed. */
  length: number;
  /**
   * The output frames the playing part shows, as video seconds from the clip's start: the first and the last (frames
   * fall on the video's 1/fps grid, wherever the clip starts). Reverse mirrors the run between them, so a reversed
   * clip shows exactly the forward one's frames; a hold shows the last.
   */
  first: number;
  last: number;
  /** No remapping at all: lt = t - start. */
  identity: boolean;
}

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** The time mapping of a clip, its remapping fields checked (throws naming the clip and the field). */
export function clipTime(c: Pick<Clip, 'id' | 'start' | 'end' | 'speed' | 'reverse' | 'offset' | 'freeze' | 'hold'>, fps: number): ClipTime {
  const where = `timeline: clip '${c.id}'`, dur = c.end - c.start, frame = 1 / fps;
  // (a hair of tolerance: a clip starting at k / fps starts on frame k)
  const gridFrom = (x: number) => Math.ceil(x * fps - 1e-6) / fps;
  if (c.speed !== undefined && !(num(c.speed) && c.speed >= 0.01 && c.speed <= 100)) throw new Error(`${where} speed ${c.speed}: expected scene seconds per video second, 0.01 to 100`);
  if (c.offset !== undefined && !(num(c.offset) && c.offset >= 0)) throw new Error(`${where} offset ${c.offset}: expected the scene seconds the clip starts at, 0 or more`);
  if (c.reverse !== undefined && typeof c.reverse !== 'boolean') throw new Error(`${where} reverse ${JSON.stringify(c.reverse)}: expected true or false`);
  if (c.hold !== undefined && !(num(c.hold) && c.hold >= 0 && dur - c.hold >= frame - 1e-9)) throw new Error(`${where} hold ${c.hold}: expected video seconds from 0 to the clip's length less a frame (${(dur - frame).toFixed(3)})`);
  const speed = c.speed ?? 1, offset = c.offset ?? 0, reverse = !!c.reverse, hold = c.hold ?? 0, play = dur - hold;
  const length = offset + play * speed;
  let freeze: number | null = null;
  if (c.freeze !== undefined) {
    if (reverse || hold) throw new Error(`${where}: freeze holds one moment, so it takes no ${reverse ? 'reverse' : 'hold'}`);
    if (!(num(c.freeze) && c.freeze >= 0 && c.freeze < length)) throw new Error(`${where} freeze ${c.freeze}: expected scene seconds inside its window, from 0 to under ${length.toFixed(3)}`);
    freeze = c.freeze;
  }
  const first = gridFrom(c.start) - c.start, last = gridFrom(c.start + play) - frame - c.start;
  if ((reverse || hold) && last < first - 1e-9) throw new Error(`${where}: it plays no whole frame before its ${hold ? 'hold' : 'end'}, so there is nothing to ${hold ? 'hold' : 'reverse'}`);
  const identity = speed === 1 && offset === 0 && !reverse && freeze === null && hold === 0;
  return { start: c.start, end: c.end, speed, offset, reverse, freeze, hold, play, length, first, last, identity };
}

/** The local scene time shown at video time t (outside the clip's window too: sub-frames reach past it). */
export function sceneTime(m: ClipTime, t: number): number {
  if (m.identity) return t - m.start;
  if (m.freeze !== null) return m.freeze;
  let u = t - m.start;
  // (a hold shows the last frame played)
  if (m.hold > 0) u = Math.min(u, m.last);
  // (reversed: the forward clip's frames in the opposite order, its last frame first and its first last; the late
  // sub-frames of its last frame would reach before the part of the scene it plays, so they stop there)
  return m.reverse ? Math.max(m.offset, m.offset + (m.first + m.last - u) * m.speed) : m.offset + u * m.speed;
}

/** Scene seconds per video second at video time t: 0 while held or frozen, negative reversed. */
export function sceneRate(m: ClipTime, t: number): number {
  // (the last frame played still moves: the hold starts after it)
  if (m.freeze !== null || (m.hold > 0 && t - m.start > m.last + 1e-9)) return 0;
  return m.reverse ? -m.speed : m.speed;
}

/**
 * The video time at which the clip's playing part shows local scene time lt, or null when it never does (before
 * the offset, past the part played, or a frozen clip). Where the scene's own time is placed in the video: cues.
 */
export function videoTime(m: ClipTime, lt: number): number | null {
  if (m.identity) return m.start + lt;
  if (m.freeze !== null) return null;
  // k: video seconds into the forward run at which the scene reaches lt
  const k = (lt - m.offset) / m.speed;
  if (k < -1e-9) return null;
  // (reversed, the run goes the other way: the scene's last frame's worth, which the run starts inside, lands at its start)
  if (m.reverse) return k <= m.play + 1e-9 ? m.start + Math.max(0, m.first + m.last - k) : null;
  // (a moment after the last frame played but before the hold still lands, as a sound starting there does)
  return k < m.play - 1e-9 ? m.start + Math.max(0, k) : null;
}

/**
 * Why a stateful scene cannot play on this clip, or '' when it can: its pre-roll after a seek re-simulates the scene
 * time before t from a reset, which only a forward run (at any speed) gives.
 */
export function statefulBlocker(m: ClipTime): string {
  return m.reverse ? 'reverse' : m.freeze !== null ? 'freeze' : m.offset > 0 ? 'start at an offset' : m.hold > 0 ? 'hold' : '';
}

/**
 * A sound a scene placed in its own time (`at` in scene time), in video time: trimmed to the part of the scene the
 * clip plays and sped up with it. A reversed or frozen clip lays none (a sound does not play backwards).
 */
export function videoSound(m: ClipTime, s: SoundClip): SoundClip | null {
  if (m.identity) return s;
  if (m.freeze !== null || m.reverse) return null;
  const a = s.at - m.start, hi = m.length, rate = s.speed ?? 1;
  const from = Math.max(a, m.offset);
  if (from >= hi - 1e-9) return null;
  const out: SoundClip = { ...s, at: m.start + (from - m.offset) / m.speed, speed: rate * m.speed };
  if (s.fadeIn !== undefined) out.fadeIn = s.fadeIn / m.speed;
  if (s.fadeOut !== undefined) out.fadeOut = s.fadeOut / m.speed;
  // (a sound given a length stops where the clip stops playing its scene; one without plays on, as it would unmapped)
  if (s.duration !== undefined) {
    const to = Math.min(a + s.duration, hi);
    if (to <= from + 1e-9) return null;
    out.duration = (to - from) / m.speed;
  }
  if (from > a) out.from = (s.from ?? 0) + (from - a) * rate;
  return out;
}
