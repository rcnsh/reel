// A music video cut to a song (a synthetic one, made with tools/synth_song.py, so it carries no licence), square at
// 30 fps. `reel analyze audio/song.mp3 --sections sections.json` wrote data/audio.json: the beats and downbeats,
// envelopes of the mix and of separated stems, drum onsets, and the sections, which name the scene each one shows.
import { clipsFromSections, defineVideo } from 'reel/config';

export default defineVideo({
  size: [1080, 1080],
  fps: 30,
  theme: 'film',
  // (each section starts on a downbeat, so every cut lands on the one)
  timeline: (src) => clipsFromSections(src, import.meta.glob('./scenes/*.ts')),
});
