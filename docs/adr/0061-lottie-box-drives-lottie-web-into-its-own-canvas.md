# LottieBox drives lottie-web into its own canvas, frame by frame

`LottieBox.load` in `src/kit/lottie.ts` calls `loadAnimation` with no container and a `rendererSettings.context` from `context2D(this.canvas)`. Given a container, lottie-web makes a canvas of its own inside it and ignores the context, so the animation would not land in the texture the box uploads.

With its data inline and no images to fetch, the animation can be loaded before `loadAnimation` returns, so `DOMLoaded` may already have fired: `load` checks `anim.isLoaded` before waiting for the event, or it would wait forever.

`LottieBox.frameAt` clamps the frame to just below `op - ip`: a Lottie's last frame is the one before `op`, since `op` itself is past every layer's end and would draw an empty frame.
