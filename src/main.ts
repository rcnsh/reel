// Entry: preview player (default) or export mode (?export=1, driven by cli/reel.ts).
import { Engine, type AdaptiveSampling, type Pixels } from './engine/engine';
import { W, H, PW, PH, SCALE, FPS, ALPHA } from './engine/gl';
import { BITS } from './engine/format';
import { THEME } from './engine/palette';
import { frameStats, hexRgb, measureText } from './check';
import config from '@project/reel.config';

const params = new URLSearchParams(location.search);
const EXPORT = params.has('export');
const ONLY = params.get('only'); // comma-separated scene ids to load (faster stills)
const FROM = params.get('t') ? parseFloat(params.get('t')!) : null;

const canvas = document.getElementById('c') as HTMLCanvasElement;
// physical size: the logical frame times ?scale=, laid out at the logical size (HTML layers inside the canvas
// rasterise at its backing size over its layout size, so that ratio must be the scale exactly: the preview
// fits the canvas to the window with a transform, which leaves its layout size alone)
canvas.width = PW;
canvas.height = PH;
canvas.style.width = W + 'px';
canvas.style.height = H + 'px';

const engine = new Engine(canvas, config);
let contextLost = false;
canvas.addEventListener('webglcontextlost', () => { contextLost = true; console.error('the WebGL context was lost'); });

declare global {
  interface Window { __reel: any }
}

let TIMELINE: typeof engine.timeline = [];

async function boot() {
  const onlySet = ONLY ? new Set(ONLY.split(',')) : null;
  await engine.init(onlySet ? (e) => onlySet.has(e.id) : undefined);
  TIMELINE = engine.timeline;
  if (EXPORT) setupExport();
  else setupPlayer();
}

// ------------------------------------------------------------------ export API
/** The last frame stream() rendered (a range starting right after it needs no warm-up). */
let lastStreamed = -2;
const senders = new Map<string, Promise<Sender>>();
interface Sender { send(fill: (buf: Uint8Array) => Promise<unknown>): Promise<void> }

/**
 * A WebSocket written from a worker thread: send() fills a pooled frame buffer, transfers it to the worker
 * (no copy) and returns once the buffer is on its way, waiting first while `inflight` frames are unacknowledged.
 */
function sender(url: string, inflight: number, bytes: number): Promise<Sender> {
  let s = senders.get(url);
  if (s) return s;
  s = new Promise<Sender>((resolve, reject) => {
    const src = `let ws;
      onmessage = (e) => {
        const m = e.data;
        if (m.open) {
          ws = new WebSocket(m.open); ws.binaryType = 'arraybuffer';
          ws.onopen = () => postMessage({ open: true });
          ws.onerror = () => postMessage({ error: 'websocket error' });
          ws.onclose = () => postMessage({ error: 'websocket closed' });
          ws.onmessage = (ev) => postMessage({ acked: +ev.data || 0 });
        } else {
          ws.send(m.buf); // (copies the frame: the buffer can go straight back)
          postMessage({ free: m.buf }, [m.buf]);
        }
      };`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    const free: ArrayBuffer[] = [];
    let sent = 0, acked = 0, failed = '', pool = 0;
    let wake: (() => void) | null = null;
    const notify = () => { const f = wake; wake = null; f?.(); };
    const wait = () => new Promise<void>((r) => { wake = r; });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.open) resolve({ send });
      else if (m.error) { failed = m.error; reject(new Error(m.error)); notify(); }
      else if (m.acked !== undefined) { acked = Math.max(acked, m.acked); notify(); }
      else if (m.free) { free.push(m.free); notify(); }
    };
    async function send(fill: (buf: Uint8Array) => Promise<unknown>) {
      while (!failed && sent - acked >= inflight) await wait();
      if (failed) throw new Error(failed);
      // two buffers: one being filled while the other is with the worker (it comes straight back)
      if (!free.length && pool < 2) { free.push(new ArrayBuffer(bytes)); pool++; }
      while (!free.length) await wait();
      const buf = free.pop()!;
      await fill(new Uint8Array(buf));
      w.postMessage({ buf }, [buf]);
      sent++;
    }
    w.postMessage({ open: url });
  });
  senders.set(url, s);
  return s;
}

