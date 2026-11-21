import type { Frame } from '../engine/scene';
import { cssColor, esc, HtmlComponent, safeBox, UNIT, val, type Anim } from './common';
import { formatNumber, growth } from './charts';
import { progressOf, type ProgressOptions } from './common';

export interface TableColumn {
  label: string;
  align?: 'left' | 'center' | 'right';
  digits?: number;
  prefix?: string;
  suffix?: string;
  format?: (v: number | string, row: number) => string;
  width?: number;
}

const columnOf = (c: string | TableColumn): TableColumn => (typeof c === 'string' ? { label: c } : c);

export function formatCell(v: number | string, col: TableColumn = { label: '' }, row = 0): string {
  if (col.format) return col.format(v, row);
  if (typeof v === 'string') return v;
  const digits = col.digits ?? 0, s = formatNumber(Math.abs(v), digits);
  const zero = Number(s.replace(/,/g, '')) === 0;
  return `${v < 0 && !zero ? '−' : ''}${col.prefix ?? ''}${s}${col.suffix ?? ''}`;
}

export function columnAlign(rows: (number | string)[][], i: number, col: TableColumn = { label: '' }): 'left' | 'center' | 'right' {
  if (col.align) return col.align;
  const cells = rows.map((r) => r[i]).filter((v) => v !== undefined);
  return cells.length > 0 && cells.every((v) => typeof v === 'number') ? 'right' : 'left';
}

export interface TableOptions extends ProgressOptions {
  columns: (string | TableColumn)[];
  rows: (number | string)[][];
  title?: string;
  size?: number;
  highlight?: Anim<number | number[] | undefined>;
  color?: string;
  stagger?: boolean;
}

const MIN_SIZE = 8;

export class Table extends HtmlComponent {
  private o: TableOptions;
  private fitted = false;
  constructor(o: TableOptions) {
    const box = o.box ?? safeBox(0.12), cols = o.columns.map(columnOf), n = o.rows.length;
    for (const [i, r] of o.rows.entries()) if (r.length > cols.length) throw new Error(`table: row ${i} has ${r.length} cells for ${cols.length} columns`);
    const align = cols.map((c, i) => columnAlign(o.rows, i, c));
    const colgroup = cols.some((c) => c.width !== undefined) ? `<colgroup>${cols.map((c) => `<col${c.width !== undefined ? ` style="width: ${(c.width * 100).toFixed(2)}%"` : ''}>`).join('')}</colgroup>` : '';
    const cell = (tag: string, i: number, text: string) => `<${tag} style="text-align: ${align[i]}">${esc(text)}</${tag}>`;
    super(o, {
      box, label: 'table',
      html: `<div class="frame">${o.title ? `<p class="title">${esc(o.title)}</p>` : ''}<table>${colgroup}<thead><tr>${cols.map((c, i) => cell('th', i, c.label)).join('')}</tr></thead>
        <tbody>${o.rows.map((r, ri) => `<tr>${cols.map((c, i) => cell('td', i, r[i] === undefined ? '' : formatCell(r[i]!, c, ri))).join('')}</tr>`).join('')}</tbody></table></div>`,
      css: `.frame { position: absolute; inset: 0; display: flex; flex-direction: column; }
        .title { font: 700 var(--title-size)/1.2 Archivo; margin-bottom: var(--title-gap); }
        table { width: 100%; border-collapse: collapse; font: 400 var(--size)/1.2 Archivo; font-variant-numeric: tabular-nums; }
        th, td { padding: var(--pad-y) var(--pad-x); white-space: nowrap; }
        th:first-child, td:first-child { padding-left: var(--pad-first); }
        th { font-weight: 700; color: color-mix(in srgb, var(--fg) 75%, var(--bg)); border-bottom: 2px solid color-mix(in srgb, var(--fg) 45%, transparent); }
        tbody tr { opacity: var(--k, 0); transform: translateY(calc((1 - var(--k, 0)) * var(--rise))); border-bottom: 1px solid color-mix(in srgb, var(--fg) 14%, transparent); }
        tbody tr.hi { background: color-mix(in srgb, ${cssColor(o.color ?? 'accent')} 16%, transparent); -webkit-text-stroke: 0.03em currentColor; }
        tbody tr.hi td:first-child { box-shadow: inset var(--bar) 0 0 ${cssColor(o.color ?? 'accent')}; }`,
    });
    this.o = o;
  }

  private sized(fs: number) {
    const frame = this.layer.$('.frame'), pad = Math.round(fs * 0.7);
    const vars = { size: fs, 'title-size': Math.round(fs * 1.4), 'title-gap': Math.round(fs * 0.9), 'pad-y': Math.round(fs * 0.35), 'pad-x': pad, 'pad-first': Math.round(pad * 0.6), rise: Math.round(fs * 0.6), bar: Math.max(3, Math.round(fs * 0.15)) };
    for (const [k, v] of Object.entries(vars)) frame.style.setProperty(`--${k}`, `${v}px`);
    const r = frame.getBoundingClientRect(), scale = r.height / frame.offsetHeight;
    return (Math.max(...this.layer.$$('.title, table, tbody tr').map((e) => e.getBoundingClientRect().bottom)) - r.top) / scale;
  }

  private fit() {
    const fits = (fs: number) => this.sized(fs) <= this.box.h + 0.5;
    let lo = MIN_SIZE, hi = Math.max(MIN_SIZE, Math.floor(this.o.size ?? UNIT * 0.028));
    if (fits(hi) || !fits(lo)) return;
    while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid; }
    this.sized(lo);
  }

  protected update(f: Frame) {
    if (!this.fitted) { this.fitted = true; this.fit(); }
    const o = this.o, n = o.rows.length, [w0, w1] = this.window(f);
    const p = progressOf(o, f, w0, Math.min(Math.max(1.4, 0.2 * (n + 2)), Math.max(0.4, w1 - w0 - 0.8)));
    const h = o.highlight === undefined ? undefined : val(o.highlight, f), hi = new Set(h === undefined ? [] : Array.isArray(h) ? h : [h]);
    for (const i of hi) if (!(Number.isInteger(i) && i >= 0 && i < n)) throw new Error(`table: highlight ${i} is not a row (0 to ${n - 1})`);
    this.layer.$$('tbody tr').forEach((e, i) => this.layer.set(e, { vars: { k: growth(p, i, n, o.stagger !== false).toFixed(4) }, class: { hi: hi.has(i) } }));
  }
}
