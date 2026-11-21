# Transparent video formats carry straight alpha

`ffmpegArgs` in `cli/formats.ts` writes straight (unpremultiplied) alpha for both transparent video formats, because that is how their readers interpret it:

- ProRes 4444 puts alpha in the alpha plane (`yuva444p10le`, 16 alpha bits). Editors and ffmpeg read ProRes 4444 alpha as straight.
- VP9 WebM keeps alpha as a second stream that libvpx encodes from `yuva420p`. Browsers composite it as straight alpha.
