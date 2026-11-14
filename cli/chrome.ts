// The Chrome reel renders with. HTML layers need HTML-in-Canvas, which arrived in Chrome 157, and renders are
// only reproducible on a known browser, so reel pins a Chrome for Testing build and keeps it in a cache folder of
// its own (`reel chrome install` fetches it with @puppeteer/browsers). CHROME_PATH names another binary instead.
// The installed Google Chrome is never used by default: it updates itself, and a render must not change with it.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { Browser, computeExecutablePath, detectBrowserPlatform, install } from '@puppeteer/browsers';

/** The Chrome for Testing build reel renders with. */
export const CHROME_BUILD = '157.0.8103.78';
/** The oldest Chrome major version that renders HTML layers. */
export const CHROME_MIN_MAJOR = 157;

/** Where `reel chrome install` puts Chrome: REEL_CHROME_CACHE, else the user's cache folder. */
export function chromeCache() {
  if (process.env.REEL_CHROME_CACHE) return path.resolve(process.env.REEL_CHROME_CACHE);
  if (process.platform === 'darwin') return path.join(homedir(), 'Library/Caches/reel-chrome');
  return path.join(process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache'), 'reel-chrome');
}

/** The pinned build's binary in the cache (whether or not it is installed). */
export function pinnedChrome() {
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error(`no Chrome for Testing build for ${process.platform} ${process.arch}: set CHROME_PATH to a Chrome ${CHROME_MIN_MAJOR} or later`);
  return computeExecutablePath({ browser: Browser.CHROME, buildId: CHROME_BUILD, cacheDir: chromeCache(), platform });
}

export interface ChromeChoice { path: string; source: 'CHROME_PATH' | 'pinned' }

/** The Chrome to render with: CHROME_PATH, else the pinned build. Throws, naming the fix, when neither is there. */
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

/** Whether a Chrome can be found (the rendering tests skip without one). */
export function hasChrome() {
  try { findChrome(); return true; } catch { return false; }
}

/** Throws when `version` (what the browser reports, e.g. '156.0.7778.5') is older than reel needs. */
export function checkChromeVersion(version: string, choice: ChromeChoice) {
  const major = Number(/^(?:\D*)(\d+)\./.exec(version)?.[1]);
  if (major >= CHROME_MIN_MAJOR) return;
  const fix = choice.source === 'CHROME_PATH'
    ? `point CHROME_PATH at Chrome ${CHROME_MIN_MAJOR} or later, or unset it to use the build \`reel chrome install\` fetches (${CHROME_BUILD})`
    : `run \`reel chrome install\``;
  throw new Error(`Chrome ${version || '(unknown version)'} at ${choice.path} is too old: reel needs Chrome ${CHROME_MIN_MAJOR} or later (HTML-in-Canvas, for HTML layers); ${fix}`);
}

/** Download the pinned build into the cache (a no-op when it is there). Returns its binary. */
export async function installChrome(onProgress?: (done: number, total: number) => void): Promise<string> {
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error(`no Chrome for Testing build for ${process.platform} ${process.arch}`);
  const b = await install({ browser: Browser.CHROME, buildId: CHROME_BUILD, cacheDir: chromeCache(), platform, downloadProgressCallback: onProgress });
  return b.executablePath;
}
