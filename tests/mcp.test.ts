// The MCP server end to end: a real MCP client (the official SDK) starts `reel mcp` over stdio and calls its tools.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PNG } from 'pngjs';
import { parseCommand } from '../cli/args';
import { encodeOptsOf, formatOf, planOf } from '../cli/formats';
import { videoArgs } from '../cli/mcp';
import { fixture, hasChrome, OFF_FRAME, reel, REEL, scratchCopy } from './helpers';

const demo = scratchCopy('demo'), layers = scratchCopy('layers'), wide = fixture('offframe', OFF_FRAME);
let client: Client;

beforeAll(async () => {
  client = new Client({ name: 'reel-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: 'bun', args: [REEL, 'mcp'], env: process.env as Record<string, string>, stderr: 'inherit' }));
});
afterAll(async () => {
  await client?.close();
  for (const p of [demo, layers, wide]) { await reel(['daemon', 'stop', '--project', p.dir]); p.cleanup(); }
});

type Block = { type: string; text?: string; data?: string; mimeType?: string };
const call = async (name: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 });
  const content = r.content as Block[];
  return { isError: !!r.isError, content, json: JSON.parse(content.find((c) => c.type === 'text')!.text!), images: content.filter((c) => c.type === 'image') };
};

test('lists its tools, each with a description', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  expect(names).toEqual(['align_recording', 'analyze_song', 'assets', 'check_video', 'contact_sheet', 'diff_images', 'mix_audio', 'motion_strip', 'narrate', 'project_info', 'render_still', 'resolve_note', 'review_notes', 'subtitles', 'video_cancel', 'video_start', 'video_status'].sort());
  for (const t of tools) expect((t.description ?? '').length).toBeGreaterThan(60);
  for (const t of tools.filter((x) => !x.name.startsWith('video_s') && !x.name.startsWith('video_c') && x.name !== 'diff_images')) expect(t.inputSchema.required ?? []).toContain('project');
});

test('an argument a tool does not have is an error, like an unknown flag', async () => {
  const r = await client.callTool({ name: 'project_info', arguments: { project: layers.dir, sise: '1080x1920' } });
  expect(r.isError).toBe(true);
  expect((r.content as Block[])[0]!.text).toMatch(/sise/);
});

test('a call piped in before the input ends is answered before the server exits', async () => {
  const msgs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'review_notes', arguments: { project: layers.dir } } },
  ];
  const p = Bun.spawn(['bun', REEL, 'mcp'], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' });
  p.stdin.write(msgs.map((m) => JSON.stringify(m)).join('\n') + '\n');
  p.stdin.end();
  const out = await new Response(p.stdout).text();
  expect(await p.exited).toBe(0);
  expect(out.split('\n').filter(Boolean).map((l) => JSON.parse(l).id)).toEqual([1, 2]);
}, 20_000);

test('the server exits when its input ends', async () => {
  const p = Bun.spawn(['bun', REEL, 'mcp'], { stdin: 'pipe', stdout: 'ignore', stderr: 'ignore' });
  p.stdin.end();
  expect(await Promise.race([p.exited, new Promise((r) => setTimeout(() => { p.kill(); r('still running'); }, 8000))])).toBe(0);
}, 15_000);

test("video_start's options become reel video flags the CLI accepts; without out the format picks its default", () => {
  const cases: [Record<string, unknown>, string[]][] = [
    [{}, []],
    [{ format: 'prores4444', opaque: true }, ['--format', 'prores4444', '--opaque']],
    [{ format: 'hevc', crf: 20, preset: 'slow', samples: 'auto', scale: 2 }, ['--scale', '2', '--samples', 'auto', '--preset', 'slow', '--crf', '20', '--format', 'hevc']],
    [{ chroma: '444', depth: 10, mix: true, from: 1, to: 2 }, ['--from', '1', '--to', '2', '--mix', '--chroma', '444', '--depth', '10']],
    [{ format: 'webp', alpha: true, quality: 70, max_fps: 12, max_size: 480 }, ['--format', 'webp', '--alpha', '--quality', '70', '--max-fps', '12', '--max-size', '480']],
    [{ draft: true, only: ['a', 'b'], noaudio: true }, ['--only', 'a,b', '--noaudio', '--draft']],
    [{ format: 'png', out: '/tmp/f/x.png' }, ['--out', '/tmp/f/x.png', '--format', 'png']],
  ];
  for (const [a, want] of cases) {
    const args = videoArgs(a, '/p');
    expect(args).toEqual(['video', '--project', '/p', '--json', '--progress', ...want]);
    const v = parseCommand(args).values;
    const f = formatOf(v.format as string | undefined, v.out as string | undefined);
    planOf(f, encodeOptsOf(v, f), 30);
  }
});

test.skipIf(!hasChrome)('project_info', async () => {
  const r = await call('project_info', { project: layers.dir });
  expect(r.isError).toBe(false);
  expect(r.json.size).toEqual([1080, 1920]);
  expect(r.json.timeline.map((c: { id: string }) => c.id)).toEqual(['dawn', 'dusk', 'title', 'overlay']);
}, 120_000);

test.skipIf(!hasChrome)('render_still returns downscaled images and the files on disk', async () => {
  const r = await call('render_still', { project: demo.dir, times: [1, 5] });
  expect(r.isError).toBe(false);
  expect(r.images.length).toBe(2);
  for (const img of r.images) {
    expect(img.mimeType).toBe('image/png');
    const png = PNG.sync.read(Buffer.from(img.data!, 'base64'));
    expect(Math.max(png.width, png.height)).toBe(1280);
  }
  expect(r.json.files.map((f: string) => f.split('/').pop())).toEqual(['hello_1.000s.png', 'written_5.000s.png']);
  for (const f of r.json.files) expect(existsSync(f)).toBe(true);
}, 120_000);

test.skipIf(!hasChrome)('check_video finds a line running off the frame, and passes the demo', async () => {
  const r = await call('check_video', { project: wide.dir });
  expect(r.isError).toBe(true);
  const off = r.json.findings.filter((f: { kind: string; severity: string }) => f.kind === 'offFrame' && f.severity === 'error');
  expect(off.map((f: { clip: string }) => f.clip)).toEqual(['wide']);
  expect(r.images.length).toBeGreaterThanOrEqual(1);
  const ok = await call('check_video', { project: demo.dir, size: '1080x1920' });
  expect(ok.isError).toBe(false);
  expect(ok.json.summary.error).toBe(0);
}, 120_000);

test.skipIf(!hasChrome)('a short video render runs to completion through start and status', async () => {
  const out = `${layers.dir}/out/mcp.mp4`;
  const s = await call('video_start', { project: layers.dir, to: 0.5, preset: 'ultrafast', out });
  expect(s.json.state).toBe('running');
  let st = s;
  // (polling is the tool's contract: the job runs in the background)
  for (let i = 0; i < 600 && st.json.state === 'running'; i++) { await Bun.sleep(200); st = await call('video_status', { job: s.json.job }); }
  expect(st.json.state).toBe('done');
  expect(st.json.result.ok).toBe(true);
  expect(st.json.result.frames).toBe(15);
  expect(existsSync(out)).toBe(true);
}, 180_000);

test.skipIf(!hasChrome)('a bad argument comes back as an error the model can read', async () => {
  const r = await client.callTool({ name: 'render_still', arguments: { project: '/nonexistent', times: [1] } });
  expect(r.isError).toBe(true);
  expect((r.content as Block[])[0]!.text).toContain('no reel.config.ts');
});
