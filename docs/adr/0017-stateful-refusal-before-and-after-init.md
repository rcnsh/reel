# A stateful scene is refused before and after init

`loadEntry` in `src/engine/engine.ts` refuses a stateful scene on a clip whose remapping its pre-roll cannot re-create (`statefulBlocker`: reverse, freeze, an offset, a hold). The check runs right after construction, to spare `init()`'s work when the scene already declares `stateful`, and again after `init()`, because a scene may set `stateful` there.
