# A static Waveform caches its levels by window alone

`Waveform.layout` in `src/kit/audio-vis.ts` computes a static window's levels once and keeps them in `cache`, keyed by the window's `t0,t1` only. Every other input to the levels (count, style, measure, gain, the box) is fixed when the component is made, and a `'clip'` window only changes with the clip, so the key needs nothing else. An option that may change after construction must join the key, or the waveform will keep showing stale levels.
