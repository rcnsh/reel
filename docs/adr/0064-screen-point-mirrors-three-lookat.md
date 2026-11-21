# projectPoint builds the camera's axes as three.js's lookAt does

`projectPoint` in `src/three/project.ts` computes where a world point lands without three.js, for a label clip that shares a rig with a `Stage3D`. It must match `Stage3D.camera(pose)` exactly, so it builds the axes as three's `lookAt` does: back (the camera looks along `-back`), right as up `(0, 1, 0)` cross back, then up. Looking straight up or down, where that cross product vanishes, it nudges the back axis by `1e-4` in z, the same way three does, so the label lands where the stage draws the object.
