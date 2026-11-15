// reel init <folder>: a new video project that renders straight away. It writes reel.config.ts, one scene, a
// tsconfig.json that extends this checkout's tsconfig.project.json (so `reel`, `reel/config` and three.js typecheck
// without an install), a package.json whose scripts run this checkout's CLI, a .gitignore, a CLAUDE.md and the
// engine's agent skills in .claude/skills (copied: a project keeps the version it was made with until
// `reel skills update`).
// --narrated adds narration.txt and mix.json and voices the script (reel narrate, Kokoro by default).
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { formatOf } from '../src/config';
import { isThemeName, themes } from '../src/themes';
import { ENGINE } from './server';

export interface InitOptions { size: [number, number]; fps: number; theme: string; narrated: boolean }

/** A path as one shell word (package.json scripts run through a shell, and the engine's path may hold spaces). */
const sh = (p: string) => (/^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`);

/** Files a folder may already hold and still count as empty. */
const IGNORABLE = new Set(['.git', '.DS_Store']);

/** Check the options; throws with a message for the command line. */
export function initOptions(o: { size?: string; fps?: string; theme?: string; narrated?: boolean }): InitOptions {
  let size: [number, number] = [1920, 1080];
  if (o.size !== undefined) {
    const m = /^(\d+)x(\d+)$/.exec(o.size);
    if (!m) throw new Error(`--size ${o.size}: expected WxH, e.g. 1080x1920`);
    size = [Number(m[1]), Number(m[2])];
  }
  const fps = o.fps === undefined ? 60 : Number(o.fps);
  if (!Number.isFinite(fps)) throw new Error(`--fps ${o.fps}: expected a number`);
  formatOf({ size, fps, timeline: () => [] });
  const theme = o.theme ?? 'neutral';
  if (!isThemeName(theme)) throw new Error(`--theme ${theme}: expected ${Object.keys(themes).join(', ')}`);
  return { size, fps, theme, narrated: !!o.narrated };
}

/** Write the project into `dir` (created if missing; refused if it holds anything). Returns the files written. */
export function initProject(dir: string, o: InitOptions): string[] {
  const root = path.resolve(dir);
  if (existsSync(root)) {
    const there = readdirSync(root).filter((f) => !IGNORABLE.has(f));
    if (there.length) throw new Error(`${root} is not empty (${there.slice(0, 5).join(', ')}${there.length > 5 ? ', …' : ''}): reel init writes only into a new or empty folder`);
  }
  const name = path.basename(root);
  const title = name.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const reel = `bun ${sh(path.join(ENGINE, 'cli/reel.ts'))}`;
  const files: Record<string, string> = {
    'reel.config.ts': o.narrated ? narratedConfig(o) : silentConfig(o, title),
    'scenes/intro.ts': o.narrated ? narratedScene() : silentScene(),
    'tsconfig.json': JSON.stringify({ extends: path.join(ENGINE, 'tsconfig.project.json'), include: ['**/*.ts'], exclude: ['out', 'node_modules'] }, null, 2) + '\n',
    'package.json': JSON.stringify({
      name: name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+/, '') || 'video',
      private: true,
      type: 'module',
      scripts: { reel: reel, dev: `${reel} dev`, typecheck: `${sh(path.join(ENGINE, 'node_modules/.bin/tsc'))} --noEmit -p .` },
    }, null, 2) + '\n',
    '.gitignore': ['# renders, stills and contact sheets', 'out/', '', '# working files of reel narrate, reel align and the config loader', 'audio/.align/', 'audio/.narration/', '.reel.config.*.mjs', 'review/.notes.lock', '', 'node_modules/', '.DS_Store', ''].join('\n'),
    'CLAUDE.md': claudeMd(title, o),
  };
  if (o.narrated) {
    files['narration.txt'] = '# intro\nThis is where the video begins.\n';
    files['mix.json'] = JSON.stringify({ music: [], cues: {} }, null, 2) + '\n';
  }
  const written: string[] = [];
  for (const [rel, text] of Object.entries(files)) {
    const f = path.join(root, rel);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, text);
    written.push(f);
  }
  return [...written, ...installSkills(root)];
}

/** The engine's skills: skills/<name>/SKILL.md and the files beside it. */
export const SKILLS = path.join(ENGINE, 'skills');
export const skillNames = () => readdirSync(SKILLS, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(path.join(SKILLS, e.name, 'SKILL.md'))).map((e) => e.name).sort();

/**
 * Copy the engine's skills into `project`/.claude/skills, replacing those folders whole (a file the engine
 * dropped goes too); other skills there are left alone. Returns the files written.
 */
export function installSkills(project: string): string[] {
  const out: string[] = [];
  for (const name of skillNames()) {
    const dest = path.join(project, '.claude/skills', name);
    rmSync(dest, { recursive: true, force: true });
    cpSync(path.join(SKILLS, name), dest, { recursive: true });
    const walk = (d: string): void => { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : out.push(path.join(d, e.name)); };
    walk(dest);
  }
  return out;
}

const head = (o: InitOptions) => `  size: [${o.size[0]}, ${o.size[1]}],
  fps: ${o.fps},
  theme: '${o.theme}',`;

function silentConfig(o: InitOptions, title: string) {
  return `// The edit: the format, the theme and every clip on the timeline (the video ends with its last clip).
import { defineVideo } from 'reel/config';

export default defineVideo({
${head(o)}
  timeline: () => [
    { id: 'intro', scene: () => import('./scenes/intro'), start: 0, end: 4, params: { text: ${JSON.stringify(title)} } },
  ],
});
`;
}

function narratedConfig(o: InitOptions) {
  return `// The edit: the format, the theme, and one clip per plate of narration.txt (a \`# name\` header) that has a
// scene of the same name in scenes/. Re-time the script with \`reel narrate\` or \`reel align <recording>\`.
import { clipsFromSections, defineVideo } from 'reel/config';

export default defineVideo({
${head(o)}
  timeline: (src) => clipsFromSections(src, import.meta.glob('./scenes/*.ts')),
});
`;
}

const BG = `  // the theme's background, a touch lighter at the top
  bg = new FSPass(/* glsl */ \`
    void main() {
      fragColor = vec4(mix(C_BG, C_BG * 0.9, smoothstep(1.0, 0.0, vUv.y)), 1.0);
    }\`);`;

function silentScene() {
  return `// The opening title: the clip's \`text\` param as a title card over the theme's background. The card comes from
// the component kit (title, kicker, subtitle, accent rule), lays itself out from the frame and rises in.
import type * as THREE from 'three';
import { Scene, type Frame, FSPass, TitleCard } from 'reel';

export default class Intro extends Scene {
${BG}
  // (params come from the clip in reel.config.ts)
  card = new TitleCard({ title: String(this.ctx.params.text ?? ''), motion: { from: 'up', in: 0.9 } });

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    this.bg.render(this.ctx.renderer, out);
    this.card.draw(this.ctx.renderer, out, f);
  }
}
`;
}

function narratedScene() {
  return `// The intro plate: its line of narration typed as it is spoken, in a text block from the component kit that wraps
// and fits it to the frame.
import type * as THREE from 'three';
import { Scene, type Frame, FSPass, TextBlock, Words, esc } from 'reel';

export default class Intro extends Scene {
${BG}
  // found by its words, not by a time: re-timing the voice moves it along
  line = this.ctx.words.get('where the video begins');
  text = new TextBlock({
    // the part not yet said is laid out but hidden, so the text never reflows as it is typed
    html: (f) => {
      const n = Math.ceil(Words.lineCharProgress(this.line, f.t));
      return esc(this.line.text.slice(0, n)) + '<span style="visibility: hidden">' + esc(this.line.text.slice(n)) + '</span>';
    },
    align: 'center', size: 96, maxLines: 3, motion: { from: 'up', in: 0.9 },
  });

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    this.bg.render(this.ctx.renderer, out);
    this.text.draw(this.ctx.renderer, out, f);
  }
}
`;
}

function claudeMd(title: string, o: InitOptions) {
  return `# ${title}

A video made with reel, the deterministic WebGL video engine at \`${ENGINE}\`. Every frame is a pure function of the time \`t\`; the preview, stills and the export render the same pixels.

Read before acting (the skills are copied into \`.claude/skills\`; \`bun run reel skills update\` refreshes them from the engine):

- **Writing or changing a scene, the config or the theme**: the \`reel-authoring\` skill (\`.claude/skills/reel-authoring/SKILL.md\` and its \`reference/\` files).
- **Checking your work**: the \`reel-review-loop\` skill. Look at rendered frames before calling anything done.
- **Every command and flag**: \`bun run reel --help\`.

## This project

- \`reel.config.ts\` is the edit: ${o.size[0]}×${o.size[1]} at ${o.fps} fps, the \`${o.theme}\` theme, ${o.narrated ? 'one clip per plate of `narration.txt` that has a scene of the same name' : 'the clips on the timeline'}. Scenes live in \`scenes/\`, one default-exported \`Scene\` class per file.${o.narrated ? `
- Narration: \`narration.txt\` holds the plates (\`# name\` and its lines). \`bun run reel narrate\` voices and times it (\`narration\` in the config or \`--voice\` picks the voice; plates are cached); \`bun run reel align <recording>\` times a real one. Both write \`audio/narration.flac\`, \`data/words.json\` and \`data/audio.json\`: regenerate them, never edit them by hand. Scenes find their timing by text (\`ctx.words.get('…')\`).
- Sound: scenes call \`cue(kind, t)\`; \`mix.json\` maps kinds to files in \`audio/\`. \`bun run reel video --mix\` renders and mixes in one go; \`bun run reel events\`, then \`bun run reel mix <raw.mp4> <out.mp4>\` re-mixes a render.` : ''}

## Checks

1. \`bun run typecheck\`.
2. Stills of every clip you touched (its first, middle and last frame) and a strip of its motion, looked at: \`bun run reel still --t <times> --only <clip>\`, \`bun run reel strip --from <s> --to <s> --only <clip>\`.
3. \`bun run reel check\` with no errors (and \`--size 1080x1920\` if the video may go vertical).
4. Notes from the person reviewing (\`bun run reel review\` opens a page where they pin notes to frames of the newest render): \`bun run reel notes --open\` lists them with the \`reel still\` command for each moment; fix, re-render, then \`bun run reel notes done <id>\`. \`review/notes.json\` is committed.
5. Timing against the sound: \`bun run reel video --draft\` (half size, one sample, quick; never a deliverable). Motion blur: \`bun run reel video --samples auto --preset veryfast\`${o.narrated ? ' (add \`--mix\` for the finished sound)' : ''}.

\`bun run reel …\` is \`bun ${path.join(ENGINE, 'cli/reel.ts')} …\` in this folder; it starts a warm renderer for the project on first use. Chrome: \`CHROME_PATH\`, else the Chrome for Testing build \`bun run reel chrome install\` downloads (157 or later).
`;
}
