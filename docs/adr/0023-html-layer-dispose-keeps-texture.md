# An HTML layer's dispose leaves its texture to the GL context

`HtmlLayer.dispose` in `src/engine/html.ts` disconnects the layer's mutation observer, removes its element and drops it from the registry, but does not delete its WebGL texture (`glTex`). The texture belongs to the engine's GL context, and a layer is disposed when its clip's scene is dropped (`htmlLayers.drop`, on a reload), which can happen while a frame that still samples the texture is in flight. Deleting it there would race that frame.

## Consequences

A disposed layer's texture stays allocated until the context goes away.
