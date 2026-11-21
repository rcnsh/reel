# Tests size slow work for SwiftShader

CI and the Linux goldens render with SwiftShader (software GL, no GPU), where a frame costs far more than on a GPU, so tests that render a lot branch on `glBackend() === 'swiftshader'`.

- `tests/daemon.test.ts`, `LONG_CHECK`: the lanes test needs a check long enough to outlast a still rendered on a second page. On a GPU that is a frame every 0.01 s; under SwiftShader a checked frame takes about a second, so it checks one frame every 0.1 s over the first 3 s instead.
- `tests/golden.test.ts`: the golden test's timeout is 1,200,000 ms under SwiftShader against 180,000 ms elsewhere, because software rendering on a Linux machine without a GPU takes minutes over the `--samples auto` frames.

## Consequences

Making these values the same on every backend either makes the GPU runs slow for nothing or makes the SwiftShader runs time out or end the check before the still has started.
