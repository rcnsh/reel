# Video frame lookup allows a hair of float error

`frameAt` in `src/kit/video-time.ts` compares each frame's `pts` with the source time plus `1e-7` (and `trimFrames` uses the same tolerance at the trim's end). A source time computed as `k / fps` comes out a hair below the frame's presentation time in floating point; without the tolerance it would land on frame `k - 1` instead of frame `k`.
