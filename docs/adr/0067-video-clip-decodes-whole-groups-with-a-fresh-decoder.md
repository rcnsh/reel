# VideoClip decodes whole groups of pictures, each with a fresh decoder

`VideoClip` in `src/kit/video.ts` decodes frames itself with WebCodecs from the MP4's samples, so a frame depends on its time alone. Several choices keep that true and quick:

- `parseMp4` takes presentation times from the first shown frame (`cts - t0`), so an edit list's B-frame delay drops out and the first frame is at 0.
- `texSize` is the size of the decoded frames (from the first one), not the track header's display size, which can differ by pixel aspect or crop.
- `decoderFor` makes one fresh `VideoDecoder` per group of pictures: a fresh decoder needs nothing from the last, so a group decodes the same after any other, whatever order frames are asked for in.
- `ensure` keeps, besides the frames needed, the ones a playing export shows next (after them, or before them on a reversed clip): those decode on the way to the ones needed anyway, so the next output frame does not decode the group again.
