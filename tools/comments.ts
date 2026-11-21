#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export type Lang = 'ts' | 'py' | 'html' | 'yaml';

export interface Comment {
  start: number;
  end: number;
  line: number;
  endLine: number;
  text: string;
  ownLine: boolean;
  inTemplate: boolean;
  pragma: boolean;
}

export const ROOT = join(import.meta.dir, '..');
export const BASELINE = join(ROOT, 'comments-baseline.json');

const LICENCE = /\bCopyright (\(c\)|©|\d{4})|SPDX-License-Identifier:|@license\b|\((?:[^()]*,\s*)?(MIT|BSD-[23]-Clause|Apache-2\.0|ISC|MPL-2\.0|OFL-1\.1)\)/;
const PRAGMA_TS = new RegExp(String.raw`^\/\/\/\s*<reference\b|^\/\/\s*@ts-(expect-error|ignore|nocheck)\b|^\/\*\s*(@vite-ignore|glsl|css|html)\s*\*\/$|^#!|` + LICENCE.source);
const PEP723 = /^# \/\/\/ [a-zA-Z0-9-]+$\n(?:^#(?:| .*)$\n)+^# \/\/\/$/gm;
const PRAGMA_PY = /^#!|^#\s*(noqa|type:\s*ignore|pragma\b)|^#\s*\/\/\/(\s|$)|^#\s*[a-z-]+\s*=|^#\s*dependencies\s*=|^#\s*\]|^#\s+"/;

export function langOf(file: string): Lang | null {
  if (/\.(ts|tsx|js|mjs|cjs)$/.test(file) || /(^|\/)tsconfig[^/]*\.json$/.test(file)) return 'ts';
  if (/\.py$/.test(file)) return 'py';
  if (/\.html$/.test(file)) return 'html';
  if (/\.ya?ml$/.test(file)) return 'yaml';
  return null;
}

const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);

function lineStarts(src: string): number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return starts;
}

