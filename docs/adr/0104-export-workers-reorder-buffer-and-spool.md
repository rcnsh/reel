# Exports render in parallel workers through a bounded reorder buffer and a disk spool

`exportVideo` (`cli/video.ts`) runs `workers` headless Chromes, each its own GPU process, on chunks of frames taken in order, puts the frames back in order and writes them to a single ffmpeg, so the file is the same as with one worker. One worker already keeps the GPU busy in heavy scenes; a second fills the gaps in light ones (2D drawing, readback, transfer).

A frame is acknowledged once it is written or waiting in the in-memory reorder buffer (under `--mem-gb`, about 1 GB by default), and each page keeps at most a few frames unacknowledged (`inflight: 4`), so memory stays bounded even at 4K. Past the buffer, frames go to a spool on disk (up to `--spool-gb`, default 20), so the renderers never wait for x264 in light scenes, and x264 catches up in heavy ones, where the CPU is free.

`toSpool` writes synchronously: a frame must be on disk before `drain()` looks for it, or the drain would find neither the buffered nor the spooled copy.
