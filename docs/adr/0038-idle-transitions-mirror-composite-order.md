# idleTransitions judges overlaps in the compositor's order, by whole frames

`idleTransitions` in `src/engine/transitions.ts` warns about a clip whose `transition` never plays. The clips it counts as "before" a clip on its track are those that start earlier, or start at the same time and come earlier in the timeline: the order the engine composites a track in (`compositeTrack` in `src/engine/engine.ts` stable-sorts a track's clips by start). Using any other order would warn about transitions that do play, or miss ones that do not.

An overlap shorter than one frame (`frame`, 1 / FPS) shows on no frame, so it is a cut and counts as idle. The comparison allows 1e-6 of slack, so an overlap written as a float start such as `9 - 1/30` still counts as one frame.
