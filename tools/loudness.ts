
export interface Loudness { integrated: number; truePeak: number; lra: number; threshold: number; offset: number }

export interface LoudnessTarget { integrated: number; truePeak: number; lra?: number }

export const STREAMING: LoudnessTarget = { integrated: -14, truePeak: -1, lra: 11 };

export function parseLoudnorm(stderr: string): Loudness {
  const i = stderr.lastIndexOf('{'), j = stderr.lastIndexOf('}');
  if (i < 0 || j < i) throw new Error(`no loudness measurement in ffmpeg's output: ${stderr.slice(-400)}`);
  const o = JSON.parse(stderr.slice(i, j + 1)) as Record<string, string>;
  const n = (k: string) => (o[k] === '-inf' ? -Infinity : o[k] === 'inf' ? Infinity : Number(o[k]));
  return { integrated: n('input_i'), truePeak: n('input_tp'), lra: n('input_lra'), threshold: n('input_thresh'), offset: n('target_offset') };
}

export interface R128 { integrated: number; truePeak: number; lra: number }

export const EBUR128 = 'ebur128=peak=true:metadata=1:framelog=quiet,ametadata=mode=print:file=-';

export function parseEbur128(text: string): R128 {
  const last = (k: string) => {
    const i = text.lastIndexOf(`lavfi.r128.${k}=`);
    if (i < 0) return NaN;
    const j = text.indexOf('\n', i);
    return Number(text.slice(i + k.length + 12, j < 0 ? undefined : j));
  };
  const I = last('I'), tp = last('true_peak'), lra = last('LRA');
  if (Number.isNaN(I) || Number.isNaN(tp)) throw new Error(`no loudness measurement in ebur128's output: ${text.slice(-400)}`);
  return { integrated: I <= -70 ? -Infinity : I, truePeak: tp > 0 ? 20 * Math.log10(tp) : -Infinity, lra: Number.isNaN(lra) ? 0 : lra };
}

export function linearGain(t: LoudnessTarget, m: R128): number | null {
  if (!Number.isFinite(m.integrated)) return 0;
  const g = t.integrated - m.integrated;
  return m.truePeak + g <= t.truePeak && m.lra <= (t.lra ?? 11) ? g : null;
}

export function loudnormFilter(t: LoudnessTarget, m: Loudness, sr = 48000): string {
  const f = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '-70.00');
  return `loudnorm=I=${t.integrated}:TP=${t.truePeak}:LRA=${t.lra ?? 11}:measured_I=${f(m.integrated)}:measured_TP=${f(m.truePeak)}:measured_LRA=${f(m.lra)}:measured_thresh=${f(m.threshold)}:offset=${f(m.offset)}:linear=true,aresample=${sr}`;
}

export function loudnessTarget(v: unknown): LoudnessTarget | null {
  if (v === false) return null;
  if (v === undefined || v === true) return STREAMING;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('mix.json: loudness must be false or { integrated, truePeak, lra }');
  const o = { ...STREAMING, ...(v as object) } as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['integrated', 'truePeak', 'lra'].includes(k)) throw new Error(`mix.json: loudness: unknown key '${k}' (expected integrated, truePeak, lra)`);
  const t = o as unknown as LoudnessTarget;
  if (!(t.integrated >= -70 && t.integrated <= -5)) throw new Error(`mix.json: loudness.integrated ${t.integrated}: expected LUFS from -70 to -5`);
  if (!(t.truePeak >= -9 && t.truePeak <= 0)) throw new Error(`mix.json: loudness.truePeak ${t.truePeak}: expected dBTP from -9 to 0`);
  if (!(t.lra! >= 1 && t.lra! <= 50)) throw new Error(`mix.json: loudness.lra ${t.lra}: expected LU from 1 to 50`);
  return t;
}
