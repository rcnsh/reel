// A project's renderer: its dev server, a headless Chrome and pages opened on the project, one per format and
// clip selection. A command run with --no-daemon makes one, uses it once and closes it; the warm renderer
// (cli/daemon.ts) keeps one for a project and reuses its pages, reloading them when the project's files change.
// Two requests may run at once (the warm renderer's two lanes): each leases a page of its own for the request
// (page() to release()), so a second request for the same format gets a second page, never one in use.
import { chromium, type Browser, type Page, type Request } from 'playwright-core';
import { formatOf } from '../src/config';
import { resolveTheme } from '../src/themes';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ENGINE, loadConfig, startServer } from './server';
import { checkChromeVersion, findChrome, glArgs, glBackend, missingLibsMessage, type GlBackend } from './chrome';
import type { PageOpts } from './args';

/** Paths in a project whose changes never matter to its pages (renders, review notes, tools' working files, the config loader's). */
/** The engine's code, whose changes replace the warm renderer instead (cli/daemon.ts). */
const ENGINE_CODE = ['src', 'cli'].map((d) => path.join(ENGINE, d) + path.sep).concat(path.join(ENGINE, 'index.html'));

export const IGNORED = /^(out|review|node_modules|\.git|audio\/\.work|audio\/\.align|\.claude)(\/|$)|(^|\/)\.reel\.config\.[^/]*\.mjs$|(^|\/)\.DS_Store$/;

/** The flags every Chrome the CLI starts gets. */
// (--disable-frame-rate-limit: a page paints as soon as it is asked to instead of on a 60 Hz clock, so an HTML
// layer that changes costs a fraction of a millisecond per frame instead of up to 17)
export const CHROME_ARGS = ['--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-frame-rate-limit'];

/** Every flag a Chrome gets: CHROME_ARGS, the GL backend's (cli/chrome.ts) and, as root (containers), no sandbox. */
export function chromeArgs(backend: GlBackend = glBackend()) {
  return [...CHROME_ARGS, ...glArgs(backend), ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])];
}

/** Start the Chrome reel renders with (cli/chrome.ts), refusing one too old for HTML layers. */
export async function launchChrome(headed = false) {
  const choice = findChrome();
  let browser: Browser;
  try {
    browser = await chromium.launch({ executablePath: choice.path, headless: !headed, args: chromeArgs() });
  } catch (e) {
    const libs = missingLibsMessage(choice.path);
    throw libs ? new Error(libs) : e;
  }
  try { checkChromeVersion(browser.version(), choice); } catch (e) { await browser.close().catch(() => {}); throw e; }
  return browser;
}

/** A page's format: the logical frame size, the frame rate and the output scale. */
export interface Format { w: number; h: number; fps: number; scale: number }
export interface ClipInfo { id: string; start: number; end: number; track: number }

/** The page URL for a format, clip selection and theme (props go in by openPage: a URL holds a few kilobytes). */
export function pageUrl(base: string, f: Format, o: Pick<PageOpts, 'only' | 'theme' | 'alpha'> & { bits?: number }) {
  const q = new URLSearchParams({ export: '1', w: String(f.w), h: String(f.h), fps: String(f.fps), scale: String(f.scale) });
  if (o.only) q.set('only', o.only);
  if (o.theme) q.set('theme', o.theme);
  if (o.alpha) q.set('alpha', '1');
  if (o.bits && o.bits !== 8) q.set('bits', String(o.bits));
  return `${base}/?${q}`;
}

/** How many times openPage loads a page again whose modules did not arrive. */
const RELOADS = 5;

/**
 * Open the project's page and wait for it to be ready: checks that it renders the size asked for and that
 * every --only clip exists. The props (JSON text) are set as window.__REEL_PROPS__ before any of its modules runs,
 * on every load. `log` gets the page's console errors and warnings.
 */
