// A project's renderer: its dev server, a headless Chrome and pages opened on the project, one per format and
// clip selection. A command run with --no-daemon makes one, uses it once and closes it; the warm renderer
// (cli/daemon.ts) keeps one for a project and reuses its pages, reloading them when the project's files change.
import { chromium, type Browser, type Page } from 'playwright-core';
import { formatOf } from '../src/config';
import { resolveTheme } from '../src/themes';
import { loadConfig, startServer } from './server';
import type { PageOpts } from './args';

/** The flags every Chrome the CLI starts gets. */
export const CHROME_ARGS = ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];

export function launchChrome(headed = false) {
  return chromium.launch({
    // CHROME_PATH (e.g. Playwright's Chrome for Testing), else the installed Google Chrome
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: !headed,
    args: CHROME_ARGS,
  });
}

/** A page's format: the logical frame size, the frame rate and the output scale. */
export interface Format { w: number; h: number; fps: number; scale: number }
export interface ClipInfo { id: string; start: number; end: number; track: number }

/** The page URL for a format, clip selection and theme. */
export function pageUrl(base: string, f: Format, o: Pick<PageOpts, 'only' | 'theme'>) {
  const q = new URLSearchParams({ export: '1', w: String(f.w), h: String(f.h), fps: String(f.fps), scale: String(f.scale) });
  if (o.only) q.set('only', o.only);
  if (o.theme) q.set('theme', o.theme);
  return `${base}/?${q}`;
}

/**
 * Open the project's page and wait for it to be ready: checks that it renders the size asked for and that
 * every --only clip exists. `log` gets the page's console errors and warnings.
 */
export async function openPage(browser: Browser, url: string, f: Format, o: Pick<PageOpts, 'only'>, log: (line: string) => void) {
  const page = await browser.newPage({ viewport: { width: f.w, height: f.h }, deviceScaleFactor: 1 });
  const logs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { logs.push(`[${m.type()}] ${m.text()}`); log(logs.at(-1)!); } });
  page.on('pageerror', (e) => { logs.push(`[pageerror] ${e.message}`); log(logs.at(-1)!); });
  try {
    await page.goto(url);
    await page.waitForFunction(() => (window as any).__reel?.ready || (window as any).__reel?.error, null, { timeout: 120000 })
      .catch(() => { throw new Error(`the page did not start:\n${logs.join('\n')}`); });
    const err = await page.evaluate(() => (window as any).__reel.error);
    if (err) throw new Error(`the project failed to load:\n${err}`);
    const size: [number, number] = await page.evaluate(() => [(window as any).__reel.width, (window as any).__reel.height]);
    if (size[0] !== f.w * f.scale || size[1] !== f.h * f.scale) throw new Error(`the page renders ${size[0]}x${size[1]}, expected ${f.w * f.scale}x${f.h * f.scale}`);
    if (o.only) {
      const ids: string[] = await page.evaluate(() => (window as any).__reel.timeline.map((e: { id: string }) => e.id));
      for (const id of o.only.split(',')) if (!ids.includes(id)) throw new Error(`--only ${id}: no such clip (the project has ${ids.join(', ')})`);
    }
  } catch (e) {
    await page.close().catch(() => {});
    throw e;
  }
  return page;
}

/** An open page of the project, and what it said since the request began. */
export class PageHandle {
  logs: string[] = [];
  dead = false;
  constructor(public page: Page, public key: string, public gen: number, public fmt: Format, public used: number) {}
  /** Scene and shader errors of this request (the page's load errors and its render errors since begin). */
  async errors(): Promise<string[]> {
    return this.page.evaluate(() => (window as any).__reel.errors as string[]).catch((e) => [`the page stopped answering: ${(e as Error).message}`]);
  }
}

/** Errors that mean the page or the browser is gone (a crash, a closed target): worth one retry on a new page. */
export const isGone = (e: unknown) => /Target (page, context or browser )?(has been )?closed|Browser has been closed|crash|Execution context was destroyed|Protocol error/i.test(String((e as Error)?.message ?? e));

