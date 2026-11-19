/**
 * Whether per-tile adaptive sampling should mask stopped tiles out of every later sub-frame on this GL renderer
 * (the WebGL RENDERER string), rather than only out of the merge into the sums (the frame is the same either
 * way). On a GPU the shading it saves costs less than the masking does (on Metal, likely because each masked
 * pass loads the depth attachment again), so only the merge is masked; on a software rasteriser (SwiftShader,
 * llvmpipe) shading is the cost, and masking pays.
 */
export function maskSubFrames(renderer: string) { return /swiftshader|llvmpipe|lavapipe|softpipe/i.test(renderer); }
