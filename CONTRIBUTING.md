# Contributing

reel is a personal tool that is open to anyone who finds it useful. Issues and pull requests are welcome; small, focused changes land fastest.

## Setting up

You need [bun](https://bun.sh) 1.4 or later, ffmpeg, and (for the Python tools) [uv](https://docs.astral.sh/uv/).

```sh
bun install
bun cli/reel.ts chrome install    # the pinned Chrome for Testing that renders use
bun run typecheck
bun test
```

## Before you open a pull request

- `bun run typecheck` and `bun test` pass. Tests that need Chrome, uv or the music models skip without them; CI runs the rest on Linux.
- Look at what you changed: `reel still --project <example> --t <times>` for a scene or a component, a short `reel video --samples auto` for anything on the export path. The checks for each kind of change are listed under **Checks** in [CLAUDE.md](CLAUDE.md), which is also the guide to the codebase's rules (determinism, logical pixels, linear colour, the project-neutral engine).
- A change meant to alter how the examples look updates the golden frames on macOS and Linux (`reel golden update`). A golden that changes when it shouldn't is the bug.
- No code comments: a decision the code can't show goes in an ADR in [`docs/adr/`](docs/adr/README.md), and an API fact goes in the docs. `bun test` holds every file to `comments-baseline.json`, which only goes down (`bun tools/comments.ts update` after removing some).
- Docs travel with the behaviour: `README.md`, `docs/ENGINE.md`, the skills in `skills/` and `reel --help` (`cli/args.ts`) describe the code as it is.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat(kit): …`, `fix(mix): …`), titles only.

## Licence

By contributing you agree that your contribution is licensed under the [MIT licence](LICENSE).
