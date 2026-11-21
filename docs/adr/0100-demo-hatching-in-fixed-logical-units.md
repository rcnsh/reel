# The demo's hatching is sized in a fixed logical unit

The background shader of `examples/demo/scenes/hello.ts` (`Hello.bg`) divides `FRAG_PX` by the constant 1080.0, not by the frame's height. `FRAG_PX` is already in logical px, so a fixed divisor keeps the noise and the engraved hatching the same size at every frame size and aspect (16:9, vertical, square); dividing by `H` would stretch or shrink the texture with the frame.
