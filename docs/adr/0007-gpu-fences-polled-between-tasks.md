# GPU fences are polled between tasks on a MessageChannel

`waitFence` in `src/engine/engine.ts` (used by `readFinish` and `gpuIdle`) polls `clientWaitSync` with a zero timeout. A WebGL sync object's status only changes between tasks, so the loop must yield to the event loop between polls. It yields with `yieldTask`, a message posted on a `MessageChannel`, which resolves on the next task with no timer clamping; `setTimeout(0)` is subject to timer clamping. `setTimeout` is only the fallback where `MessageChannel` does not exist.
