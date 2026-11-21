# Animated WebP defaults to quality 88

`WEBP_QUALITY` in `cli/formats.ts` is 88 because at 80, flat dark areas (a night sky, a gradient) show blocks. Both the libwebp_anim path and the img2webp path (`webpArgs`) use it as the default when `--quality` is not given.
