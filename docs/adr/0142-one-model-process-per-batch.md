# Each local model runs in one process for all its passages

Loading a model costs more than one passage's work. So every local model the tools drive gets one process and a jobs file that lists every passage:

- `forcedAlign` (`tools/aligner.ts`) aligns all passages with one `tools/forced_align.py` run. The first run fetches Qwen3-ForcedAligner (about 1.2 GB).
- `transcribe` (`tools/align.ts`) sends every recording through one `tools/whisper_words.py` run, both for `--method whisper` and for the verify pass. The model loads once for every job.
- The Kokoro voice (`tools/voices/kokoro.ts`) voices every passage with one `kokoro_tts.py` run.

## Consequences

A batched local voice hands its passages to `synth`'s `each` callback only after the whole process has finished, not one at a time. That is allowed for a local voice, because nothing was paid for. It is not allowed for a hosted voice (see the plate-caching decision).
