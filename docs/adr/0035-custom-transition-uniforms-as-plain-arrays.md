# Custom transition uniforms are uploaded as plain arrays

`TransitionPass.customPass` in `src/engine/transitions.ts` stores each custom transition uniform's value as a number or a plain array, never as a `THREE.Vector2`/`Vector3`/`Vector4`. three.js uploads a plain array as it is to float, int and bool vectors alike, so one representation serves `vec`, `ivec`, `uvec` and `bvec` uniforms that a pasted gl-transitions shader declares itself. Vector objects would only fit float vectors.
