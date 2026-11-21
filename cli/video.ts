import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AdaptiveSampling } from '../src/engine/engine';
import { PIXELS } from '../src/engine/pixels';
import { ffmpegArgs, ffmpegDeepGain, ffmpegHasAlphaModes, hasFfmpegEncoder as hasEncoder, sequencePattern, webpArgs, type EncodeOpts, type Plan } from './formats';
import { run, spawnChild } from './children';
import { launchChrome, openPage, pageUrl, type Format } from './renderer';
import { commit, commitFrames, destOf, onAbort, partialOf, scratchDir, sweep } from './scratch';
import { ENGINE } from './server';

export interface VideoOpts {
  url: string;
  project: string;
  fmt: Format;
  only?: string;
  theme?: string;
  props?: string;
  samples: number | AdaptiveSampling;
  shutter: number;
  from?: number;
  to?: number;
  out: string;
  plan: Plan;
  enc: EncodeOpts;
  noaudio: boolean;
  workers: number;
  chunk: number;
  memGb: number;
  spoolGb: number;
  headed?: boolean;
  direct?: boolean;
  onProgress?: (p: { frames: number; total: number; fps: number; eta: number }) => void;
}

export interface VideoResult { encoder?: string; file: string | null; frames: number; seconds: number; workers: number; subFrames: Record<string, number>; spoolPeak: number; errors: string[]; logs: string[]; events: { duration: number; timeline: { id: string; start: number; end: number }[]; cues: { kind: string; t: number }[]; sounds: import('../src/config').SoundClip[] } }

