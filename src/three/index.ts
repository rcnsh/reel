// The 3D kit: a stage that renders three.js into a scene's target with the sampler's jitter, camera rigs as functions
// of time, loaders, animation sampled at a time, instancing, HTML on planes, and what `reel check` sees of it.
export * from './stage';
export * from './camera';
export * from './load';
export * from './animate';
export * from './plane';
export { projectBox, corners, type Projected } from './project';
export { halton, subPixel, lensSample, lightSample, concentric } from './jitter';
