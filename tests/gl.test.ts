// Which GL backend Chrome renders with, per platform, and its flags.
import { expect, test } from 'bun:test';
import { glArgs, glBackend, parseMissingLibs } from '../cli/chrome';
import { chromeArgs } from '../cli/renderer';

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
