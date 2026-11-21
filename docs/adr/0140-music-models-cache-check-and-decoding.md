# music_models.py's cache check and decoding

`cached` in `tools/music_models.py` finds the PyTorch Demucs weights by the file name `955717e8-*.th`. That is the name demucs gives htdemucs's one checkpoint in torch hub's cache.

Off Apple Silicon, `separate` decodes the song with ffmpeg rather than with a Python audio library. reel needs ffmpeg anyway, and it reads any format the song comes in the same way.
