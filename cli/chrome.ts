import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { Browser, computeExecutablePath, detectBrowserPlatform, install } from '@puppeteer/browsers';

export const CHROME_BUILD = '157.0.8103.78';
export const CHROME_MIN_MAJOR = 157;

export function chromeCache() {
  if (process.env.REEL_CHROME_CACHE) return path.resolve(process.env.REEL_CHROME_CACHE);
  if (process.platform === 'darwin') return path.join(homedir(), 'Library/Caches/reel-chrome');
  return path.join(process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache'), 'reel-chrome');
}

export function pinnedChrome() {
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error(`no Chrome for Testing build for ${process.platform} ${process.arch}: set CHROME_PATH to a Chrome ${CHROME_MIN_MAJOR} or later`);
  return computeExecutablePath({ browser: Browser.CHROME, buildId: CHROME_BUILD, cacheDir: chromeCache(), platform });
}

export interface ChromeChoice { path: string; source: 'CHROME_PATH' | 'pinned' }

export function findChrome(): ChromeChoice {
  const env = process.env.CHROME_PATH;
  if (env) {
    if (!existsSync(env)) throw new Error(`CHROME_PATH is ${env}, which does not exist: point it at a Chrome ${CHROME_MIN_MAJOR}+ binary, or unset it and run \`reel chrome install\``);
    return { path: env, source: 'CHROME_PATH' };
  }
  const p = pinnedChrome();
  if (!existsSync(p)) throw new Error(`no Chrome to render with: run \`reel chrome install\` (downloads Chrome for Testing ${CHROME_BUILD} into ${chromeCache()}), or set CHROME_PATH to a Chrome ${CHROME_MIN_MAJOR}+ binary`);
  return { path: p, source: 'pinned' };
}

export function hasChrome() {
  try { findChrome(); return true; } catch { return false; }
}

export function checkChromeVersion(version: string, choice: ChromeChoice) {
  const major = Number(/^(?:\D*)(\d+)\./.exec(version)?.[1]);
  if (major >= CHROME_MIN_MAJOR) return;
  const fix = choice.source === 'CHROME_PATH'
    ? `point CHROME_PATH at Chrome ${CHROME_MIN_MAJOR} or later, or unset it to use the build \`reel chrome install\` fetches (${CHROME_BUILD})`
    : `run \`reel chrome install\``;
  throw new Error(`Chrome ${version || '(unknown version)'} at ${choice.path} is too old: reel needs Chrome ${CHROME_MIN_MAJOR} or later (HTML-in-Canvas, for HTML layers); ${fix}`);
}

export const CHROME_APT = 'libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 libdbus-1-3';

export function parseMissingLibs(ldd: string): string[] {
  return [...new Set(ldd.split('\n').map((l) => /^\s*(\S+)\s+=>\s+not found/.exec(l)?.[1]).filter((x): x is string => !!x))];
}

export function missingLibs(bin: string): string[] {
  if (process.platform !== 'linux') return [];
  const r = Bun.spawnSync(['ldd', bin], { stderr: 'ignore' });
  return r.success ? parseMissingLibs(r.stdout.toString()) : [];
}

export function missingLibsMessage(bin: string): string {
  const libs = missingLibs(bin);
  return libs.length ? `Chrome needs system libraries this machine lacks (${libs.join(', ')}); on Debian or Ubuntu: sudo apt-get install -y ${CHROME_APT}` : '';
}

export async function installChrome(onProgress?: (done: number, total: number) => void): Promise<string> {
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error(`no Chrome for Testing build for ${process.platform} ${process.arch}`);
  const b = await install({ browser: Browser.CHROME, buildId: CHROME_BUILD, cacheDir: chromeCache(), platform, downloadProgressCallback: onProgress });
  return b.executablePath;
}

export type GlBackend = 'metal' | 'egl' | 'vulkan' | 'swiftshader';
export const GL_BACKENDS: readonly GlBackend[] = ['metal', 'egl', 'vulkan', 'swiftshader'];

export function glBackend(env: Record<string, string | undefined> = process.env, platform: string = process.platform, hasGpu: () => boolean = gpuNode): GlBackend {
  const want = env.REEL_GL;
  if (want) {
    if (!GL_BACKENDS.includes(want as GlBackend)) throw new Error(`REEL_GL=${want}: expected ${GL_BACKENDS.join(', ')}`);
    if (want === 'metal' && platform !== 'darwin') throw new Error('REEL_GL=metal: Metal is macOS only');
    return want as GlBackend;
  }
  if (platform === 'darwin') return 'metal';
  return hasGpu() ? 'egl' : 'swiftshader';
}

export function gpuNode() {
  try { return readdirSync('/dev/dri').some((n) => n.startsWith('renderD')); } catch { return false; }
}

export function glArgs(b: GlBackend): string[] {
  switch (b) {
    case 'metal': return ['--use-angle=metal'];
    case 'egl': return ['--use-gl=angle', '--use-angle=gl-egl'];
    case 'vulkan': return ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan'];
    case 'swiftshader': return ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  }
}
