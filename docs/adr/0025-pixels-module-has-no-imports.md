# The readback modes module imports nothing

`src/engine/pixels.ts` (`Pixels`, `PIXELS`, `yuvFits`) is shared by the page and the CLI: `cli/formats.ts` plans each export's readback with it outside the browser. It therefore has no imports. Importing an engine module from it (`gl.ts`, `format.ts`, anything touching `window`, three.js or the compile-time constants) would break the CLI's use of it.
