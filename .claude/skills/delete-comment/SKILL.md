---
name: delete-comment
description: Classify every comment in a path, delete it, and move what it knew into an ADR or an issue; then lower the comment ratchet.
disable-model-invocation: true
---

# Delete comments

reel bans code comments. `comments-baseline.json` holds the most comments each file may have, and `tests/comments.test.ts` fails when a file has more than its baseline, or fewer without the baseline being updated, so it only ever ratchets down. This skill drains it: a pass over a path, file or folder (the argument; the whole repo when none) that leaves every comment in it deleted, or kept for a reason the report names.

## The tool

`tools/comments.ts` is the one scanner the ratchet and this skill share (TS/JS, GLSL and CSS in template literals, Python, HTML, YAML).

- `bun tools/comments.ts stats [paths]`: comments and comment-only lines per file; start here to size the pass.
- `bun tools/comments.ts list [paths]`: every comment as `file:line[-end] [trailing|template] text`. Pragmas (`/// <reference>`, `@ts-expect-error`, `/* glsl */` markers, licence credits, shebangs, PEP 723 blocks) are exempt: never listed, counted or deleted.
- `bun tools/comments.ts delete <file> <line...>`: deletes the comments that start on those lines, taking a whole-line comment's line and leaving a trailing comment's code. One call per file, with every line from a `list` taken *before* that file changed (lines shift after a delete). It prints how many of the lines given held a comment; any short of all means a line was wrong.
- `bun tools/comments.ts check` / `update`: the ratchet; `update` lowers the baseline and refuses to raise it. A change to the scanner itself can move counts either way: then rebuild with `rm comments-baseline.json && bun tools/comments.ts update --init`, and say why in the commit.

Delete through the tool, never by hand, and change no code in the same pass: a comment pass that also refactors can't be reviewed as one.

## Categories

Read each comment against the code under it, and grep the repo for any claim it makes. Each goes in exactly one bucket:

| Bucket | What it is | Action |
| --- | --- | --- |
| **tautology** | Says what the code says: a name restated, a banner, a JSDoc repeating the signature. Also a fact `docs/ENGINE.md`, `README.md`, `PLAYBOOK.md`, `CLAUDE.md` or `skills/**` already holds (name where). | Delete. |
| **stale** | Wrong about the code now: a name, flag, default, number or behaviour that changed. Cite what the code does instead. | Delete. |
| **excuse** | Lets a fixable shortcut in our own code slide: "for now", "hack", "TODO", a duplicate justified, a magic number explained away. | Delete; file an issue for the fix. |
| **decision** | A non-obvious choice a maintainer would otherwise "fix" into a bug: why this and not the obvious way, a constraint the code can't show (an upstream Chrome/ANGLE/SwiftShader/ffmpeg/three.js behaviour, a determinism or precision rule, an ordering), a rejected alternative. | Delete; record it in an ADR. |
| **contract** | Documents something a scene author or project uses (an exported engine, kit or config symbol's units, ranges, defaults or meaning) that no doc holds and the types can't show. Projects read these as editor hovers. | Keep, or move the fact into `skills/reel-authoring/reference/` and delete. |
| **generated** | Text inside a template literal that is content, not a comment on this code: a file written into a user's project (`cli/init.ts`), code shown on screen (`examples/explainer/scenes/code.ts`), test fixture data. Deleting it changes what reel outputs. GLSL in a shader string is code: classify it. | Keep. |

A workaround for something outside our control is a decision, not an excuse. Between tautology and decision, ask whether a competent maintainer reading only the code would likely break it; if so, it's a decision.

## ADRs

`docs/adr/NNNN-slug.md`, numbered on from the highest there, one per decision (several comments often record one). Before writing one, read `docs/adr/` for an existing record and extend it instead.

```md
# Short title of the decision

1-3 short paragraphs: context, what was decided, why. Name code by file and symbol, never line. Present tense. Keep every fact the comment held: numbers, upstream bug names, the failure it prevents.
```

Add `## Considered options` or `## Consequences` only when the comments name a rejected alternative or a non-obvious effect. List the new ADR in `docs/adr/README.md`.

## Issues

One per shortcut (group the comments about one), filed with the T3 `create_issue` tool or `gh issue create`, labelled `enhancement` or `bug`. The title is imperative ("Replace X with Y in Z"). The body names the file and symbol, quotes the deleted comment, says what a fix looks like and how to check it. File only real shortcuts a fix would improve.

## A large pass

Past about 400 comments, split the files into batches of about that size (keep a directory's files together) and give each to a subagent with this skill's path and its file list. Each one writes the ADR drafts and issue drafts to a scratch folder rather than numbering or filing them, so two can't take one ADR number. Each subagent deletes only in its own files and runs no tests. The lead merges duplicate ADRs, numbers them, and files the issues.

## Done

The pass is done when every comment in the path is deleted or kept as contract or generated, and:

1. `bun run typecheck` and `bun test` pass, and an engine path that lost comments has had its CLAUDE.md checks run (deleting is token-safe, but the checks stay the proof).
2. `bun tools/comments.ts update` has lowered the baseline, and `check` passes.
3. The ADRs are in `docs/adr/` and indexed, and the issues are filed.
4. The report gives counts per bucket, comment lines removed, the ADRs and issue links, and every comment kept, with its bucket.
