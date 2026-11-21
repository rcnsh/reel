import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as fontkit from 'fontkit';
import type { FontFaceDef } from '../src/engine/type';

const FONT_FILE = /\.(ttf|otf|woff2?)$/i;
const WIDTHS: Record<number, string> = { 1: '50%', 2: '62.5%', 3: '75%', 4: '87.5%', 5: '100%', 6: '112.5%', 7: '125%', 8: '150%', 9: '200%' };

function fontFiles(dir: string, rel = ''): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...fontFiles(path.join(dir, e.name), r));
    else if (FONT_FILE.test(e.name)) out.push(r);
  }
  return out.sort();
}

export function describeFont(file: string, url: string): FontFaceDef {
  let f: fontkit.Font;
  try {
    const o = fontkit.openSync(file);
    if (!('familyName' in o)) throw new Error('a font collection (.ttc): split it into single fonts');
    f = o as fontkit.Font;
  } catch (e) { throw new Error(`${file}: not a font reel can read (${(e as Error).message})`); }
  const names = (f as unknown as { name?: { records?: { preferredFamily?: Record<string, string> } } }).name?.records;
  const family = names?.preferredFamily?.en ?? Object.values(names?.preferredFamily ?? {})[0] ?? f.familyName;
  const os2 = (f as unknown as { 'OS/2'?: { usWeightClass?: number; usWidthClass?: number; fsSelection?: { italic?: boolean } } })['OS/2'];
  const axes = f.variationAxes as Record<string, { min: number; max: number }>;
  const weight = axes.wght ? `${axes.wght.min} ${axes.wght.max}` : String(os2?.usWeightClass ?? 400);
  const stretch = axes.wdth ? `${axes.wdth.min}% ${axes.wdth.max}%` : WIDTHS[os2?.usWidthClass ?? 5] ?? '100%';
  const italic = !!os2?.fsSelection?.italic || f.italicAngle !== 0 || /italic|oblique/i.test(f.subfamilyName);
  return { family, url, weight, stretch, style: italic ? 'italic' : 'normal' };
}

export function projectFonts(project: string): FontFaceDef[] {
  const dir = path.join(project, 'fonts');
  return fontFiles(dir).map((r) => describeFont(path.join(dir, r), `/fonts/${r}`));
}

export const googleSlug = (family: string) => family.toLowerCase().replace(/[^a-z0-9]/g, '');

interface GhEntry { name: string; type: string; download_url: string | null }

export async function addGoogleFont(project: string, family: string): Promise<{ dir: string; files: string[]; families: string[] }> {
  const slug = googleSlug(family);
  if (!slug) throw new Error(`'${family}' is not a font family name`);
  const headers = { 'user-agent': 'reel', accept: 'application/vnd.github+json' };
  let entries: GhEntry[] | null = null, licence = '';
  for (const lic of ['ofl', 'apache', 'ufl']) {
    const r = await fetch(`https://api.github.com/repos/google/fonts/contents/${lic}/${slug}`, { headers });
    if (r.status === 404) continue;
    if (!r.ok) throw new Error(`GitHub answered ${r.status} for google/fonts ${lic}/${slug}${r.status === 403 ? ' (rate limited: try again in an hour)' : ''}`);
    entries = (await r.json()) as GhEntry[];
    licence = lic;
    break;
  }
  if (!entries) throw new Error(`no family '${family}' in Google Fonts (looked for google/fonts ofl/${slug}, apache/${slug}, ufl/${slug}; the name is the one fonts.google.com shows)`);
  const wanted = entries.filter((e) => e.type === 'file' && e.download_url && (FONT_FILE.test(e.name) || /^(OFL|LICENSE|UFL)(\.txt)?$/i.test(e.name)));
  if (!wanted.some((e) => FONT_FILE.test(e.name))) throw new Error(`google/fonts ${licence}/${slug} holds no font files`);
  const dir = path.join(project, 'fonts', slug);
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (const e of wanted) {
    const r = await fetch(e.download_url!, { headers: { 'user-agent': 'reel' } });
    if (!r.ok) throw new Error(`could not download ${e.name}: ${r.status}`);
    const f = path.join(dir, e.name);
    writeFileSync(f, new Uint8Array(await r.arrayBuffer()));
    files.push(f);
  }
  const families = [...new Set(files.filter((f) => FONT_FILE.test(f)).map((f) => describeFont(f, '').family))];
  return { dir, files, families };
}
