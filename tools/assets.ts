// `reel assets`: the generated assets a project declares in assets.json. With a provider's key in the environment
// it makes the missing ones (and those whose prompt changed), fitted to their size and format and recorded in
// data/generated-assets.json; without one it lists what each needs, so a person can make the file elsewhere and
// drop it in. A file reel assets did not make is never replaced.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { run } from '../cli/children';
import { assetKey, describe, loadAssets, RECORD, statusOf, type AssetEntry, type Status } from './asset-manifest';
import { providerFor, type ProviderEnv } from './providers';

export const ASSETS_HELP = `reel assets [--list] [--force] [--json]: the generated assets of assets.json

assets.json: { "assets": [ { "id": "ridge", "kind": "image", "prompt": "…", "size": [1600, 900], "out": "assets/ridge.png" },
                           { "id": "whoosh", "kind": "sfx", "prompt": "…", "duration": 1.2, "out": "audio/whoosh.mp3" },
                           { "id": "bed", "kind": "music", "prompt": "…", "duration": 30, "out": "audio/bed.mp3" } ] }

Generates the missing ones, and those whose prompt, size or duration changed, when the provider's key is set:
images with OpenAI (OPENAI_API_KEY; REEL_IMAGE_MODEL, default gpt-image-1), sound effects and music with
ElevenLabs (ELEVENLABS_API_KEY). Only the prompt and size or duration are sent. Without a key it prints what each
missing asset needs and where it goes, and exits 1. Files it did not make are never replaced; --force makes the
generated ones again. --list only lists. Renders show a labelled placeholder for a missing image, and reel check
reports every missing asset.`;

export interface AssetRow { id: string; kind: AssetEntry['kind']; status: Status; out: string; prompt: string; needs: string; provider: string; generated?: boolean; error?: string }

export async function runAssets(root: string, o: { list?: boolean; force?: boolean }, ctx: ProviderEnv = { env: process.env, fetch }) {
  const { entries, record } = loadAssets(root);
  const key = (a: AssetEntry) => assetKey(a, providerFor(a.kind).model(ctx.env));
  const rows: AssetRow[] = entries.map((a) => ({ id: a.id, kind: a.kind, out: a.out, prompt: a.prompt, needs: describe(a), provider: `${providerFor(a.kind).id} (${providerFor(a.kind).keyVar})`, status: statusOf(a, existsSync(path.join(root, a.out)), record, key) }));
  if (!o.list) {
    const work = mkdtempSync(path.join(tmpdir(), 'reel-assets-'));
    try {
      for (const [i, a] of entries.entries()) {
        const row = rows[i]!, p = providerFor(a.kind);
        const due = row.status === 'missing' || row.status === 'stale' || (o.force && row.status === 'generated');
        if (!due || !ctx.env[p.keyVar]) continue;
        try {
          const raw = await p.generate(a, work, ctx);
          await fit(raw, a, path.join(root, a.out));
          record[a.id] = { key: key(a), out: a.out, model: p.model(ctx.env) };
          Object.assign(row, { status: 'generated', generated: true });
        } catch (e) { row.error = (e as Error).message; }
      }
    } finally { rmSync(work, { recursive: true, force: true }); }
    if (rows.some((r) => r.generated)) {
      mkdirSync(path.join(root, 'data'), { recursive: true });
      writeFileSync(path.join(root, RECORD), JSON.stringify(record, null, 1) + '\n');
    }
  }
  return rows;
}

/** A generated file at the asset's size (images: cover-cropped) and in its output's format. */
async function fit(raw: string, a: AssetEntry, out: string) {
  mkdirSync(path.dirname(out), { recursive: true });
  if (a.kind === 'image') {
    const [w, h] = a.size!;
    await run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', raw, '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}`, '-frames:v', '1', out]);
  } else if (path.extname(out).toLowerCase() === path.extname(raw).toLowerCase()) copyFileSync(raw, out);
  else await run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', raw, out]);
}

if (import.meta.main) {
  let a;
  try {
    a = parseArgs({ args: process.argv.slice(2), strict: true, options: { list: { type: 'boolean' }, force: { type: 'boolean' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  } catch (e) { console.error(`reel assets: ${(e as Error).message} (reel assets --help)`); process.exit(2); }
  if (a.values.help) { console.log(ASSETS_HELP); process.exit(0); }
  let rows: AssetRow[];
  try { rows = await runAssets(path.resolve(process.env.REEL_PROJECT ?? '.'), a.values); } catch (e) {
    if (a.values.json) console.log(JSON.stringify({ ok: false, errors: [(e as Error).message], logs: [], warnings: [] }));
    console.error(`reel assets: ${(e as Error).message}`); process.exit(1);
  }
  const missing = rows.filter((r) => r.status === 'missing' || r.status === 'stale');
  const errors = rows.filter((r) => r.error).map((r) => `${r.id}: ${r.error}`);
  if (a.values.json) console.log(JSON.stringify({ ok: !missing.length && !errors.length, errors, logs: [], warnings: [], assets: rows, missing: missing.map((r) => r.id) }, null, 1));
  else {
    if (!rows.length) console.log('no assets.json, or no assets in it');
    for (const r of rows) {
      console.log(`${r.status.toUpperCase().padEnd(9)} ${r.id.padEnd(16)} ${r.out}${r.generated ? '  (generated now)' : ''}`);
      if (r.status === 'missing' || r.status === 'stale') console.log(`          needs: ${r.needs}\n          prompt: ${r.prompt}\n          ${r.error ? `failed: ${r.error}` : `make it elsewhere and save it at ${r.out}, or set ${r.provider.match(/\((\w+)\)/)![1]} to generate it`}`);
    }
  }
  process.exit(missing.length || errors.length ? 1 : 0);
}
