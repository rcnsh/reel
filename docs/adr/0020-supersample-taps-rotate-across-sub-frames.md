# Supersample taps cycle and rotate across sub-frames

Shaders that supersample with the 4 rotated-grid taps (`SS_TAP`, `rgss`) take one tap per sub-frame in a motion-blurred render (`sub()` in `Engine.render`, `src/engine/engine.ts`). The cycling is on only when every set of sub-frames holds a multiple of 4 (adaptive sets always do; a fixed `--samples N` only when N is), so each tap is taken equally often and the average is the same image for a quarter of the shading cost.

The tap of sub-frame k is `(k + (k >> 2)) % 4`: the cycle is rotated by one every 4 sub-frames, so a tap does not always land in the same part of the shutter.
