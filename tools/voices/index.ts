import { elevenlabs } from './elevenlabs';
import { fish } from './fish';
import { kokoro } from './kokoro';
import { say } from './say';
import type { Voice, VoiceEnv, VoiceSource } from './voice';

export const SOURCES: Record<string, VoiceSource> = { kokoro, say, elevenlabs, fish };

export function voiceOf(spec: string, ctx: VoiceEnv = { env: process.env, fetch }): Voice {
  const i = spec.indexOf(':'), name = i < 0 ? spec : spec.slice(0, i), arg = i < 0 ? '' : spec.slice(i + 1);
  const src = Object.prototype.hasOwnProperty.call(SOURCES, name) ? SOURCES[name] : undefined;
  if (!src) throw new Error(`voice '${spec}': expected ${Object.keys(SOURCES).map((k) => `${k}[:…]`).join(', ')}`);
  return src.create(arg, ctx);
}

export type { Voice, VoiceEnv, VoiceSource, SynthRequest, Speech } from './voice';
