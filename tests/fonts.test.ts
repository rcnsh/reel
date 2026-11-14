// A project's fonts as the page loads them: family, weight range, width and style read from the files.
import { expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describeFont, googleSlug, projectFonts } from '../cli/fonts';
import { ENGINE } from './helpers';

const src = (f: string) => path.join(ENGINE, 'public/fonts', f);

test('describeFont reads a variable font, a static weight, an italic and a width instance', () => {
  expect(describeFont(src('src/Archivo[wdth,wght].ttf'), 'a')).toEqual({ family: 'Archivo', url: 'a', weight: '100 900', stretch: '62% 125%', style: 'normal' });
  expect(describeFont(src('src/IBMPlexMono-SemiBold.ttf'), 'b')).toMatchObject({ family: 'IBM Plex Mono', weight: '600', stretch: '100%', style: 'normal' });
  expect(describeFont(src('src/CormorantGaramond-Italic[wght].ttf'), 'c')).toMatchObject({ family: 'Cormorant Garamond', weight: '300 700', style: 'italic' });
  expect(describeFont(src('Archivo-w875-700.ttf'), 'd')).toMatchObject({ family: 'Archivo', weight: '700', stretch: '87.5%' });
  expect(() => describeFont(src('OFL-archivo.txt'), 'e')).toThrow('not a font reel can read');
});

test('projectFonts lists every font under fonts/, served from the project', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'reel-test-fonts-'));
  try {
    mkdirSync(path.join(dir, 'fonts/plex'), { recursive: true });
    cpSync(src('src/IBMPlexMono-Bold.ttf'), path.join(dir, 'fonts/plex/IBMPlexMono-Bold.ttf'));
    cpSync(src('src/OFL.txt'), path.join(dir, 'fonts/plex/OFL.txt'));
    expect(projectFonts(dir)).toEqual([{ family: 'IBM Plex Mono', url: '/fonts/plex/IBMPlexMono-Bold.ttf', weight: '700', stretch: '100%', style: 'normal' }]);
    expect(projectFonts(path.join(dir, 'none'))).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('googleSlug: the google/fonts folder of a family', () => {
  expect(googleSlug('Space Grotesk')).toBe('spacegrotesk');
  expect(googleSlug('IBM Plex Sans')).toBe('ibmplexsans');
});
