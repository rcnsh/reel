// The output formats: which one a command line means, what each asks of the page, and the ffmpeg command for each.
import { expect, test } from 'bun:test';
import { UsageError } from '../cli/args';
import { defaultOut, draftEncoder, draftName, encodeOptsOf, FORMATS, ffmpegArgs, formatOf, planOf, sequencePattern, webpArgs, type EncodeOpts, type FormatId } from '../cli/formats';
import { containerOf } from '../tools/mix';

test('the format comes from --format, else the --out extension, else H.264', () => {
  expect(formatOf(undefined, undefined).id).toBe('h264');
  expect(formatOf(undefined, '/x/a.mov').id).toBe('prores');
  expect(formatOf(undefined, '/x/a.webm').id).toBe('webm');
  expect(formatOf(undefined, '/x/a.GIF').id).toBe('gif');
  expect(formatOf(undefined, '/x/f.jpeg').id).toBe('jpeg');
  expect(formatOf(undefined, '/x/f.exr').id).toBe('exr');
  expect(formatOf('hevc', '/x/a.mp4').id).toBe('hevc');
  expect(formatOf('prores4444', '/x/a.mov').id).toBe('prores4444');
  expect(formatOf('png16', '/x/f.png').id).toBe('png16');
  expect(() => formatOf(undefined, '/x/a.avi')).toThrow(UsageError);
  expect(() => formatOf('hevc', '/x/a.mov')).toThrow('a hevc file is .mp4');
  expect(() => formatOf('png16', '/x/f.jpg')).toThrow('.png files');
  expect(() => formatOf('toString', undefined)).toThrow('--format toString');
});

test('each format asks the page for the readback, depth and alpha it needs', () => {
  const p = (id: FormatId, o = {}) => { const x = planOf(FORMATS[id], o, 60); return [x.pixels, x.bits, x.alpha, x.rawFormat]; };
  expect(p('h264')).toEqual(['rgb8', 8, false, 'rgb24']);
  expect(p('h264', { depth: 10 })).toEqual(['rgb16', 10, false, 'rgb48le']);
  expect(p('hevc')).toEqual(['rgb16', 10, false, 'rgb48le']);
  expect(p('prores')).toEqual(['rgb16', 10, false, 'rgb48le']);
  expect(p('prores4444')).toEqual(['rgba16', 10, true, 'rgba64le']);
  expect(p('prores4444', { alpha: false })).toEqual(['rgb16', 10, false, 'rgb48le']);
  expect(p('webm')).toEqual(['rgba8', 8, true, 'rgba']);
  expect(p('png')).toEqual(['rgb8', 8, false, 'rgb24']);
  expect(p('png', { alpha: true })).toEqual(['rgba8', 8, true, 'rgba']);
  expect(p('png16', { alpha: true })).toEqual(['rgba16', 16, true, 'rgba64le']);
  expect(p('exr')).toEqual(['linear', 8, false, 'rgbaf16le']);
  // 8-bit 4:2:0 reads back yuv420p converted on the GPU when the size packs (width a multiple of 8, height of 4)
  const q = (id: FormatId, size: [number, number], o = {}) => planOf(FORMATS[id], o, 30, size).pixels;
  expect(q('h264', [1920, 1080])).toBe('yuv420');
  expect(q('h264', [1080, 1920])).toBe('yuv420');
  expect(q('h264', [1916, 1080])).toBe('rgb8');
  expect(q('h264', [1920, 1080], { chroma: '444' })).toBe('rgb8');
  expect(q('webm', [1920, 1080], { alpha: false })).toBe('yuv420');
  expect(q('webm', [1920, 1080])).toBe('rgba8');
  expect(q('gif', [1920, 1080])).toBe('rgb8');
  // loops cap the frame rate, never raise it
  expect(planOf(FORMATS.gif, {}, 60).fps).toBe(25);
  expect(planOf(FORMATS.webp, {}, 24).fps).toBe(24);
  expect(planOf(FORMATS.gif, { maxFps: 12 }, 30).fps).toBe(12);
  expect(planOf(FORMATS.h264, {}, 60).fps).toBe(60);
  expect(() => planOf(FORMATS.h264, { alpha: true }, 30)).toThrow('cannot carry transparency');
  expect(() => planOf(FORMATS.hevc, { chroma: '444' }, 30)).toThrow('--chroma goes with h264');
  expect(() => planOf(FORMATS.png, { maxSize: 300 }, 30)).toThrow('loop formats');
  expect(() => planOf(FORMATS.prores, { draft: 'x264' }, 30)).toThrow('--draft');
});

