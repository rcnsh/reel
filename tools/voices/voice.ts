// What every voice source provides to `reel narrate`. A source is one file in tools/voices/ exporting a
// VoiceSource, listed in tools/voices/index.ts.
import type { HttpEnv } from '../http';

/** A passage to speak: one plate of the script. `previous` and `next` are the neighbouring plates' text, for voices that use context. */
export interface SynthRequest { text: string; previous?: string; next?: string; speed: number; model?: string }

/** The speech for a passage: an audio file (any format ffmpeg reads) and, when the voice knows them, its tokens' times. */
export interface Speech { file: string; words?: { w: string; start: number; end: number }[] }

export interface Voice {
  /** 'kokoro:af_heart': what notes and cache keys name. */
  id: string;
  /**
   * Speak the passages into files in `work` (a scratch folder), in order, handing each to `each` (and awaiting it).
   * A voice that pays per request hands each over as soon as it arrives, so a failure on a later passage leaves the
   * earlier ones kept; a local model run once for every passage may hand them over when it ends.
   */
  synth(reqs: SynthRequest[], work: string, each: (i: number, s: Speech) => Promise<void>): Promise<void>;
}

/** The environment (for keys), fetch and the retry timer: replaceable in tests. */
export type VoiceEnv = HttpEnv;

export interface VoiceSource {
  /** One line for --help: what the source is and what its argument names. */
  about: string;
  /** True when it sends text to a service (it then needs its key in the environment). */
  hosted: boolean;
  /** The voice for the part after the colon (empty for the default). Throws when it cannot be used (a missing key). */
  create(arg: string, ctx: VoiceEnv): Voice;
}
