# Timing: words, audio and sound

## Narration

`narration.txt` holds plates: a `# name` header and its lines. Time it:

- `reel narrate`: a voice from the script: Kokoro (local, the default), `say` (macOS scratch), or ElevenLabs / Fish Audio (hosted, with their key). Word times come from the voice's own timestamps or a forced aligner. Plates are cached: only the ones whose text changed are voiced again.
- `reel align <recording>`: a real recording (one take, or a folder of per-plate files named after the plates). The script's words are force-aligned to it (Qwen3-ForcedAligner, about 15 ms from where words really start); `--method whisper` transcribes and matches instead, for a reading that departs from the script.

Both write `audio/narration.flac`, `data/words.json` and `data/audio.json` (a silent 100 BPM grid, one section per plate), with `--lead`, `--hold` and `--tail` seconds of silence before the first word, between plates and after the last word (or `narration: { lead, hold, tail }` in the config). With `clipsFromSections` in the config, each plate shows the scene of the same name; a plate without a scene is skipped, so a video is built one plate at a time.

## Words (`this.ctx.words`, `src.words`)

- `lines[]`: `{ i, text, start, end, words[] }`, each word `{ w, start, end }`. Text comes with typographic punctuation (`don’t`).
- `words.get('sudden drop')`: the first line containing the text (case-insensitive, straight or curly quotes); throws when none does. `words.get(text, n)` for the n-th. `find(s)`: all such lines.
- `lineAt(t)`, `lastLine(t)`, `nextLine(t)`, `linesIn(t0, t1)`, `wordAt(t)`, `lastWord(t)`, `findWords('word')`.
- `Words.wordProgress(word, t)` (0..1 through a word), `Words.lineCharProgress(line, t)` (characters said so far: for letter-by-letter reveals and wipes).
- Empty (no lines) in a project without `data/words.json`.

## Audio analysis (`this.ctx.audio`, `src.audio`, and `f`)

- `beats[]`, `downbeats[]`, `sections[]` (`{ name, start, end }`), `duration`, `bpm`, `track` (the sound the preview plays and the export muxes).
- `beatAt(t)` (continuous beat index), `barAt(t)`, `timeOfBeat(i)`, `nearestBeat(t)`, `beatBefore(t)` (the beat at or before t: a cut that never lands after a word), `nearestDownbeat(t)`, `section(t)`.
- `env(name, t)` for `rms low mid high vocal drums bass other` (0..1), `envPeak(name, t, w)`, `hit(kind, t, halfLife)` (decaying pulses from `kick snare hat vocal` onsets), `events(kind, t0, t1)`.
- Every frame carries `f.a` (`rms low mid high vocal drums bass other kick snare hat vonset`), `f.beat`, `f.bar`, `f.beatPhase`, `f.barPhase`.
- Narration timing gives a silent grid and empty envelopes (`f.a` reads 0). A project without `data/audio.json` gets a silent 100 BPM grid and no track.

## Music

`reel analyze <song> --sections sections.json` (`[{ "name": "intro", "bar": 0 }, …]`, named after your scenes) analyses a song: beats and downbeats (Beat This!; one tempo where the song keeps one), 100 fps envelopes of the mix and of separated stems (`drums`, `bass`, `other`, `vocal`, from Demucs), kick, snare and hat onsets from the drum stem and vocal onsets from the vocal stem, and sections (from the file, or segmented as `part1`, `part2` …). `--fast` is a quick draft without the models (librosa; the stems are rough harmonic/percussive proxies, and a moving tempo loses it). The song becomes the track. For a narrated video with a music bed, time the narration first, then `reel analyze <bed> --keep-sections --offset <s>` adds the bed's beats from where it enters. `reel analyze --help` lists the flags. Sung words come from `reel align <vocal> --method whisper`.

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

`music` runs from the start of clip `from` to the start of clip `to`, looped, ducked under the voice. `reel events` writes `data/cues.json` (the clips and every cue), then `reel mix <render.mp4> <out.mp4>` lays it all under the render. A partial render mixes with the same `--from`.

## Subtitles

`reel subtitles` writes `out/subtitles/subtitles.srt` and `.vtt` from `data/words.json`: cues of at most two lines of 42 characters and 7 seconds, broken after punctuation where it can, each held 0.4 s after its last word and at least a second long. `reel video --subtitles` adds them to the finished file as a soft track. Burned-in captions are the kit's `Captions`.
