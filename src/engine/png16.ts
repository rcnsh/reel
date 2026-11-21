
export interface Png16 {
  width: number;
  height: number;
  data: Float32Array;
}

interface Chunks { width: number; height: number; depth: number; colorType: number; interlace: number; idat: Uint8Array[]; cicp?: number[]; iccp: boolean; srgb: boolean; gamma?: number }

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

export function pngDepth(b: Uint8Array): number {
  return b.length > 25 && SIG.every((v, i) => b[i] === v) ? b[24]! : 0;
}

function chunks(b: Uint8Array): Chunks {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const c: Chunks = { width: 0, height: 0, depth: 0, colorType: 0, interlace: 0, idat: [], iccp: false, srgb: false };
  for (let p = 8; p + 8 <= b.length;) {
    const len = v.getUint32(p), type = String.fromCharCode(...b.subarray(p + 4, p + 8)), d = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { c.width = v.getUint32(p + 8); c.height = v.getUint32(p + 12); c.depth = d[8]!; c.colorType = d[9]!; c.interlace = d[12]!; }
    else if (type === 'IDAT') c.idat.push(d);
    else if (type === 'cICP') c.cicp = [d[0]!, d[1]!];
    else if (type === 'iCCP') c.iccp = true;
    else if (type === 'sRGB') c.srgb = true;
    else if (type === 'gAMA') c.gamma = v.getUint32(p + 8) / 100000;
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  return c;
}

async function inflate(parts: Uint8Array[]): Promise<Uint8Array> {
  const s = new Blob(parts as BlobPart[]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

const srgbToLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const P3_TO_709 = [1.2249401, -0.2249404, 0, -0.0420569, 1.0420571, 0, -0.0196376, -0.0786361, 1.0982735];

export async function decodePng16(b: Uint8Array): Promise<Png16 | null> {
  if (pngDepth(b) !== 16) return null;
  const c = chunks(b);
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[c.colorType];
  if (!channels || c.interlace !== 0 || !c.idat.length) return null;
  let decode: (x: number) => number = srgbToLinear, p3 = false;
  if (c.cicp) {
    const [prim, tf] = c.cicp as [number, number];
    if (prim !== 1 && prim !== 12) return null;
    if (tf === 8) decode = (x) => x;
    else if (tf !== 13) return null;
    p3 = prim === 12;
  } else if (!c.srgb && c.iccp) return null;
  else if (!c.srgb && c.gamma) { const g = 1 / c.gamma; decode = (x) => x ** g; }

  const raw = await inflate(c.idat);
  const { width: w, height: h } = c, bpp = channels * 2, stride = w * bpp;
  if (raw.length < h * (stride + 1)) throw new Error('the PNG is truncated');
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!, src = y * (stride + 1) + 1, row = y * stride, prev = row - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]!, a = i >= bpp ? px[row + i - bpp]! : 0, up = y > 0 ? px[prev + i]! : 0, ul = y > 0 && i >= bpp ? px[prev + i - bpp]! : 0;
      let v: number;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + up;
      else if (f === 3) v = x + ((a + up) >> 1);
      else if (f === 4) { const p = a + up - ul, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - ul); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : ul); }
      else throw new Error(`the PNG has an unknown row filter ${f}`);
      px[row + i] = v & 255;
    }
  }
  const out = new Float32Array(w * h * 4), lut = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) lut[i] = decode(i / 65535);
  const at = (i: number) => (px[i]! << 8) | px[i + 1]!;
  for (let i = 0, o = 0; i < w * h; i++, o += 4) {
    const s = i * bpp;
    let r: number, g: number, bl: number, al = 1;
    if (channels <= 2) { r = g = bl = lut[at(s)]!; if (channels === 2) al = at(s + 2) / 65535; }
    else { r = lut[at(s)]!; g = lut[at(s + 2)]!; bl = lut[at(s + 4)]!; if (channels === 4) al = at(s + 6) / 65535; }
    if (p3) {
      const m = P3_TO_709;
      [r, g, bl] = [Math.max(0, m[0]! * r + m[1]! * g + m[2]! * bl), Math.max(0, m[3]! * r + m[4]! * g + m[5]! * bl), Math.max(0, m[6]! * r + m[7]! * g + m[8]! * bl)];
    }
    out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = al;
  }
  return { width: w, height: h, data: out };
}
