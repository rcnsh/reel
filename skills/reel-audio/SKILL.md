---
name: reel-audio
description: Sound and timing for reel videos - voicing a narration script (Kokoro, macOS say, ElevenLabs, Fish Audio), aligning a real recording, analysing a song for beats and stems, the sound mix and its loudness, subtitles, and generated images and sounds (assets.json). Use when a reel project needs narration, a voice re-timed, music cut to, cue sounds, a finished mixed file, subtitles, or a picture or sound that does not exist yet.
---

# Sound, timing and generated assets in reel

A reel project is silent until it has a track. Every tool below writes plain files into the project; scenes read the
timing through `this.ctx.words` and `this.ctx.audio` (and `f.a`, `f.beat`), never the audio itself. Commands are
`reel <command>` (in a project made by `reel init`: `bun run reel <command>`); each takes `--project <folder>` and
`--help`. The same exist as MCP tools (`narrate`, `align_recording`, `analyze_song`, `mix_audio`, `subtitles`,
`assets`, and `video_start` with `mix`).

Nothing leaves the machine unless a hosted provider's key is in the environment: `ELEVENLABS_API_KEY`,
`FISH_API_KEY`, `OPENAI_API_KEY`. Local models run through MLX on Apple Silicon and PyTorch on the CPU elsewhere
(slower: on Linux allow a minute for a short narration or a song), and download once (Kokoro ~350 MB, the forced
aligner ~1.2 GB, the music models ~250 MB) into their normal caches.

## Narration: `reel narrate`

`narration.txt` holds **plates**: `# name` (letters, digits, `-`, `_`; it names the scene file) and the lines under
it; `//` lines are comments. `reel narrate` voices each plate as one passage and times every word:

| `--voice` | what | word times |
|---|---|---|
| `kokoro[:voice]` (default `kokoro:af_heart`) | local model; `am_michael`, `bf_emma`, `bm_george` … (English) | its duration predictor |
| `say[:name]` | macOS scratch voice, instant | forced aligner |
| `elevenlabs:<voice-id>` | hosted, `ELEVENLABS_API_KEY`; `--model eleven_v3` etc. | its character timestamps |
| `fish:<voice-id>` | hosted, `FISH_API_KEY` (a Fish Audio voice model id) | forced aligner |

- Settings: `--speed 1`, `--lead 0.6` (s before the first word), `--hold 0.85` (s at least between plates),
  `--tail 1.6` (s after the last word), `--model`, `--language English`. Put the project's choice in the config so
  every run agrees: `narration: { voice: 'kokoro:bm_george', speed: 1.05, tail: 3 }` in `reel.config.ts`.
- Plates are cached in `audio/.narration/` by text, voice, speed, model and language: after editing one line only that plate
  is voiced again (with a hosted voice, the others cost nothing). Pauses are applied afterwards, so changing them
  voices nothing. `--force` voices everything again.
