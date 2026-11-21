# A camera pose without a field of view uses the stage's own

`Stage3D.camera` in `src/three/stage.ts` sets the camera's `fov` on every call to the pose's `fov`, else the stage's `fov` option, else 35. It never keeps the field of view the previous pose left on the camera.

Frames render in any order (export workers take chunks, `--samples auto` renders sub-frames out of order, stills seek anywhere), so a field of view carried over from the pose placed before would make a frame depend on the frame rendered before it. Resetting it per call keeps a frame a function of `t` alone.
