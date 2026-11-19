// A table: a header and rows revealed one after another as progress runs 0 to 1, columns aligned (numbers to the
// right by default) and formatted, and rows picked out by a highlight that may change over time.
import type { Frame } from '../engine/scene';
import { cssColor, esc, HtmlComponent, safeBox, UNIT, val, type Anim } from './common';
import { formatNumber, growth, progressOf, type ProgressOptions } from './charts';

export interface TableColumn {
  label: string;
  /** Default: right for a column of numbers, else left. */
  align?: 'left' | 'center' | 'right';
  /** A number's decimals (default 0), and text around it: `prefix: '$'`, `suffix: '%'`. */
  digits?: number;
  prefix?: string;
  suffix?: string;
  /** A cell's text of your own (replaces digits, prefix and suffix). */
  format?: (v: number | string, row: number) => string;
  /** The column's share of the table's width (0 to 1; default as wide as its content). */
  width?: number;
}

/** A column given as just its label. */
const columnOf = (c: string | TableColumn): TableColumn => (typeof c === 'string' ? { label: c } : c);

/**
 * A cell as text: a string as it is; a number with `en-US` grouping, `digits` decimals, and its sign (a true minus,
 * −) before the prefix: −$1,200.50. A number that rounds to zero has no sign. `format` overrides all of it.
 */
export function formatCell(v: number | string, col: TableColumn = { label: '' }, row = 0): string {
  if (col.format) return col.format(v, row);
  if (typeof v === 'string') return v;
  const digits = col.digits ?? 0, s = formatNumber(Math.abs(v), digits);
  const zero = Number(s.replace(/,/g, '')) === 0;
  return `${v < 0 && !zero ? '−' : ''}${col.prefix ?? ''}${s}${col.suffix ?? ''}`;
}

/** A column's alignment: its own, else right when every cell in it is a number, else left. */
export function columnAlign(rows: (number | string)[][], i: number, col: TableColumn = { label: '' }): 'left' | 'center' | 'right' {
  if (col.align) return col.align;
  const cells = rows.map((r) => r[i]).filter((v) => v !== undefined);
  return cells.length > 0 && cells.every((v) => typeof v === 'number') ? 'right' : 'left';
}

export interface TableOptions extends ProgressOptions {
  /** The header: labels, or columns with alignment and number formatting. */
  columns: (string | TableColumn)[];
  rows: (number | string)[][];
  title?: string;
  /** The font size (default 2.8% of the short side); it shrinks so the title, header and rows fit the box's height. */
  size?: number;
  /** Rows (0-based) to pick out, *Anim*: a tinted band with a bar in `color` and heavier text (drawn with a stroke, so the columns do not move). */
  highlight?: Anim<number | number[] | undefined>;
  /** The highlight's colour (palette key or CSS colour, default accent). */
  color?: string;
  /** Rows come in one after another (default true), or all together. */
  stagger?: boolean;
}

/**
 * A table: the header shows with the component, then rows rise and fade in one after another as progress runs 0
 * to 1 (by default over 0.2 s a row, at least 1.4 s, done 0.6 s before the window ends). Text is tabular figures, so columns of numbers line up.
 * Markup: `.frame` > `.title`, `table` > `thead` > `tr` > `th`; `tbody` > `tr` (`.hi` when highlighted) > `td`.
 */
export class Table extends HtmlComponent {
  private o: TableOptions;
  constructor(o: TableOptions) {
    const box = o.box ?? safeBox(0.12), cols = o.columns.map(columnOf), n = o.rows.length;
    for (const [i, r] of o.rows.entries()) if (r.length > cols.length) throw new Error(`table: row ${i} has ${r.length} cells for ${cols.length} columns`);
    // (from the CSS below: a row is 1.2 font sizes of line and 0.7 of padding, rounded, plus its rule; the title 1.68
    // and 0.9 below it; and a row coming in starts 0.6 lower)
    const fit = (box.h - (n + 1) * 3 - 2) / ((n + 1) * 1.9 + 0.6 + (o.title ? 2.6 : 0));
    const fs = Math.max(8, Math.floor(Math.min(o.size ?? UNIT * 0.028, fit)));
    const align = cols.map((c, i) => columnAlign(o.rows, i, c)), pad = Math.round(fs * 0.7);
    const colgroup = cols.some((c) => c.width !== undefined) ? `<colgroup>${cols.map((c) => `<col${c.width !== undefined ? ` style="width: ${(c.width * 100).toFixed(2)}%"` : ''}>`).join('')}</colgroup>` : '';
    const cell = (tag: string, i: number, text: string) => `<${tag} style="text-align: ${align[i]}">${esc(text)}</${tag}>`;
    super(o, {
      box, label: 'table',
      html: `<div class="frame">${o.title ? `<p class="title">${esc(o.title)}</p>` : ''}<table>${colgroup}<thead><tr>${cols.map((c, i) => cell('th', i, c.label)).join('')}</tr></thead>
        <tbody>${o.rows.map((r, ri) => `<tr>${cols.map((c, i) => cell('td', i, r[i] === undefined ? '' : formatCell(r[i]!, c, ri))).join('')}</tr>`).join('')}</tbody></table></div>`,
      css: `.frame { position: absolute; inset: 0; display: flex; flex-direction: column; }
        .title { font: 700 ${Math.round(fs * 1.4)}px/1.2 Archivo; margin-bottom: ${Math.round(fs * 0.9)}px; }
        table { width: 100%; border-collapse: collapse; font: 400 ${fs}px/1.2 Archivo; font-variant-numeric: tabular-nums; }
        th, td { padding: ${Math.round(fs * 0.35)}px ${pad}px; white-space: nowrap; }
        th:first-child, td:first-child { padding-left: ${Math.round(pad * 0.6)}px; }
        th { font-weight: 700; color: color-mix(in srgb, var(--fg) 75%, var(--bg)); border-bottom: 2px solid color-mix(in srgb, var(--fg) 45%, transparent); }
        tbody tr { opacity: var(--k, 0); transform: translateY(calc((1 - var(--k, 0)) * ${Math.round(fs * 0.6)}px)); border-bottom: 1px solid color-mix(in srgb, var(--fg) 14%, transparent); }
        tbody tr.hi { background: color-mix(in srgb, ${cssColor(o.color ?? 'accent')} 16%, transparent); -webkit-text-stroke: 0.03em currentColor; }
        tbody tr.hi td:first-child { box-shadow: inset ${Math.max(3, Math.round(fs * 0.15))}px 0 0 ${cssColor(o.color ?? 'accent')}; }`,
    });
    this.o = o;
  }

  protected update(f: Frame) {
    // (0.2 s a row, at least 1.4 s, and done before the window's last 0.6 s however many rows there are)
    const o = this.o, n = o.rows.length, [w0, w1] = this.window(f);
    const p = progressOf(o, f, Math.min(Math.max(1.4, 0.2 * (n + 2)), Math.max(0.4, w1 - w0 - 0.8)));
    const h = o.highlight === undefined ? undefined : val(o.highlight, f), hi = new Set(h === undefined ? [] : Array.isArray(h) ? h : [h]);
    for (const i of hi) if (!(Number.isInteger(i) && i >= 0 && i < n)) throw new Error(`table: highlight ${i} is not a row (0 to ${n - 1})`);
    this.layer.$$('tbody tr').forEach((e, i) => this.layer.set(e, { vars: { k: growth(p, i, n, o.stagger !== false).toFixed(4) }, class: { hi: hi.has(i) } }));
  }
}