function lineAt(starts: number[], pos: number): number {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

type Span = { start: number; end: number; inTemplate: boolean };

function scanTsSpans(src: string, from = 0, to = src.length): Span[] {
  const spans: Span[] = [];
  const stack: ('`' | '{')[] = [];
  let i = from;
  let prev = '';
  let tq = '';
  const blockEnd = (j: number) => {
    const k = src.indexOf('*/', j + 2);
    return k < 0 || k >= to ? to : k + 2;
  };
  while (i < to) {
    const c = src[i], d = src[i + 1];
    if (stack[stack.length - 1] === '`') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { stack.pop(); i++; prev = ')'; tq = ''; continue; }
      if (c === '$' && d === '{') { stack.push('{'); i += 2; prev = '('; continue; }
      if (c === '\n') { tq = ''; i++; continue; }
      if (tq) { if (c === tq) tq = ''; i++; continue; }
      if (c === '"' || c === "'") { tq = c; i++; continue; }
      const before = i === 0 ? '\n' : src[i - 1];
      if (c === '/' && (d === '/' || d === '*') && /[\s;{}()`]/.test(before)) {
        let j = i + 2;
        while (j < to) {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '`' || (src[j] === '$' && src[j + 1] === '{')) break;
          if (d === '/' && src[j] === '\n') break;
          if (d === '*' && src[j] === '*' && src[j + 1] === '/') { j += 2; break; }
          j++;
        }
        j = Math.min(j, to);
        spans.push({ start: i, end: j, inTemplate: true });
        i = j;
        continue;
      }
      i++;
      continue;
    }
    if (c === '/' && d === '/') {
      let j = i;
      while (j < to && src[j] !== '\n') j++;
      spans.push({ start: i, end: j, inTemplate: false });
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      const j = blockEnd(i);
      spans.push({ start: i, end: j, inTemplate: false });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < to && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      i = j + 1;
      prev = ')';
      continue;
    }
    if (c === '`') { stack.push('`'); i++; continue; }
    if (c === '{') { if (stack.length) stack.push('{'); i++; prev = '{'; continue; }
    if (c === '}') {
      if (stack[stack.length - 1] === '{') stack.pop();
      i++;
      prev = '}';
      continue;
    }
    if (c === '/') {
      const regex = prev === '' || /[(,=:[!&|?{};+\-*%<>~^}]/.test(prev) || KEYWORDS_BEFORE_REGEX.has(prev);
      if (regex) {
        let j = i + 1, cls = false;
        while (j < to && src[j] !== '\n') {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') cls = true;
          else if (src[j] === ']') cls = false;
          else if (src[j] === '/' && !cls) break;
          j++;
        }
        i = j + 1;
        prev = ')';
        continue;
      }
      i++;
      prev = '/';
      continue;
    }
    if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i;
      while (j < to && /[A-Za-z0-9_$]/.test(src[j])) j++;
      prev = src.slice(i, j);
      if (!KEYWORDS_BEFORE_REGEX.has(prev)) prev = 'x';
      i = j;
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return spans;
}

function scanPySpans(src: string): Span[] {
  const spans: Span[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '#') {
      let j = i;
      while (j < src.length && src[j] !== '\n') j++;
      spans.push({ start: i, end: j, inTemplate: false });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      const triple = src.startsWith(c.repeat(3), i);
      const q = triple ? c.repeat(3) : c;
      let j = i + q.length;
      while (j < src.length && !src.startsWith(q, j) && (triple || src[j] !== '\n')) j += src[j] === '\\' ? 2 : 1;
      i = j + q.length;
      continue;
    }
    i++;
  }
  return spans;
}

function scanYamlSpans(src: string): Span[] {
  const spans: Span[] = [];
  let pos = 0;
  for (const line of src.split('\n')) {
    let quote = '';
    for (let k = 0; k < line.length; k++) {
      const c = line[k];
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '#' && (k === 0 || /\s/.test(line[k - 1]))) {
        spans.push({ start: pos + k, end: pos + line.length, inTemplate: false });
        break;
      }
    }
    pos += line.length + 1;
  }
  return spans;
}

function scanCssSpans(src: string, from: number, to: number): Span[] {
  const spans: Span[] = [];
  let i = from;
  while (i < to) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < to && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      i = j + 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const k = src.indexOf('*/', i + 2);
      const j = k < 0 || k >= to ? to : k + 2;
      spans.push({ start: i, end: j, inTemplate: false });
      i = j;
      continue;
    }
    i++;
  }
  return spans;
}

function scanHtmlSpans(src: string): Span[] {
  const spans: Span[] = [];
  const re = /<!--[\s\S]*?-->|<script\b[^>]*>([\s\S]*?)<\/script>|<style\b[^>]*>([\s\S]*?)<\/style>/g;
  for (const m of src.matchAll(re)) {
    const at = m.index!;
    if (m[0].startsWith('<!--')) spans.push({ start: at, end: at + m[0].length, inTemplate: false });
    else {
      const body = m[1] ?? m[2] ?? '';
      const from = at + m[0].indexOf('>') + 1;
      spans.push(...(m[1] !== undefined ? scanTsSpans(src, from, from + body.length) : scanCssSpans(src, from, from + body.length)));
    }
  }
  return spans;
}

export function scanComments(src: string, lang: Lang): Comment[] {
  const spans = lang === 'ts' ? scanTsSpans(src) : lang === 'py' ? scanPySpans(src) : lang === 'yaml' ? scanYamlSpans(src) : scanHtmlSpans(src);
  const starts = lineStarts(src);
  const out: Comment[] = [];
  const pep723 = lang === 'py' ? [...src.matchAll(PEP723)].map((m) => [m.index!, m.index! + m[0].length]) : [];
  for (const s of spans) {
    const text = src.slice(s.start, s.end);
    const line = lineAt(starts, s.start);
    const endLine = lineAt(starts, Math.max(s.start, s.end - 1));
    const lineStart = starts[line - 1];
    const lineEndIdx = src.indexOf('\n', s.end);
    const after = src.slice(s.end, lineEndIdx < 0 ? src.length : lineEndIdx);
    const ownLine = src.slice(lineStart, s.start).trim() === '' && after.trim() === '';
    let pragma = false;
    if (lang === 'py') {
      pragma = pep723.some(([a, b]) => s.start >= a && s.start < b) || (line === 1 && text.startsWith('#!')) || /^#\s*(noqa|type:\s*ignore|pragma\b)/.test(text);
    } else if (lang === 'ts' || lang === 'html') pragma = PRAGMA_TS.test(text.trim()) && (!s.inTemplate || LICENCE.test(text));
    out.push({ start: s.start, end: s.end, line, endLine, text, ownLine, inTemplate: s.inTemplate, pragma });
  }
  return out;
}

