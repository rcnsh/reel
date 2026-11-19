# Timing: words, audio and sound

## Narration

`narration.txt` holds plates: a `# name` header and its lines. Time it:

- `reel narrate`: a voice from the script: Kokoro (local, the default), `say` (macOS scratch), or ElevenLabs / Fish Audio (hosted, with their key). Word times come from the voice's own timestamps or a forced aligner. Plates are cached: only the ones whose text changed are voiced again.
- `reel align <recording>`: a real recording (one take, or a folder of per-plate files named after the plates). The script's words are force-aligned to it (Qwen3-ForcedAligner, about 15 ms from where words really start); `--method whisper` transcribes and matches instead, for a reading that departs from the script.

Both write `audio/narration.flac`, `data/words.json` and `data/audio.json` (a silent 100 BPM grid, one section per plate, each starting a quarter second before its first word), with `--lead`, `--hold` and `--tail` seconds of silence before the first word, between plates and after the last word (or `narration: { lead, hold, tail }` in the config). With `clipsFromSections` in the config, each plate shows the scene of the same name; a plate without a scene is skipped, so a video is built one plate at a time. The plates cut; `clipsFromSections(src, glob, { transition: 'wipe', overlap: 0.5 })` overlaps each pair across the cut instead, half before it and half after; a plate starts a quarter second before its first word (less when the hold is shorter than that), so with an overlap of 0.5 s or less the transition is over by the time that word is said. A `transition` function that returns undefined for a plate cuts to it.

## Words (`this.ctx.words`, `src.words`)

- `lines[]`: `{ i, text, start, end, words[] }`, each word `{ w, start, end }`. Text comes with typographic punctuation (`don’t`).
- `words.get('sudden drop')`: the first line containing the text (case-insensitive; straight or curly quotes, `...` or `…`, a hyphen or an en or em dash, spaced or not, all match); throws when none does. `words.get(text, n)` for the n-th. `find(s)`: all such lines.
- `lineAt(t)`, `lastLine(t)`, `nextLine(t)`, `linesIn(t0, t1)`, `wordAt(t)`, `lastWord(t)`, `findWords('word')`.
- A kit component's `at` takes lines and words directly, in video time: `new TextBlock({ text: '…', at: this.ctx.words.get('sudden drop') })` shows while the line is said (reference/kit.md).
- `Words.wordProgress(word, t)` (0..1 through a word), `Words.lineCharProgress(line, t)` (characters said so far: for letter-by-letter reveals and wipes).
- Empty (no lines) in a project without `data/words.json`.

## Audio analysis (`this.ctx.audio`, `src.audio`, and `f`)

