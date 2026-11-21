import * as THREE from 'three';
import { createFile, DataStream, Endianness, type ISOFile } from 'mp4box';
import { awaitBeforeFirstFrame, notLate } from '../engine/html';
import { LOADING, type Frame } from '../engine/scene';
import { sound } from '../engine/util';
import { drawPicture, kenBurnsAt, type Framing } from './image';
import { safeBox, windowOf, type Box, type ComponentOptions } from './common';
import { framesAt, videoSounds, type FrameSpan, type VideoTiming } from './video-time';

export interface VideoClipOptions extends Omit<ComponentOptions, 'css'> {
  src: string;
  trim?: [number, number];
  speed?: number;
  loop?: boolean;
  fit?: 'cover' | 'contain';
  radius?: number;
  kenBurns?: boolean | { from?: Framing; to?: Framing };
  frames?: 'nearest' | 'blend';
  alpha?: 'below' | 'right';
  sound?: boolean | { db: number };
  cacheMB?: number;
  alt?: string;
}

interface Sample { pts: number; dur: number; sync: boolean; data: Uint8Array; ts: number }

interface Track { config: VideoDecoderConfig; width: number; height: number; samples: Sample[]; frames: FrameSpan[]; order: number[]; rank: number[]; hasAudio: boolean }

async function parseMp4(bytes: ArrayBuffer, src: string): Promise<Track> {
  const file: ISOFile = createFile();
  const ready = new Promise<void>((res, rej) => { file.onReady = () => res(); file.onError = (_m, msg) => rej(new Error(msg)); });
  const buf = bytes as ArrayBuffer & { fileStart: number };
  buf.fileStart = 0;
  file.appendBuffer(buf as never);
  file.flush();
  await Promise.race([ready, new Promise((_, rej) => setTimeout(() => rej(new Error('not an MP4 or MOV file (WebM and others: re-encode to MP4)')), 0))]);
  const info = file.getInfo();
  const vt = info.videoTracks[0];
  if (!vt) throw new Error('the file has no video track');
  const trak = file.getTrackById(vt.id);
  let description: Uint8Array | undefined;
  for (const e of trak.mdia.minf.stbl.stsd.entries as unknown as Record<string, { write(s: DataStream): void } | undefined>[]) {
    const box = e.avcC ?? e.hvcC ?? e.vpcC ?? e.av1C;
    if (box) { const s = new DataStream(undefined, 0, Endianness.BIG_ENDIAN); box.write(s); description = new Uint8Array(s.buffer, 8); break; }
  }
  const config: VideoDecoderConfig = { codec: vt.codec.startsWith('vp08') ? 'vp8' : vt.codec, codedWidth: vt.video!.width, codedHeight: vt.video!.height, description, hardwareAcceleration: 'prefer-software', optimizeForLatency: false };
  if (!(await VideoDecoder.isConfigSupported(config)).supported) {
    config.hardwareAcceleration = 'no-preference';
    if (!(await VideoDecoder.isConfigSupported(config)).supported) throw new Error(`this browser cannot decode '${vt.codec}' (H.264, HEVC, VP9 and AV1 in MP4 work)`);
  }
  const u8 = new Uint8Array(bytes);
  const raw = file.getTrackSamplesInfo(vt.id);
  if (!raw.length) throw new Error('the video track has no frames');
  const t0 = Math.min(...raw.map((s) => s.cts));
  const samples: Sample[] = raw.map((s) => ({ pts: (s.cts - t0) / s.timescale, dur: s.duration / s.timescale, sync: s.is_sync, data: u8.subarray(s.offset, s.offset + s.size), ts: Math.round(((s.cts - t0) / s.timescale) * 1e6) }));
  const order = samples.map((_, i) => i).sort((a, b) => samples[a]!.pts - samples[b]!.pts), rank: number[] = [];
  order.forEach((s, i) => { rank[s] = i; });
  return { rank, config, width: vt.track_width || vt.video!.width, height: vt.track_height || vt.video!.height, samples, frames: order.map((i) => ({ pts: samples[i]!.pts, dur: samples[i]!.dur })), order, hasAudio: info.audioTracks.length > 0 };
}

export class VideoClip {
  readonly box: Box;
  private o: VideoClipOptions;
  private track: Track | null = null;
  private timing!: VideoTiming;
  private decoder: VideoDecoder | null = null;
  private cache = new Map<number, THREE.ExternalTexture>();
  private free: WebGLTexture[] = [];
  private wanted = new Set<number>();
  private renderer: THREE.WebGLRenderer | null = null;
  private busy: Promise<void> = Promise.resolve();
  private failed: Error | null = null;
  private centre = NaN;
  private texSize: [number, number] | null = null;
  private backward = false;

