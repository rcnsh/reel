# A config's export defaults apply only where they mean the same

`withExportDefaults` in `cli/formats.ts` puts the config's `export` defaults under the command line's flags. A flag that is given always wins, and `--audio` beats `noaudio`. Some defaults are skipped because they would mean something else:

- `crf` and `preset` apply only to h264 and hevc. VP9's crf is on another scale (0 to 63).
- `samples` does not apply to a draft, which always renders one sample, or when adaptive-sampling flags (`--min-samples`, `--max-samples`, `--refine`, `--tol`) are given.

A bad default throws an error that names the config key, not a flag.
