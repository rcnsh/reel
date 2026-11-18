// Generated assets a project declares in assets.json (`reel assets` makes or lists them). Until an image's file
// exists, a scene that asks for it gets a placeholder of the declared size that says what belongs there.
import { fetchJSON } from './audio';
import { uncounted } from './report';

/** An entry of assets.json: what to generate and where it goes. */
export interface AssetEntry { id: string; kind: 'image' | 'sfx' | 'music'; prompt: string; out: string; size?: [number, number]; duration?: number }

let manifest: Promise<AssetEntry[]> | null = null;

/** The project's assets.json entries (none when it has no manifest). */
export function assetManifest(): Promise<AssetEntry[]> {
  manifest ??= fetchJSON('assets.json').then((j) => ((j as { assets?: AssetEntry[] } | null)?.assets ?? []), () => []);
  return manifest;
}

const norm = (p: string) => p.replace(/^\.?\//, '');

/** The manifest's entry for a project path, if it declares one. */
export async function declaredAsset(src: string): Promise<AssetEntry | undefined> {
  return (await assetManifest()).find((a) => norm(a.out) === norm(src));
}

/** A placeholder image for a missing asset: its declared size, hatched, labelled with its id, size and prompt. */
export function assetPlaceholder(a: AssetEntry): HTMLCanvasElement {
  return uncounted(() => {
    const [w, h] = a.size ?? [1024, 1024];
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    g.fillStyle = '#5a5a5a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#6c6c6c'; g.lineWidth = Math.max(2, w / 200);
    for (let x = -h; x < w; x += Math.max(16, w / 24)) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.stroke(); }
    g.strokeStyle = '#e8e8e8'; g.lineWidth = Math.max(3, w / 160); g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
    const u = Math.min(w, h);
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${Math.round(u * 0.07)}px Archivo, sans-serif`;
    g.fillText(`MISSING ASSET: ${a.id}`, w / 2, h / 2 - u * 0.12);
    g.font = `500 ${Math.round(u * 0.045)}px Archivo, sans-serif`;
    g.fillText(`${w}×${h} → ${a.out}`, w / 2, h / 2 - u * 0.03);
    // the prompt, wrapped to the width
    g.font = `400 ${Math.round(u * 0.035)}px Archivo, sans-serif`;
    const words = a.prompt.split(/\s+/), lines: string[] = [];
    let cur = '';
    for (const word of words) { const t = cur ? `${cur} ${word}` : word; if (g.measureText(t).width > w * 0.84 && cur) { lines.push(cur); cur = word; } else cur = t; }
    if (cur) lines.push(cur);
    lines.slice(0, 5).forEach((l, i) => g.fillText(i === 4 && lines.length > 5 ? `${l} …` : l, w / 2, h / 2 + u * (0.07 + i * 0.05)));
    return c;
  });
}
