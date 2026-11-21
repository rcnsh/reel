# Narration plates are cached as each one arrives

In `narrate` (`tools/narrate.ts`), a plate's cache is `<name>-<key>.flac` and `.json` (its words) in `audio/.narration/`. Each file is written to a partial and renamed, so it is either whole or absent. Each plate is kept as soon as the voice hands it over, so a failure on a later plate keeps what was already paid for. When the voice gives words, they are written first. A `.flac` without a `.json` was voiced by a voice without timestamps and not yet aligned; the next run aligns it without voicing it again.

This depends on the `Voice.synth` contract (`tools/voices/voice.ts`). A voice that pays per request must hand each passage to `each` as soon as it arrives, so a failure on a later passage leaves the earlier ones kept. A local model run once for every passage may hand them over when it ends.
