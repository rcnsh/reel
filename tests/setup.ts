// Preloaded before every test file (bunfig.toml). A test run gets an export slot of its own: REEL_EXPORTS_DIR points
// at a fresh temp folder, inherited by every CLI the tests spawn, so an export running elsewhere on the machine (which
// holds the machine-wide slot, cli/exports.ts) neither fails nor queues the tests' exports. The tests' exports are small
// (a second, at 320×180 or so), so running one beside a real export costs little memory. Removed when the run ends.
import { afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'reel-test-exports-'));
process.env.REEL_EXPORTS_DIR = dir;
// (a preload's afterAll runs once, after the last file)
afterAll(() => rmSync(dir, { recursive: true, force: true }));
