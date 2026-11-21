# A FileReader shim lets GLTFExporter run under bun

three.js's `GLTFExporter` reads Blobs through `FileReader`, which bun does not provide. `examples/product3d/make_assets.ts` installs a minimal `globalThis.FileReader` (only `readAsArrayBuffer` and `onloadend`, backed by `Blob.arrayBuffer()`) when none exists, before calling `parseAsync` with `binary: true`. It is a workaround for the runtime, not for our code; it can go when bun ships `FileReader`.