export async function openPage(browser: Browser, url: string, f: Format, o: Pick<PageOpts, 'only' | 'props'>, log: (line: string) => void) {
  const page = await browser.newPage({ viewport: { width: f.w, height: f.h }, deviceScaleFactor: 1 });
  if (o.props) await page.addInitScript((p) => { (window as any).__REEL_PROPS__ = p; }, o.props);
  // (what the page says goes to `log` once a load is kept: a load thrown away for a module that did not arrive
  // takes its errors with it)
  const logs: string[] = [];
  let kept = false;
  const say = (line: string) => { if (kept) log(line); else logs.push(line); };
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') say(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => say(`[pageerror] ${e.message}`));
  // (modules the server refused: Renderer.explain puts Vite's reason in place of each)
  const refused: string[] = [];
  // (a module that never arrived: a 504, which Vite answers the old URLs with after it bundled a dependency again
  // while the page was loading, or a request that failed with no answer or with its body cut short. Either way the
  // page is loaded again, which Vite's live reload would do and a render server has none. A 404 or a 500 is the
  // project's own mistake and is reported instead. ERR_ABORTED is a request the page itself gave up, as a reload
  // does to the old document's: never a reason to load again)
  const origin = new URL(url).origin;
  let lost: string[] = [];
  // (Chrome also reports a script it refused to run, a 404 among them, as failed: that one is not lost, only one
  // with no answer or whose body was cut short)
  const refusedReq = new WeakSet<Request>();
  // (a pre-bundled package that is not there, 404 under /node_modules/.vite/, went away as Vite bundled again)
  page.on('response', (r) => {
    if (r.status() < 400) return;
    refusedReq.add(r.request());
    const ours = r.url().startsWith(origin);
    if (ours && (r.status() === 504 || (r.status() === 404 && new URL(r.url()).pathname.startsWith('/node_modules/.vite/')))) lost.push(`${r.url()} (${r.status()} ${r.statusText()})`);
    else if (r.request().resourceType() === 'script') refused.push(`module did not load: ${r.url()}`);
  });
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? 'failed';
    if (r.resourceType() === 'script' && r.url().startsWith(origin) && !refusedReq.has(r) && !why.includes('ERR_ABORTED')) lost.push(`${r.url()} (${why})`);
  });
  const started = () => page.waitForFunction(() => (window as any).__reel?.ready || (window as any).__reel?.error, null, { timeout: 120000 })
    .catch(() => { throw new Error(`the page did not start:\n${[...refused, ...logs].join('\n')}`); });
  try {
    await page.goto(url, { waitUntil: 'commit' });
    await started();
    for (let i = 1; lost.length && i <= RELOADS; i++) {
      await new Promise((r) => setTimeout(r, 100 * i));
      lost = []; logs.length = 0; refused.length = 0;
      await page.reload({ waitUntil: 'commit' });
      await started();
    }
    kept = true;
    logs.forEach(log);
    if (lost.length) log(`[warning] modules did not arrive after ${RELOADS} reloads: ${lost.join(', ')}`);
    const err = await page.evaluate(() => (window as any).__reel.error);
    if (err) throw new Error(`the project failed to load:\n${refused.length ? refused.join('\n') : lost.length ? `modules did not arrive after ${RELOADS} reloads:\n${lost.join('\n')}` : err}`);
    const size: [number, number] = await page.evaluate(() => [(window as any).__reel.width, (window as any).__reel.height]);
    if (size[0] !== f.w * f.scale || size[1] !== f.h * f.scale) throw new Error(`the page renders ${size[0]}x${size[1]}, expected ${f.w * f.scale}x${f.h * f.scale}`);
    if (o.only) {
      const ids: string[] = await page.evaluate(() => (window as any).__reel.timeline.map((e: { id: string }) => e.id));
      for (const id of o.only.split(',')) if (!ids.includes(id)) throw new Error(`--only ${id}: no such clip (the project has ${ids.join(', ')})`);
    }
  } catch (e) {
    if (!kept) logs.forEach(log);
    await page.close().catch(() => {});
    throw e;
  }
  return page;
}

/** An open page of the project, and what it said since the request began. */
export class PageHandle {
  logs: string[] = [];
  dead = false;
  /** Leased to a request (page() until release()): no other request uses it, and it is not closed under it. */
  busy = false;
  /** Its dev server was replaced while it was leased: closed (and that server stopped) once released. */
  retired = false;
  constructor(public page: Page, public key: string, public gen: number, public fmt: Format, public used: number) {}
  /** Whether the page's GL context was lost (the GPU process went away): it cannot render any more. */
  async lost(): Promise<boolean> {
    return this.page.evaluate(() => !!(window as any).__reel?.contextLost).catch(() => true);
  }
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
  private restart = false;
  private uses = 0;
  /** page() one at a time (it may start the server or Chrome, or close pages); the requests themselves overlap. */
  private opening: Promise<unknown> = Promise.resolve();
  /** Dev servers replaced while pages of theirs were leased: each stops when its last such page is released. */
  private retiring: { srv: Awaited<ReturnType<typeof startServer>>; pages: Set<PageHandle> }[] = [];

  /** What the project's files looked like at the last request (path -> mtime and size). */
  private seen = new Map<string, string>();
  /** The same for the modules the pages loaded from outside the project, and when the last scan ran (ms). */
  private outside = new Map<string, string>();
  private scannedAt = Date.now();
  /** Files this renderer wrote into the project (stills to a folder of the project's own): not changes to it. */
  readonly written = new Set<string>();

  constructor(public project: string, private opts: { headed?: boolean; maxPages?: number } = {}) {}

