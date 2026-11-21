import type * as THREE from 'three';
import { Scene, type Frame, VideoClip, ImageBox, LottieBox, TextBlock, clearRT, W } from 'reel';

export default class Shot extends Scene {
  clip = new VideoClip({ src: 'assets/clip.mp4', alt: 'colour field', box: { x: 0, y: 0, w: W, h: 1920 }, kenBurns: { from: { zoom: 1 }, to: { zoom: 1.08 } }, motion: false });
  mark = new ImageBox({ src: 'assets/mark.svg', alt: 'mark', fit: 'contain', box: { x: W / 2 - 120, y: 150, w: 240, h: 160 }, at: [0.3, 8], motion: { from: 'down', distance: 40 } });
  badge = new LottieBox({ src: 'assets/badge.json', alt: 'badge', box: { x: W / 2 - 230, y: 400, w: 460, h: 460 }, at: [1, 7.6], motion: { from: 'fade', in: 0.01, out: 0.4 } });
  line = new TextBlock({ text: 'Video, SVG and Lottie, sampled at any moment', box: { x: 110, y: 900, w: W - 220, h: 200 }, size: 64, maxLines: 2, color: '#ffffff', css: '.tb { text-shadow: 0 2px 24px rgba(10, 16, 40, 0.55); }', at: [1.8, 7.6], motion: { from: 'up' } });
  inset = new VideoClip({
    src: 'assets/clip.mp4', alt: 'half speed', box: { x: W / 2 - 200, y: 1150, w: 400, h: 300 }, radius: 28,
    trim: [2, 4], speed: 0.5, loop: true, frames: 'blend', sound: false, at: [2.6, 7.6], motion: { from: 'up' },
  });

  override async prepare(f: Frame) {
    await this.clip.prepare(f, this.ctx.renderer);
    await this.inset.prepare(f, this.ctx.renderer);
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    clearRT(r, out, [0, 0, 0], 1);
    this.clip.draw(r, out, f, { opacity: 0.72 });
    this.mark.draw(r, out, f);
    this.badge.draw(r, out, f);
    this.line.draw(r, out, f);
    this.inset.draw(r, out, f);
  }

  override dispose() { this.clip.dispose(); this.inset.dispose(); this.badge.dispose(); }
}
