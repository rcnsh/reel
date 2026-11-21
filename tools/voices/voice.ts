import type { HttpEnv } from '../http';

export interface SynthRequest { text: string; previous?: string; next?: string; speed: number; model?: string }

export interface Speech { file: string; words?: { w: string; start: number; end: number }[] }

export interface Voice {
  id: string;
  synth(reqs: SynthRequest[], work: string, each: (i: number, s: Speech) => Promise<void>): Promise<void>;
}

export type VoiceEnv = HttpEnv;

export interface VoiceSource {
  about: string;
  hosted: boolean;
  create(arg: string, ctx: VoiceEnv): Voice;
}
