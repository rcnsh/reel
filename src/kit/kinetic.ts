import type { Frame } from '../engine/scene';
import { clamp, ease as easings, stagger, staggerStart, type StaggerOptions } from '../engine/util';
import type { Line, Word } from '../engine/words';
import { kebab } from '../engine/html';
import { cssColor, esc, graphemes, HtmlComponent, safeBox, UNIT, val, type Anim, type ComponentOptions } from './common';
import { fitText } from './text';

export type KineticEntrance = 'fade' | 'rise' | 'drop' | 'scale' | 'blur' | 'clip' | ((k: number) => Record<string, string | number>);

export interface KineticTextOptions extends ComponentOptions {
  text?: Anim<string>;
  by?: 'word' | 'letter';
  enter?: KineticEntrance;
  delay?: number;
  each?: number;
  total?: number;
  dur?: number;
  ease?: (t: number) => number;
  order?: StaggerOptions['order'];
  seed?: number;
  distance?: number;
  room?: number;
  words?: Line | Word[];
  highlight?: boolean | string;
  size?: number;
  minSize?: number;
  fit?: boolean;
  maxLines?: number;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  font?: string;
  weight?: number;
  lineHeight?: number;
  color?: string;
}

export function kineticPieces(text: string, by: 'word' | 'letter'): string[][] {
  const words = text.split(/[ \t\n\r\f]+/).filter(Boolean);
  return words.map((w) => (by === 'letter' ? graphemes(w) : [w]));
}

interface Plan { text: string; words: string[][]; wordOf: number[]; first: number[]; count: number[] }

export class KineticText extends HtmlComponent {
  private o: KineticTextOptions;
  private spoken: Word[] | null;
  private plan: Plan | null = null;
  private built: string | null = null;
  private pieces: HTMLElement[] = [];
  private wordEls: HTMLElement[] = [];

  constructor(o: KineticTextOptions) {
    const box = o.box ?? safeBox();
    const justify = { top: 'start', middle: 'center', bottom: 'end' }[o.valign ?? 'middle'];
    const d = o.distance ?? 0.6, enter = o.enter ?? 'rise';
    const k = 'var(--k, 1)';
    const preset: Record<string, string> = {
      fade: `opacity: ${k};`,
      rise: `opacity: ${k}; transform: translateY(calc((1 - ${k}) * ${d}em));`,
      drop: `opacity: ${k}; transform: translateY(calc((1 - ${k}) * ${-d}em));`,
      scale: `opacity: ${k}; transform: scale(calc(0.4 + 0.6 * ${k}));`,
      blur: `opacity: ${k}; filter: blur(calc((1 - ${k}) * 0.3em));`,
      clip: `transform: translateY(calc((1 - ${k}) * 115%));`,
    };
    if (typeof enter === 'string' && !(enter in preset)) throw new Error(`KineticText: no entrance '${enter}' (${Object.keys(preset).join(', ')}, or a function)`);
    const room = o.room ?? (typeof enter === 'function' ? 1 : enter === 'rise' || enter === 'drop' ? Math.abs(d) + 0.3 : enter === 'blur' ? 1 : 0.5);
    const pad = Math.ceil((o.size ?? Math.round(UNIT * 0.07)) * Math.max(0, room));
    super({ motion: { from: 'fade', in: 0, out: 0.4 }, ...o }, {
      box, label: 'kinetic text', pad,
      html: `<div class="frame"><div class="kt" data-flow></div></div>`,
      css: `.frame { position: absolute; inset: ${pad}px; display: grid; align-content: ${justify}; }
        .frame.over { overflow: clip; }
        .kt { width: 100%; text-align: ${o.align ?? 'center'}; font-family: ${o.font ? `'${o.font}'` : 'Archivo'}; font-weight: ${o.weight ?? 700};
          line-height: ${o.lineHeight ?? 1.15}; color: ${cssColor(o.color ?? 'fg')}; font-size: ${o.size ?? Math.round(UNIT * 0.07)}px; text-wrap: balance; }
        .w { display: inline-block; white-space: nowrap; ${enter === 'clip' ? 'clip-path: inset(-0.5em -0.5em -0.12em -0.5em);' : ''} }
        .p { display: inline-block; transform-origin: 50% 70%; ${typeof enter === 'string' ? preset[enter] : ''} }
        .p.pending { visibility: hidden; }
        .w.now { color: ${cssColor(o.highlight === undefined || o.highlight === false || o.highlight === true ? 'accent' : o.highlight)}; }`,
    });
    this.o = o;
    this.spoken = o.words ? ('words' in o.words ? o.words.words : o.words) : null;
  }

