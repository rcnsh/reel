// The video export: headless Chromes render chunks of frames and stream them over a WebSocket into one ffmpeg.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AdaptiveSampling } from '../src/engine/engine';
import { PIXELS } from '../src/engine/pixels';
import { ffmpegArgs, ffmpegDeepGain, ffmpegHasAlphaModes, hasFfmpegEncoder as hasEncoder, sequencePattern, webpArgs, type EncodeOpts, type Plan } from './formats';
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
  /** The format and what the page reads back for it (cli/formats.ts), and the encoder's options. */
  plan: Plan;
  enc: EncodeOpts;
  noaudio: boolean;
  workers: number;
  chunk: number;
  memGb: number;
  spoolGb: number;
  headed?: boolean;
  /** Called as frames are written (about every 1% of them), and once at the end. */
  onProgress?: (p: { frames: number; total: number; fps: number; eta: number }) => void;
}

export interface VideoResult { encoder?: string; file: string; frames: number; seconds: number; workers: number; subFrames: Record<string, number>; spoolPeak: number; errors: string[]; logs: string[]; events: { duration: number; timeline: { id: string; start: number; end: number }[]; cues: { kind: string; t: number }[]; sounds: import('../src/config').SoundClip[] } }

/**
 * Render [from, to) into one encoder. `workers` headless Chromes (each its own GPU process) take chunks of
 * `chunk` frames in order; frames are put back in order and written to a single ffmpeg, so the file is the same
 * as with one worker. A frame is acknowledged once it is written or waiting in a bounded reorder buffer, and each
 * page keeps at most a few frames unacknowledged, so memory stays bounded at 4K. One worker already keeps the
 * GPU busy in the heavy scenes; a second one fills the gaps in the light ones (2D drawing, readback, transfer).
 * Throws when the range is empty or something fails; scene errors come back in `errors`.
 */
