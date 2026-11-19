// Timing and music analysis (data/audio.json: reel narrate, reel align or reel analyze)
// sampled at arbitrary time.

export interface AudioJSON {
  duration: number;
  bpm: number;
  fps: number;
  beats: number[];
  downbeats: number[];
  sections: { name: string; start: number; end: number }[];
  features: Record<string, number[]>;
  onsets: Record<string, [number, number][]>;
  /** The sound the preview plays and the export muxes, relative to the project root (default audio/narration.flac). */
  track?: string;
  /** `reel analyze`'s waveform of the song (a bed's, placed at its offset, with --keep-sections): peak and RMS per 1/fps s, base64 bytes (0..255 for 0..1, one scale). */
  wave?: { fps: number; peak: string; rms: string };
  /** `reel analyze`'s spectrum: band centres in Hz, and per 1/fps s a row of their levels (base64 bytes, 0..255 for 0..1). */
  spectrum?: { fps: number; bands: number[]; data: string };
}

/** Base64 to bytes (atob: the same in the page and in bun). */
function bytes(b64: string | undefined): Uint8Array {
  if (!b64) return new Uint8Array(0);
  const s = atob(b64), o = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i);
  return o;
}

export interface AudioSample {
  rms: number; low: number; mid: number; high: number;
  vocal: number; drums: number; bass: number; other: number;
  /** Decaying pulses (1 at the hit, half-life ~90-140 ms), scaled by hit strength. */
  kick: number; snare: number; hat: number; vonset: number;
}

/** A project file as JSON, or null when it is missing (the dev server answers a missing file with the page). */
export async function fetchJSON(url: string): Promise<unknown> {
  const r = await fetch(url);
  return r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : null;
}

const FEATURES = ['rms', 'low', 'mid', 'high', 'vocal', 'drums', 'bass', 'other'] as const;

export class AudioData {
  duration: number;
  bpm: number;
  beats: number[];
  downbeats: number[];
  sections: { name: string; start: number; end: number }[];
  private fps: number;
  private feat: Record<string, Float32Array> = {};
  onsets: Record<string, [number, number][]>;
  /** The sound the preview plays and the export muxes, or null: a video with no audio analysis is silent. */
  track: string | null;
  /** The spectrum's band centres in Hz, lowest first (empty without a spectrum: analysed before it was stored). */
  bandFreqs: number[];
  private waveFps: number;
  private peak: Uint8Array;
  private rmsWave: Uint8Array;
  private specFps: number;
  private spec: Uint8Array;

  constructor(j: AudioJSON) {
    this.duration = j.duration;
    this.bpm = j.bpm;
    this.beats = j.beats;
    this.downbeats = j.downbeats;
    this.sections = j.sections;
    this.fps = j.fps || 100;
    // envelopes may be nested under `features` or top-level arrays
    for (const k of FEATURES) this.feat[k] = Float32Array.from(j.features?.[k] ?? ((j as any)[k] as number[] | undefined) ?? []);
    this.onsets = j.onsets ?? {};
    this.track = j.track ?? (j.duration > 0 ? 'audio/narration.flac' : null);
    this.waveFps = j.wave?.fps || 100;
    this.peak = bytes(j.wave?.peak);
    this.rmsWave = bytes(j.wave?.rms);
    this.specFps = j.spectrum?.fps || 100;
    this.bandFreqs = j.spectrum?.bands ?? [];
    this.spec = bytes(j.spectrum?.data);
  }

  /** Whether the analysis has a waveform and a spectrum (`reel analyze` stores both; narration has neither). */
  get hasWave() { return this.peak.length > 0; }
  get hasSpectrum() { return this.spec.length > 0 && this.bandFreqs.length > 0; }