export async function exportVideo(o: VideoOpts): Promise<VideoResult> {
  const seq = o.plan.format.kind === 'sequence';
  const outDir = path.dirname(seq ? sequencePattern(o.out, o.plan.format) : o.out);
  sweep([tmpdir(), outDir], path.join(ENGINE, 'node_modules/.vite'));
  if (o.enc.draft === 'webcodecs') {
    const d = await exportEncoded(o);
    if (d) return d;
    o = { ...o, enc: { ...o.enc, draft: hasEncoder('h264_videotoolbox') ? 'videotoolbox' : 'x264' } };
  }
  const logs: string[] = [];
  const fmt: Format = { ...o.fmt, fps: o.plan.fps };
  const browserOf = async () => {
    const browser = await launchChrome(o.headed);
    try {
      return { browser, page: await openPage(browser, pageUrl(o.url, fmt, { ...o, alpha: o.plan.alpha, bits: o.plan.bits }), fmt, o, (l) => logs.push(l)) };
    } catch (e) { await browser.close().catch(() => {}); throw e; }
  };
  const webpFrames = o.plan.format.id === 'webp' && !hasEncoder('libwebp_anim') ? scratchDir(tmpdir(), 'reel-webp') : undefined;
  if (webpFrames && !Bun.which('img2webp')) throw new Error('webp: this ffmpeg has no libwebp encoder and img2webp (libwebp\'s tools: brew install webp, apt install webp) is not installed');
  const first = await browserOf();
  let m: { duration: number; track: string | null; stateful: boolean; timeline: VideoResult['events']['timeline']; cues: VideoResult['events']['cues']; sounds: VideoResult['events']['sounds'] };
  try {
    m = await first.page.evaluate(() => { const P = (window as any).__reel; return { duration: P.duration, track: P.track, stateful: P.stateful, timeline: P.timeline, cues: P.cues, sounds: P.sounds }; });
  } catch (e) { await first.browser.close().catch(() => {}); throw e; }
  const from = o.from ?? 0, to = o.to ?? m.duration;
  if (!(to > from)) { await first.browser.close().catch(() => {}); throw new Error(`--from ${from} --to ${to}: nothing to render`); }

  const fps = fmt.fps, OW = Math.round(fmt.w * fmt.scale), OH = Math.round(fmt.h * fmt.scale);
  mkdirSync(outDir, { recursive: true });
  const dest = seq || o.direct ? o.out : destOf(o.out);
  const partial = seq ? partialOf(path.join(outDir, 'frames')) : o.direct ? o.out : partialOf(dest);
  const spoolDir = scratchDir(tmpdir(), 'reel-spool');
  let ok = false;
  const scratch = () => { for (const d of [spoolDir, webpFrames, ok && partial === o.out ? null : partial]) if (d) rmSync(d, { recursive: true, force: true }); };
  let killEncoder = () => {};
  const offAbort = onAbort(() => { killEncoder(); scratch(); });
  const audio = m.track && existsSync(path.join(o.project, m.track)) ? path.join(o.project, m.track) : null;
  const mux = !!audio && !o.noaudio;
  const f0 = Math.round(from * fps), f1 = Math.round(to * fps), total = f1 - f0;
  const ff = (() => {
    try {
      for (const d of [seq ? partial : null, spoolDir, webpFrames]) if (d) mkdirSync(d, { recursive: true });
      const args = ffmpegArgs(o.plan, o.enc, { width: OW, height: OH, fps, out: seq ? path.join(partial, path.basename(o.out)) : partial, audio: mux ? { file: audio!, from, duration: to - from } : null, startNumber: f0, webpFrames, alphaModes: o.plan.format.id !== 'exr' || ffmpegHasAlphaModes(), deepGain: o.plan.pixels === 'rgb16' || o.plan.pixels === 'rgba16' ? ffmpegDeepGain() : 1 });
      return spawnChild(args, { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit' });
    } catch (e) { offAbort(); scratch(); void first.browser.close().catch(() => {}); throw e; }
  })();
  killEncoder = () => ff.kill(9);

  const chunk = Math.max(1, o.chunk);
  const workers = m.stateful ? 1 : Math.max(1, Math.min(o.workers, Math.ceil(total / chunk)));
  const frameBytes = OW * OH * PIXELS[o.plan.pixels].perPixel;
  const cap = Math.max(4, Math.floor((o.memGb * 1e9) / frameBytes));
  const spoolCap = Math.floor((o.spoolGb * 1e9) / frameBytes);
  const spooled = new Set<number>();
  let spoolPeak = 0;
  const spoolFile = (n: number) => path.join(spoolDir, `${n}.rgb`);
  const toSpool = (n: number, buf: Uint8Array) => {
    writeFileSync(spoolFile(n), buf);
    spooled.add(n);
    spoolPeak = Math.max(spoolPeak, spooled.size);
  };
  const waiting = new Map<number, Uint8Array>();
  const owed = new Map<number, number>();
  const queue: number[][] = Array.from({ length: workers }, () => []);
  const sockets: any[] = [];
  const ackCount = new Array(workers).fill(0);
  const ack = (k: number) => { ackCount[k]++; sockets[k]?.send(String(ackCount[k])); };
  let next = f0, written = 0, cursor = f0, ending = false;

  let failure: Error | null = null, rejectFailed!: (e: Error) => void, resolveWritten!: () => void;
  const failed = new Promise<never>((_, rej) => { rejectFailed = rej; });
  failed.catch(() => {});
  const allWritten = new Promise<void>((res) => { resolveWritten = res; });
  const fail = (e: unknown) => {
    if (failure) return;
    failure = e instanceof Error ? e : new Error(String(e));
    for (const ws of sockets) ws?.close();
    rejectFailed(failure);
  };
  void ff.exited.then((code) => { if (!ending) fail(new Error(`ffmpeg exited early (code ${code})`)); });

  const t0 = performance.now();
  const step = Math.max(1, Math.round(total / 100));
  let draining = false;
  const drain = async () => {
    if (draining || failure) return;
    draining = true;
    try {
      while (!failure && (waiting.has(next) || spooled.has(next))) {
        let buf = waiting.get(next);
        if (buf) waiting.delete(next);
        else {
          buf = await Bun.file(spoolFile(next)).bytes();
          spooled.delete(next);
          rmSync(spoolFile(next));
        }
        ff.stdin.write(buf);
        await ff.stdin.flush();
        const k = owed.get(next);
        if (k !== undefined) { owed.delete(next); ack(k); }
        next++; written++;
        for (const [mm, kk] of owed) {
          if (waiting.size > cap) {
            if (spooled.size >= spoolCap) break;
            toSpool(mm, waiting.get(mm)!);
            waiting.delete(mm);
          }
          owed.delete(mm);
          ack(kk);
        }
        if (written % step === 0 || written === total) {
          const el = (performance.now() - t0) / 1000, rate = written / el;
          o.onProgress?.({ frames: written, total, fps: +rate.toFixed(2), eta: +((total - written) / rate).toFixed(1) });
        }
        if (written === total) resolveWritten();
      }
    } catch (e) { fail(e); } finally { draining = false; }
  };
  let server: ReturnType<typeof Bun.serve<{ k: number }>>;
  try {
    server = Bun.serve<{ k: number }>({
    port: 0,
    fetch(req, srv) { return srv.upgrade(req, { data: { k: +(new URL(req.url).searchParams.get('w') ?? 0) } }) ? undefined : new Response('ws only', { status: 400 }); },
    websocket: {
      maxPayloadLength: Math.max(64 * 1024 * 1024, frameBytes + 1024),
      open(ws) { sockets[ws.data.k] = ws; if (failure) ws.close(); },
      message(ws, msg) {
        if (failure) return;
        try {
          const k = ws.data.k, n = queue[k]!.shift(), buf = msg as Uint8Array;
          if (n === undefined) throw new Error(`worker ${k} sent a frame it was not given`);
          if (buf.length !== frameBytes) throw new Error(`worker ${k} sent ${buf.length} bytes for frame ${n}`);
          if (waiting.size < cap || n === next) { waiting.set(n, buf); ack(k); }
          else if (spooled.size < spoolCap) { toSpool(n, buf); ack(k); }
          else { waiting.set(n, buf); owed.set(n, k); }
          void drain();
        } catch (e) { fail(e); }
      },
    },
  });
  } catch (e) { ff.kill(9); scratch(); offAbort(); void first.browser.close().catch(() => {}); throw e; }
  const take = () => { if (cursor >= f1) return null; const a = cursor; cursor = Math.min(f1, a + chunk); return [a, cursor] as const; };
  const pages: Awaited<ReturnType<typeof browserOf>>[] = [first];
  const used: Record<string, number> = {};
  const sceneErrors = new Set<string>();
  const closePages = async () => {
    for (const p of pages.splice(0)) {
      for (const e of await p.page.evaluate(() => (window as any).__reel.errors as string[]).catch(() => [])) sceneErrors.add(e);
      await p.browser.close().catch(() => {});
    }
  };
  const launches: Promise<unknown>[] = [];
  try {
    const rendering = Promise.all(Array.from({ length: workers }, async (_, k) => {
      let p = first;
      if (k > 0) {
        const launch = browserOf();
        launches.push(launch.catch(() => {}));
        try { p = await launch; } catch (e) {
          logs.push(`worker ${k}: its Chrome did not start (${String((e as Error)?.message ?? e).split('\n')[0]}); the other workers rendered its share`);
          return;
        }
        if (ending || failure) { await p.browser.close().catch(() => {}); return; }
        pages.push(p);
      }
      const { page } = p;
      for (let r = take(); r && !failure; r = take()) {
        for (let n = r[0]; n < r[1]; n++) queue[k]!.push(n);
        const h: Record<string, number> = await page.evaluate((x) => (window as any).__reel.stream(x), {
          from: r[0] / fps, to: r[1] / fps, ws: `ws://localhost:${server.port}/?w=${k}`, samples: o.samples, shutter: o.shutter, inflight: 4, pixels: o.plan.pixels,
        });
        for (const [c, mm] of Object.entries(h)) used[c] = (used[c] ?? 0) + mm;
      }
    }));
    rendering.catch(() => {});
    await Promise.race([rendering, failed]).catch((e) => { fail(e); throw failure; });
    await Promise.race([allWritten, failed]);
    await closePages();
    ending = true;
    ff.stdin.end();
    const code = await ff.exited;
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
    if (webpFrames) {
      const w = await run(webpArgs(webpFrames, total, fps, o.enc, partial), { quiet: true, nothrow: true });
      if (w.exitCode !== 0) throw new Error(`img2webp failed: ${w.stderr.trim().slice(-800)}`);
    }
    if (!sceneErrors.size) {
      if (seq) commitFrames(partial, outDir);
      else if (partial !== o.out) commit(partial, dest);
    }
    ok = true;
  } finally {
    ending = true;
    if (!ok) ff.kill(9);
    await closePages();
    await Promise.all(launches);
    server.stop(true);
    scratch();
    offAbort();
  }
  return { file: sceneErrors.size ? null : o.out, frames: written, seconds: +((performance.now() - t0) / 1000).toFixed(1), workers, subFrames: used, spoolPeak, errors: [...sceneErrors], logs, events: { duration: m.duration, timeline: m.timeline, cues: m.cues, sounds: m.sounds } };
}


async function exportEncoded(o: VideoOpts): Promise<VideoResult | null> {
  const logs: string[] = [], t0 = performance.now();
  const fmt: Format = { ...o.fmt, fps: o.plan.fps };
  const browser = await launchChrome(o.headed);
  let ff: ReturnType<typeof Bun.spawn> | null = null, server: ReturnType<typeof Bun.serve> | null = null, ok = false;
  let pic: string | null = null, muxed: string | null = null;
  const scratch = () => { for (const f of [pic, muxed]) if (f && !(ok && f === o.out)) rmSync(f, { force: true }); };
  const offAbort = onAbort(() => { ff?.kill(9); scratch(); });
  try {
    const page = await openPage(browser, pageUrl(o.url, fmt, o), fmt, o, (l) => logs.push(l));
    const m: { duration: number; track: string | null; timeline: VideoResult['events']['timeline']; cues: VideoResult['events']['cues']; sounds: VideoResult['events']['sounds'] } = await page.evaluate(() => { const P = (window as any).__reel; return { duration: P.duration, track: P.track, timeline: P.timeline, cues: P.cues, sounds: P.sounds }; });
    const from = o.from ?? 0, to = o.to ?? m.duration, fps = fmt.fps;
    if (!(to > from)) throw new Error(`--from ${from} --to ${to}: nothing to render`);
    const total = Math.round(to * fps) - Math.round(from * fps);
    mkdirSync(path.dirname(o.out), { recursive: true });
    const audio = m.track && existsSync(path.join(o.project, m.track)) && !o.noaudio ? path.join(o.project, m.track) : null;
    const dest = o.direct ? o.out : destOf(o.out), scratchOf = () => (o.direct ? o.out : partialOf(dest));
    pic = audio ? partialOf(dest) : scratchOf();
    if (audio) muxed = scratchOf();
    const args = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'h264', '-r', String(fps), '-i', 'pipe:0', '-c:v', 'copy', '-bsf:v', 'h264_metadata=transfer_characteristics=1', '-color_trc', 'bt709', ...(o.enc.comment ? ['-metadata', `comment=${o.enc.comment}`] : []), '-movflags', '+faststart', '-f', 'mp4', pic];
    const proc = ff = spawnChild(args, { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit' });
    let count = 0, frames = 0;
    const step = Math.max(1, Math.round(total / 100));
    server = Bun.serve({
      port: 0,
      fetch(req, srv) { return srv.upgrade(req, { data: {} }) ? undefined : new Response('ws only', { status: 400 }); },
      websocket: {
        maxPayloadLength: 64 * 1024 * 1024,
        async message(ws, msg) {
          proc.stdin.write(msg as Uint8Array);
          await proc.stdin.flush();
          ws.send(String(++count));
          frames = count;
          if (frames % step === 0 || frames === total) {
            const el = (performance.now() - t0) / 1000;
            o.onProgress?.({ frames, total, fps: +(frames / el).toFixed(2), eta: +((total - frames) / (frames / el)).toFixed(1) });
          }
        },
      },
    });
    const r: { frames?: number; encoder?: string; unsupported?: string } = await page.evaluate((x) => (window as any).__reel.encode(x), {
      from, to, ws: `ws://localhost:${server.port}/`, bitrate: Math.round(fmt.w * fmt.scale * fmt.h * fmt.scale * fps * 0.2),
    });
    if (r.unsupported) { logs.push(`draft: ${r.unsupported}`); proc.kill(9); return null; }
    const errors: string[] = await page.evaluate(() => (window as any).__reel.errors as string[]).catch(() => []);
    proc.stdin.end();
    const code = await proc.exited;
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
    if (audio) {
      const mux = await run(['ffmpeg', '-y', '-loglevel', 'error', '-i', pic, '-ss', String(from), '-t', String(to - from), '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-shortest', '-map_metadata', '0', '-movflags', '+faststart', muxed!], { quiet: true, nothrow: true });
      if (mux.exitCode !== 0) throw new Error(`ffmpeg (muxing the sound): ${mux.stderr.slice(-800)}`);
    }
    const done = muxed ?? pic;
    if (!errors.length && done !== o.out) commit(done, dest);
    ok = true;
    return { file: errors.length ? null : o.out, frames: r.frames!, seconds: +((performance.now() - t0) / 1000).toFixed(1), workers: 1, subFrames: { 1: r.frames! }, spoolPeak: 0, errors, logs, encoder: `WebCodecs H.264 in the page (${r.encoder})`, events: { duration: m.duration, timeline: m.timeline, cues: m.cues, sounds: m.sounds } };
  } finally {
    if (!ok) ff?.kill(9);
    scratch();
    offAbort();
    server?.stop(true);
    await browser.close().catch(() => {});
  }
}