  /**
   * Look for changes to the project's files since the last request (a stat of each: a project is a few dozen
   * files, and a scan cannot miss an edit made a millisecond before the request the way a file watcher can).
   * A change reloads the pages before their next use, makes Vite transform the changed modules again, and has
   * the config read again (its format or theme may have changed).
   */
  private rescan() {
    const now = new Map<string, string>(), changed: string[] = [];
    const walk = (d: string, rel: string) => {
      let es;
      try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of es) {
        const r = rel ? `${rel}/${e.name}` : e.name, f = path.join(d, e.name);
        if (IGNORED.test(r)) continue;
        if (e.isDirectory()) walk(f, r);
        else if (e.isFile() && !this.written.has(f)) {
          try { const st = statSync(f); now.set(f, `${st.mtimeMs}:${st.size}`); } catch {}
        }
      }
    };
    walk(this.project, '');
    // the modules the pages loaded from outside the project (a scene importing a monorepo's sources): Vite's module
    // graph names them. A file seen for the first time counts as changed when it was written after the last scan
    // (the page may have loaded it before that edit). The engine's own files restart the warm renderer instead, and
    // packages (node_modules) change only with an install.
    for (const [f, v] of now) if (this.seen.get(f) !== v) changed.push(f);
    for (const f of this.seen.keys()) if (!now.has(f)) changed.push(f);
    const scanned = this.scannedAt;
    this.scannedAt = Date.now();
    const outside = new Map<string, string>(), loaded = this.srv?.server.moduleGraph.fileToModulesMap.keys() ?? [];
    for (const f of new Set([...this.outside.keys(), ...loaded])) {
      if (!path.isAbsolute(f) || f.startsWith(this.project + path.sep) || ENGINE_CODE.some((d) => f.startsWith(d)) || f.includes(`${path.sep}node_modules${path.sep}`)) continue;
      let st;
      try { st = statSync(f); } catch { if (this.outside.has(f)) changed.push(f); continue; }
      const v = `${st.mtimeMs}:${st.size}`, was = this.outside.get(f);
      outside.set(f, v);
      if (was === undefined ? st.mtimeMs > scanned : was !== v) changed.push(f);
    }
    this.outside = outside;
    const first = this.seen.size === 0;
    this.seen = now;
    if (first || !changed.length) return;
    this.gen++;
    this.configDirty = true;
    // (after a module failed, a fresh server: the fix for an import that did not resolve is a new file, not an
    // edit to the importer, and Vite's resolver remembers that the file was not there)
    if (this.moduleErrors.size) this.restart = true;
    this.moduleErrors.clear();
    const g = this.srv?.server.moduleGraph;
    if (g) for (const f of changed) for (const m of g.getModulesByFile(f) ?? []) g.invalidateModule(m);
  }

  /** Modules Vite failed to transform, by file, until the file changes. */
  private moduleErrors = new Map<string, string>();

  /**
   * The page only learns that a scene's import failed ("Failed to fetch dynamically imported module: <url>"), and
   * openPage only that the server refused a module ("module did not load: <url>"): put Vite's error for that file
   * (the syntax error with its line and code frame, or the import it could not resolve) in its place.
   */
  explain(errors: string[]): string[] {
    return errors.map((e) => e.replace(/(?:(?:TypeError: )?Failed to fetch dynamically imported module|module did not load): (\S+)/g, (all, url: string) => {
      let p: string;
      try { p = decodeURIComponent(new URL(url).pathname); } catch { return all; }
      const file = p.startsWith('/@fs/') ? p.slice(4) : path.join(ENGINE, p);
      const m = this.moduleErrors.get(file);
      return m ? `could not load ${m}` : existsSync(file) ? all : `could not load ${path.relative(this.project, file)}: the file is not there`;
    }));
  }

  get pageCount() { return this.pages.size; }

  /** The dev server, restarted when the config's format or theme changed (they are compile-time constants). */
  async server() {
    if (this.srv && this.configDirty) {
      this.configDirty = false;
      const c = await loadConfig(this.project);
      const same = JSON.stringify([formatOf(c), resolveTheme(c.theme ?? 'neutral')]) === JSON.stringify([this.srv.format, this.srv.theme]);
      if (!same || this.restart) {
        // (a request in the other lane finishes on the old server, which stops after it; the next starts beside it)
        const busy = [...this.pages.values()].filter((h) => h.busy);
        for (const h of busy) { h.retired = true; this.pages.delete(h.key); }
        // (registered before any await: the other request may end meanwhile)
        if (busy.length) this.retiring.push({ srv: this.srv, pages: new Set(busy) });
        await this.closePages();
        if (!busy.length) await this.srv.stop().catch(() => {});
        this.srv = undefined;
      }
    }
    this.configDirty = this.restart = false;
    this.srv ??= await startServer(this.project, { onModuleError: (e) => this.moduleErrors.set(e.file, e.message) });
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

  /**
   * The page for these options, leased to the caller until release() (or drop()): reused while the project is
   * unchanged and no other request holds it, else (re)opened.
   */
  async page(o: PageOpts): Promise<PageHandle> {
    const turn = this.opening.then(() => this.lease(o));
    this.opening = turn.catch(() => {});
    const h = await turn;
    let fresh: boolean;
    try { fresh = await h.page.evaluate(() => (window as any).__reel.beginRequest()); } catch (e) { this.release(h); throw e; }
    if (!fresh) {
      // (a warm page whose GL context was lost renders nothing: open a fresh one)
      await this.drop(h);
      return this.page(o);
    }
    return h;
  }

  private async lease(o: PageOpts): Promise<PageHandle> {
    this.rescan();
    const srv = await this.server();
    const fmt: Format = { w: o.w ?? srv.format.w, h: o.h ?? srv.format.h, fps: o.fps ?? srv.format.fps, scale: o.scale ?? 1 };
    const base = JSON.stringify([fmt, o.only ?? '', o.theme ?? '', o.props ?? '', !!o.alpha, o.bits ?? 8]);
    // (a page per format and lane: '#0' unless that one is in use)
    let h: PageHandle | undefined;
    for (let slot = 0; ; slot++) {
      const key = `${base}#${slot}`;
      const c = this.pages.get(key);
      if (c?.busy) continue;
      if (c && (c.dead || c.page.isClosed() || c.gen !== this.gen)) {
        this.pages.delete(key);
        await c.page.close().catch(() => {});
      } else h = c;
      if (!h) h = await this.open(key, fmt, o, srv.url);
      break;
    }
    if (h.used) h.logs = []; // (a fresh page keeps what it said while loading)
    h.used = ++this.uses;
    h.busy = true;
    return h;
  }

  private async open(key: string, fmt: Format, o: PageOpts, url: string): Promise<PageHandle> {
    if (o.theme) resolveTheme(o.theme); // (a name that is not a theme fails here, not in the page)
    const browser = await this.chrome();
    // (the oldest idle page goes when there are too many: each holds a GL context and its targets)
    for (;;) {
      const idle = [...this.pages].filter(([, p]) => !p.busy);
      if (this.pages.size < (this.opts.maxPages ?? 4) || !idle.length) break;
      const [k, old] = idle.sort((a, b) => a[1].used - b[1].used)[0]!;
      this.pages.delete(k);
      await old.page.close().catch(() => {});
    }
    const early: string[] = [], gen = this.gen;
    let handle: PageHandle | undefined;
    const page = await openPage(browser, pageUrl(url, fmt, o), fmt, o, (l) => (handle ? handle.logs : early).push(l));
    const h = handle = new PageHandle(page, key, gen, fmt, 0);
    h.logs = early;
    page.on('crash', () => { h.dead = true; });
    page.on('close', () => { h.dead = true; });
    this.pages.set(key, h);
    return h;
  }

  /** Give a page back after its request: the next request may use it. */
  release(h: PageHandle) {
    if (!h.busy) return;
    h.busy = false;
    if (!h.retired) {
      // (a format's extra pages, opened while its first was in use, close once none of them is: one GL context each)
      const base = h.key.slice(0, h.key.lastIndexOf('#'));
      const same = [...this.pages.values()].filter((p) => p.key.startsWith(`${base}#`));
      if (same.length > 1 && same.every((p) => !p.busy)) {
        for (const p of same) if (!p.key.endsWith('#0')) { this.pages.delete(p.key); void p.page.close().catch(() => {}); }
      }
      return;
    }
    void h.page.close().catch(() => {});
    const r = this.retiring.find((x) => x.pages.has(h));
    if (!r) return;
    r.pages.delete(h);
    if (!r.pages.size) { this.retiring.splice(this.retiring.indexOf(r), 1); void r.srv.stop().catch(() => {}); }
  }

  /** The dev server's URL and the config's format and theme (starting the server if needed). */
  async meta() {
    const s = await this.server();
    return { url: s.url, format: s.format, theme: s.theme };
  }

  /** Drop a page (after a crash or a failed request), so the next request opens a fresh one. */
  async drop(h: PageHandle) {
    this.release(h);
    if (this.pages.get(h.key) === h) this.pages.delete(h.key);
    await h.page.close().catch(() => {});
  }

  private async closePages() {
    for (const h of this.pages.values()) await h.page.close().catch(() => {});
    this.pages.clear();
  }

  async close() {
    await this.closePages();
    for (const r of this.retiring.splice(0)) { for (const h of r.pages) await h.page.close().catch(() => {}); await r.srv.stop().catch(() => {}); }
    await this.browser?.close().catch(() => {});
    this.browser = undefined;
    await this.srv?.stop().catch(() => {});
    this.srv = undefined;
  }
}
