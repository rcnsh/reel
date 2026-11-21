# VideoClip uploads frames through three.js's state cache

`VideoClip.store` in `src/kit/video.ts` uploads each decoded `VideoFrame` with raw WebGL (`texStorage2D`, `texSubImage2D`), but binds the texture and sets `UNPACK_FLIP_Y_WEBGL`, `UNPACK_PREMULTIPLY_ALPHA_WEBGL` and `UNPACK_COLORSPACE_CONVERSION_WEBGL` through `renderer.state`, as the HTML layers do. Set behind three's back, those would leave its state cache out of step with GL and break its next uploads. The browser converts the frame's YUV to sRGB in the upload, into an `SRGB8_ALPHA8` texture.
