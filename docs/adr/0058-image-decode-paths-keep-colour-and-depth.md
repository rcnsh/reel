# ImageBox decodes each format by the path that keeps its colours and depth

`ImageBox.load` in `src/kit/image.ts` decodes the file in the colours it was made in, and picks a path per format. A raster image goes through `createImageBitmap`, which converts an image with a colour profile (Display P3, Adobe RGB) to sRGB; an `<img>` uploaded to GL keeps its numbers and shows them as if they were sRGB, so a phone photo would come out wrong. A 16-bit PNG is decoded by reel's own decoder (`decodePng16`) into a half-float texture, because the browser decodes it to 8 bits. An SVG is rasterised (`loadSvg`) at the size it is shown, times the output scale and the furthest Ken Burns zoom, so it stays sharp.

## Considered options

- Upload an `<img>` element directly: rejected, it skips the colour-profile conversion.
- Let the browser decode 16-bit PNGs: rejected, it keeps 8 bits.
