# The media example's assets are generated with seeking and fonts in mind

`examples/media/make_assets.ts` makes the clip, the Lottie badge and the SVG mark from code. Three choices in it are deliberate:

- The clip is encoded with a keyframe every second (`-g 30` at 30 fps), so a decoder seeking to any time in it has at most a second of frames to decode: seeks are quick, which the engine's frame-by-frame decoding of `VideoClip` relies on.
- Each Lottie layer starts on its own frame (`ip` in `layer`): a stroke drawn on with round caps shows a dot while its trim is still at 0, so a layer appears only when its draw-on begins (the tick at frame 17 for a trim from 16, the ring at 5 for a trim from 4).
- The SVG mark is shapes only, with no text, so it depends on no font being installed.
