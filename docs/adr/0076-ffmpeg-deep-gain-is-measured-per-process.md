# ffmpeg's 16-bit gain is measured, not assumed

Some ffmpeg builds' swscale scales 16-bit RGB input as if its full scale were 255 x 256 rather than 65535, a gain of 1.0039 that brightens a 10-bit export by up to 3.4 codes. Homebrew's ffmpeg 9 does it on every path. A static ffmpeg 7 does it only on the way to limited range, so a probe on another path would miss it.

`ffmpegDeepGain` in `cli/formats.ts` measures the gain once per process. It converts a grey of `GAIN_GREY` (60000) through the very conversion the deep formats use (`toYuv709` to `yuv444p16le`) and compares the luma with `GAIN_Y`, the limited-range value an exact conversion gives (`deepGainOf`). The deep formats divide the gain out first (`lutrgb` in `toYuv709`), so they come out at the levels the page rendered.