test('flags become encoder options, checked against the format', () => {
  expect(encodeOptsOf({ crf: '20', preset: 'fast', chroma: '444', depth: '10' }, FORMATS.h264)).toEqual({ crf: 20, preset: 'fast', chroma: '444', depth: 10 });
  expect(encodeOptsOf({ opaque: true }, FORMATS.webm)).toEqual({ alpha: false });
  expect(encodeOptsOf({ quality: '70', 'max-size': '480', 'max-fps': '15' }, FORMATS.webp)).toEqual({ quality: 70, maxSize: 480, maxFps: 15 });
  expect(() => encodeOptsOf({ crf: '20' }, FORMATS.prores)).toThrow('--crf goes with');
  expect(() => encodeOptsOf({ preset: 'warp' }, FORMATS.h264)).toThrow('--preset warp');
  expect(() => encodeOptsOf({ opaque: true }, FORMATS.png)).toThrow('--opaque goes with');
  expect(() => encodeOptsOf({ alpha: true, opaque: true }, FORMATS.webm)).toThrow('contradict');
  expect(() => encodeOptsOf({ x265: 'a=1' }, FORMATS.h264)).toThrow('--x265 goes with hevc');
  expect(() => encodeOptsOf({ quality: '101' }, FORMATS.jpeg)).toThrow('1 to 100');
});

const args = (id: FormatId, o = {}, audio = true) => {
  const plan = planOf(FORMATS[id], o, 30);
  return ffmpegArgs(plan, o, { width: 1280, height: 720, fps: plan.fps, out: `/o/x${FORMATS[id].ext}`, audio: audio ? { file: '/p/t.flac', from: 1, duration: 2 } : null, startNumber: 30 }).join(' ');
};

test('YUV formats convert full-range RGB to limited-range BT.709 explicitly and tag all four colour fields', () => {
  for (const id of ['h264', 'hevc', 'prores', 'prores4444', 'webm'] as FormatId[]) {
    const a = args(id);
    expect(a).toContain('scale=in_range=pc:out_range=tv:out_color_matrix=bt709:flags=area+accurate_rnd+full_chroma_int');
    expect(a).toContain('setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709');
    expect(a).toContain('-color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709');
    expect(a).toStartWith('ffmpeg -y -loglevel error -f rawvideo -pix_fmt');
  }
});

test("16-bit frames have swscale's gain divided out before the YUV conversion; 8-bit and image formats do not", () => {
  const deep = (id: FormatId, o: EncodeOpts = {}) => {
    const plan = planOf(FORMATS[id], o, 30);
    return { plan, a: ffmpegArgs(plan, o, { width: 1280, height: 720, fps: 30, out: `/o/x${FORMATS[id].ext}`, deepGain: 1.0039166 }).join(' ') };
  };
  for (const [id, o] of [['hevc', {}], ['prores', {}], ['prores4444', {}], ['h264', { depth: 10 }], ['h264', { chroma: '444', depth: 10 }]] as [FormatId, EncodeOpts][]) {
    const { plan, a } = deep(id, o);
    expect(plan.pixels).toMatch(/^rgba?16$/);
    expect(a).toContain('vflip,lutrgb=r=val*0.9960987:g=val*0.9960987:b=val*0.9960987,scale=in_range=pc');
  }
  for (const [id, o] of [['h264', {}], ['h264', { chroma: '444' }], ['png16', {}], ['exr', {}], ['webm', {}]] as [FormatId, EncodeOpts][]) expect(deep(id, o).a).not.toContain('lutrgb');
  // (an ffmpeg without the gain gets nothing added)
  const plan = planOf(FORMATS.hevc, {}, 30);
  expect(ffmpegArgs(plan, {}, { width: 64, height: 64, fps: 30, out: '/o/x.mp4', deepGain: 1 }).join(' ')).not.toContain('lutrgb');
});

test('each format has its codec, pixel format and sound', () => {
  expect(args('h264')).toContain('-c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -tune grain -x264-params aq-mode=3');
  expect(args('h264')).toContain('-c:a aac -b:a 320k -shortest');
  expect(args('h264', { chroma: '444', depth: 10 })).toContain('-pix_fmt yuv444p10le');
  expect(args('h264', { chroma: '444', depth: 10 })).toContain('-pix_fmt rgb48le');
  expect(args('hevc')).toContain('-c:v libx265 -preset medium -crf 18 -pix_fmt yuv420p10le -profile:v main10 -tag:v hvc1');
  expect(args('hevc')).toContain('colorprim=bt709:transfer=bt709:colormatrix=bt709:range=limited');
  expect(args('prores')).toContain('-c:v prores_ks -profile:v 3 -vendor apl0 -pix_fmt yuv422p10le');
  expect(args('prores')).toContain('-c:a pcm_s24le');
  expect(args('prores4444')).toContain('-profile:v 4 -vendor apl0 -pix_fmt yuva444p10le -alpha_bits 16');
  expect(args('prores4444')).toContain('-pix_fmt rgba64le');
  expect(args('webm')).toContain('-c:v libvpx-vp9 -pix_fmt yuva420p');
  expect(args('webm')).toContain('-c:a libopus');
  expect(args('webm', { alpha: false })).toContain('-pix_fmt yuv420p');
  expect(args('webm')).not.toContain('movflags');
  // loops and sequences carry no sound
  for (const id of ['gif', 'webp', 'png', 'png16', 'jpeg', 'exr'] as FormatId[]) { expect(args(id)).not.toContain('-c:a'); expect(args(id)).not.toContain('t.flac'); }
  expect(args('gif')).toContain('scale=640:360:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a');
  expect(args('gif', { maxSize: 2000 })).not.toContain('scale=');
  expect(args('webp', { quality: 60 })).toContain('-c:v libwebp_anim -lossless 0 -quality 60 -loop 0');
  expect(args('png')).toContain('-c:v png -pix_fmt rgb24 -start_number 30 /o/x_%06d.png');
  expect(args('png16', { alpha: true })).toContain('-pix_fmt rgba64be');
  expect(args('jpeg', { quality: 100 })).toContain('format=yuvj444p -c:v mjpeg -q:v 2');
  expect(args('exr', { alpha: true })).toContain('setparams=alpha_mode=premultiplied,format=gbrapf32le,vflip -c:v exr -format 1');
  const old = planOf(FORMATS.exr, { alpha: true }, 30);
  expect(ffmpegArgs(old, { alpha: true }, { width: 64, height: 64, fps: 30, out: '/o/x.exr', alphaModes: false }).join(' ')).toContain('-vf format=gbrapf32le,vflip -c:v exr');
  expect(args('h264', { draft: 'videotoolbox', comment: 'reel draft' })).toContain('-c:v h264_videotoolbox');
  expect(args('h264', { draft: 'videotoolbox', comment: 'reel draft' })).toContain('-metadata comment=reel draft');
});