/** A canvas as a PNG, base64 (the native toBase64: Chrome 140+, and reel refuses anything before 157). */
async function pngOf(cv: OffscreenCanvas) {
  const b = new Uint8Array(await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer());
  return b.toBase64();
}
/** Output size for a w x h image whose long side may be at most `max` px (never enlarged). */
function fit(w: number, h: number, max?: number) {
  const k = max && Math.max(w, h) > max ? max / Math.max(w, h) : 1;
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))] as const;
}
/**
 * A copy of `src` (x, y, w, h of it) at most `max` px on its long side, smoothed. A large reduction goes in halvings
 * (each a 2x2 average) before the last step: one drawImage samples a few source pixels per output pixel on a GPU
 * canvas, so thin lines and text vanish or alias in a small copy, and differently on every backend.
 */
function scaled(src: OffscreenCanvas | HTMLCanvasElement, x: number, y: number, w: number, h: number, max?: number) {
  const [ow, oh] = fit(w, h, max);
  let cur: OffscreenCanvas | HTMLCanvasElement = src, cx = x, cy = y, cw = w, ch = h;
  for (;;) {
    const last = cw <= ow * 2 && ch <= oh * 2;
    const nw = last ? ow : Math.max(ow, Math.ceil(cw / 2)), nh = last ? oh : Math.max(oh, Math.ceil(ch / 2));
    const out = new OffscreenCanvas(nw, nh), c = out.getContext('2d')!;
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(cur, cx, cy, cw, ch, 0, 0, nw, nh);
    if (last) return out;
    cur = out; cx = 0; cy = 0; cw = nw; ch = nh;
  }
}
let lastGrid: OffscreenCanvas | null = null;
const clipsAt = (t: number) => TIMELINE.filter((e) => t >= e.start && t < e.end).sort((a, b) => (a.track ?? 0) - (b.track ?? 0)).map((e) => e.id);

