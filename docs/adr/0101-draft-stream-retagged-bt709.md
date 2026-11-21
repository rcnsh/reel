# The draft's WebCodecs stream is retagged BT.709

The browser tags the H.264 stream its `VideoEncoder` makes from the canvas with the canvas's sRGB transfer. `exportEncoded` (`cli/video.ts`) retags it BT.709, as every other YUV stream reel writes: in the bitstream (`-bsf:v h264_metadata=transfer_characteristics=1`) and in the MP4's `colr` box (`-color_trc bt709`), which ffmpeg otherwise writes from the input's tags.