test('sequences name their frames by video frame; defaults go to out/', () => {
  expect(sequencePattern('/o/f.png', FORMATS.png)).toBe('/o/f_%06d.png');
  expect(sequencePattern('/o/shot-%04d.exr', FORMATS.exr)).toBe('/o/shot-%04d.exr');
  expect(defaultOut('/p', FORMATS.png16)).toBe('/p/out/png16/frame.png');
  expect(defaultOut('/p', FORMATS.h264)).toBe('/p/out/video.mp4');
  expect(defaultOut('/p', FORMATS.h264, true)).toBe('/p/out/video.draft.mp4');
  expect(defaultOut('/p', FORMATS.prores4444)).toBe('/p/out/video.4444.mov');
});

test("img2webp's frame durations stay on the frame clock", () => {
  const a = webpArgs('/t', 30, 30, {}, '/o/x.webp');
  const ds = a.flatMap((x, i) => (x === '-d' ? [Number(a[i + 1])] : []));
  expect(ds.length).toBe(30);
  expect(ds.reduce((s, d) => s + d, 0)).toBe(1000);
  expect(new Set(ds)).toEqual(new Set([33, 34]));
  expect(a.at(-1)).toBe('/o/x.webp');
});

test('the mix goes into the containers that carry sound, with their codecs', () => {
  expect(containerOf('/a.mp4').audio).toContain('aac');
  expect(containerOf('/a.mov')).toEqual({ audio: ['-c:a', 'pcm_s24le'], subtitles: 'mov_text', flags: ['-movflags', '+faststart'] });
  expect(containerOf('/a.webm').subtitles).toBe('webvtt');
  expect(() => containerOf('/a.gif')).toThrow('carries no sound');
});

test('drafts are named and encoded as drafts', () => {
  expect(draftName('/o/video.mp4', true)).toBe('/o/video.draft.mp4');
  expect(draftName('/o/video.draft.mp4', true)).toBe('/o/video.draft.mp4');
  expect(draftName('/o/video.mp4', false)).toBe('/o/video.mp4');
  const env = process.env.REEL_DRAFT_ENCODER;
  try {
    delete process.env.REEL_DRAFT_ENCODER;
    expect(draftEncoder(() => true)).toBe('webcodecs');
    process.env.REEL_DRAFT_ENCODER = 'videotoolbox';
    expect(draftEncoder(() => false)).toBe('x264');
    expect(draftEncoder(() => true)).toBe('videotoolbox');
  } finally { if (env === undefined) delete process.env.REEL_DRAFT_ENCODER; else process.env.REEL_DRAFT_ENCODER = env; }
});

test('frames converted on the GPU are only tagged, or repacked for nv12', () => {
  const plan = planOf(FORMATS.h264, {}, 30, [1920, 1080]);
  const a = ffmpegArgs(plan, {}, { width: 1920, height: 1080, fps: 30, out: '/o/x.mp4' }).join(' ');
  expect(a).toContain('-pix_fmt yuv420p -s 1920x1080');
  expect(a).toContain('-vf vflip,setparams=range=tv:colorspace=bt709');
  expect(a).not.toContain('out_color_matrix');
  const d = ffmpegArgs(planOf(FORMATS.h264, { draft: 'videotoolbox' }, 30, [960, 540]), { draft: 'videotoolbox' }, { width: 960, height: 540, fps: 30, out: '/o/x.mp4' }).join(' ');
  expect(d).toContain('vflip,format=nv12,setparams=range=tv');
});