function setupExport() {
  document.body.classList.add('export');
  const stateful = [...engine.loaded.values()].some((l) => l.scene?.stateful);
  window.__reel = {
    engine,
    duration: engine.duration,
    /** The sound the export muxes (a path in the project), or null for a silent video. */
    track: engine.audio.track,
    /** Scene and shader errors: the page's load errors and the render errors since beginRequest(). */
    get errors() { return engine.errors; },
    /** Timeline problems that are not errors (a transition that never plays), by clip. */
    get warnings() { return engine.warnings; },
    /**
     * Start a request on a warm page: render errors are reported again from here (once per clip). Returns false
     * when the page can no longer render (its GL context was lost: the GPU process crashed or was reset).
     */
    beginRequest() { engine.clearRenderErrors(); return !contextLost; },
    get contextLost() { return contextLost; },
    /** Output size in px (the logical frame times scale) and frame rate; stream() sends frames of width*height*3 bytes (rgb24) unless asked for other pixels. */
    scale: SCALE,
    width: PW,
    height: PH,
    /** The logical frame size scenes lay out in. */
    W, H,
    fps: FPS,
    /** A transparent render (?alpha=1) and the output's bits per channel (?bits=). */
    alpha: ALPHA,
    bits: BITS,
    theme: THEME.name,
    /** The render's props (the page's over the config's defaults). */
    props: engine.props,
    /** A loaded scene keeps simulation state: its frames must be rendered in order, by one renderer. */
    stateful,
    timeline: TIMELINE.map(({ id, start, end, track, check, freeze }) => {
      // (a frozen clip is still on purpose: `reel check` does not report it as frozen)
      const ex = check?.exempt;
      const exempt = ex === true ? ex : freeze !== undefined ? [...new Set([...(ex ?? []), 'frozen' as const])] : ex;
      return { id, start, end, track: track ?? 0, ...(exempt ? { exempt } : {}) };
    }),
    /** The theme's palette, #rrggbb per key. */
    palette: THEME.palette,
    /** Ids of the clips on screen at t, lowest track first. */
    clipsAt,
    /** Sound cues scenes recorded with cue() in their init, sorted by time. */
    get cues(): { kind: string; t: number }[] { return [...((globalThis as any).__reelCues ?? [])].sort((a, b) => a.t - b.t); },
    /** Sounds on the timeline: the config's `sounds` and those scenes placed with sound(), by start time. */
    get sounds() { return engine.sounds(); },
    /** Render a single frame at t (seeks as needed). Returns the sub-frames used. */
    still(t: number, samples: number | AdaptiveSampling = 1, shutter = 0.5) { return engine.renderFrame(t, 1 / FPS, true, samples, shutter); },
    /**
     * For `reel check`: render t collecting what the scenes report drawing, then measure the frame (its
     * brightness grid) and every text box against the pixels behind it. Returns the boxes, the stats and the
     * scene errors so far.
     */
    async inspect(t: number, samples: number | AdaptiveSampling = 1, shutter = 0.5) {
      await engine.prepare(t, 1 / FPS, samples, shutter);
      engine.collectBoxes = true;
      try { engine.render(t, 1 / FPS, true, samples, shutter); } finally { engine.collectBoxes = false; }
      const px = { data: await engine.readPixelsAsync(), pw: PW, ph: PH, scale: SCALE };
      const boxes = engine.lastBoxes.map((b) => ({ ...b, ...(b.kind === 'text' && b.color && /^#[0-9A-F]{6}$/i.test(b.color) && (b.alpha ?? 1) >= 0.05 ? { m: measureText(px, b, hexRgb(b.color)) } : {}) }));
      return { boxes, stats: frameStats(px), clips: clipsAt(t), errors: engine.errors, textDraws: engine.lastTextDraws, clocks: engine.lastClocks, stepped: [...engine.lastStepped] };
    },
    /**
     * For `reel check`'s second renders: render t by a seek (whatever was rendered before) and return the frame's
     * stats, the scene errors so far and whether a scene failed in this render (even one that had failed before).
     */
    async recheck(t: number, samples: number | AdaptiveSampling = 1, shutter = 0.5) {
      engine.forgetTime();
      const failures = engine.failures;
      await engine.renderFrame(t, 1 / FPS, true, samples, shutter);
      return { stats: frameStats({ data: await engine.readPixelsAsync(), pw: PW, ph: PH, scale: SCALE }), errors: engine.errors, failed: engine.failures > failures };
    },
    /**
     * The last rendered frame as a PNG (base64): the export's pixels at full resolution, or `crop` (x, y, w, h in
     * logical px) of them, at most `maxSize` px on the long side, with `marks` (logical rectangles) outlined.
     */
    async png(o: { maxSize?: number; crop?: [number, number, number, number]; marks?: [number, number, number, number][] } = {}) {
      const px = await engine.readPixelsAsync(), row = PW * 4;
      const img = new ImageData(PW, PH);
      for (let y = 0; y < PH; y++) img.data.set(px.subarray((PH - 1 - y) * row, (PH - y) * row), y * row); // bottom-up -> top-down
      const full = new OffscreenCanvas(PW, PH);
      full.getContext('2d')!.putImageData(img, 0, 0);
      let [x, y, w, h] = o.crop ?? [0, 0, W, H];
      x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
      w = Math.max(1, Math.min(W - x, Math.ceil(w))); h = Math.max(1, Math.min(H - y, Math.ceil(h)));
      const out = scaled(full, x * SCALE, y * SCALE, w * SCALE, h * SCALE, o.maxSize);
      if (o.marks?.length) {
        const c = out.getContext('2d')!, k = out.width / w;
        c.lineWidth = Math.max(2, Math.round(out.width / 400));
        for (const [mx, my, mw, mh] of o.marks) {
          c.strokeStyle = 'rgba(0,0,0,0.7)'; c.setLineDash([]);
          c.strokeRect((mx - x) * k, (my - y) * k, mw * k, mh * k);
          c.strokeStyle = '#ff2bd6'; c.setLineDash([c.lineWidth * 3, c.lineWidth * 2]);
          c.strokeRect((mx - x) * k, (my - y) * k, mw * k, mh * k);
        }
      }
      return pngOf(out);
    },
    /**
     * Frames at `times` in a grid of `cols` columns, each `cell` px on its long side and labelled with its time
     * and the clips on screen; the whole image at most `maxSize` px on its long side. PNG, base64.
     */
    async grid(o: { times: number[]; cols: number; cell: number; samples?: number | AdaptiveSampling; shutter?: number; maxSize?: number; gap?: number }) {
      const [cw, ch] = fit(W, H, o.cell);
      const cols = Math.max(1, Math.min(o.cols, o.times.length)), rows = Math.ceil(o.times.length / cols);
      const pad = 4, lab = 20;
      const cv = new OffscreenCanvas(cols * (cw + pad) + pad, rows * (ch + lab + pad) + pad);
      const c = cv.getContext('2d')!;
      c.fillStyle = '#1b1b1d'; c.fillRect(0, 0, cv.width, cv.height);
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
      const cells: { t: number; clips: string[]; subFrames: number }[] = [];
      for (const [i, t] of o.times.entries()) {
        const k = await engine.renderFrame(t, 1 / FPS, true, o.samples ?? 1, o.shutter ?? 0.5);
        const x = pad + (i % cols) * (cw + pad), y = pad + Math.floor(i / cols) * (ch + lab + pad);
        c.drawImage(canvas, 0, 0, PW, PH, x, y + lab, cw, ch);
        const ids = clipsAt(t).filter((id) => id !== 'overlay');
        c.fillStyle = '#e6e3dc'; c.font = '600 13px ui-monospace, Menlo, monospace';
        c.fillText(`${t.toFixed(3)}s`, x + 2, y + 14);
        c.fillStyle = '#9c978f'; c.font = '12px ui-monospace, Menlo, monospace';
        const tw = c.measureText(`${t.toFixed(3)}s`).width + 10;
        let label = ids.join('+') || '—';
        while (label.length > 1 && c.measureText(label).width > cw - tw - 4) label = label.slice(0, -2) + '…';
        c.fillText(label, x + 2 + tw, y + 14);
        cells.push({ t, clips: clipsAt(t), subFrames: k });
      }
      lastGrid = cv;
      const out = o.maxSize && Math.max(cv.width, cv.height) > o.maxSize ? scaled(cv, 0, 0, cv.width, cv.height, o.maxSize) : cv;
      return { png: await pngOf(out), width: out.width, height: out.height, cells };
    },
    /** The last grid again, at most `maxSize` px on its long side (a preview without rendering it twice). */
    async lastGridPng(maxSize: number) {
      if (!lastGrid) throw new Error('no grid rendered yet');
      return pngOf(scaled(lastGrid, 0, 0, lastGrid.width, lastGrid.height, maxSize));
    },
    /**
     * The draft tier: render [from, to) at the frame rate (one sample) and encode it here with WebCodecs, H.264 from
     * the canvas (hardware where the browser has it, else its software encoder), sending the Annex B stream over a
     * WebSocket in order, one message per encoded frame. The receiver acknowledges with the running count of
     * messages taken; at most `inflight` are unacknowledged. Returns the frames encoded and the encoder used, or
     * `{ unsupported }` when this browser can encode neither way (the CLI then pipes raw frames instead).
     */
    async encode(opts: { from: number; to: number; ws: string; bitrate: number; inflight?: number }) {
      const VE = (window as any).VideoEncoder, VF = (window as any).VideoFrame;
      if (!VE) return { unsupported: 'no WebCodecs' };
      const base = { codec: 'avc1.640028', width: PW, height: PH, bitrate: opts.bitrate, framerate: FPS, avc: { format: 'annexb' }, latencyMode: 'quality' };
      let cfg: Record<string, unknown> | null = null;
      for (const hw of ['prefer-hardware', 'prefer-software']) {
        const c = { ...base, hardwareAcceleration: hw };
        if ((await VE.isConfigSupported(c)).supported) { cfg = c; break; }
      }
      if (!cfg) return { unsupported: `this browser cannot encode H.264 at ${PW}x${PH}` };
      const ws = new WebSocket(opts.ws);
      ws.binaryType = 'arraybuffer';
      let acked = 0, sent = 0, failed = '', wake: (() => void) | null = null;
      const notify = () => { const f = wake; wake = null; f?.(); };
      await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error('websocket error')); });
      ws.onmessage = (e) => { acked = Math.max(acked, +e.data || 0); notify(); };
      ws.onclose = () => { failed ||= 'websocket closed'; notify(); };
      const enc = new VE({
        output: (c: { byteLength: number; copyTo(b: Uint8Array): void }) => { const b = new Uint8Array(c.byteLength); c.copyTo(b); ws.send(b); sent++; },
        error: (e: unknown) => { failed = `encoder: ${e}`; notify(); },
      });
      enc.configure(cfg);
      const dt = 1 / FPS, n0 = Math.round(opts.from * FPS), n1 = Math.round(opts.to * FPS), inflight = opts.inflight ?? 8;
      for (let n = n0; n < n1; n++) {
        if (failed) throw new Error(failed);
        await engine.renderFrame(n * dt, dt, true, 1, 0.5);
        const f = new VF(canvas, { timestamp: Math.round((n - n0) * dt * 1e6), duration: Math.round(dt * 1e6) });
        enc.encode(f, { keyFrame: (n - n0) % Math.round(FPS * 2) === 0 });
        f.close();
        while (!failed && (enc.encodeQueueSize > 2 || sent - acked >= inflight)) await new Promise<void>((r) => { wake = r; setTimeout(notify, 2); });
      }
      await enc.flush();
      enc.close();
      while (!failed && acked < sent) await new Promise<void>((r) => { wake = r; setTimeout(notify, 5); });
      ws.close();
      if (failed && failed !== 'websocket closed') throw new Error(failed);
      return { frames: n1 - n0, encoder: (cfg.hardwareAcceleration as string).replace('prefer-', '') };
    },
    /**
     * Render [from, to) at the frame rate and stream raw rgb24 frames (bottom-up) over a WebSocket, in order.
     * Returns when all frames were handed to the socket, with a histogram of sub-frames per frame. The
     * receiver acknowledges each frame it has taken (a text message with its running count) and at most
     * `inflight` frames are unacknowledged: backpressure from the encoder, so a slow encode (4K) cannot
     * pile frames up in memory. Pipelined: frame n's readback is collected while n+1 renders, and the
     * socket is written from a worker thread. Calls with the same `ws` reuse its connection, so a
     * renderer can be handed several ranges. In a project with a stateful scene, a range that does not go on where
     * the last one ended starts with a warm-up frame; a stateless frame is the same however it is reached, so its
     * ranges start straight away.
     * `pixels` picks the readback (rgb8 by default; see Pixels).
     */
    async stream(opts: { from: number; to: number; ws: string; samples?: number | AdaptiveSampling; shutter?: number; inflight?: number; pixels?: Pixels }) {
      const mode = opts.pixels ?? 'rgb8';
      const snd = await sender(opts.ws, opts.inflight ?? 4, Engine.bytes(mode));
      const dt = 1 / FPS;
      const n0 = Math.round(opts.from * FPS), n1 = Math.round(opts.to * FPS);
      const S = opts.samples ?? 1, SH = opts.shutter ?? 0.5;
      // warm-up: render one frame before the range so the first frame is sequential for stateful scenes (it gets
      // the frame step as dt, not a seek's 0). Stateless scenes depend on t only: no warm-up. (Adaptive sampling
      // only runs stateless scenes: one sample is enough for the warm-up.)
      if (stateful && n0 > 0 && lastStreamed !== n0 - 1) await engine.renderFrame((n0 - 1) * dt, dt, false, typeof S === 'number' ? S : 1, SH);
      const used: Record<number, number> = {}; // sub-frames per frame -> frames
      let pending = -1;
      for (let n = n0; n < n1; n++) {
        const k = await engine.renderFrame(n * dt, dt, false, S, SH);
        used[k] = (used[k] ?? 0) + 1;
        engine.readStart(n & 1, mode);
        if (pending >= 0) await snd.send((buf) => engine.readFinish(pending & 1, buf));
        pending = n;
      }
      if (pending >= 0) await snd.send((buf) => engine.readFinish(pending & 1, buf));
      lastStreamed = n1 - 1;
      return used;
    },
  };
  window.__reel.ready = true;
}

// ------------------------------------------------------------------ preview player
function setupPlayer() {
  const audio = new Audio(engine.audio.track ?? undefined);
  audio.preload = 'auto';
  const ui = document.getElementById('ui')!;
  const scrub = document.getElementById('scrub') as HTMLInputElement;
  const info = document.getElementById('info')!;
  const marks = document.getElementById('marks')!;
  const errs = document.getElementById('errs')!;
  scrub.max = String(engine.duration);
  scrub.step = '0.001';
  if (engine.errors.length) { errs.textContent = engine.errors.join('\n\n'); errs.style.display = 'block'; }

  for (const e of TIMELINE) {
    const m = document.createElement('div');
    m.className = 'mark';
    m.style.left = `${(e.start / engine.duration) * 100}%`;
    m.style.width = `${((e.end - e.start) / engine.duration) * 100}%`;
    m.title = `${e.id} ${e.start.toFixed(2)}–${e.end.toFixed(2)}`;
    m.textContent = e.id;
    m.onclick = () => seek(e.start);
    marks.appendChild(m);
  }

  let t = FROM ?? 0;
  let playing = false;
  let loop: [number, number] | null = null;
  let lastAudioT = 0, lastPerf = 0;
  const seek = (x: number) => { t = Math.max(0, Math.min(engine.duration - 0.001, x)); audio.currentTime = t; };
  seek(t);

  // (with no narration file the clock still runs: play() rejects and the performance.now() smoothing carries it)
  const toggle = () => { playing = !playing; if (playing) { audio.currentTime = t; audio.play().catch(() => {}); } else audio.pause(); };
  canvas.onclick = toggle;
  scrub.oninput = () => seek(parseFloat(scrub.value));
  window.addEventListener('keydown', (ev) => {
    if (ev.key === ' ') { ev.preventDefault(); toggle(); }
    if (ev.key === 'ArrowRight') seek(t + (ev.shiftKey ? 5 : 1));
    if (ev.key === 'ArrowLeft') seek(t - (ev.shiftKey ? 5 : 1));
    if (ev.key === '.') seek(t + 1 / FPS);
    if (ev.key === ',') seek(t - 1 / FPS);
    if (ev.key === 'l') {
      const e = TIMELINE.find((x) => t >= x.start && t < x.end);
      loop = loop ? null : e ? [e.start, e.end] : null;
    }
    if (ev.key === 'h') ui.classList.toggle('hidden');
    if (ev.key === ']') { const e = TIMELINE.find((x) => x.start > t + 0.01); if (e) seek(e.start); }
    if (ev.key === '[') { const es = TIMELINE.filter((x) => x.start < t - 0.3); const e = es[es.length - 1]; if (e) seek(e.start); }
  });

  // fit the frame to the window (a transform: the canvas keeps its logical layout size)
  const wrap = document.getElementById('wrap')!;
  const fitView = () => { canvas.style.transform = `scale(${Math.min(wrap.clientWidth / W, wrap.clientHeight / H)})`; };
  new ResizeObserver(fitView).observe(wrap);
  fitView();

  let frames = 0, fpsT = performance.now(), fps = 0;
  // (the next frame is asked for once this one is drawn: a frame's prepare may wait for a paint)
  const tick = async () => {
    try {
      if (playing) {
        // smooth the coarse audio clock with performance.now()
        const now = performance.now();
        if (audio.currentTime !== lastAudioT) { lastAudioT = audio.currentTime; lastPerf = now; }
        t = lastAudioT + (audio.paused ? 0 : (now - lastPerf) / 1000);
        if (loop && t >= loop[1]) seek(loop[0]);
        if (audio.ended) playing = false;
      }
      await engine.renderFrame(t, 1 / FPS);
      scrub.value = String(t);
      frames++;
      const now = performance.now();
      if (now - fpsT > 500) { fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }
      const e = TIMELINE.find((x) => t >= x.start && t < x.end);
      const l = engine.words.lineAt(t);
      info.textContent = `${t.toFixed(2)}s  beat ${engine.audio.beatAt(t).toFixed(2)}  bar ${engine.audio.barAt(t).toFixed(2)}  [${e?.id ?? '—'}]  ${fps.toFixed(0)}fps   ${l ? '“' + l.text + '”' : ''}${loop ? '  LOOP' : ''}`;
    } finally { requestAnimationFrame(tick); }
  };
  requestAnimationFrame(tick);

  // Vite HMR: re-instantiate scenes whose module changed
  if (import.meta.hot) {
    (import.meta.hot as unknown as { on(ev: string, cb: (payload: any) => void): void }).on('vite:afterUpdate', (payload) => {
      for (const u of payload.updates ?? []) {
        const m = /scenes\/([\w-]+)\.ts/.exec(u.path ?? '');
        if (m) for (const e of TIMELINE) if (e.id === m[1] || (e as any).file === m[1]) engine.reload(e.id);
      }
    });
  }
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f55;position:fixed;top:0;left:0">${String(e?.stack ?? e)}</pre>`);
  window.__reel = { error: String(e?.stack ?? e) };
});