  constructor(o: VideoClipOptions) {
    this.o = o;
    const own = windowOf(o.at, o.label ?? o.alt ?? o.src);
    this.box = o.box ?? safeBox();
    const clip = LOADING.clip;
    notLate(o.label ?? o.src);
    this.backward = !!clip?.time.reverse;
    awaitBeforeFirstFrame((async () => {
      const res = await fetch(o.src);
      if (!res.ok) throw new Error(`video '${o.src}' did not load (a path in the project, served from its folder): ${res.status} ${res.statusText}`);
      const t = await parseMp4(await res.arrayBuffer(), o.src).catch((e: Error) => { throw new Error(`video '${o.src}': ${e.message}`); });
      this.track = t;
      const last = t.frames.at(-1)!, length = last.pts + last.dur;
      const trim: [number, number] = [Math.max(0, o.trim?.[0] ?? 0), Math.min(length, o.trim?.[1] ?? length)];
      if (!(trim[1] > trim[0])) throw new Error(`video '${o.src}': the trim [${o.trim}] holds no frames (the file is ${length.toFixed(2)} s)`);
      const speed = o.speed ?? 1;
      if (!(speed > 0)) throw new Error(`video '${o.src}': speed must be above 0`);
      const at: [number, number] = own ?? [0, clip ? clip.end - clip.start : (trim[1] - trim[0]) / speed];
      this.timing = { at, trim, speed, loop: !!o.loop };
      if (clip && t.hasAudio && o.sound !== false) for (const s of videoSounds(o.src, clip.start, this.timing, typeof o.sound === 'object' ? o.sound.db : 0)) sound(s, clip);
    })());
  }

  /** The frame's size in px (the colour's half with stacked alpha). */
  get size(): [number, number] {
    const t = this.track;
    if (!t) return [1, 1];
    return this.o.alpha === 'below' ? [t.width, t.height / 2] : this.o.alpha === 'right' ? [t.width / 2, t.height] : [t.width, t.height];
  }

  get duration() { const l = this.track?.frames.at(-1); return l ? l.pts + l.dur : 0; }

  async prepare(f: Frame, renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.centre = f.lt;
    const t = this.track;
    if (!t) return;
    const [w0, w1] = this.timing.at;
    if (f.lt + f.exposure / 2 < w0 || f.lt - f.exposure / 2 > w1) return;
    const { a, b } = framesAt(t.frames, Math.min(Math.max(f.lt, w0), w1), this.timing, this.o.frames === 'blend');
    const need = a === b ? [a] : [a, b];
    const run = this.busy.then(() => this.ensure(need));
    this.busy = run.catch(() => {});
    await run;
  }

  private bytesPerFrame() { const [w, h] = this.texSize ?? [this.track!.width, this.track!.height]; return w * h * 4 * 1.34; }

  private async ensure(need: number[]) {
    if (this.failed) throw this.failed;
    const t = this.track!;
    this.wanted = new Set(need);
    const missing = need.filter((i) => !this.cache.has(i));
    if (!missing.length) { for (const i of need) this.touch(i); return; }
    const cap = Math.max(need.length + 2, Math.floor(((this.o.cacheMB ?? 384) * 2 ** 20) / this.bytesPerFrame()));
    const keep = new Set(need), ahead = Math.max(0, Math.min(cap - need.length, Math.floor(cap / 2)));
    if (this.backward) {
      const low = Math.min(...need);
      for (let i = low - 1; i >= Math.max(0, low - ahead); i--) keep.add(i);
    } else {
      const top = Math.max(...need);
      for (let i = top + 1; i < Math.min(t.frames.length, top + 1 + ahead); i++) keep.add(i);
    }
    const groups = new Map<number, number>();
    for (const i of missing) {
      const d = t.order[i]!;
      let k = d;
      while (k > 0 && !t.samples[k]!.sync) k--;
      groups.set(k, Math.max(groups.get(k) ?? 0, d));
    }
    for (const [k, last] of [...groups].sort((a, b) => a[0] - b[0])) await this.decodeGroup(k, last, keep, cap);
    const still = need.filter((i) => !this.cache.has(i));
    if (still.length) throw new Error(`video '${this.o.src}': frames ${still.join(', ')} did not decode`);
  }

