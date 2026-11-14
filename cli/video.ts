// The video export: headless Chromes render chunks of frames and stream them over a WebSocket into one ffmpeg.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AdaptiveSampling } from '../src/engine/engine';
import { launchChrome, openPage, pageUrl, type Format } from './renderer';

export interface VideoOpts {
  url: string;
  project: string;
  fmt: Format;
  only?: string;
  theme?: string;
  samples: number | AdaptiveSampling;
  shutter: number;
  from?: number;
  to?: number;
  out: string;
  crf: number;
  preset: string;
  x264: string;
  noaudio: boolean;
  workers: number;
  chunk: number;
  memGb: number;
  spoolGb: number;
  headed?: boolean;
  /** Called as frames are written (about every 1% of them), and once at the end. */
  onProgress?: (p: { frames: number; total: number; fps: number; eta: number }) => void;
}

export interface VideoResult { file: string; frames: number; seconds: number; workers: number; subFrames: Record<string, number>; spoolPeak: number; errors: string[]; logs: string[]; events: { duration: number; timeline: { id: string; start: number; end: number }[]; cues: { kind: string; t: number }[] } }

/**
 * Render [from, to) into one encoder. `workers` headless Chromes (each its own GPU process) take chunks of
 * `chunk` frames in order; frames are put back in order and written to a single ffmpeg, so the file is the same
 * as with one worker. A frame is acknowledged once it is written or waiting in a bounded reorder buffer, and each
 * page keeps at most a few frames unacknowledged, so memory stays bounded at 4K. One worker already keeps the
 * GPU busy in the heavy scenes; a second one fills the gaps in the light ones (2D drawing, readback, transfer).
 * Throws when the range is empty or something fails; scene errors come back in `errors`.
 */