export async function exportVideo(o: VideoOpts): Promise<VideoResult> {
  if (o.enc.draft === 'webcodecs') {
    const d = await exportEncoded(o);
    if (d) return d;
    // (this browser encodes no H.264: the raw pipe into ffmpeg's fastest encoder instead)
    o = { ...o, enc: { ...o.enc, draft: hasEncoder('h264_videotoolbox') ? 'videotoolbox' : 'x264' } };
  }
  const logs: string[] = [];
  // (a loop's frame rate may be capped below the project's)
  const fmt: Format = { ...o.fmt, fps: o.plan.fps };
  const browserOf = async () => {
    const browser = await launchChrome(o.headed);
    try {
      return { browser, page: await openPage(browser, pageUrl(o.url, fmt, { ...o, alpha: o.plan.alpha, bits: o.plan.bits }), fmt, o, (l) => logs.push(l)) };
    } catch (e) { await browser.close().catch(() => {}); throw e; }
  };
  // (an ffmpeg without libwebp: PNG frames into a folder, assembled by img2webp at the end)
  const webpFrames = o.plan.format.id === 'webp' && !hasEncoder('libwebp_anim') ? path.join(tmpdir(), `reel-webp-${process.pid}-${Date.now()}`) : undefined;
  if (webpFrames && !Bun.which('img2webp')) throw new Error('webp: this ffmpeg has no libwebp encoder and img2webp (libwebp\'s tools: brew install webp, apt install webp) is not installed');
  // (the duration and the track come from the project's data, the same in every page; the first page then renders
  // as worker 0, which saves a browser start)
  const first = await browserOf();
  let m: { duration: number; track: string | null; stateful: boolean; timeline: VideoResult['events']['timeline']; cues: VideoResult['events']['cues']; sounds: VideoResult['events']['sounds'] };
  try {
    m = await first.page.evaluate(() => { const P = (window as any).__reel; return { duration: P.duration, track: P.track, stateful: P.stateful, timeline: P.timeline, cues: P.cues, sounds: P.sounds }; });
  } catch (e) { await first.browser.close().catch(() => {}); throw e; }
  const from = o.from ?? 0, to = o.to ?? m.duration;
  if (!(to > from)) { await first.browser.close().catch(() => {}); throw new Error(`--from ${from} --to ${to}: nothing to render`); }

  const fps = fmt.fps, OW = Math.round(fmt.w * fmt.scale), OH = Math.round(fmt.h * fmt.scale);
  const seq = o.plan.format.kind === 'sequence';
  mkdirSync(path.dirname(seq ? sequencePattern(o.out, o.plan.format) : o.out), { recursive: true });
  // the sound the project's audio analysis names, if the file is there (a silent video has none)
  const audio = m.track && existsSync(path.join(o.project, m.track)) ? path.join(o.project, m.track) : null;
  const mux = !!audio && !o.noaudio;
  const f0 = Math.round(from * fps), f1 = Math.round(to * fps), total = f1 - f0;
  if (webpFrames) mkdirSync(webpFrames, { recursive: true });
  const args = ffmpegArgs(o.plan, o.enc, { width: OW, height: OH, fps, out: o.out, audio: mux ? { file: audio!, from, duration: to - from } : null, startNumber: f0, webpFrames, alphaModes: o.plan.format.id !== 'exr' || ffmpegHasAlphaModes(), deepGain: o.plan.pixels === 'rgb16' || o.plan.pixels === 'rgba16' ? ffmpegDeepGain() : 1 });
  const ff = Bun.spawn(args, { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit' });

  const chunk = Math.max(1, o.chunk);
  // (a scene with simulation state needs its frames in order from one renderer)
  const workers = m.stateful ? 1 : Math.max(1, Math.min(o.workers, Math.ceil(total / chunk)));
  // reorder buffer: frames waiting for an earlier one or for the encoder, acknowledged while under ~1 GB in
  // memory; past that they go to a spool on disk (up to spoolGb, default 20), so the renderers never wait
  // for x264 in the light scenes and x264 catches up in the heavy ones, where the CPU is free
  const frameBytes = OW * OH * PIXELS[o.plan.pixels].perPixel;
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
  // chunks in order from a shared cursor
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
  let ok = false;
  try {
    // (the first page renders at once; the others launch alongside it and take chunks as soon as they are ready)
    const rendering = Promise.all(Array.from({ length: workers }, async (_, k) => {
      const p = k === 0 ? first : await browserOf();
      if (k > 0) {
        // (closePages closes the pages it finds; one that comes up after the render stopped is closed here)
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
    // (a page error stops the render; a failure on this side stops waiting for the pages)
    await Promise.race([rendering, failed]).catch((e) => { fail(e); throw failure; });
    await Promise.race([allWritten, failed]);
    await closePages();
    ending = true;
    ff.stdin.end();
    const code = await ff.exited;
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
    if (webpFrames) {
      const w = Bun.spawnSync(webpArgs(webpFrames, total, fps, o.enc, o.out), { stdout: 'pipe', stderr: 'pipe' });
      if (w.exitCode !== 0) throw new Error(`img2webp failed: ${w.stderr.toString().trim().slice(-800)}`);
    }
    ok = true;
  } finally {
    ending = true;
    // (killed, ffmpeg leaves an unplayable file rather than a finished-looking truncated one)
    if (!ok) ff.kill(9);
    await closePages();
    server.stop(true);
    rmSync(spoolDir, { recursive: true, force: true });
    if (webpFrames) rmSync(webpFrames, { recursive: true, force: true });
    for (const sig of ['SIGINT', 'SIGTERM'] as const) process.off(sig, onSignal);
  }
  return { file: o.out, frames: written, seconds: +((performance.now() - t0) / 1000).toFixed(1), workers, subFrames: used, spoolPeak, errors: [...sceneErrors], logs, events: { duration: m.duration, timeline: m.timeline, cues: m.cues, sounds: m.sounds } };
}


/**
 * The draft tier's fast path: one page renders at the draft's size and encodes H.264 itself with WebCodecs (the
 * page's `encode`), and ffmpeg only muxes the Annex B stream it sends, with the project's sound, into an MP4. Returns
 * null when the browser cannot encode H.264 (the caller falls back to the raw pipe).
 */
async function exportEncoded(o: VideoOpts): Promise<VideoResult | null> {
  const logs: string[] = [], t0 = performance.now();
  const fmt: Format = { ...o.fmt, fps: o.plan.fps };
  const browser = await launchChrome(o.headed);
  let ff: ReturnType<typeof Bun.spawn> | null = null, server: ReturnType<typeof Bun.serve> | null = null, ok = false;
  try {
    const page = await openPage(browser, pageUrl(o.url, fmt, o), fmt, o, (l) => logs.push(l));
    const m: { duration: number; track: string | null; timeline: VideoResult['events']['timeline']; cues: VideoResult['events']['cues']; sounds: VideoResult['events']['sounds'] } = await page.evaluate(() => { const P = (window as any).__reel; return { duration: P.duration, track: P.track, timeline: P.timeline, cues: P.cues, sounds: P.sounds }; });
    const from = o.from ?? 0, to = o.to ?? m.duration, fps = fmt.fps;
    if (!(to > from)) throw new Error(`--from ${from} --to ${to}: nothing to render`);
    const total = Math.round(to * fps) - Math.round(from * fps);
    mkdirSync(path.dirname(o.out), { recursive: true });
    const audio = m.track && existsSync(path.join(o.project, m.track)) && !o.noaudio ? path.join(o.project, m.track) : null;
    // (the Annex B stream has no timestamps: muxed alone at the frame rate first, then with the sound, which ffmpeg
    // drops when it is muxed with an untimed stream in one pass)
    const pic = audio ? `${o.out}.picture.mp4` : o.out;
    // (the browser tags the stream with the canvas's sRGB transfer: retagged BT.709, as every other YUV stream reel writes,
    // in the bitstream and in the container's colr box, which is written from the input's tags otherwise)
    const args = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'h264', '-r', String(fps), '-i', 'pipe:0', '-c:v', 'copy', '-bsf:v', 'h264_metadata=transfer_characteristics=1', '-color_trc', 'bt709', ...(o.enc.comment ? ['-metadata', `comment=${o.enc.comment}`] : []), '-movflags', '+faststart', '-f', 'mp4', pic];
    const proc = ff = Bun.spawn(args, { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit' });
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
      const mux = Bun.spawnSync(['ffmpeg', '-y', '-loglevel', 'error', '-i', pic, '-ss', String(from), '-t', String(to - from), '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-shortest', '-map_metadata', '0', '-movflags', '+faststart', o.out], { stderr: 'pipe' });
      rmSync(pic, { force: true });
      if (mux.exitCode !== 0) throw new Error(`ffmpeg (muxing the sound): ${mux.stderr.toString().slice(-800)}`);
    }
    ok = true;
    return { file: o.out, frames: r.frames!, seconds: +((performance.now() - t0) / 1000).toFixed(1), workers: 1, subFrames: { 1: r.frames! }, spoolPeak: 0, errors, logs, encoder: `WebCodecs H.264 in the page (${r.encoder})`, events: { duration: m.duration, timeline: m.timeline, cues: m.cues, sounds: m.sounds } };
  } finally {
    if (!ok) ff?.kill(9);
    server?.stop(true);
    await browser.close().catch(() => {});
  }
}
