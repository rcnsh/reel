// What every voice source provides to `reel narrate`. A source is one file in tools/voices/ exporting a
// VoiceSource, listed in tools/voices/index.ts.

/** A passage to speak: one plate of the script. `previous` and `next` are the neighbouring plates' text, for voices that use context. */
export interface SynthRequest { text: string; previous?: string; next?: string; speed: number; model?: string }

/** The speech for a passage: an audio file (any format ffmpeg reads) and, when the voice knows them, its tokens' times. */
export interface Speech { file: string; words?: { w: string; start: number; end: number }[] }

export interface Voice {
  /** 'kokoro:af_heart': what notes and cache keys name. */
  id: string;
  /** Speak the passages into files in `work` (a scratch folder), in order. */
  synth(reqs: SynthRequest[], work: string): Promise<Speech[]>;
}

export interface VoiceEnv {
  env: Record<string, string | undefined>;
  /** fetch, replaceable in tests. */
  fetch: typeof fetch;
}

export interface VoiceSource {
  /** One line for --help: what the source is and what its argument names. */
  about: string;
  /** True when it sends text to a service (it then needs its key in the environment). */
  hosted: boolean;
  /** The voice for the part after the colon (empty for the default). Throws when it cannot be used (a missing key). */
  create(arg: string, ctx: VoiceEnv): Voice;
}

/** An HTTP error from a hosted voice as one line, with the service's message. */
export async function httpError(service: string, r: Response): Promise<Error> {
  const body = (await r.text().catch(() => '')).slice(0, 400);
  return new Error(`${service}: HTTP ${r.status}${body ? `: ${body}` : ''}`);
}