- `beats[]`, `downbeats[]`, `sections[]` (`{ name, start, end }`), `duration`, `bpm`, `track` (the sound the preview plays and the export muxes).
- `beatAt(t)` (continuous beat index), `barAt(t)`, `timeOfBeat(i)`, `nearestBeat(t)`, `beatBefore(t)` (the beat at or before t: a cut that never lands after a word), `nearestDownbeat(t)`, `section(t)`.
- `env(name, t)` for `rms low mid high vocal drums bass other` (0..1), `envPeak(name, t, w)`, `hit(kind, t, halfLife)` (decaying pulses from `kick snare hat vocal` onsets), `events(kind, t0, t1)`.
- `wave(t, span?)` (`{ peak, rms }` of the mix, 0..1 on one scale; over `[t - span/2, t + span/2]` with a span), `bands(t, n?)` (the spectrum's levels 0..1, lowest first; `n` resamples them), `bandFreqs` (their centres in Hz), `hasWave`, `hasSpectrum`. The kit's `Waveform` and `Spectrum` draw them (reference/kit.md).
- Every frame carries `f.a` (`rms low mid high vocal drums bass other kick snare hat vonset`), `f.beat`, `f.bar`, `f.beatPhase`, `f.barPhase`.
- Narration timing gives a silent grid and empty envelopes (`f.a` reads 0). A project without `data/audio.json` gets a silent 100 BPM grid from 0 and no track; the beat helpers then answer on that grid (downbeats every 4th beat), as they do on `bpm` from the one beat when an analysis has a single beat.

## Music

`reel analyze <song> --sections sections.json` (`[{ "name": "intro", "bar": 0 }, …]`, named after your scenes) analyses a song: beats and downbeats (Beat This!; one tempo where the song keeps one, following it where it moves), 100 fps envelopes of the mix and of separated stems (`drums`, `bass`, `other`, `vocal`, from Demucs), a waveform and 24 spectrum bands of the mix, kick, snare and hat onsets from the drum stem and vocal onsets from the vocal stem, and sections (from the file, or segmented as `part1`, `part2` …). `--fast` is a quick draft without the models (librosa; the stems are rough harmonic/percussive proxies, and its one fitted tempo loses a moving one: `--free-tempo` follows it). The song becomes the track. For a narrated video with a music bed, time the narration first, then `reel analyze <bed> --keep-sections --offset <s>` adds the bed's beats from where it enters. `reel analyze --help` lists the flags. Sung words come from `reel align <vocal> --method whisper`.

To cut on the beat, snap clip starts in `timeline(src)`: `src.audio.beatBefore(src.words.get('first words').words[0].start)`, or `src.audio.nearestDownbeat(t)` at the end of a line. To pulse on the kick: `f.a.kick` (or `audio.hit('kick', t, 0.12)`).

## The sound mix

A scene that wants a sound calls `cue(kind, t)` in `init()` (a pen tick at each word's start, a whoosh at an entrance). `mix.json` in the project maps kinds to files in `audio/` and lays music beds:

```json
{
  "music": [{ "file": "bed.mp3", "from": "intro", "to": "outro", "db": -17, "fadeIn": 2, "fadeOut": 4 }],
  "cues": { "tick": { "file": "tick.wav", "db": -6, "minGap": 0.15 } },
  "entryCues": { "whoosh": ["chapter2", "chapter3"] }
}
```

Sound files are the project's, in `audio/`, or the engine's bundled cue sounds by name: `tick`, `click`, `pop`, `whoosh`, `swell`, `impact` (`"file": "whoosh"`); a `cue('whoosh', t)` with no entry in `mix.json` plays the bundled whoosh. `music` runs from the start of clip `from` (or from `at` seconds) to the start of clip `to` (without them, from the start of the video and to its end), looped (`"loop": false` plays it once), ducked under the track (`"duck": { "threshold": -20, "ratio": 4, "attack": 80, "release": 600 }` sets it: threshold in dB, by default about -30.5, the others as shown; `false` for none); a partial render hears it from where it has got to. `"loudness": { "integrated": -14, "truePeak": -1 }` is the default target (two-pass EBU R128), `false` turns it off. `reel video --mix` renders and mixes in one go; to re-mix a render, `reel events` writes `data/cues.json` (the clips and every cue), then `reel mix <render.mp4> <out.mp4>`. A partial render mixes with the same `--from`. The track comes from its lossless file, so the sound is encoded once.

A sound that belongs to the edit rather than to a scene goes in the config's `sounds`, as data or a function of the sources: `sounds: (src) => [{ file: 'audio/rain.flac', at: src.words.get('it rained').start, duration: 8, loop: true, db: -12, fadeIn: 1 }]`. Each takes `file` (a project path, a video whose sound to use, or a bundled name), `at`, and optionally `from` (seconds into the file), `duration`, `loop`, `speed` (0.1 to 10, pitch kept), `db`, `fadeIn` and `fadeOut`. A scene can place one the same way with `sound({ … })` in `init()`. A file that is missing is a scene error that `reel check` reports.

## Clip time

A clip can play its scene at another speed, backwards, from partway in, or frozen, without the scene knowing. The scene runs in its own time, which the clip maps the video's onto:

```ts
{ id: 'replay', scene: () => import('./scenes/race'), start: 8, end: 12, speed: 0.5, offset: 3 },  // slow motion from 3 s in
{ id: 'rewind', scene: () => import('./scenes/race'), start: 12, end: 14, speed: 2, reverse: true },
{ id: 'still', scene: () => import('./scenes/race'), start: 14, end: 15, speed: 4, freeze: 2.4 },  // 2.4 s in, its window 4 s
{ id: 'outro', scene: () => import('./scenes/end'), start: 15, end: 20, hold: 1.5 },  // plays 3.5 s, holds its last frame
```

- `speed`: scene seconds per video second (0.01 to 100; default 1). `offset`: the scene seconds the clip starts at (default 0). The scene's window is `offset + (end - start - hold) * speed` of its seconds, so `f.p`, `f.end` and the kit's default windows cover what the clip plays.
- `reverse`: the frames the clip would show forward, in the opposite order (its last frame first).
- `hold`: the last `hold` video seconds of the clip show its last frame played (with `reverse`, the moment it starts at forward).
- `freeze`: the whole clip shows the scene at that many of its seconds, inside the window `speed` and `offset` give (not with `reverse` or `hold`).

What follows the scene's time: `f.t`, `f.lt`, `f.p`, `f.start`/`f.end`, `ctx.start`/`ctx.end`, `f.dt` and `f.exposure`; every comparison of `f.t` with word times; the kit's `at` windows and motion; `VideoClip` frames, `LottieBox` frames and HTML layers' CSS animations; the motion-blur shutter (each sub-frame's time is mapped, so blur lengthens with speed, runs backwards reversed and vanishes when frozen); the cues and sounds a scene places from `init()`, whose times are in its own clock: a cue lands where the clip shows its moment (and is dropped if it never does), a sound is trimmed to what the clip plays and sped up with it, fades included (a reversed or frozen clip lays none, a `VideoClip`'s sound included, and nor does one that would play outside 0.1 to 10 times its speed; each says so in the page log). What stays on the video's clock: `f.vt`, the audio analysis (`f.a`, `f.beat`, `f.bar`, `ctx.audio` lookups at `f.vt`), transitions (`f.tin`, `f.tout`), the post chain's own time (grain, dither), `ctx.clip(id)` windows, and the narration itself: a slowed plate's text reveal no longer matches the voice. Validation is strict: a bad value fails the load naming the clip and the field. `reel check` does not report a clip with `freeze` as frozen; a `hold` of its `--frozen` seconds (default 3) or more is, unless the clip has `check: { exempt: ['frozen'] }`. Per-frame jitter on a remapped clip uses `frameIdx(f.vt)` (reference/sampling.md).

## Subtitles

`reel subtitles` writes `out/subtitles/subtitles.srt` and `.vtt` from `data/words.json`: cues of at most two lines of 42 characters and 7 seconds, broken after punctuation where it can, each held 0.4 s after its last word and at least a second long. `reel video --subtitles` adds them to the finished file as a soft track. Burned-in captions are the kit's `Captions`.