export function deleteComments(src: string, lang: Lang, lines: Set<number>): { src: string; deleted: number; matched: number } {
  const targets = scanComments(src, lang).filter((c) => !c.pragma && lines.has(c.line));
  const matched = new Set(targets.map((c) => c.line)).size;
  let out = src;
  for (const c of [...targets].sort((a, b) => b.start - a.start)) {
    if (c.ownLine) {
      const ls = out.lastIndexOf('\n', c.start - 1) + 1;
      let le = out.indexOf('\n', c.end);
      le = le < 0 ? out.length : le + 1;
      out = out.slice(0, ls) + out.slice(le);
    } else {
      let s = c.start;
      while (s > 0 && (out[s - 1] === ' ' || out[s - 1] === '\t')) s--;
      const tail = out.slice(c.end).match(/^[ \t]*/)![0].length;
      const nextIsEol = c.end + tail >= out.length || out[c.end + tail] === '\n';
      const breaks = c.text.includes('\n') && !nextIsEol;
      const left = nextIsEol || breaks ? s : c.start, right = nextIsEol ? c.end : c.end + tail;
      const glue = breaks ? '\n' : /[\w$]/.test(out[left - 1] ?? '') && /[\w$]/.test(out[right] ?? '') ? ' ' : '';
      out = out.slice(0, left) + glue + out.slice(right);
    }
  }
  return { src: collapseBlankRuns(out, src), deleted: targets.length, matched };
}

function collapseBlankRuns(out: string, before: string): string {
  if (/\n\s*\n\s*\n/.test(before)) return out;
  return out.replace(/\n([ \t]*\n){2,}/g, '\n\n');
}

export function stripComments(src: string, lang: Lang): string {
  const cs = scanComments(src, lang).filter((c) => !c.inTemplate);
  let out = '', at = 0;
  for (const c of cs) { out += src.slice(at, c.start) + ' '; at = c.end; }
  return (out + src.slice(at)).replace(/\s+/g, ' ').trim();
}