export async function exportVideo(o: VideoOpts): Promise<VideoResult> {
  const logs: string[] = [];
  const browserOf = async () => {
    const browser = await launchChrome(o.headed);
    try {
      return { browser, page: await openPage(browser, pageUrl(o.url, o.fmt, o), o.fmt, o, (l) => logs.push(l)) };
    } catch (e) { await browser.close().catch(() => {}); throw e; }
  };
  // (the duration and the track come from the project's data, the same in every page)
  const first = await browserOf();
  const m: { duration: number; track: string | null; stateful: boolean; timeline: VideoResult['events']['timeline']; cues: VideoResult['events']['cues'] } = await first.page.evaluate(() => { const P = (window as any).__reel; return { duration: P.duration, track: P.track, stateful: P.stateful, timeline: P.timeline, cues: P.cues }; });
  await first.browser.close();
  const from = o.from ?? 0, to = o.to ?? m.duration;
  if (!(to > from)) throw new Error(`--from ${from} --to ${to}: nothing to render`);

  const fps = o.fmt.fps, OW = o.fmt.w * o.fmt.scale, OH = o.fmt.h * o.fmt.scale;
  mkdirSync(path.dirname(o.out), { recursive: true });
  // the sound the project's audio analysis names, if the file is there (a silent video has none)
  const audio = m.track && existsSync(path.join(o.project, m.track)) ? path.join(o.project, m.track) : null;
  const mux = !!audio && !o.noaudio;
  // (frames come as rgb24: the same YUV out of the scaler as from rgba, a quarter fewer bytes to move)
  const args = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${OW}x${OH}`, '-r', String(fps), '-i', 'pipe:0'];
  if (mux) args.push('-ss', String(from), '-t', String(to - from), '-i', audio!);
  // Frames are sRGB (toSRGB in the final pass): convert with the BT.709 matrix and tag the stream,
  // otherwise ffmpeg converts with BT.601 while players and YouTube decode untagged HD as BT.709.
  // scale tags the matrix and range; primaries and transfer need setparams (the -color_* output flags don't reach the stream).
  args.push('-vf', 'vflip,scale=out_color_matrix=bt709,setparams=color_primaries=bt709:color_trc=bt709', '-c:v', 'libx264', '-preset', o.preset, '-crf', String(o.crf), '-pix_fmt', 'yuv420p', '-tune', 'grain', '-x264-params', o.x264);
  if (mux) args.push('-c:a', 'aac', '-b:a', '320k', '-shortest');
  args.push('-movflags', '+faststart', o.out);
  const ff = Bun.spawn(args, { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit' });

  const f0 = Math.round(from * fps), f1 = Math.round(to * fps), total = f1 - f0;
  const chunk = Math.max(1, o.chunk);
  // (a scene with simulation state needs its frames in order from one renderer)
  const workers = m.stateful ? 1 : Math.max(1, Math.min(o.workers, Math.ceil(total / chunk)));
  // reorder buffer: frames waiting for an earlier one or for the encoder, acknowledged while under ~1 GB in
  // memory; past that they go to a spool on disk (up to spoolGb, default 20), so the renderers never wait
  // for x264 in the light scenes and x264 catches up in the heavy ones, where the CPU is free
  const frameBytes = OW * OH * 3;
  const cap = Math.max(4, Math.floor((o.memGb * 1e9) / frameBytes));
  const spoolCap = Math.floor((o.spoolGb * 1e9) / frameBytes);
  const spoolDir = path.join(tmpdir(), `reel-spool-${process.pid}-${Date.now()}`);
  mkdirSync(spoolDir, { recursive: true });
  const onSignal = () => { ff.kill(9); rmSync(spoolDir, { recursive: true, force: true }); process.exit(130); };
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, onSignal);
  const spooled = new Set<number>();
  let spoolPeak = 0;
  const spoolFile = (n: number) => path.join(spoolDir, `${n}.rgb`);
  const toSpool = (n: number, buf: Uint8Array) => {
    // (written synchronously: the frame must be on disk before drain() looks for it)
    writeFileSync(spoolFile(n), buf);
    spooled.add(n);
    spoolPeak = Math.max(spoolPeak, spooled.size);
  };
  const waiting = new Map<number, Uint8Array>();
  const owed = new Map<number, number>(); // frames in memory over the cap, not yet acknowledged -> their worker
  const queue: number[][] = Array.from({ length: workers }, () => []); // frame numbers each worker will send, in order
  const sockets: any[] = [];
  const ackCount = new Array(workers).fill(0);
  const ack = (k: number) => { ackCount[k]++; sockets[k]?.send(String(ackCount[k])); };
  let next = f0, written = 0, cursor = f0, ending = false;

  // any failure stops the render: closing the sockets makes every page's stream() throw
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
        // a frame written is acknowledged if it was not yet; then the oldest owed while there is room
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
  const server = Bun.serve<{ k: number }>({
    port: 0,
    fetch(req, srv) { return srv.upgrade(req, { data: { k: +(new URL(req.url).searchParams.get('w') ?? 0) } }) ? undefined : new Response('ws only', { status: 400 }); },
    websocket: {
      maxPayloadLength: Math.max(64 * 1024 * 1024, OW * OH * 3 + 1024),
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
  // chunks in order from a shared cursor
  const take = () => { if (cursor >= f1) return null; const a = cursor; cursor = Math.min(f1, a + chunk); return [a, cursor] as const; };
  const pages: Awaited<ReturnType<typeof browserOf>>[] = [];
  const used: Record<string, number> = {};
  const sceneErrors = new Set<string>();
  const closePages = async () => {
    for (const p of pages.splice(0)) {
      for (const e of await p.page.evaluate(() => (window as any).__reel.errors as string[]).catch(() => [])) sceneErrors.add(e);
      await p.browser.close().catch(() => {});
    }
  };
  let ok = false;
  try {
    const opened = await Promise.allSettled(Array.from({ length: workers }, () => browserOf()));
    for (const r of opened) if (r.status === 'fulfilled') pages.push(r.value);
    for (const r of opened) if (r.status === 'rejected') throw r.reason;
    const rendering = Promise.all(pages.map(async ({ page }, k) => {
      for (let r = take(); r && !failure; r = take()) {
        for (let n = r[0]; n < r[1]; n++) queue[k]!.push(n);
        const h: Record<string, number> = await page.evaluate((x) => (window as any).__reel.stream(x), {
          from: r[0] / fps, to: r[1] / fps, ws: `ws://localhost:${server.port}/?w=${k}`, samples: o.samples, shutter: o.shutter, inflight: 4,
        });
        for (const [c, mm] of Object.entries(h)) used[c] = (used[c] ?? 0) + mm;
      }
    }));
    rendering.catch(() => {});
    // (a page error stops the render; a failure on this side stops waiting for the pages)
    await Promise.race([rendering, failed]).catch((e) => { fail(e); throw failure; });
    await Promise.race([allWritten, failed]);
    await closePages();
    ending = true;
    ff.stdin.end();
    const code = await ff.exited;
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
    ok = true;
  } finally {
    ending = true;
    // (killed, ffmpeg leaves an unplayable file rather than a finished-looking truncated one)
    if (!ok) ff.kill(9);
    await closePages();
    server.stop(true);
    rmSync(spoolDir, { recursive: true, force: true });
    for (const sig of ['SIGINT', 'SIGTERM'] as const) process.off(sig, onSignal);
  }
  return { file: o.out, frames: written, seconds: +((performance.now() - t0) / 1000).toFixed(1), workers, subFrames: used, spoolPeak, errors: [...sceneErrors], logs, events: { duration: m.duration, timeline: m.timeline, cues: m.cues } };
}
