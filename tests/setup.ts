import { afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'reel-test-exports-'));
process.env.REEL_EXPORTS_DIR = dir;
afterAll(() => rmSync(dir, { recursive: true, force: true }));
