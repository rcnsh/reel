import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { moveFile } from '../cli/golden';

const dir = mkdtempSync(path.join(tmpdir(), 'reel-test-move-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const crossDevice = () => { throw Object.assign(new Error('EXDEV: cross-device link not permitted, rename'), { code: 'EXDEV' }); };

test('a rename that fails with EXDEV falls back to a copy and removes the source', () => {
  const from = path.join(dir, 'a.png'), to = path.join(dir, 'out', 'a.png');
  writeFileSync(from, 'still');
  rmSync(path.dirname(to), { recursive: true, force: true });
  mkdirSync(path.dirname(to));
  writeFileSync(to, 'old golden');
  moveFile(from, to, crossDevice);
  expect(readFileSync(to, 'utf8')).toBe('still');
  expect(existsSync(from)).toBe(false);
  expect(readdirSync(path.dirname(to))).toEqual(['a.png']);
});

test('any other rename error is thrown and the source kept', () => {
  const from = path.join(dir, 'b.png'), to = path.join(dir, 'b-out.png');
  writeFileSync(from, 'still');
  const denied = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); };
  expect(() => moveFile(from, to, denied)).toThrow('EACCES');
  expect(existsSync(from)).toBe(true);
  expect(existsSync(to)).toBe(false);
});

test('a plain rename moves the file', () => {
  const from = path.join(dir, 'c.png'), to = path.join(dir, 'c-out.png');
  writeFileSync(from, 'still');
  moveFile(from, to);
  expect(readFileSync(to, 'utf8')).toBe('still');
  expect(existsSync(from)).toBe(false);
});