  /**
   * The mix's waveform at t, 0..1 on one scale (1: the loudest peak): `peak` (the largest sample) and `rms`.
   * `span` 0 (the default) interpolates between the 1/100 s frames; a longer span gives the peak and RMS over
   * [t - span/2, t + span/2], what a bar standing for that much time shows. 0 outside the song and without a
   * waveform.
   */
  wave(t: number, span = 0): { peak: number; rms: number } {
    const P = this.peak, R = this.rmsWave, n = P.length, fps = this.waveFps;
    if (n === 0) return { peak: 0, rms: 0 };
    if (span * fps < 1) {
      // (frame i is the samples of [i/fps, (i+1)/fps): its value stands at its middle)
      const x = t * fps - 0.5, i = Math.floor(x), u = x - i;
      const at = (a: Uint8Array, k: number) => (k >= 0 && k < n ? a[k]! : 0);
      if (i < -1 || i >= n) return { peak: 0, rms: 0 };
      return { peak: (at(P, i) * (1 - u) + at(P, i + 1) * u) / 255, rms: (at(R, i) * (1 - u) + at(R, i + 1) * u) / 255 };
    }
    // frames [a, b): those past the song's ends count as silence in the RMS
    const a = Math.round((t - span / 2) * fps), b = Math.round((t + span / 2) * fps);
    const i0 = Math.max(0, a), i1 = Math.min(n, b);
    if (i1 <= i0) return { peak: 0, rms: 0 };
    let pk = 0, ss = 0;
    for (let i = i0; i < i1; i++) { pk = Math.max(pk, P[i]!); ss += R[i]! * R[i]!; }
    return { peak: pk / 255, rms: Math.sqrt(ss / (b - a)) / 255 };
  }

  /**
   * The spectrum at t: each band's level 0..1 (lowest band first), interpolated between the 1/100 s frames. With
   * `n` other than the band count, `n` levels across the same log-frequency range: fewer take the loudest of the
   * bands each covers, more interpolate between bands. Zeros outside the song and without a spectrum.
   */
  bands(t: number, n = this.bandFreqs.length, out = new Float32Array(n)): Float32Array {
    if (out.length !== n) throw new Error(`bands: out holds ${out.length} levels, not ${n}`);
    out.fill(0);
    const B = this.bandFreqs.length, S = this.spec, frames = B ? Math.floor(S.length / B) : 0;
    if (frames === 0 || n === 0) return out;
    // (frame i is the spectrum at i/fps: the STFT's windows are centred on their frames)
    const x = t * this.specFps, i = Math.floor(x), u = x - i;
    if (i < -1 || i >= frames) return out;
    const lvl = (b: number) => {
      const a = i >= 0 ? S[i * B + b]! : 0, c = i + 1 < frames ? S[(i + 1) * B + b]! : 0;
      return (a * (1 - u) + c * u) / 255;
    };
    for (let k = 0; k < n; k++) {
      if (n < B) {
        // level k covers stored bands [k B / n, (k + 1) B / n)
        let m = 0;
        for (let b = Math.floor((k * B) / n); b < Math.floor(((k + 1) * B) / n); b++) m = Math.max(m, lvl(b));
        out[k] = m;
        continue;
      }
      // level k of n at the same place across the range as in the stored bands
      const y = n === B ? k : (k * (B - 1)) / (n - 1), b = Math.floor(y), v = y - b;
      out[k] = v > 0 && b + 1 < B ? lvl(b) * (1 - v) + lvl(b + 1) * v : lvl(Math.min(b, B - 1));
    }
    return out;
  }

  /** No analysis: a silent 100 BPM grid, no sections (the length then comes from the config or its clips). */
  static empty(): AudioData {
    return new AudioData({ duration: 0, bpm: 100, fps: 100, beats: [], downbeats: [], sections: [], features: {}, onsets: {} });
  }

  /** `src`: the JSON's path in the project, false for none; by default data/audio.json if the project has one. */
  static async load(src?: string | false): Promise<AudioData> {
    if (src === false) return AudioData.empty();
    const j = await fetchJSON(src ?? 'data/audio.json');
    if (j) return new AudioData(j as AudioJSON);
    if (src) throw new Error(`audio analysis not found: ${src}`);
    return AudioData.empty();
  }

  /** Linear-interpolated envelope value at time t. */
  env(name: string, t: number): number {
    const a = this.feat[name];
    if (!a || a.length === 0) return 0;
    const x = t * this.fps;
    const i = Math.floor(x);
    if (i < 0) return a[0]!;
    if (i >= a.length - 1) return a[a.length - 1]!;
    const f = x - i;
    return a[i]! * (1 - f) + a[i + 1]! * f;
  }

  /** Max over [t - w, t]: a peak-hold for punchy reactions. */
  envPeak(name: string, t: number, w = 0.08): number {
    let m = 0;
    for (let s = t - w; s <= t; s += 1 / this.fps) m = Math.max(m, this.env(name, s));
    return m;
  }