  private async decodeGroup(k: number, last: number, keep: Set<number>, cap: number) {
    const t = this.track!;
    let group = k + 1;
    while (group < t.samples.length && !t.samples[group]!.sync) group++;
    let end = last + 1;
    for (const i of keep) { const d = t.order[i]!; if (d >= k && d < group) end = Math.max(end, d + 1); }
    const byTs = new Map<number, number>();
    for (let s = k; s < end; s++) byTs.set(t.samples[s]!.ts, t.rank[s]!);
    const dec = this.decoderFor((frame) => {
      try {
        const i = byTs.get(frame.timestamp);
        if (i !== undefined && keep.has(i) && !this.cache.has(i)) this.store(i, frame, cap);
      } finally { frame.close(); }
    });
    for (let s = k; s < end; s++) {
      const x = t.samples[s]!;
      dec.decode(new EncodedVideoChunk({ type: s === k || x.sync ? 'key' : 'delta', timestamp: x.ts, duration: Math.round(x.dur * 1e6), data: x.data }));
    }
    try { await dec.flush(); } catch (e) { throw this.failed ?? e; }
  }

  private decoderFor(output: (f: VideoFrame) => void) {
    this.decoder?.close();
    const dec = new VideoDecoder({ output, error: (e) => { this.failed = new Error(`video '${this.o.src}': ${e.message}`); } });
    dec.configure(this.track!.config);
    this.decoder = dec;
    return dec;
  }

  private touch(i: number) { const tx = this.cache.get(i); if (tx) { this.cache.delete(i); this.cache.set(i, tx); } }

  private store(i: number, frame: VideoFrame, cap: number) {
    const r = this.renderer;
    if (!r) throw new Error('VideoClip.prepare(f, renderer) has not been given the renderer');
    while (this.cache.size >= cap) {
      const old = [...this.cache.keys()].find((j) => !this.wanted.has(j));
      if (old === undefined) break;
      const tx = this.cache.get(old)!;
      this.free.push(tx.sourceTexture as WebGLTexture);
      tx.dispose();
      this.cache.delete(old);
    }
    const gl = r.getContext() as WebGL2RenderingContext;
    const w = frame.displayWidth, h = frame.displayHeight;
    this.texSize ??= [w, h];
    const [tw, th] = this.texSize;
    if (w !== tw || h !== th) throw new Error(`video '${this.o.src}': its frames change size (${tw}x${th}, then ${w}x${h}); re-encode it at one size`);
    let tex = this.free.pop();
    if (!tex) {
      tex = gl.createTexture()!;
      r.state.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(tw, th))) + 1, gl.SRGB8_ALPHA8, tw, th);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    r.state.bindTexture(gl.TEXTURE_2D, tex);
    const st = r.state as unknown as { pixelStorei(name: number, value: number | boolean): void };
    st.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    st.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    st.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    gl.generateMipmap(gl.TEXTURE_2D);
    const tx = new THREE.ExternalTexture(tex);
    this.cache.set(i, tx);
  }

  draw(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, f: Frame, o: { opacity?: number } = {}) {
    const t = this.track;
    if (!t) return;
    const [w0, w1] = this.timing.at;
    if (f.lt < w0 || f.lt > w1) return;
    const lt = Math.abs(f.lt - this.centre) <= f.exposure / 2 + 1e-6 ? this.centre : f.lt;
    const { a, b, w } = framesAt(t.frames, Math.min(Math.max(lt, w0), w1), this.timing, this.o.frames === 'blend');
    const ta = this.cache.get(a), tb = this.cache.get(b);
    if (!ta || !tb) throw new Error(`video '${this.o.src}': frame ${!ta ? a : b} was not prepared (call await clip.prepare(f, renderer) in the scene's prepare)`);
    drawPicture(renderer, out, f, {
      tex: ta, tex2: b !== a ? tb : null, mix: w, alpha: this.o.alpha ?? 'none', size: this.size, box: this.box, fit: this.o.fit, radius: this.o.radius,
      framing: kenBurnsAt(this.o.kenBurns, f.lt, w0, w1), label: this.o.label ?? this.o.alt ?? this.o.src,
    }, this.o.motion ?? { from: 'fade' }, w0, w1, o.opacity ?? 1);
  }

  dispose() {
    this.decoder?.close();
    const gl = this.renderer?.getContext() as WebGL2RenderingContext | undefined;
    for (const tx of this.cache.values()) { gl?.deleteTexture(tx.sourceTexture as WebGLTexture); tx.dispose(); }
    for (const tex of this.free) gl?.deleteTexture(tex);
    this.cache.clear(); this.free = [];
  }
}
