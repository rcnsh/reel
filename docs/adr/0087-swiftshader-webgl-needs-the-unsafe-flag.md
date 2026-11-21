# SwiftShader renders launch Chrome with --enable-unsafe-swiftshader

Since Chrome 137, WebGL on SwiftShader is behind `--enable-unsafe-swiftshader`. `glArgs` in `cli/chrome.ts` passes it for the `swiftshader` backend. That's safe because reel's Chrome renders only reel's own pages, never untrusted content.
