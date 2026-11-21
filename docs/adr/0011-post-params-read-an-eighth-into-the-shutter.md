# Post parameters are read 1/8 of the shutter after t

In a motion-blurred render, `Engine.render` (`src/engine/engine.ts`) takes the frame's post parameters (shake, flash, zoom, fades) from one sub-frame: the one nearest `POST_U = 0.125` of the shutter after t (ties go to the later one). That is where the videos were tuned (with 4 sub-frames, the third sits there) and a point every adaptive set includes, so a frame's post does not change with the sub-frame count. As a consequence a flash that starts between t and that point shows at its peak on this frame, not one frame later.
