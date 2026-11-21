# A kit window may end at Infinity

`windowOf` in `src/kit/common.ts` turns a component's `at` into clip seconds and refuses every non-finite number, except `Infinity` as the window's end. `[2, Infinity]` means "from 2 s to the end of the clip", which `motionAt` handles like any other end. Tightening the check to `Number.isFinite` for both ends would break those windows.
