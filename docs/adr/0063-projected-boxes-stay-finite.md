# Projected boxes are clamped to one frame beyond each edge

`projectBox` in `src/three/project.ts` clips a box's edges at `w = EPS` where they cross the camera plane, and a corner clipped there projects towards infinity. The rectangle is clamped (`lim`) to at most one frame beyond each edge (from `-W` to `2W`, `-H` to `2H`), so what `reel check` receives stays finite and still reads as off the frame.