  /** Sum of decaying pulses from onsets of a kind (kick/snare/hat/vocal) before t. */
  hit(kind: string, t: number, halfLife = 0.11): number {
    const list = this.onsets[kind];
    if (!list || list.length === 0) return 0;
    let lo = 0, hi = list.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m]![0] <= t) lo = m + 1; else hi = m; }
    let v = 0;
    for (let i = lo - 1; i >= 0 && i >= lo - 6; i--) {
      const [ot, s] = list[i]!;
      const dt = t - ot;
      if (dt > halfLife * 8) break;
      v = Math.max(v, s * Math.pow(0.5, dt / halfLife));
    }
    return v;
  }

  /** Onset events of a kind in [t0, t1). */
  events(kind: string, t0: number, t1: number): [number, number][] {
    return (this.onsets[kind] ?? []).filter(([t]) => t >= t0 && t < t1);
  }

  sample(t: number): AudioSample {
    return {
      rms: this.env('rms', t), low: this.env('low', t), mid: this.env('mid', t), high: this.env('high', t),
      vocal: this.env('vocal', t), drums: this.env('drums', t), bass: this.env('bass', t), other: this.env('other', t),
      kick: this.hit('kick', t, 0.12), snare: this.hit('snare', t, 0.14), hat: this.hit('hat', t, 0.06),
      vonset: this.hit('vocal', t, 0.15),
    };
  }

  /** The beat helpers' fallback grid with fewer than two beats: `bpm`, or 100 when the analysis has none. */
  private get gridBpm() { return this.bpm > 0 ? this.bpm : 100; }

  /**
   * Continuous beat index: 0 at first beat, fractional in between (extrapolated outside). With fewer than two
   * beats, the `bpm` grid from the one beat, or from 0.
   */
  beatAt(t: number): number {
    const b = this.beats;
    if (b.length < 2) return (t - (b[0] ?? 0)) * (this.gridBpm / 60);
    if (t <= b[0]!) return (t - b[0]!) / (b[1]! - b[0]!);
    if (t >= b[b.length - 1]!) {
      const p = b[b.length - 1]! - b[b.length - 2]!;
      return b.length - 1 + (t - b[b.length - 1]!) / p;
    }
    let lo = 0, hi = b.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m]! <= t) lo = m; else hi = m; }
    return lo + (t - b[lo]!) / (b[hi]! - b[lo]!);
  }

  /** Time of (fractional) beat index. */
  timeOfBeat(i: number): number {
    const b = this.beats;
    const n = b.length;
    const period = n > 1 ? (b[n - 1]! - b[0]!) / (n - 1) : 60 / this.gridBpm;
    if (n < 2 || i <= 0) return (b[0] ?? 0) + i * period;
    if (i >= n - 1) return b[n - 1]! + (i - (n - 1)) * period;
    const k = Math.floor(i);
    return b[k]! + (b[k + 1]! - b[k]!) * (i - k);
  }

  /** Continuous bar index from downbeats (0 at first downbeat). */
  barAt(t: number): number {
    const d = this.downbeats;
    if (d.length < 2) return this.beatAt(t) / 4;
    if (t <= d[0]!) return (t - d[0]!) / (d[1]! - d[0]!);
    if (t >= d[d.length - 1]!) {
      const p = d[d.length - 1]! - d[d.length - 2]!;
      return d.length - 1 + (t - d[d.length - 1]!) / p;
    }
    let lo = 0, hi = d.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m]! <= t) lo = m; else hi = m; }
    return lo + (t - d[lo]!) / (d[hi]! - d[lo]!);
  }

  /** Nearest beat time to t. */
  nearestBeat(t: number): number {
    return this.timeOfBeat(Math.round(this.beatAt(t)));
  }

  /**
   * The last beat at or before t (`tol` s of slack, for a word sung a hair before its beat): a cut that never
   * lands after t. Before the first beat, the grid's extrapolation, but never before 0.
   */
  beatBefore(t: number, tol = 0.02): number {
    return Math.max(0, this.timeOfBeat(Math.floor(this.beatAt(t + tol))));
  }

  /**
   * Nearest downbeat to t. Without downbeats, every 4th beat of the beat grid from beat 0; with only one, every 4th
   * beat from it.
   */
  nearestDownbeat(t: number): number {
    const d = this.downbeats;
    if (d.length < 2) {
      const b0 = d.length ? this.beatAt(d[0]!) : 0;
      return this.timeOfBeat(b0 + 4 * Math.round((this.beatAt(t) - b0) / 4));
    }
    return d.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), d[0]!);
  }

  section(t: number) {
    return this.sections.find((s) => t >= s.start && t < s.end) ?? this.sections[this.sections.length - 1];
  }
}
