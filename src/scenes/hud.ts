// The HUD: crop marks in the corners and a caption bottom right, drawn over the tracks below. An ordinary scene
// for an upper track: a theme places it over the whole video (its `overlay`), and a project places it as clips
// of its own, `{ id: 'fig1', scene: () => import('reel/scenes/hud'), start, end, track: 2, params: { caption: { fig: 'FIG. 1', text: '…' } } }`.
// Params: HudParams (src/themes.ts). Colours come from the theme: the dark colour on a light picture, the
// light colour on a dark one.
import type * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { rgba, TONE } from '../engine/palette';
import { F, font } from '../engine/type';
import { clamp, ease, lerp, prog, smoothstep } from '../engine/util';
import type { HudParams } from '../themes';

const q = (x: number) => Math.round(x * 1000) / 1000;

export default class Hud extends Scene {
  layer = new Layer2D();
  /** What the layer holds: it is drawn again only when that changes (the scene runs once per sub-frame). */
  private drawn = '';

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp } = this.ctx;
    const p = this.ctx.params as HudParams;
    clearRT(renderer, out, [0, 0, 0], 0);
    const fly = p.fly ?? 0.8;
    // (quantised, and the layer drawn from the quantised values: what it holds depends on t alone)
    const marks = !p.marks ? 0 : fly <= 0 ? 1 : q(clamp(Math.min(f.t - f.start, f.end - f.t) / fly));
    const cap = p.caption;
    const capA = cap ? q(Math.min(smoothstep(f.start, f.start + 0.5, f.t), 1 - smoothstep(f.end - 0.6, f.end, f.t))) : 0;
    // reveal the letters left to right
    const chars = cap ? Math.floor(cap.text.length * prog(f.t, f.start, f.start + 0.8)) : 0;
    if (marks <= 0 && capA <= 0) return;
    const key = `${marks}|${capA}|${chars}`;
    if (key !== this.drawn) {
      this.drawn = key;
      const c = this.layer.ctx, light = (p.tone ?? (TONE.light === 'bg' ? 'light' : 'dark')) === 'light';
      this.layer.clear();
      if (marks > 0) this.cropMarks(c, marks, light);
      if (cap && capA > 0) this.caption(c, cap, capA, chars, light);
      this.layer.upload();
    }
    comp.draw(renderer, this.layer.texture, out);
  }

  /** Corner marks; as `k` drops they fly out along the diagonals and past the edges. */
  private cropMarks(c: CanvasRenderingContext2D, k: number, light: boolean) {
    const e = ease.inOutCubic(clamp(k));
    c.save();
    c.globalAlpha = clamp(k * 3);
    c.strokeStyle = light ? rgba(TONE.dark, 0.45) : rgba(TONE.light, 0.34);
    c.lineWidth = 1.25;
    const m = lerp(-40, 36, e), l = 22;
    c.beginPath();
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]] as const) {
      c.moveTo(x + sx * l, y + 0.5 * sy); c.lineTo(x, y + 0.5 * sy); c.lineTo(x, y + sy * l);
    }
    c.stroke();
    c.restore();
  }

  private caption(c: CanvasRenderingContext2D, cap: NonNullable<HudParams['caption']>, a: number, chars: number, light: boolean) {
    c.save();
    c.globalAlpha = a;
    const x = W - 64, y = H - 66;
    c.textBaseline = 'alphabetic';
    c.font = font(F.serif(400, true), 26);
    c.fillStyle = light ? rgba(TONE.dark, 0.9) : rgba(TONE.light, 0.85);
    // a soft halo keeps the caption legible over a busy picture (none on a light one: it reads as a pale patch)
    c.shadowColor = rgba(TONE.dark, 0.85);
    c.shadowBlur = light ? 0 : 10;
    const full = c.measureText(cap.text).width;
    c.textAlign = 'left';
    c.fillText(cap.text.slice(0, chars), x - full, y);
    if (cap.fig) {
      c.font = font(F.mono(500), 13);
      c.letterSpacing = '3px';
      c.fillStyle = rgba(light ? 'accentLo' : 'accent', 1);
      c.fillText(cap.fig, x - full, y - 34);
    }
    c.restore();
  }
}
