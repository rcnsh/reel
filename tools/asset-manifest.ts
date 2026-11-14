// The asset manifest (assets.json in a project): what each generated asset is and whether its file is there.
// Pure apart from reading files, so it is unit-tested.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AssetEntry } from '../src/engine/assets';

export type { AssetEntry };

/** Where `reel assets` records what it generated (committed, so a clone knows which files are generated). */
export const RECORD = 'data/generated-assets.json';

const KINDS = ['image', 'sfx', 'music'] as const;
const EXT: Record<AssetEntry['kind'], string[]> = { image: ['.png', '.jpg', '.jpeg', '.webp'], sfx: ['.mp3', '.wav', '.flac'], music: ['.mp3', '.wav', '.flac'] };

/** The entries of an assets.json, checked: unique ids, a known kind, a prompt, an output path in the project of the right type, a size or duration. */
export function parseManifest(json: unknown, file = 'assets.json'): AssetEntry[] {
  const list = (json as { assets?: unknown })?.assets;
  if (!Array.isArray(list)) throw new Error(`${file}: expected { "assets": [ … ] }`);
  const ids = new Set<string>();
  return list.map((raw, i) => {
    const a = raw as Record<string, unknown>, at = `${file}: assets[${i}]${typeof a?.id === 'string' ? ` ('${a.id}')` : ''}`;
    if (!a || typeof a !== 'object') throw new Error(`${at}: expected an object`);
    for (const k of Object.keys(a)) if (!['id', 'kind', 'prompt', 'out', 'size', 'duration'].includes(k)) throw new Error(`${at}: unknown key '${k}' (expected id, kind, prompt, out, size, duration)`);
    if (typeof a.id !== 'string' || !/^[\w-]+$/.test(a.id)) throw new Error(`${at}: id must be letters, digits, - and _`);
    if (ids.has(a.id)) throw new Error(`${at}: id '${a.id}' is used twice`);
    ids.add(a.id);
    if (!KINDS.includes(a.kind as never)) throw new Error(`${at}: kind must be image, sfx or music`);
    const kind = a.kind as AssetEntry['kind'];
    if (typeof a.prompt !== 'string' || a.prompt.trim().length < 3) throw new Error(`${at}: prompt must describe the asset`);
    if (typeof a.out !== 'string' || path.isAbsolute(a.out) || a.out.split(/[\\/]/).includes('..')) throw new Error(`${at}: out must be a path inside the project`);
    if (!EXT[kind].includes(path.extname(a.out).toLowerCase())) throw new Error(`${at}: out for a ${kind} must end in ${EXT[kind].join(', ')}`);
    if (kind === 'image') {
      const s = a.size as number[];
      if (!Array.isArray(s) || s.length !== 2 || !s.every((x) => Number.isInteger(x) && x >= 16 && x <= 8192)) throw new Error(`${at}: an image needs size [width, height] in px`);
    } else if (!(typeof a.duration === 'number' && a.duration >= 0.5 && a.duration <= (kind === 'sfx' ? 30 : 300))) throw new Error(`${at}: a ${kind} needs duration in seconds (0.5 to ${kind === 'sfx' ? 30 : 300})`);
    return a as unknown as AssetEntry;
  });
}

/** What makes a generated file current: its kind, prompt, size or duration and the model that made it. */
export function assetKey(a: AssetEntry, model: string) {
  return createHash('sha256').update(JSON.stringify({ v: 1, kind: a.kind, prompt: a.prompt.trim(), size: a.size ?? null, duration: a.duration ?? null, model })).digest('hex').slice(0, 16);
}

export type Status = 'missing' | 'generated' | 'stale' | 'provided';
export type Record_ = Record<string, { key: string; out: string; model: string }>;

/**
 * Each asset's state: missing (no file), generated (made by reel assets from this prompt), stale (made from a
 * different prompt or settings: regenerated when a key is present), provided (a file someone put there: never replaced).
 */
export function statusOf(a: AssetEntry, exists: boolean, rec: Record_, key: (a: AssetEntry) => string | null): Status {
  if (!exists) return 'missing';
  const r = rec[a.id];
  if (!r || r.out !== a.out) return 'provided';
  const k = key(a);
  return k === null || r.key === k ? 'generated' : 'stale';
}

/** A project's manifest and record (an empty list when it has no assets.json). */
export function loadAssets(root: string): { entries: AssetEntry[]; record: Record_ } {
  const f = path.join(root, 'assets.json');
  const entries = existsSync(f) ? parseManifest(JSON.parse(readFileSync(f, 'utf8')), f) : [];
  const r = path.join(root, RECORD);
  return { entries, record: existsSync(r) ? JSON.parse(readFileSync(r, 'utf8')) : {} };
}

/** The assets whose files are missing: what `reel check` reports. */
export function missingAssets(root: string): AssetEntry[] {
  return loadAssets(root).entries.filter((a) => !existsSync(path.join(root, a.out)));
}

/** What a person needs to make an asset by hand. */
export function describe(a: AssetEntry) {
  return a.kind === 'image' ? `${a.size![0]}×${a.size![1]} px image (${path.extname(a.out).slice(1)})` : `${a.kind === 'sfx' ? 'sound effect' : 'music'}, ${a.duration} s (${path.extname(a.out).slice(1)})`;
}
