// The export's page side: a range handed to stream() that does not go on from the last one starts with a warm-up
// frame only when a scene keeps state (its first frame must then follow one); a stateless frame is the same
// however it is reached, so its ranges start straight away.
import { afterAll, expect, test } from 'bun:test';
import { Renderer } from '../cli/renderer';
import { fixture, hasChrome } from './helpers';

const scene = (stateful: boolean) => `import type * as THREE from 'three';
import { Scene, type Frame, clearRT, LIN } from 'reel';
export default class S extends Scene {
  ${stateful ? 'stateful = true;\n  prerollMax = 0;' : ''}
  render(f: Frame, out: THREE.WebGLRenderTarget) { clearRT(this.ctx.renderer, out, LIN.bg); }
}
`;
const project = (stateful: boolean) => fixture(stateful ? 'stream-stateful' : 'stream', {
  'reel.config.ts': `import { defineVideo } from 'reel/config';
export default defineVideo({ size: [64, 36], fps: 30, theme: 'neutral', timeline: () => [{ id: 's', scene: () => import('./scenes/s'), start: 0, end: 2 }] });
`,
  'scenes/s.ts': scene(stateful),
});
const projects = [project(false), project(true)];
afterAll(() => { for (const p of projects) p.cleanup(); });

/** The frames the page renders for two ranges that do not follow on from each other and a third that goes on from the second (an ack server takes them). */
async function framesRendered(dir: string) {
  const r = new Renderer(dir);
  let n = 0;
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) { return srv.upgrade(req) ? undefined : new Response('ws only', { status: 400 }); },
    websocket: { message(ws) { ws.send(String(++n)); } },
  });
  try {
    const h = await r.page({ scale: 1 });
    return await h.page.evaluate(async (ws) => {
      const P = (window as any).__reel, E = P.engine, render = E.renderFrame.bind(E);
      let calls = 0;
      E.renderFrame = (...a: unknown[]) => { calls++; return render(...a); };
      await P.stream({ from: 10 / 30, to: 13 / 30, ws });
      await P.stream({ from: 30 / 30, to: 33 / 30, ws });
      // (one that goes on where the last ended never needs one)
      await P.stream({ from: 33 / 30, to: 35 / 30, ws });
      return calls;
    }, `ws://localhost:${server.port}/`);
  } finally {
    server.stop(true);
    await r.close();
  }
}

test.skipIf(!hasChrome)('a stateless range starts with no warm-up frame; a stateful one with one', async () => {
  expect(await framesRendered(projects[0]!.dir)).toBe(8);
  expect(await framesRendered(projects[1]!.dir)).toBe(10);
}, 120_000);