export class Renderer {
  private srv?: Awaited<ReturnType<typeof startServer>>;
  private browser?: Browser;
  private pages = new Map<string, PageHandle>();
  /** Bumped when the project's files change: a page loaded before is reloaded before its next use. */
  private gen = 0;
  private configDirty = false;
  private uses = 0;

  constructor(public project: string, private opts: { headed?: boolean; maxPages?: number } = {}) {}

  /** The project's files changed (`config`: the config may have, so the format and theme are read again). */
  invalidate(config = true) {
    this.gen++;
    if (config) this.configDirty = true;
  }

  get pageCount() { return this.pages.size; }

  /** The dev server, restarted when the config's format or theme changed (they are compile-time constants). */
  async server() {
    if (this.srv && this.configDirty) {
      this.configDirty = false;
      const c = await loadConfig(this.project);
      const same = JSON.stringify([formatOf(c), resolveTheme(c.theme ?? 'neutral')]) === JSON.stringify([this.srv.format, this.srv.theme]);
      if (!same) {
        await this.closePages();
        await this.srv.stop().catch(() => {});
        this.srv = undefined;
      }
    }
    this.configDirty = false;
    this.srv ??= await startServer(this.project);
    return this.srv;
  }

  private async chrome() {
    if (!this.browser?.isConnected()) {
      this.pages.clear();
      this.browser = await launchChrome(this.opts.headed);
      this.browser.on('disconnected', () => { for (const h of this.pages.values()) h.dead = true; });
    }
    return this.browser;
  }

  /** The page for these options, ready for a request: reused while the project is unchanged, else (re)opened. */
  async page(o: PageOpts): Promise<PageHandle> {
    const srv = await this.server();
    const fmt: Format = { w: o.w ?? srv.format.w, h: o.h ?? srv.format.h, fps: o.fps ?? srv.format.fps, scale: o.scale ?? 1 };
    const key = JSON.stringify([fmt, o.only ?? '', o.theme ?? '']);
    let h = this.pages.get(key);
    if (h && (h.dead || h.page.isClosed() || h.gen !== this.gen)) {
      this.pages.delete(key);
      await h.page.close().catch(() => {});
      h = undefined;
    }
    if (!h) {
      if (o.theme) resolveTheme(o.theme); // (a name that is not a theme fails here, not in the page)
      const browser = await this.chrome();
      // (the oldest page goes when there are too many: each holds a GL context and its targets)
      while (this.pages.size >= (this.opts.maxPages ?? 4)) {
        const [k, old] = [...this.pages].sort((a, b) => a[1].used - b[1].used)[0]!;
        this.pages.delete(k);
        await old.page.close().catch(() => {});
      }
      const early: string[] = [], gen = this.gen;
      let handle: PageHandle | undefined;
      const page = await openPage(browser, pageUrl(srv.url, fmt, o), fmt, o, (l) => (handle ? handle.logs : early).push(l));
      handle = h = new PageHandle(page, key, gen, fmt, 0);
      handle.logs = early;
      page.on('crash', () => { handle!.dead = true; });
      page.on('close', () => { handle!.dead = true; });
      this.pages.set(key, h);
    } else {
      h.logs = [];
    }
    h.used = ++this.uses;
    await h.page.evaluate(() => (window as any).__reel.beginRequest());
    return h;
  }

  /** The dev server's URL and the config's format and theme (starting the server if needed). */
  async meta() {
    const s = await this.server();
    return { url: s.url, format: s.format, theme: s.theme };
  }

  /** Drop a page (after a crash or a failed request), so the next request opens a fresh one. */
  async drop(h: PageHandle) {
    this.pages.delete(h.key);
    await h.page.close().catch(() => {});
  }

  private async closePages() {
    for (const h of this.pages.values()) await h.page.close().catch(() => {});
    this.pages.clear();
  }

  async close() {
    await this.closePages();
    await this.browser?.close().catch(() => {});
    this.browser = undefined;
    await this.srv?.stop().catch(() => {});
    this.srv = undefined;
  }
}