  private textAt(f: Frame) {
    if (this.o.text !== undefined) return val(this.o.text, f);
    if (this.spoken) return this.spoken.map((w) => w.w).join(' ');
    return '';
  }

  private planAt(f: Frame): Plan {
    const text = this.textAt(f);
    if (this.plan?.text === text) return this.plan;
    const words = kineticPieces(text, this.o.by ?? 'word');
    if (this.spoken && words.length !== this.spoken.length) {
      throw new Error(`KineticText: the text has ${words.length} words and \`words\` ${this.spoken.length}: give the same line ('${text}' / '${this.spoken.map((w) => w.w).join(' ')}')`);
    }
    const wordOf: number[] = [], first: number[] = [], count: number[] = [];
    words.forEach((ps, wi) => { first.push(wordOf.length); count.push(ps.length); for (const _ of ps) wordOf.push(wi); });
    return (this.plan = { text, words, wordOf, first, count });
  }

  private build(p: Plan) {
    const o = this.o, kt = this.layer.$('.kt'), frame = this.layer.$('.frame');
    kt.innerHTML = p.words.map((ps) => `<span class="w">${ps.map((x) => `<span class="p">${esc(x)}</span>`).join('')}</span>`).join(' ');
    this.wordEls = this.layer.$$('.w');
    this.pieces = this.layer.$$('.p');
    frame.classList.remove('over');
    if (o.fit !== false) fitText(kt, this.box, o.size ?? Math.round(UNIT * 0.07), o.minSize ?? Math.round(UNIT * 0.026), o.maxLines, o.lineHeight ?? 1.15);
    const r = kt.getBoundingClientRect();
    if (r.height > this.box.h + 0.5 || kt.scrollWidth > Math.ceil(r.width) + 0.5) frame.classList.add('over');
  }

  private timing(f: Frame) {
    const o = this.o, letter = (o.by ?? 'word') === 'letter';
    return { at: this.window(f)[0] + (o.delay ?? 0), each: o.each ?? (letter ? 0.03 : 0.08), total: o.total, dur: o.dur ?? (letter ? 0.35 : 0.5), ease: o.ease ?? easings.outCubic, order: o.order, seed: o.seed };
  }

  private startOf(f: Frame, p: Plan, i: number) {
    if (!this.spoken) return staggerStart(i, p.wordOf.length, this.timing(f));
    const wi = p.wordOf[i]!, w = this.spoken[wi]!;
    return w.start + ((w.end - w.start) * (i - p.first[wi]!)) / p.count[wi]!;
  }

  progress(f: Frame, i: number): number { return this.progressOf(f, this.planAt(f), this.timing(f), i); }

  private progressOf(f: Frame, p: Plan, tm: ReturnType<KineticText['timing']>, i: number) {
    if (!this.spoken) return stagger(f.lt, i, p.wordOf.length, tm);
    const s = this.startOf(f, p, i);
    return tm.dur <= 0 ? (f.t >= s ? 1 : 0) : tm.ease(clamp((f.t - s) / tm.dur));
  }

  endAt(f: Frame): number {
    const p = this.planAt(f), tm = this.timing(f);
    let last = this.spoken ? -Infinity : tm.at;
    for (let i = 0; i < p.wordOf.length; i++) last = Math.max(last, this.startOf(f, p, i));
    if (this.spoken) last = (Number.isFinite(last) ? last : f.start) - f.start;
    return last + Math.max(0, tm.dur);
  }

  protected update(f: Frame) {
    const p = this.planAt(f);
    if (p.text !== this.built) { this.built = p.text; this.build(p); }
    const l = this.layer, enter = this.o.enter ?? 'rise', tm = this.timing(f);
    this.pieces.forEach((e, i) => {
      const k = +this.progressOf(f, p, tm, i).toFixed(5);
      l.set(e, { class: { pending: k <= 0 }, attr: { 'data-exempt': k > 0 && k < 1 ? 'contrast safeArea offFrame' : null } });
      if (typeof enter === 'function') l.set(e, { attr: { style: [`--k: ${k}`, ...Object.entries(enter(k)).map(([n, v]) => `${n.startsWith('--') ? n : kebab(n)}: ${v}`)].join('; ') } });
      else l.set(e, { vars: { k } });
    });
    if (!this.spoken || !this.o.highlight) return;
    this.wordEls.forEach((e, wi) => {
      const w = this.spoken![wi]!;
      l.set(e, { class: { said: f.t >= w.start, now: f.t >= w.start && f.t < w.end } });
    });
  }
}
