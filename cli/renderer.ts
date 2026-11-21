import { chromium, type Browser, type Page, type Request } from 'playwright-core';
import { formatOf } from '../src/config';
import { resolveTheme } from '../src/themes';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ENGINE, loadConfig, startServer } from './server';
import { checkChromeVersion, findChrome, glArgs, glBackend, missingLibsMessage, type GlBackend } from './chrome';
import type { PageOpts } from './args';

const ENGINE_CODE = ['src', 'cli'].map((d) => path.join(ENGINE, d) + path.sep).concat(path.join(ENGINE, 'index.html'));

export const IGNORED = /^(out|review|node_modules|\.git|audio\/\.work|audio\/\.align|\.claude)(\/|$)|(^|\/)\.reel\.config\.[^/]*\.mjs$|(^|\/)\.DS_Store$/;

export const CHROME_ARGS = ['--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-frame-rate-limit'];

export function chromeArgs(backend: GlBackend = glBackend()) {
  return [...CHROME_ARGS, ...glArgs(backend), ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])];
}

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

export interface Format { w: number; h: number; fps: number; scale: number }
export interface ClipInfo { id: string; start: number; end: number; track: number }

export function pageUrl(base: string, f: Format, o: Pick<PageOpts, 'only' | 'theme' | 'alpha'> & { bits?: number }) {
  const q = new URLSearchParams({ export: '1', w: String(f.w), h: String(f.h), fps: String(f.fps), scale: String(f.scale) });
  if (o.only) q.set('only', o.only);
  if (o.theme) q.set('theme', o.theme);
  if (o.alpha) q.set('alpha', '1');
  if (o.bits && o.bits !== 8) q.set('bits', String(o.bits));
  return `${base}/?${q}`;
}

const RELOADS = 5;

export async function openPage(browser: Browser, url: string, f: Format, o: Pick<PageOpts, 'only' | 'props'>, log: (line: string) => void) {
  const page = await browser.newPage({ viewport: { width: f.w, height: f.h }, deviceScaleFactor: 1 });
  if (o.props) await page.addInitScript((p) => { (window as any).__REEL_PROPS__ = p; }, o.props);
  const logs: string[] = [];
  let kept = false;
  const say = (line: string) => { if (kept) log(line); else logs.push(line); };
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') say(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => say(`[pageerror] ${e.message}`));
  const refused: string[] = [];
  const origin = new URL(url).origin;
  let lost: string[] = [];
  const refusedReq = new WeakSet<Request>();
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

export class PageHandle {
  logs: string[] = [];
  dead = false;
  busy = false;
  retired = false;
  constructor(public page: Page, public key: string, public gen: number, public fmt: Format, public used: number) {}
  async lost(): Promise<boolean> {
    return this.page.evaluate(() => !!(window as any).__reel?.contextLost).catch(() => true);
  }
  async errors(): Promise<string[]> {
    return this.page.evaluate(() => (window as any).__reel.errors as string[]).catch((e) => [`the page stopped answering: ${(e as Error).message}`]);
  }
}

export const isGone = (e: unknown) => /Target (page, context or browser )?(has been )?closed|Browser has been closed|crash|Execution context was destroyed|Protocol error/i.test(String((e as Error)?.message ?? e));

export class Renderer {
  private srv?: Awaited<ReturnType<typeof startServer>>;
  private browser?: Browser;
  private pages = new Map<string, PageHandle>();
  private gen = 0;
  private configDirty = false;
  private restart = false;
  private uses = 0;
  private opening: Promise<unknown> = Promise.resolve();
  private retiring: { srv: Awaited<ReturnType<typeof startServer>>; pages: Set<PageHandle> }[] = [];

  private seen = new Map<string, string>();
  private outside = new Map<string, string>();
  private scannedAt = Date.now();
  readonly written = new Set<string>();

  constructor(public project: string, private opts: { headed?: boolean; maxPages?: number } = {}) {}

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
    if (this.moduleErrors.size) this.restart = true;
    this.moduleErrors.clear();
    const g = this.srv?.server.moduleGraph;
    if (g) for (const f of changed) for (const m of g.getModulesByFile(f) ?? []) g.invalidateModule(m);
  }

  private moduleErrors = new Map<string, string>();

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

  async server() {
    if (this.srv && this.configDirty) {
      this.configDirty = false;
      const c = await loadConfig(this.project);
      const same = JSON.stringify([formatOf(c), resolveTheme(c.theme ?? 'neutral')]) === JSON.stringify([this.srv.format, this.srv.theme]);
      if (!same || this.restart) {
        const busy = [...this.pages.values()].filter((h) => h.busy);
        for (const h of busy) { h.retired = true; this.pages.delete(h.key); }
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

  async page(o: PageOpts): Promise<PageHandle> {
    const turn = this.opening.then(() => this.lease(o));
    this.opening = turn.catch(() => {});
    const h = await turn;
    let fresh: boolean;
    try { fresh = await h.page.evaluate(() => (window as any).__reel.beginRequest()); } catch (e) { this.release(h); throw e; }
    if (!fresh) {
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
    if (h.used) h.logs = [];
    h.used = ++this.uses;
    h.busy = true;
    return h;
  }

  private async open(key: string, fmt: Format, o: PageOpts, url: string): Promise<PageHandle> {
    if (o.theme) resolveTheme(o.theme);
    const browser = await this.chrome();
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

  release(h: PageHandle) {
    if (!h.busy) return;
    h.busy = false;
    if (!h.retired) {
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

  async meta() {
    const s = await this.server();
    return { url: s.url, format: s.format, theme: s.theme };
  }

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