- With a hosted voice each plate is cached as soon as it arrives, and requests are retried on HTTP 429, 5xx and network errors
  (after the service's Retry-After when it sends one). After a failure (a spent quota, a rejected key) fix it and
  run `reel narrate` again: only the plates still missing are voiced.
- Each plate is trimmed and brought to -16 LUFS; word edges are snapped to the pauses in the audio.
- Writes `audio/narration.flac` (lossless), `data/words.json` (`lines[]` with `plate`, `text`, `start`, `end`,
  `words[]` of `{ w, start, end }`) and `data/audio.json` (the track, the length, one section per plate, a silent
  100 BPM grid). Never edit them by hand.

Numbers and symbols are spoken as written (`3.5` as "three point five"); write the script the way it should sound
if a voice reads a figure oddly.

## A real recording: `reel align <recording | folder>`

The script is known, so its words are force-aligned to the audio (Qwen3-ForcedAligner): word starts land within
about 15 ms of where they are spoken (80 ms worst) at phrase edges. A folder holds one file per plate named after
it (`intro.m4a`); one file is a single take of the whole script, cut between plates at the quietest point. The take
is high-passed and brought to -16 LUFS; `--lead/--hold/--tail` lay it out like narrate. A forced aligner places
every word even when the take skips, repeats or rewords a line, so align then transcribes the take (faster-whisper)
and warns, exiting 1, about each line whose words are not heard where they were placed: fix the take or the script
(`--no-verify` skips the check). `--method whisper`
transcribes and matches instead, for a reading that departs from the script (about 100 ms off, worse on figures).
Sung lyrics: `reel align <vocal-stem-or-song> --method whisper`.

## A song: `reel analyze <song>`

Writes `data/audio.json` and copies the song to `audio/` as the track:

- `beats`, `downbeats`, `bpm`, `time_signature` from Beat This! (a constant grid where the song keeps one tempo,
  phase set on the kicks; the tracked beats where the tempo moves).
- 100 fps envelopes (0..1): `rms low mid high` of the mix, `drums bass other vocal` of Demucs stems.
- Onsets `[time, strength]`: `kick snare hat` from the drum stem, `vocal` from the vocal stem.
- Sections: `--sections sections.json` (`[{ "name": "intro", "bar": 0 }, { "name": "drop", "start": 31.2 }]`, named
  after scenes), else segmented (`part1`, `part2` …).
- `--fast`: no models (librosa; stems are rough proxies; a moving tempo loses it). For drafts.
- A bed under narration: time the narration first, then `reel analyze bed.flac --keep-sections --offset 12`, and
  lay it in `mix.json` from the same time: `{ "file": "bed.flac", "at": 12 }`.

In scenes: `f.a.kick` (a decaying pulse), `f.a.drums`, `f.beat`, `f.bar`, `f.beatPhase`; `audio.hit('snare', t)`,
`audio.env('vocal', t)`. Cut on the beat in the config: `src.audio.nearestDownbeat(t)`, `src.audio.beatBefore(t)`.

## Cues and the mix

A scene asks for a sound with `cue(kind, t)` in `init()` (times from words or beats). `mix.json`:

```json
{
  "music": [{ "file": "bed.flac", "from": "intro", "to": "outro", "db": -17, "fadeIn": 2, "fadeOut": 4 }],
  "duck": { "threshold": -30.5, "ratio": 4, "attack": 80, "release": 600 },
  "cues": { "tick": { "file": "tick.wav", "db": -6, "minGap": 0.15 }, "land": { "file": "impact" } },
  "entryCues": { "whoosh": ["chapter2", "chapter3"] },
  "loudness": { "integrated": -14, "truePeak": -1, "lra": 11 },
  "voiceDb": 0
}
```

- Files are the project's (`audio/`), or the bundled cue sounds by name: `tick`, `click`, `pop`, `whoosh`,
  `swell`, `impact`. A cue kind named after a bundled sound needs no entry (it plays at -6 dB).
- Music runs from the start of clip `from`, or from `at` seconds (without either, the start of the video), to the
  start of clip `to` (without it, the end of the video), looped (`"loop": false`: once, ending with its file), ducked
  under the track. A partial render hears the bed from where it has got to. `duck` sets the ducking (ffmpeg's
  `sidechaincompress`: `threshold` in dB, `ratio`, `attack` and `release` in ms; the defaults are those above, the
  threshold exactly 0.03, about -30.5 dB),
  `false` turns it off. `entryCues` add a cue of that kind at the start of each
  listed clip; they are added by the mix, so `reel events` counts only the cues scenes made.
- Sounds placed on the timeline go in the config, not `mix.json`: `sounds: [{ file: 'audio/door.wav', at: 4.2, db: -3 }]`
  (or `(src) => […]` with times from words or beats; fields `from`, `duration`, `loop`, `speed`, `fadeIn`, `fadeOut`),
  or `sound({ … })` from a scene's `init()`. They are laid as they are, not ducked.
- `loudness` defaults to -14 LUFS integrated, -1 dBTP (two-pass EBU R128: measured, then a linear gain where the
  true peak allows, else loudnorm's limiter); `false` turns it off. Any number of cues is cheap: each kind is summed
  into one track before ffmpeg runs.
- **`reel video --samples auto --mix`** renders and mixes into the finished file and prints its LUFS and true peak.
  To re-mix a render without re-rendering: `reel events` (writes `data/cues.json`), then
  `reel mix out/raw.mp4 out/final.mp4` (a partial render with the same `--from`).
- The track is read from its lossless file; the only lossy step is the final encode (AAC in .mp4, Opus in .webm;
  a .mov gets 24-bit PCM, lossless). The same project mixes to the same
  bytes every time, and a silent project mixes too.

## Subtitles

`reel subtitles` writes `subtitles.srt` and `subtitles.vtt` into `out/subtitles` (`--out` names another folder) from `data/words.json` (two lines of 42 characters
at most, 7 s at most, broken after punctuation). `reel video --subtitles` mixes and adds them as a soft track.
Burned-in captions are the kit's `Captions` component.

## Generated assets: `assets.json` and `reel assets`

```json
{ "assets": [
  { "id": "ridge", "kind": "image", "prompt": "Misty ridge at dawn, layered blue silhouettes", "size": [1600, 900], "out": "assets/ridge.png" },
  { "id": "riser", "kind": "sfx", "prompt": "Airy riser into a soft hit", "duration": 2, "out": "audio/riser.mp3" },
  { "id": "bed", "kind": "music", "prompt": "Calm piano, 90 BPM, sparse", "duration": 60, "out": "audio/bed.mp3" }
] }
```

- `reel assets` generates what is missing (or whose prompt, size or duration changed) when the key is set: images
  with OpenAI (`OPENAI_API_KEY`, `REEL_IMAGE_MODEL`), sound effects and music with ElevenLabs. Each is fitted to its
  size and format; `data/generated-assets.json` records what was made. Requests are retried on HTTP 429, 5xx and
  network errors, like a hosted voice's.
- Without a key it lists each missing asset's prompt, size and path and exits 1: tell the person what to make and
  where to save it. A file put there by hand is used and never overwritten.
- Until an image exists, `ImageBox` draws a labelled placeholder of its size, so layout work goes on; `reel check`
  reports every missing asset (`missingAsset`). Use the asset's `out` path as the `src`.

## Checking sound work

You cannot listen. Check by numbers and frames: the LUFS and true peak `--mix` prints; `data/words.json` against
the script (every word present, starts increasing); `reel still` at a word's start and a frame before it to see a
reveal land on the word; `reel strip` across a beat to see a pulse; `reel check` for missing assets.
