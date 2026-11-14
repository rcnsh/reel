// The break: the drums drop out, which the stem meters show (the drums bar falls while bass, other and vocal go on).
// The meters are an HTML layer brought up to date once per frame from the stems' envelopes.
import type * as THREE from 'three';
import { Scene, type Frame, HtmlLayer, clearRT, LIN } from 'reel';

const STEMS = ['drums', 'bass', 'other', 'vocal'] as const;

export default class Break extends Scene {
  meters = new HtmlLayer({
    html: `<h2>Stems</h2><div class="m">${STEMS.map((s) => `<div class="s" data-s="${s}"><div class="bar"><i></i></div><span>${s}</span></div>`).join('')}</div>`,
    css: `h2 { position: absolute; top: 12%; width: 100%; text-align: center; font: 800 7vmin Archivo; }
      .m { position: absolute; left: 14%; right: 14%; top: 26%; bottom: 16%; display: flex; gap: 5%; }
      .s { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2vmin; }
      .bar { flex: 1; width: 100%; background: color-mix(in srgb, var(--fg) 6%, transparent); border-radius: 1vmin; position: relative; overflow: hidden; }
      i { position: absolute; left: 0; right: 0; bottom: 0; height: calc(var(--v, 0) * 100%); background: var(--accent); }
      span { font: 600 3.6vmin Archivo; }`,
    update: (f, l) => { for (const s of STEMS) l.set(`[data-s="${s}"] i`, { style: { '--v': f.a[s].toFixed(3) } }); },
  });

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, LIN.bg);
    this.meters.draw(this.ctx.renderer, out);
  }
}
