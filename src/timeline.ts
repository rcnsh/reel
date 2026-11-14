// The edit. Each narration plate (a `# name` header in narration.txt, a section in data/audio.json) is shown by
// the scene module of the same name, scenes/<name>.ts; plates without one are skipped, so a video can be built
// one plate at a time. Windows come from the narration timing, so re-timing the voice moves the edit. Windows
// touch: hard cuts. For overlaps (crossfades, custom transitions), captions or per-entry params, edit the
// entries here.
import type { TimelineEntry } from './engine/engine';
import type { SceneClass } from './engine/scene';
import type { Lyrics } from './engine/lyrics';
import type { AudioData } from './engine/audio';

const modules = import.meta.glob<{ default: SceneClass }>('./scenes/*.ts');

export function makeTimeline(_ly: Lyrics, au: AudioData): TimelineEntry[] {
  const have = au.sections.filter((s) => modules[`./scenes/${s.name}.ts`]);
  return have.map((s, k) => ({
    id: s.name,
    load: modules[`./scenes/${s.name}.ts`]!,
    // the first entry starts at 0 and each one runs until the next begins
    start: k === 0 ? 0 : s.start,
    end: have[k + 1]?.start ?? au.duration,
  }));
}
