import { expect, test } from 'bun:test';
import { glArgs, glBackend, parseMissingLibs } from '../cli/chrome';
import { chromeArgs } from '../cli/renderer';
import { maskSubFrames } from '../src/engine/tilemask';

test('Metal on macOS; on Linux EGL with a GPU render node, else SwiftShader; REEL_GL overrides', () => {
  expect(glBackend({}, 'darwin', () => false)).toBe('metal');
  expect(glBackend({}, 'linux', () => true)).toBe('egl');
  expect(glBackend({}, 'linux', () => false)).toBe('swiftshader');
  expect(glBackend({ REEL_GL: 'vulkan' }, 'linux', () => false)).toBe('vulkan');
  expect(glBackend({ REEL_GL: 'swiftshader' }, 'darwin', () => true)).toBe('swiftshader');
  expect(() => glBackend({ REEL_GL: 'metal' }, 'linux', () => true)).toThrow('macOS only');
  expect(() => glBackend({ REEL_GL: 'opengl' }, 'linux', () => true)).toThrow('expected metal, egl, vulkan, swiftshader');
});

test('each backend has its ANGLE flags, and every Chrome gets the common ones', () => {
  expect(glArgs('metal')).toEqual(['--use-angle=metal']);
  expect(glArgs('egl')).toContain('--use-angle=gl-egl');
  expect(glArgs('vulkan')).toContain('--use-angle=vulkan');
  expect(glArgs('swiftshader')).toEqual(['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']);
  const a = chromeArgs('swiftshader');
  expect(a).toContain('--disable-frame-rate-limit');
  expect(a).toContain('--use-angle=swiftshader');
  expect(a.filter((x) => x.startsWith('--use-angle'))).toHaveLength(1);
});

test('ldd output gives the libraries Chrome lacks', () => {
  const ldd = [
    '\tlinux-vdso.so.1 (0x00007ffd)',
    '\tlibnss3.so => not found',
    '\tlibdl.so.2 => /lib/x86_64-linux-gnu/libdl.so.2 (0x00007f)',
    '\tlibgbm.so.1 => not found',
    '\tlibnss3.so => not found',
  ].join('\n');
  expect(parseMissingLibs(ldd)).toEqual(['libnss3.so', 'libgbm.so.1']);
  expect(parseMissingLibs('\tlibc.so.6 => /lib/libc.so.6 (0x1)')).toEqual([]);
});

test('per-tile sampling masks every sub-frame on a software rasteriser, only the merge on a GPU', () => {
  expect(maskSubFrames('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe(true);
  expect(maskSubFrames('ANGLE (Mesa, llvmpipe (LLVM 19.1.7 256 bits), OpenGL ES 3.2)')).toBe(true);
  expect(maskSubFrames('ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)')).toBe(false);
  expect(maskSubFrames('ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 4090/PCIe/SSE2, OpenGL ES 3.2)')).toBe(false);
});
