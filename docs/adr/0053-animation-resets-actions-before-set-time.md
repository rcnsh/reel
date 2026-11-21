# Animation resets every action before setting the time

`Animation.at` in `src/three/animate.ts` calls `reset()` on every action before `mixer.setTime(t)`. In three.js a `LoopOnce` clip that has played to its end pauses itself, and `setTime` would leave it paused there, so a seek back to an earlier time would keep the final pose. Resetting first makes every call start from scratch, so the pose depends on `t` alone.
