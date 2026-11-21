import { afterAll, expect, test } from 'bun:test';
import { realpathSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { hasChrome, reel, REEL, scratchCopy } from './helpers';

const layers = scratchCopy('layers');
let server: ReturnType<typeof Bun.spawn> | null = null, client: Client | null = null;
afterAll(async () => {
  server?.kill('SIGINT');
  await client?.close();
  await reel(['daemon', 'stop', '--project', layers.dir]);
  layers.cleanup();
});

async function firstLine(p: ReturnType<typeof Bun.spawn>) {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of p.stdout as ReadableStream<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    if (buf.includes('\n')) return buf.slice(0, buf.indexOf('\n'));
  }
  return buf;
}

test.skipIf(!hasChrome)('review a draft: the page, the video in ranges, a note through the API, read back by the CLI and MCP', async () => {
  const dir = realpathSync(layers.dir);
  const v = await reel(['video', '--draft', '--to', '1', '--json', '--wait', '--project', dir]);
  expect(v.code).toBe(0);

  server = Bun.spawn(['bun', REEL, 'review', '--json', '--project', dir], { stdout: 'pipe', stderr: 'pipe' });
  const start = JSON.parse(await firstLine(server));
  expect(start.ok).toBe(true);
  expect(start.draft).toBe(true);
  expect(start.file).toBe(`${dir}/out/video.draft.mp4`);
  const url: string = start.url;
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

  const page = await fetch(url);
  expect(page.headers.get('content-type')).toContain('text/html');
  expect(await page.text()).toContain('<title>reel review</title>');
  const part = await fetch(`${url}video`, { headers: { range: 'bytes=0-99' } });
  expect(part.status).toBe(206);
  expect((await part.arrayBuffer()).byteLength).toBe(100);
  expect(part.headers.get('content-range')).toMatch(/^bytes 0-99\/\d+$/);
  expect((await fetch(`${url}reel.config.ts`)).status).toBe(404);
  expect((await fetch(url, { headers: { host: 'example.com' } })).status).toBe(403);

  const state = await (await fetch(`${url}api/state`)).json();
  expect(state.video).toMatchObject({ name: 'out/video.draft.mp4', draft: true, fps: 30 });
  expect(state.logical).toEqual([1080, 1920]);
  expect(state.timeline.map((c: { id: string }) => c.id)).toEqual(['dawn', 'dusk', 'title', 'overlay']);

  const post = await fetch(`${url}api/notes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: 0.51, text: 'Title too low', rect: { x: 100, y: 1500, w: 880, h: 200 } }) });
  expect(post.status).toBe(200);
  const { note } = await post.json();
  expect(note).toMatchObject({ t: 0.5, frame: 15, clips: ['dawn', 'title'], text: 'Title too low', rect: { x: 100, y: 1500, w: 880, h: 200 }, status: 'open', render: { file: 'out/video.draft.mp4', draft: true } });
  const bad = await fetch(`${url}api/notes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: 1, text: ' ' }) });
  expect(bad.status).toBe(400);

  const listed = await reel(['notes', '--open', '--json', '--project', dir]);
  expect(listed.code).toBe(0);
  expect(listed.json().notes).toEqual([expect.objectContaining({ id: note.id, text: 'Title too low', still: `reel still --t 0.5 --project ${dir}` })]);

  client = new Client({ name: 'reel-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: 'bun', args: [REEL, 'mcp'], env: process.env as Record<string, string>, stderr: 'inherit' }));
  const read = async (args: Record<string, unknown>) => JSON.parse(((await client!.callTool({ name: 'review_notes', arguments: { project: dir, ...args } })).content as { text: string }[])[0]!.text);
  expect((await read({ open_only: true })).notes.map((n: { id: string }) => n.id)).toEqual([note.id]);
  const resolved = await client.callTool({ name: 'resolve_note', arguments: { project: dir, id: note.id } });
  expect(resolved.isError).toBeFalsy();
  expect((await read({ open_only: true })).notes).toEqual([]);
  expect((await read({})).notes[0].status).toBe('done');
  const missing = await client.callTool({ name: 'resolve_note', arguments: { project: dir, id: 'zzzz' } });
  expect(missing.isError).toBe(true);

  expect((await (await fetch(`${url}api/notes`)).json()).notes[0].status).toBe('done');

  const moved = await (await fetch(`${url}api/notes/${note.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: 3.21 }) })).json();
  expect(moved.note).toMatchObject({ t: 3.2, frame: 96, clips: ['dawn', 'dusk', 'title'], text: 'Title too low' });
  const back = await reel(['notes', 'move', note.id, '--t', '5.8', '--json', '--project', dir]);
  expect(back.code).toBe(0);
  expect(back.json().note).toMatchObject({ t: 5.8, frame: 174, clips: ['dusk'] });

  server.kill('SIGINT');
  expect(await server.exited).not.toBe(null);
  server = null;
}, 180_000);
