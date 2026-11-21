# Clip time maps on the output frame grid

`src/engine/cliptime.ts` maps video time to a clip's scene time (`sceneTime`, `sceneRate`) and back (`videoTime`, `videoSound`). A few choices in it are not visible from the arithmetic.

`clipTime`'s `gridFrom` rounds up to the 1/fps grid with a 1e-6 tolerance (`Math.ceil(x * fps - 1e-6)`), so a clip starting at k / fps starts on frame k despite float error. `sceneTime` is not clamped to the clip's window: motion-blur sub-frames reach past both ends of it. `sceneRate` stays non-zero through the last frame played and drops to 0 only past it (`t - start > last + 1e-9`): the last frame still moves, and the hold starts after it.

Going back, `videoTime` on a reversed clip lands a scene time that falls inside the last frame's worth of the run (which the reversed run starts inside) at the clip's start. On a forward clip a scene moment after the last frame played but before the hold still lands, as a sound starting there does. `videoSound` trims a sound that has a `duration` to where the clip stops playing its scene; a sound without one plays on, as it would on a clip without remapping.
