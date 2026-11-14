// The narration settings a run uses: the defaults, then the project's config (`narration` in reel.config.ts),
// then the command's flags. Pure, so it is unit-tested; and the cache key of a voiced plate.
import { createHash } from 'node:crypto';
import type { NarrationSettings } from '../src/config';

export type Resolved = Required<Omit<NarrationSettings, 'model'>> & { model?: string };

export const DEFAULTS: Resolved = { voice: 'kokoro:af_heart', speed: 1, lead: 0.6, hold: 0.85, tail: 1.6, language: 'English' };

const KEYS = ['voice', 'speed', 'model', 'lead', 'hold', 'tail', 'language'];

/** Settings from the config's `narration` and flags (strings from the command line), checked. */
export function resolveSettings(config: NarrationSettings | undefined, flags: Record<string, string | boolean | undefined>): Resolved {
  for (const k of Object.keys(config ?? {})) if (!KEYS.includes(k)) throw new Error(`reel.config.ts: narration.${k} is not a setting (expected ${KEYS.join(', ')})`);
  const o: Record<string, unknown> = { ...DEFAULTS, ...(config ?? {}) };
  const shown: Record<string, unknown> = { ...o };
  for (const k of KEYS) {
    const f = flags[k];
    if (typeof f !== 'string') continue;
    shown[k] = f;
    o[k] = ['speed', 'lead', 'hold', 'tail'].includes(k) ? (f.trim() === '' ? NaN : Number(f)) : f;
  }
  const r = o as Resolved;
  if (typeof r.voice !== 'string' || !r.voice) throw new Error('narration voice: expected a voice such as kokoro:af_heart');
  if (!(r.speed >= 0.5 && r.speed <= 2)) throw new Error(`narration speed ${shown.speed}: expected 0.5 to 2`);
  for (const k of ['lead', 'hold', 'tail'] as const) if (!(r[k] >= 0 && r[k] <= 30)) throw new Error(`narration ${k} ${shown[k]}: expected seconds from 0 to 30`);
  return r;
}

/**
 * What makes a voiced plate reusable: the voice, its rate and model, the text, and the language (the forced aligner
 * times a voice without timestamps in it); not the pauses, applied later.
 */
export function plateKey(voice: string, s: Resolved, text: string) {
  return createHash('sha256').update(JSON.stringify({ v: 1, voice, speed: s.speed, model: s.model ?? null, language: s.language, text })).digest('hex').slice(0, 16);
}
