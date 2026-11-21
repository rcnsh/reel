import type { Clip, SoundClip } from '../config';

export interface ClipTime {
  start: number;
  end: number;
  speed: number;
  offset: number;
  reverse: boolean;
  freeze: number | null;
  hold: number;
  play: number;
  length: number;
  first: number;
  last: number;
  identity: boolean;
}

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

export function clipTime(c: Pick<Clip, 'id' | 'start' | 'end' | 'speed' | 'reverse' | 'offset' | 'freeze' | 'hold'>, fps: number): ClipTime {
  const where = `timeline: clip '${c.id}'`, dur = c.end - c.start, frame = 1 / fps;
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

export function sceneTime(m: ClipTime, t: number): number {
  if (m.identity) return t - m.start;
  if (m.freeze !== null) return m.freeze;
  let u = t - m.start;
  if (m.hold > 0) u = Math.min(u, m.last);
  return m.reverse ? Math.max(m.offset, m.offset + (m.first + m.last - u) * m.speed) : m.offset + u * m.speed;
}

export function sceneRate(m: ClipTime, t: number): number {
  if (m.freeze !== null || (m.hold > 0 && t - m.start > m.last + 1e-9)) return 0;
  return m.reverse ? -m.speed : m.speed;
}

export function videoTime(m: ClipTime, lt: number): number | null {
  if (m.identity) return m.start + lt;
  if (m.freeze !== null) return null;
  const k = (lt - m.offset) / m.speed;
  if (k < -1e-9) return null;
  if (m.reverse) return k <= m.play + 1e-9 ? m.start + Math.max(0, m.first + m.last - k) : null;
  return k < m.play - 1e-9 ? m.start + Math.max(0, k) : null;
}

export function statefulBlocker(m: ClipTime): string {
  return m.reverse ? 'reverse' : m.freeze !== null ? 'freeze' : m.offset > 0 ? 'start at an offset' : m.hold > 0 ? 'hold' : '';
}

export function videoSound(m: ClipTime, s: SoundClip): SoundClip | null {
  if (m.identity) return s;
  if (m.freeze !== null || m.reverse) return null;
  const a = s.at - m.start, hi = m.length, rate = s.speed ?? 1;
  const from = Math.max(a, m.offset);
  if (from >= hi - 1e-9) return null;
  const out: SoundClip = { ...s, at: m.start + (from - m.offset) / m.speed, speed: rate * m.speed };
  if (s.fadeIn !== undefined) out.fadeIn = s.fadeIn / m.speed;
  if (s.fadeOut !== undefined) out.fadeOut = s.fadeOut / m.speed;
  if (s.duration !== undefined) {
    const to = Math.min(a + s.duration, hi);
    if (to <= from + 1e-9) return null;
    out.duration = (to - from) / m.speed;
  }
  if (from > a) out.from = (s.from ?? 0) + (from - a) * rate;
  return out;
}
