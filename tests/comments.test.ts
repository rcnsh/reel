import { describe, expect, test } from 'bun:test';
import { compare, countAll, deleteComments, readBaseline, scanComments, stripComments } from '../tools/comments';

const texts = (src: string, lang: Parameters<typeof scanComments>[1] = 'ts') => scanComments(src, lang).filter((c) => !c.pragma).map((c) => c.text);

describe('scanComments', () => {
  test('finds line, block and JSDoc comments', () => {
    expect(texts('// a\nconst x = 1; // b\n/* c */\n/**\n * d\n */\nf();')).toEqual(['// a', '// b', '/* c */', '/**\n * d\n */']);
  });

  test('ignores slashes in strings, regex literals and URLs', () => {
    expect(texts(`const u = 'http://x'; const r = /\\/\\//g; const s = "/* no */"; const d = a / b / c;`)).toEqual([]);
    expect(texts('if (/^\\/\\/$/.test(s)) return;')).toEqual([]);
    expect(texts('const t = `see http://x and ${a / 2}`;')).toEqual([]);
  });

  test('finds GLSL comments inside template literals, past escaped backticks', () => {
    const cs = scanComments('const s = `\n  // light \\`x\\` here\n  float a = 1.0; /* b */\n`;', 'ts');
    expect(cs.map((c) => [c.text, c.inTemplate])).toEqual([['// light \\`x\\` here', true], ['/* b */', true]]);
  });

  test('ignores slashes in quoted strings inside a template, and stops a template comment at an interpolation', () => {
    expect(texts("const s = `\n  code = new CodeBlock({ code: 'const x = 1; // one' });\n`;")).toEqual([]);
    expect(texts('const s = `\n  float a; // n=${n} here\n  // uses ${`x`}\n`;')).toEqual(['// n=', '// uses ']);
  });

  test('reads only block comments in an HTML style', () => {
    expect(texts('<style>@import url(http://f/x.css); /* c */ p { color: red }</style>', 'html')).toEqual(['/* c */']);
  });

  test('exempts licence credits and closed PEP 723 blocks only', () => {
    expect(texts('// strip the copyright notice\n// hack, remove (mit)\n// Copyright (c) 2024 A\n// noise (Ashima, MIT)\n')).toEqual(['// strip the copyright notice', '// hack, remove (mit)']);
    expect(texts('x = 1\n# /// script\n# real\n', 'py')).toEqual(['# /// script', '# real']);
  });

  test('treats references, ts directives, shebangs and PEP 723 blocks as pragmas', () => {
    expect(texts('#!/usr/bin/env bun\n/// <reference path="x.d.ts" />\n// @ts-expect-error: why\nf();')).toEqual([]);
    expect(texts('const v = /* glsl */ `\n  // ---- noise (Ashima, MIT) ----\n  // a real one\n`; // carries no licence\n')).toEqual(['// a real one', '// carries no licence']);
    expect(texts('# /// script\n# dependencies = ["numpy"]\n# ///\n# real\nx = "#not"  # trailing\n', 'py')).toEqual(['# real', '# trailing']);
  });

  test('reads HTML comments and the comments in its scripts and styles', () => {
    expect(texts('<!-- a --><style>/* b */ p {}</style><script>// c\nx();</script>', 'html')).toEqual(['<!-- a -->', '/* b */', '// c']);
  });

  test('reads YAML comments but not hashes in strings', () => {
    expect(texts('# a\nkey: "x # y" # b\nurl: http://h/#frag\n', 'yaml')).toEqual(['# a', '# b']);
  });
});

describe('deleteComments', () => {
  test('removes whole-line comments with their line and trailing ones without the code', () => {
    const src = 'a();\n// gone\nb(); // gone too\n/**\n * doc\n */\nc();\n';
    const { src: out, deleted } = deleteComments(src, 'ts', new Set([2, 3, 4]));
    expect(deleted).toBe(3);
    expect(out).toBe('a();\nb();\nc();\n');
  });

  test('leaves code tokens untouched and keeps pragmas', () => {
    const src = '// @ts-expect-error: no\nconst x: number = "s"; /* why */ const y = 2;\n';
    const { src: out } = deleteComments(src, 'ts', new Set([1, 2]));
    expect(out).toBe('// @ts-expect-error: no\nconst x: number = "s"; const y = 2;\n');
    expect(stripComments(out, 'ts')).toBe(stripComments(src, 'ts').replace('// @ts-expect-error: no ', ''));
  });

  test('keeps tokens apart and line breaks that end a statement', () => {
    expect(deleteComments('let/* c */x = 1;\nreturn /*\n */ 1;\n', 'ts', new Set([1, 2])).src).toBe('let x = 1;\nreturn\n1;\n');
  });

  test('counts the lines given that held a comment', () => {
    expect(deleteComments('a(); /* x */ // y\nb();\n', 'ts', new Set([1, 2]))).toMatchObject({ deleted: 2, matched: 1 });
  });

  test('collapses the blank lines a deleted block leaves behind', () => {
    expect(deleteComments('a();\n\n// x\n\nb();\n', 'ts', new Set([3])).src).toBe('a();\n\nb();\n');
  });
});

describe('the comment ratchet', () => {
  test('no file has more comments than comments-baseline.json allows, and the baseline is current', () => {
    const { over, under } = compare(countAll(), readBaseline());
    expect(over, 'Comments are banned. Delete the new ones (see .claude/skills/delete-comment)').toEqual([]);
    expect(under, 'Fewer comments than the baseline: run `bun tools/comments.ts update`').toEqual([]);
  });

  test('compare flags new files and growth, and credits removals', () => {
    expect(compare({ 'a.ts': 3, 'new.ts': 1 }, { 'a.ts': 2, 'gone.ts': 4 })).toEqual({
      over: ['a.ts: 3 comments, baseline 2', 'new.ts: 1 comments, baseline 0'],
      under: ['gone.ts: 0 comments, baseline 4'],
    });
  });
});
