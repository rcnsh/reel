import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import glsl from 'highlight.js/lib/languages/glsl';
import go from 'highlight.js/lib/languages/go';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import type { Frame } from '../engine/scene';
import { clamp } from '../engine/util';
import { esc, HtmlComponent, safeBox, UNIT, val, type Anim, type ComponentOptions } from './common';

const LANGS = { bash, cpp, css, diff, glsl, go, javascript, json, python, rust, sql, typescript, xml, yaml };
for (const [name, def] of Object.entries(LANGS)) if (!hljs.getLanguage(name)) hljs.registerLanguage(name, def);
export const CODE_LANGUAGES = Object.keys(LANGS);

export interface CodeBlockOptions extends ComponentOptions {
  code: string;
  /** A language from CODE_LANGUAGES or an alias (default: plain text). An unknown one is an error. */
  lang?: string;
  /** The largest font size in px (default 3.4% of the short side); it shrinks so the longest line and every line fit. */
  size?: number;
  lineNumbers?: boolean;
  highlight?: Anim<number[]>;
  reveal?: Anim<number>;
  /** A title bar (a file name), and the panel behind the code (default true). */
  title?: string;
  panel?: boolean;
}

export function splitHighlighted(html: string): string[] {
  const out: string[] = [], open: string[] = [];
  let cur = '';
  for (const tok of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (!tok) continue;
    if (tok === '\n') { out.push(cur + '</span>'.repeat(open.length)); cur = open.join(''); }
    else if (tok.startsWith('<span')) { open.push(tok); cur += tok; }
    else if (tok === '</span>') { open.pop(); cur += tok; }
    else cur += tok;
  }
  out.push(cur + '</span>'.repeat(open.length));
  return out;
}

export class CodeBlock extends HtmlComponent {
  private o: CodeBlockOptions;
  readonly lines: string[];
  constructor(o: CodeBlockOptions) {
    const box = o.box ?? safeBox(0.1);
    const lang = o.lang && hljs.getLanguage(o.lang) ? o.lang : undefined;
    if (o.lang && !lang) throw new Error(`CodeBlock: no language '${o.lang}' (it highlights ${CODE_LANGUAGES.join(', ')})`);
    const code = o.code.replace(/\t/g, '  ').replace(/\s+$/, '');
    const lines = splitHighlighted(lang ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value : esc(code));
    const raw = code.split('\n'), longest = Math.max(1, ...raw.map((l) => l.length)) + (o.lineNumbers ? String(raw.length).length + 2 : 0);
    const pad = Math.round(UNIT * 0.03), titleH = o.title ? Math.round(UNIT * 0.06) : 0, lh = 1.5;
    const size = Math.max(6, Math.min(o.size ?? Math.round(UNIT * 0.034), (box.w - pad * 2) / (longest * 0.6 + 0.5), (box.h - pad * 2 - titleH) / (lines.length * lh)));
    super(o, {
      box, label: 'code block',
      html: `<div class="frame"><div class="panel">${o.title ? `<div class="bar"><span class="dots"><i></i><i></i><i></i></span><span class="name">${esc(o.title)}</span></div>` : ''}<pre class="code">${lines.map((l, i) => `<div class="ln" data-label="line ${i + 1}">${o.lineNumbers ? `<span class="no">${i + 1}</span>` : ''}${l || ' '}</div>`).join('')}</pre></div></div>`,
      css: `.frame { position: absolute; inset: 0; display: grid; align-content: center; }
        .panel { ${o.panel === false ? '' : 'background: color-mix(in srgb, var(--fg) 7%, var(--bg)); border: 1px solid color-mix(in srgb, var(--fg) 14%, transparent);'} border-radius: ${Math.round(UNIT * 0.014)}px; overflow: hidden; }
        .bar { height: ${titleH}px; display: flex; align-items: center; gap: ${pad}px; padding: 0 ${pad}px; border-bottom: 1px solid color-mix(in srgb, var(--fg) 12%, transparent);
          font: 500 ${Math.round(titleH * 0.4)}px 'IBM Plex Mono'; color: color-mix(in srgb, var(--fg) 65%, var(--bg)); }
        .dots { display: flex; gap: ${Math.round(titleH * 0.16)}px; } .dots i { width: ${Math.round(titleH * 0.2)}px; height: ${Math.round(titleH * 0.2)}px; border-radius: 50%; background: color-mix(in srgb, var(--fg) 25%, transparent); }
        .code { margin: 0; padding: ${pad}px; font: 400 ${size.toFixed(2)}px/${lh} 'IBM Plex Mono'; color: var(--fg); white-space: pre; tab-size: 2; }
        .ln { transition: none; }
        .ln.hide { visibility: hidden; }
        .code.focus .ln:not(.on) { opacity: .35; }
        .no { display: inline-block; width: ${String(raw.length).length + 1}ch; margin-right: 1ch; text-align: right; color: color-mix(in srgb, var(--fg) 40%, var(--bg)); }
        .hljs-keyword, .hljs-built_in, .hljs-selector-tag, .hljs-meta .hljs-keyword, .hljs-doctag, .hljs-section, .hljs-name { color: color-mix(in srgb, var(--accent) 72%, var(--fg)); }
        .hljs-string, .hljs-regexp, .hljs-addition, .hljs-attribute, .hljs-template-tag, .hljs-selector-attr { color: color-mix(in srgb, var(--accent) 55%, var(--fg)); }
        .hljs-number, .hljs-literal, .hljs-symbol, .hljs-bullet, .hljs-variable.constant_, .hljs-deletion { color: color-mix(in srgb, var(--accent) 72%, var(--fg)); font-weight: 600; }
        .hljs-title, .hljs-title.function_, .hljs-title.class_, .hljs-type { font-weight: 600; }
        .hljs-comment, .hljs-quote, .hljs-meta { color: color-mix(in srgb, var(--fg) 50%, var(--bg)); font-style: italic; }
        .hljs-attr, .hljs-property, .hljs-params, .hljs-variable { color: color-mix(in srgb, var(--fg) 82%, var(--accent)); }`,
    });
    this.o = o;
    this.lines = lines;
  }

  protected update(f: Frame) {
    const o = this.o, n = this.lines.length;
    const shown = o.reveal === undefined ? n : Math.floor(clamp(val(o.reveal, f), 0, n) + 1e-6);
    const hi = o.highlight ? new Set(val(o.highlight, f)) : null;
    this.layer.set('.code', { class: { focus: !!hi && hi.size > 0 } });
    this.layer.$$('.ln').forEach((e, i) => this.layer.set(e, { class: { hide: i >= shown, on: !!hi?.has(i + 1) } }));
  }
}
