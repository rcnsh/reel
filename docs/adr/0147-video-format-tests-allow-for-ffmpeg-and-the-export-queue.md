# Video format tests allow for ffmpeg versions and the export queue

`tests/video-formats.test.ts` renders with `--wait`, so each export queues behind the run's other exports instead of failing. The run has an export slot of its own (`tests/setup.ts`), so it never waits on another agent's export.

The HEVC test expects the background's luma at `64 + 876 * grey / 255`: the still's grey in limited range, with swscale's gain on 16-bit input divided out.

ffmpeg 8 decodes half-float EXRs as `gbrapf16le`, and older versions widen them to 32-bit. The test therefore accepts `gbrapf(16|32)le` as the decoded pixel format, and it checks the file's half-float channels by reading the EXR header (`exrChannels`), not ffprobe's pixel format.
