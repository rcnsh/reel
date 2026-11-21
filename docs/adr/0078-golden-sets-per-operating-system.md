# Golden frames are kept per operating system, not per GL backend

Chrome rasterises text and decodes video differently on macOS and Linux, by more than any tolerance that would still catch a real change. On one system the GL backend barely matters: on a Mac, SwiftShader and Metal differ in a few dozen pixels of text edges. So `cli/golden.ts` (`goldenDir`) keeps one set per platform (`tests/golden/<platform>/`), and the Linux set is rendered by SwiftShader, the backend of a machine without a GPU.

`renderGoldens` renders with a `Renderer` of its own per example, not the warm renderer, so the tests leave nothing running.
