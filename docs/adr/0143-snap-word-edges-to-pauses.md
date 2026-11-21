# Word edges snap to the pauses in the audio

Aligners place words on a coarse grid (80 ms for Qwen3-ForcedAligner). Phrase edges are where cuts and reveals land, so `snapToPauses` in `tools/align-words.ts` moves edges that fall near a pause onto it. This halves the error there. It works on 10 ms levels (`levels` in `tools/audio-io.ts`). A pause is a run of at least `min` frames 40 dB under the loudest, and the end of the audio counts as a pause. A start inside a pause or up to 80 ms after one moves to the pause's end, where the sound begins. An end up to 80 ms before a pause or inside one moves to the pause's start. Inside continuous speech nothing moves. Words stay in order and never overlap.

`refine` in `tools/aligner.ts` applies this to every timed source: a voice's own timestamps, the forced aligner and Whisper.
