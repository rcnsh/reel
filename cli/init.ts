// reel init <folder>: a new video project that renders straight away. It writes reel.config.ts, one scene, a
// tsconfig.json that extends this checkout's tsconfig.project.json (so `reel`, `reel/config` and three.js typecheck
// without an install), a package.json whose scripts run this checkout's CLI, a .gitignore and a CLAUDE.md.
// --narrated adds narration.txt and mix.json and times the script with a scratch voice (reel narrate).
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { formatOf } from '../src/config';
import { themes } from '../src/themes';
import { ENGINE } from './server';

export interface InitOptions { size: [number, number]; fps: number; theme: string; narrated: boolean }

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
  formatOf({ size, fps, timeline: () => [] });
  const theme = o.theme ?? 'neutral';
  if (!(theme in themes)) throw new Error(`--theme ${theme}: expected ${Object.keys(themes).join(', ')}`);
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
  const reel = `bun ${path.join(ENGINE, 'cli/reel.ts')}`;
  const files: Record<string, string> = {
    'reel.config.ts': o.narrated ? narratedConfig(o) : silentConfig(o, title),
    'scenes/intro.ts': o.narrated ? narratedScene() : silentScene(),
    'tsconfig.json': JSON.stringify({ extends: path.join(ENGINE, 'tsconfig.project.json'), include: ['**/*.ts'], exclude: ['out', 'node_modules'] }, null, 2) + '\n',
    'package.json': JSON.stringify({
      name: name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+/, '') || 'video',
      private: true,
      type: 'module',
      scripts: { reel: reel, dev: `${reel} dev`, typecheck: `${path.join(ENGINE, 'node_modules/.bin/tsc')} --noEmit -p .` },
    }, null, 2) + '\n',
    '.gitignore': ['# renders, stills and contact sheets', 'out/', '', '# working files of reel narrate, reel align and the config loader', 'audio/.align/', 'audio/.work/', 'audio/narration.scratch.mp3', '.reel.config.*.mjs', '', 'node_modules/', '.DS_Store', ''].join('\n'),
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
  return written;
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
// scene of the same name in scenes/. Re-time the script with \`reel narrate\` (scratch voice) or \`reel align <recording>\`.
import { clipsFromSections, defineVideo } from 'reel/config';

export default defineVideo({
${head(o)}
  timeline: (src) => clipsFromSections(src, import.meta.glob('./scenes/*.ts')),
});
`;
}

/** The shared body of both scenes: a background, a line of type rising in, an accent rule drawn under it. */
const sceneBody = (textExpr: string, comment: string) => `import type * as THREE from 'three';
import { Scene, type Frame, FSPass, Layer2D, W, H, F, font, fitSize, rgba, ease, prog, window01${textExpr.includes('Words') ? ', Words' : ''} } from 'reel';

export default class Intro extends Scene {
  // the theme's background, a touch lighter at the top
  bg = new FSPass(/* glsl */ \`
    void main() {
      fragColor = vec4(mix(C_BG, C_BG * 0.9, smoothstep(1.0, 0.0, vUv.y)), 1.0);
    }\`);
  text = new Layer2D();

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp } = this.ctx;
    this.bg.render(renderer, out);
    ${comment}
    ${textExpr}
    const fam = F.archivo(87.5, 800);
    // laid out from W and H, so it holds in any frame size
    const size = fitSize(full, fam, W * 0.8, Math.min(W, H) * 0.1);
    const a = window01(f.t, f.start, f.end, 0.4, 0.6), rise = prog(f.lt, 0, 0.9, ease.outExpo);
    const c = this.text.ctx;
    this.text.clear();
    c.font = font(fam, size);
    // (drawn from the full line's left edge, so a line revealed letter by letter stays put)
    const width = c.measureText(full).width;
    c.fillStyle = rgba('fg', a);
    c.fillText(shown, W / 2 - width / 2, H / 2 + (1 - rise) * size * 0.4);
    c.fillStyle = rgba('accent', a);
    const rule = width * prog(f.lt, 0.3, 1.3, ease.inOutCubic);
    c.fillRect(W / 2 - rule / 2, H / 2 + size * 0.45, rule, Math.max(2, size * 0.06));
    comp.draw(renderer, this.text.upload(), out);
  }
}
`;

function silentScene() {
  return `// The opening title: the clip's \`text\` param over the theme's background, with an accent rule drawn under it.\n` +
    sceneBody(`const full = String(this.ctx.params.text ?? ''), shown = full;`, '// (params come from the clip in reel.config.ts)');
}

function narratedScene() {
  return `// The intro plate: its line of narration set in type as it is spoken, with an accent rule drawn under it.\n` +
    sceneBody(`const line = this.ctx.words.get('where the video begins');
    const full = line.text, shown = full.slice(0, Math.ceil(Words.lineCharProgress(line, f.t)));`,
    '// found by its words, not by a time: re-timing the voice moves it along');
}

function claudeMd(title: string, o: InitOptions) {
  const e = (p: string) => path.join(ENGINE, p);
  return `# ${title}

A video made with reel, the deterministic WebGL video engine at \`${ENGINE}\`. Every frame is a pure function of the time \`t\`; the preview and the export render the same pixels.

Read before acting:

- **Writing or changing a scene**: \`${e('docs/ENGINE.md')}\` in full (the Scene API, determinism and sampling rules, themes, the toolbox, 4K).
- **Commands**: \`${e('README.md')}\`, and \`bun run reel --help\` for every command and flag.
- **The config's types**: \`${e('src/config.ts')}\` (\`VideoConfig\`, \`Clip\`); themes in \`${e('src/themes.ts')}\`.

## This project

- \`reel.config.ts\` is the edit: ${o.size[0]}×${o.size[1]} at ${o.fps} fps, the \`${o.theme}\` theme, ${o.narrated ? 'one clip per plate of `narration.txt` that has a scene of the same name' : 'the clips on the timeline'}. Scenes live in \`scenes/\`, one default-exported \`Scene\` class per file.${o.narrated ? `
- Narration: \`narration.txt\` holds the plates (\`# name\` and its lines). \`bun run reel narrate\` times it with a scratch voice; \`bun run reel align <recording>\` times a real one. Both write \`audio/narration.mp3\`, \`data/words.json\` and \`data/audio.json\`: regenerate them, never edit them by hand. Scenes find their timing by text (\`ctx.words.get('…')\`).
- Sound: scenes call \`cue(kind, t)\`; \`mix.json\` maps kinds to files in \`audio/\`. \`bun run reel events\`, then \`bun run reel mix <raw.mp4> <out.mp4>\`.` : ''}
- Colours come from the theme: \`C_BG\`, \`C_FG\`, \`C_ACCENT\` in GLSL, \`rgba('fg')\` for Canvas2D, \`LIN.accent\` for GL.

## Checks

1. \`bun run typecheck\`.
2. Stills of every clip you touched, looked at: \`bun run reel still --t <times> --only <clip> --out out/stills\`.
3. Motion: \`bun run reel video --samples auto --preset veryfast --out out/draft.mp4\`.

\`bun run reel …\` is \`bun ${e('cli/reel.ts')} …\` in this folder. Chrome: set \`CHROME_PATH\` as the engine's \`CLAUDE.md\` says.
`;
}
