# EXR alpha is marked premultiplied where ffmpeg can say so

The linear frame's alpha is premultiplied, as EXR's is. `ffmpegArgs` in `cli/formats.ts` adds `setparams=alpha_mode=premultiplied`, which tells ffmpeg the alpha is already premultiplied, so it converts nothing. Only ffmpeg 8 and later track alpha modes. `ffmpegHasAlphaModes` probes for them by looking for `alpha_mode` in the `setparams` filter's help, and `FfmpegInput.alphaModes` leaves the filter out on an older ffmpeg, which passes the values through unchanged anyway.
