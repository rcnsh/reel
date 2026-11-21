export function maskSubFrames(renderer: string) { return softwareGL(renderer); }

export function softwareGL(renderer: string) { return /swiftshader|llvmpipe|lavapipe|softpipe/i.test(renderer); }
