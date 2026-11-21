# Audio analysis base64 is decoded with atob

`AudioData` in `src/engine/audio.ts` decodes the waveform and spectrum bytes of `data/audio.json` with `atob` in `bytes()`. The module runs in the page (scenes, the kit's `Waveform` and `Spectrum`) and in bun (the config's `timeline()` through the CLI, and the unit tests). `atob` behaves the same in both; Node's `Buffer` does not exist in the page.
