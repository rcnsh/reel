# Stepping back within a shutter is not a seek

`compositeTrack` in `src/engine/engine.ts` treats a clip's time as a seek (stateful scenes reset and pre-roll) only when the page seeked, the clip has not rendered, or its time moved by more than 0.25 s from its last render. Sub-frames of one frame step back within its shutter, and adaptive sampling renders them out of order; counting any backward step as a seek would reset and pre-roll a stateful scene for every sub-frame.