export function trackedFiles(root = ROOT): string[] {
  const res = Bun.spawnSync(['git', '-c', `safe.directory=${root}`, 'ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root });
  if (!res.success) throw new Error(`git ls-files failed in ${root}: ${res.stderr.toString().trim()}`);
  return res.stdout.toString().split('\n').filter((f) => f && langOf(f) && !/^(patches|public|node_modules)\//.test(f) && existsSync(join(root, f)));
}

export function countAll(root = ROOT): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of trackedFiles(root)) {
    const n = scanComments(readFileSync(join(root, f), 'utf8'), langOf(f)!).filter((c) => !c.pragma).length;
    if (n) counts[f] = n;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export function readBaseline(): Record<string, number> {
  return existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
}

export interface Ratchet { over: string[]; under: string[] }

export function compare(current: Record<string, number>, baseline: Record<string, number>): Ratchet {
  const over: string[] = [], under: string[] = [];
  for (const [f, n] of Object.entries(current)) {
    const b = baseline[f] ?? 0;
    if (n > b) over.push(`${f}: ${n} comments, baseline ${b}`);
    else if (n < b) under.push(`${f}: ${n} comments, baseline ${b}`);
  }
  for (const [f, b] of Object.entries(baseline)) if (!(f in current)) under.push(`${f}: 0 comments, baseline ${b}`);
  return { over, under };
}

function writeBaseline(counts: Record<string, number>) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n');
}

const USAGE = `bun tools/comments.ts <command>
  list [paths...]           every comment with its file:line (files or folders; all tracked files when none given); --pragmas includes the exempt ones
  delete <file> <line...>   delete the comments that start on those lines (pragmas are kept)
  stats [paths...]          comments and comment-only lines per file
  check                     fail when a file has more comments than comments-baseline.json allows, or fewer (run update)
  update [--init]           lower the baseline to today's counts; refuses to raise one, and to start one without --init`;

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  const pragmas = rest.includes('--pragmas');
  const args = rest.filter((a) => !a.startsWith('--'));
  const rel = (f: string) => relative(ROOT, join(process.cwd(), f));
  const pickFrom = (paths: string[]) => {
    const all = trackedFiles();
    if (!paths.length) return all;
    return paths.map(rel).flatMap((p) => (all.includes(p) ? [p] : all.filter((f) => f.startsWith(p === '' || p === '.' ? '' : `${p.replace(/\/$/, '')}/`))));
  };
  const pick = cmd === 'list' || cmd === 'stats' ? pickFrom(args) : [];
  if (cmd === 'list') {
    for (const f of pick) {
      const lang = langOf(f);
      if (!lang) continue;
      for (const c of scanComments(readFileSync(join(ROOT, f), 'utf8'), lang)) {
        if (c.pragma && !pragmas) continue;
        const span = c.endLine > c.line ? `${c.line}-${c.endLine}` : `${c.line}`;
        const tags = [c.ownLine ? '' : 'trailing', c.inTemplate ? 'template' : '', c.pragma ? 'pragma' : ''].filter(Boolean).join(',');
        console.log(`${f}:${span}${tags ? ` [${tags}]` : ''} ${c.text.replace(/\n\s*/g, '\n    ')}`);
      }
    }
  } else if (cmd === 'delete') {
    const file = args[0] && rel(args[0]);
    const lang = file && langOf(file);
    const lines = new Set(args.slice(1).filter((a) => /^\d+$/.test(a)).map(Number));
    if (!lang || !lines.size) { console.error(USAGE); process.exit(2); }
    const path = join(ROOT, file);
    const { src, deleted, matched } = deleteComments(readFileSync(path, 'utf8'), lang, lines);
    writeFileSync(path, src);
    console.log(`${file}: deleted ${deleted} comments on ${matched} of the ${lines.size} lines given`);
    if (matched !== lines.size) process.exitCode = 1;
  } else if (cmd === 'stats') {
    let total = 0, own = 0;
    for (const f of pick) {
      const lang = langOf(f);
      if (!lang) continue;
      const cs = scanComments(readFileSync(join(ROOT, f), 'utf8'), lang).filter((c) => !c.pragma);
      const ownLines = cs.filter((c) => c.ownLine).reduce((a, c) => a + c.endLine - c.line + 1, 0);
      if (!cs.length) continue;
      total += cs.length; own += ownLines;
      console.log(`${f}\t${cs.length}\t${ownLines}`);
    }
    console.log(`TOTAL\t${total}\t${own}`);
  } else if (cmd === 'check') {
    const { over, under } = compare(countAll(), readBaseline());
    if (over.length) console.error(`Comments are banned (comments-baseline.json only shrinks):\n  ${over.join('\n  ')}`);
    if (under.length) console.error(`Fewer comments than the baseline: run \`bun tools/comments.ts update\` to lock it in:\n  ${under.join('\n  ')}`);
    if (over.length || under.length) process.exit(1);
    console.log('comments: within the baseline');
  } else if (cmd === 'update') {
    const current = countAll(), baseline = readBaseline();
    if (!existsSync(BASELINE) && !rest.includes('--init')) {
      console.error('No comments-baseline.json: start one with `update --init`');
      process.exit(1);
    }
    const { over } = compare(current, baseline);
    if (over.length && existsSync(BASELINE)) {
      console.error(`Refusing to raise the baseline:\n  ${over.join('\n  ')}`);
      process.exit(1);
    }
    writeBaseline(current);
    console.log(`baseline: ${Object.values(current).reduce((a, b) => a + b, 0)} comments in ${Object.keys(current).length} files`);
  } else {
    console.error(USAGE);
    process.exit(cmd ? 2 : 0);
  }
}
